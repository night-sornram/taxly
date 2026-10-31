import { expect, it, vi } from "vitest";
import { SyncEngine } from "./engine";
import type { CloudTransport } from "./engine";
import { emptySnapshot, sameSnapshot } from "./model";
import type { LocalState, Snapshot, Upload } from "./model";
import type { SyncStore } from "./store";
const clone = structuredClone;
const initial: Snapshot = {
  categories: [{ id: "food", kind: "expense", name: "อาหาร" }],
  entries: [],
};
class Store implements SyncStore {
  state: LocalState = {
    revision: 0,
    owner_id: "owner",
    project_url: "project",
    enabled: true,
    cloud_revision: 0,
    base_snapshot: emptySnapshot(),
    snapshot: clone(initial),
    upload: null,
  };
  async read() {
    return clone(this.state);
  }
  async bind(enabled: boolean) {
    this.state.enabled = enabled;
    this.state.revision++;
  }
  async stage(expected: number, upload: Upload) {
    if (expected !== this.state.revision || this.state.upload) throw { code: "StaleRevision" };
    this.state.upload = clone(upload);
    this.state.revision++;
  }
  async accept(expected: number, snapshot: Snapshot, base: Snapshot, revision: number) {
    if (expected !== this.state.revision) throw { code: "StaleRevision" };
    this.state = {
      ...this.state,
      revision: expected + 1,
      snapshot: clone(snapshot),
      base_snapshot: clone(base),
      cloud_revision: revision,
      upload: null,
    };
  }
  edit(id: string, amount: string) {
    const old = this.state.snapshot.entries.find((e) => e.id === id);
    if (old) old.amount = amount;
    else
      this.state.snapshot.entries.push({
        id,
        date: "2026-10-31",
        category_id: "food",
        amount,
        note: "",
        tax: null,
      });
    this.state.revision++;
  }
  remove(id: string) {
    this.state.snapshot.entries = this.state.snapshot.entries.filter((e) => e.id !== id);
    this.state.revision++;
  }
}
class Cloud implements CloudTransport {
  state = { revision: 0, snapshot: emptySnapshot() };
  offline = false;
  loseResponse = false;
  subscribers = new Set<() => void>();
  receipts = new Map<string, number>();
  async read() {
    if (this.offline) throw new Error("offline");
    return clone(this.state);
  }
  async write(expected: number, snapshot: Snapshot, id: string) {
    if (this.offline) throw new Error("offline");
    if (this.receipts.has(id)) return this.receipts.get(id)!;
    if (expected !== this.state.revision) throw { code: "40001" };
    this.state = { revision: expected + 1, snapshot: clone(snapshot) };
    this.receipts.set(id, this.state.revision);
    for (const subscriber of this.subscribers) subscriber();
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("connection lost after commit");
    }
    return this.state.revision;
  }
  subscribe(changed: () => void) {
    this.subscribers.add(changed);
    return () => {
      this.subscribers.delete(changed);
    };
  }
}
it("syncs two independent devices and retains offline edits until reconnect", async () => {
  const cloud = new Cloud(),
    desktop = new Store(),
    phone = new Store();
  const a = new SyncEngine(desktop, cloud, () => {}),
    b = new SyncEngine(phone, cloud, () => {});
  await a.run();
  await b.run();
  cloud.subscribe(() => {
    void b.run();
  });
  desktop.edit("desktop", "12.34");
  await a.run();
  await vi.waitFor(() =>
    expect(phone.state.snapshot.entries).toEqual(desktop.state.snapshot.entries),
  );
  cloud.offline = true;
  phone.edit("phone", "0.20");
  await b.run();
  expect(b.status.pending).toBe(1);
  expect(phone.state.snapshot.entries).toHaveLength(2);
  cloud.offline = false;
  await b.run();
  await a.run();
  expect(sameSnapshot(phone.state.snapshot, desktop.state.snapshot)).toBe(true);
  expect(cloud.state.snapshot.entries).toHaveLength(2);
});
it("preserves both competing edits until the user resolves the conflict", async () => {
  const cloud = new Cloud(),
    aStore = new Store(),
    bStore = new Store();
  aStore.edit("same", "1.00");
  const a = new SyncEngine(aStore, cloud, () => {}),
    b = new SyncEngine(bStore, cloud, () => {});
  await a.run();
  await b.run();
  aStore.edit("same", "2.00");
  bStore.edit("same", "3.00");
  await a.run();
  await b.run();
  expect(b.status.phase).toBe("conflict");
  expect(bStore.state.snapshot.entries[0].amount).toBe("3.00");
  expect(cloud.state.snapshot.entries[0].amount).toBe("2.00");
  await b.resolve({ "entries:same": "local" });
  expect(cloud.state.snapshot.entries[0].amount).toBe("3.00");
});
it("does not duplicate a write whose successful response was lost", async () => {
  const cloud = new Cloud(),
    store = new Store(),
    engine = new SyncEngine(store, cloud, () => {});
  await engine.run();
  store.edit("single", "5.00");
  cloud.loseResponse = true;
  await engine.run();
  const revision = cloud.state.revision;
  await engine.run();
  expect(cloud.state.revision).toBe(revision);
  expect(cloud.state.snapshot.entries).toHaveLength(1);
  expect(engine.status.phase).toBe("synced");
});
it("re-reads after a concurrent local edit without losing the new row", async () => {
  const cloud = new Cloud(),
    store = new Store(),
    engine = new SyncEngine(store, cloud, () => {});
  await engine.run();
  store.edit("first", "1.00");
  const write = cloud.write.bind(cloud);
  let changed = false;
  cloud.write = async (revision, snapshot, id) => {
    if (!changed) {
      changed = true;
      store.edit("second", "2.00");
    }
    return write(revision, snapshot, id);
  };
  await engine.run();
  expect(cloud.state.snapshot.entries).toHaveLength(2);
  expect(engine.status.phase).toBe("synced");
});
it("keeps a deletion made while an upload is in flight", async () => {
  const cloud = new Cloud(),
    store = new Store(),
    engine = new SyncEngine(store, cloud, () => {});
  await engine.run();
  store.edit("temporary", "1.00");
  const write = cloud.write.bind(cloud);
  let changed = false;
  cloud.write = async (revision, snapshot, id) => {
    const result = await write(revision, snapshot, id);
    if (!changed) {
      changed = true;
      store.remove("temporary");
    }
    return result;
  };
  await engine.run();
  expect(cloud.state.snapshot.entries).toHaveLength(0);
  expect(store.state.snapshot.entries).toHaveLength(0);
  expect(engine.status.phase).toBe("synced");
});
it("recovers a lost upload response after restart without resurrecting a deleted row", async () => {
  const cloud = new Cloud(),
    store = new Store(),
    first = new SyncEngine(store, cloud, () => {});
  await first.run();
  store.edit("temporary", "1.00");
  cloud.loseResponse = true;
  await first.run();
  expect(store.state.upload).not.toBeNull();
  store.remove("temporary");
  first.stop();
  const restarted = new SyncEngine(store, cloud, () => {});
  await restarted.run();
  expect(cloud.state.snapshot.entries).toHaveLength(0);
  expect(store.state.upload).toBeNull();
  expect(restarted.status.phase).toBe("synced");
});
it("preserves a revert during upload and retries a competing cloud revision", async () => {
  const cloud = new Cloud(),
    store = new Store(),
    engine = new SyncEngine(store, cloud, () => {});
  store.edit("same", "1.00");
  await engine.run();
  store.edit("same", "2.00");
  const write = cloud.write.bind(cloud);
  let changed = false;
  cloud.write = async (revision, snapshot, id) => {
    if (!changed) {
      changed = true;
      store.edit("same", "1.00");
      cloud.state.revision++;
      throw { code: "40001" };
    }
    return write(revision, snapshot, id);
  };
  await engine.run();
  expect(cloud.state.snapshot.entries[0].amount).toBe("1.00");
  expect(engine.status.phase).toBe("synced");
});
it("never uploads while paused and ignores stale conflict choices", async () => {
  const cloud = new Cloud(),
    store = new Store();
  await store.bind(false);
  store.edit("only", "2.00");
  const engine = new SyncEngine(store, cloud, () => {});
  await engine.run();
  expect(cloud.state.revision).toBe(0);
  expect(engine.status.phase).toBe("paused");
});
