import { errorMessage } from "../api";
import { mergeSnapshots, pendingCount, sameSnapshot, validateSnapshot } from "./model";
import type { CloudState, Conflict, Snapshot } from "./model";
import type { SyncStore } from "./store";

export interface CloudTransport {
  read(): Promise<CloudState>;
  write(expected: number, snapshot: Snapshot, operationId: string): Promise<number>;
  subscribe(changed: () => void): () => void;
}
export interface SyncStatus {
  phase: "idle" | "paused" | "syncing" | "synced" | "offline" | "conflict" | "error";
  pending: number;
  message: string;
  conflicts: Conflict[];
  lastSynced: string | null;
}
export const initialStatus: SyncStatus = {
  phase: "idle",
  pending: 0,
  message: "",
  conflicts: [],
  lastSynced: null,
};
export class SyncEngine {
  status: SyncStatus = { ...initialStatus };
  private running = false;
  private again = false;
  private stopped = false;
  private choices: Record<string, "local" | "remote"> = {};
  private resolutionRemote: Snapshot | null = null;
  private resolutionLocal: Snapshot | null = null;
  constructor(
    readonly store: SyncStore,
    readonly cloud: CloudTransport,
    readonly notify: (status: SyncStatus) => void,
  ) {}
  private set(update: Partial<SyncStatus>) {
    if (this.stopped) return;
    this.status = { ...this.status, ...update };
    this.notify(this.status);
  }
  stop() {
    this.stopped = true;
  }
  async resolve(choices: Record<string, "local" | "remote">) {
    this.choices = choices;
    await this.run();
  }
  async run() {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      let retries = 0;
      do {
        this.again = false;
        try {
          const local = await this.store.read();
          if (!local.enabled) {
            this.set({ phase: "paused", pending: pendingCount(local) });
            return;
          }
          this.set({ phase: "syncing", pending: pendingCount(local), message: "" });
          if (this.stopped) return;
          // Save intent before sending. Replaying the same ID recovers a committed
          // write even after a lost response, a local edit, or an app restart.
          if (local.upload) {
            const upload = local.upload;
            let revision: number;
            try {
              revision = await this.cloud.write(
                upload.expected_revision,
                upload.snapshot,
                upload.id,
              );
            } catch (e) {
              if (!e || typeof e !== "object" || !("code" in e) || e.code !== "40001") throw e;
              const latest = await this.store.read();
              if (this.stopped) return;
              if (latest.upload?.id === upload.id)
                await this.store.accept(
                  latest.revision,
                  latest.snapshot,
                  latest.base_snapshot,
                  latest.cloud_revision,
                );
              this.again = true;
              continue;
            }
            if (!Number.isSafeInteger(revision) || revision < 0)
              throw new Error("Invalid cloud revision");
            const latest = await this.store.read();
            if (this.stopped) return;
            if (latest.upload?.id === upload.id)
              // Keep every edit made since staging, including deletes and reverts.
              // The next merge brings in remote changes from the uploaded snapshot.
              await this.store.accept(
                latest.revision,
                latest.snapshot,
                upload.local_snapshot,
                revision,
              );
            this.again = true;
            continue;
          }
          const remote = await this.cloud.read();
          if (this.stopped) return;
          remote.snapshot = validateSnapshot(remote.snapshot);
          if (!Number.isSafeInteger(remote.revision) || remote.revision < 0)
            throw new Error("รุ่นข้อมูลออนไลน์ไม่ถูกต้อง");
          // A choice only applies to the exact pair the user reviewed.
          if (
            this.resolutionRemote &&
            (!sameSnapshot(remote.snapshot, this.resolutionRemote) ||
              !sameSnapshot(local.snapshot, this.resolutionLocal!))
          )
            this.choices = {};
          const merged = mergeSnapshots(
            local.base_snapshot,
            local.snapshot,
            remote.snapshot,
            this.choices,
          );
          if (merged.conflicts.length) {
            this.resolutionRemote = remote.snapshot;
            this.resolutionLocal = local.snapshot;
            this.set({
              phase: "conflict",
              conflicts: merged.conflicts,
              message: "มีรายการแก้ไขชนกัน เลือกข้อมูลที่จะเก็บก่อนซิงก์",
            });
            return;
          }
          const snapshot = validateSnapshot(merged.snapshot);
          if (!sameSnapshot(snapshot, remote.snapshot)) {
            await this.store.stage(local.revision, {
              id: crypto.randomUUID(),
              expected_revision: remote.revision,
              local_snapshot: local.snapshot,
              snapshot,
            });
            this.again = true;
            continue;
          }
          await this.store.accept(local.revision, snapshot, snapshot, remote.revision);
          this.choices = {};
          this.resolutionRemote = null;
          this.resolutionLocal = null;
          this.set({
            phase: "synced",
            pending: 0,
            conflicts: [],
            message: "",
            lastSynced: new Date().toISOString(),
          });
        } catch (e) {
          if (
            e &&
            typeof e === "object" &&
            "code" in e &&
            ["StaleRevision", "40001"].includes(String(e.code)) &&
            retries++ < 4
          ) {
            this.again = true;
            continue;
          }
          throw e;
        }
      } while (this.again && !this.stopped);
    } catch (e) {
      const local = await this.store.read().catch(() => null);
      this.set({
        phase: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error",
        pending: local ? pendingCount(local) : this.status.pending,
        message: errorMessage(e),
      });
    } finally {
      this.running = false;
    }
  }
}
