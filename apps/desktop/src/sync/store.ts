import { command } from "../api";
import { starterSnapshot } from "./defaults";
import { emptySnapshot, validateSnapshot } from "./model";
import type { LocalState, Snapshot, Upload } from "./model";

export interface SyncStore {
  read(): Promise<LocalState>;
  bind(enabled: boolean): Promise<void>;
  stage(expectedRevision: number, upload: Upload): Promise<void>;
  accept(
    expectedRevision: number,
    snapshot: Snapshot,
    base: Snapshot,
    cloudRevision: number,
  ): Promise<void>;
}
export const staleRevision = () => ({
  code: "StaleRevision",
  message: "ข้อมูลเปลี่ยน กำลังตรวจการซิงก์ใหม่",
});
export class NativeStore implements SyncStore {
  constructor(
    readonly owner: string,
    readonly project: string,
  ) {}
  read() {
    return command<LocalState>("get_ledger_sync_state");
  }
  bind(enabled: boolean) {
    return command<void>("bind_ledger_sync_account", {
      ownerId: this.owner,
      projectUrl: this.project,
      enabled,
    });
  }
  stage(expectedRevision: number, upload: Upload) {
    return command<void>("stage_ledger_sync", {
      ownerId: this.owner,
      projectUrl: this.project,
      expectedRevision,
      upload,
    });
  }
  async accept(revision: number, snapshot: Snapshot, base: Snapshot, cloudRevision: number) {
    const changed = await command<boolean>("apply_ledger_sync", {
      request: {
        owner_id: this.owner,
        project_url: this.project,
        expected_revision: revision,
        cloud_revision: cloudRevision,
        snapshot,
        base_snapshot: base,
      },
    });
    if (changed) {
      window.dispatchEvent(new Event("taxly-ledger-refreshed"));
      window.dispatchEvent(new Event("taxly-tax-changed"));
    }
  }
}
/** One atomic IndexedDB document per account/project; pending changes survive closing the phone. */
export class BrowserStore implements SyncStore {
  private db: Promise<IDBDatabase>;
  private key: string;
  constructor(
    readonly owner: string,
    readonly project: string,
  ) {
    this.key = `${project}:${owner}`;
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open("taxly-ledger", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("accounts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "เปิดพื้นที่เก็บข้อมูลในโทรศัพท์ไม่สำเร็จ กรุณาตรวจพื้นที่ว่างและสิทธิ์เบราว์เซอร์",
          ),
        );
    });
  }
  private initial(): LocalState {
    return {
      revision: 0,
      owner_id: this.owner,
      project_url: this.project,
      enabled: true,
      cloud_revision: 0,
      base_snapshot: emptySnapshot(),
      snapshot: starterSnapshot(),
      upload: null,
    };
  }
  async read(): Promise<LocalState> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("accounts", "readonly"),
        request = tx.objectStore("accounts").get(this.key);
      request.onsuccess = () => resolve(request.result ?? this.initial());
      request.onerror = () => reject(request.error);
    });
  }
  async update(change: (state: LocalState) => void): Promise<void> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("accounts", "readwrite"),
        store = tx.objectStore("accounts"),
        request = store.get(this.key);
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const state: LocalState = request.result ?? this.initial();
          change(state);
          state.snapshot = validateSnapshot(state.snapshot);
          state.revision++;
          store.put(state, this.key);
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        window.dispatchEvent(new Event("taxly-ledger-refreshed"));
        resolve();
      };
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("บันทึกข้อมูลในโทรศัพท์ไม่สำเร็จ"));
      tx.onerror = () => {
        failure = tx.error;
      };
    });
  }
  async bind(enabled: boolean) {
    await this.update((s) => {
      s.enabled = enabled;
    });
  }
  async stage(expectedRevision: number, upload: Upload) {
    await this.update((s) => {
      if (s.revision !== expectedRevision || s.upload || !s.enabled) throw staleRevision();
      s.upload = upload;
    });
  }
  async accept(revision: number, snapshot: Snapshot, base: Snapshot, cloudRevision: number) {
    await this.update((s) => {
      if (s.revision !== revision || !s.enabled || cloudRevision < s.cloud_revision)
        throw staleRevision();
      s.snapshot = snapshot;
      s.base_snapshot = base;
      s.cloud_revision = cloudRevision;
      s.upload = null;
    });
  }
}
