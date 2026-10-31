import { normalizeAmount } from "../money";
import type { LedgerCategory, LedgerEntry } from "../ledger/types";

export interface TaxLink {
  source_label: string;
  kind: "salary" | "bonus" | "other";
  withholding: string | null;
}
export interface SyncEntry {
  id: string;
  date: string;
  category_id: string;
  amount: string;
  note: string;
  tax: TaxLink | null;
}
export interface Snapshot {
  categories: LedgerCategory[];
  entries: SyncEntry[];
}
export interface LocalState {
  revision: number;
  owner_id: string | null;
  project_url: string | null;
  enabled: boolean;
  cloud_revision: number;
  base_snapshot: Snapshot;
  snapshot: Snapshot;
  upload: Upload | null;
}
export interface Upload {
  id: string;
  expected_revision: number;
  local_snapshot: Snapshot;
  snapshot: Snapshot;
}
export interface CloudState {
  revision: number;
  snapshot: Snapshot;
}
export interface Conflict {
  key: string;
  kind: "categories" | "entries";
  id: string;
  local: LedgerCategory | SyncEntry | null;
  remote: LedgerCategory | SyncEntry | null;
  localCategory?: string;
  remoteCategory?: string;
}
export const emptySnapshot = (): Snapshot => ({ categories: [], entries: [] });
export function canonical(snapshot: Snapshot): Snapshot {
  return {
    categories: snapshot.categories
      .map((c) => ({ id: c.id, kind: c.kind, name: c.name.trim() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    entries: snapshot.entries
      .map((e) => ({
        id: e.id,
        date: e.date,
        category_id: e.category_id,
        amount: normalizeAmount(e.amount),
        note: e.note.trim(),
        tax: e.tax
          ? {
              source_label: e.tax.source_label.trim(),
              kind: e.tax.kind,
              withholding: e.tax.withholding === null ? null : normalizeAmount(e.tax.withholding),
            }
          : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const sameSnapshot = (a: Snapshot, b: Snapshot) => equal(canonical(a), canonical(b));
export function validateSnapshot(value: unknown): Snapshot {
  const bad = () => new Error("ข้อมูลรายรับรายจ่ายที่ซิงก์ไม่ถูกต้อง");
  if (
    !value ||
    typeof value !== "object" ||
    !("categories" in value) ||
    !("entries" in value) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.entries) ||
    value.categories.length > 1000 ||
    value.entries.length > 200_000
  )
    throw bad();
  const ids = new Set<string>();
  const names = new Set<string>();
  const categories = new Map<string, LedgerCategory>();
  const idOk = (id: unknown): id is string =>
    typeof id === "string" &&
    id.trim().length > 0 &&
    id.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(id);
  for (const c of value.categories) {
    if (
      !c ||
      !idOk(c.id) ||
      ids.has(c.id) ||
      !["income", "expense"].includes(c.kind) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      [...c.name].length > 50 ||
      names.has(`${c.kind}:${c.name.trim()}`)
    )
      throw bad();
    ids.add(c.id);
    names.add(`${c.kind}:${c.name.trim()}`);
    categories.set(c.id, c);
  }
  ids.clear();
  const amountOk = (amount: unknown, zero: boolean) => {
    if (typeof amount !== "string" || !/^\d+(\.\d{1,2})?$/.test(amount) || amount.length > 20)
      return false;
    const cents = BigInt(
      amount.replace(".", "") +
        (amount.includes(".") ? "0".repeat(2 - amount.split(".")[1].length) : "00"),
    );
    return cents >= (zero ? 0n : 1n) && cents <= 9_223_372_036_854_775_807n;
  };
  for (const e of value.entries) {
    if (
      !e ||
      !idOk(e.id) ||
      ids.has(e.id) ||
      !categories.has(e.category_id) ||
      !amountOk(e.amount, false) ||
      typeof e.date !== "string" ||
      !/^20\d{2}-\d{2}-\d{2}$|^2100-\d{2}-\d{2}$/.test(e.date) ||
      !Number.isFinite(Date.parse(`${e.date}T00:00:00Z`)) ||
      new Date(`${e.date}T00:00:00Z`).toISOString().slice(0, 10) !== e.date ||
      typeof e.note !== "string" ||
      [...e.note].length > 500
    )
      throw bad();
    if (
      e.tax !== null &&
      e.tax !== undefined &&
      (categories.get(e.category_id)?.kind !== "income" ||
        typeof e.tax.source_label !== "string" ||
        !e.tax.source_label.trim() ||
        [...e.tax.source_label].length > 100 ||
        !["salary", "bonus", "other"].includes(e.tax.kind) ||
        ![2025, 2026].includes(Number(e.date.slice(0, 4))) ||
        (e.tax.withholding !== null && !amountOk(e.tax.withholding, true)))
    )
      throw bad();
    ids.add(e.id);
  }
  return canonical(value as Snapshot);
}

/** Three-way merge: independent changes combine; competing edits require a choice. */
export function mergeSnapshots(
  base: Snapshot,
  local: Snapshot,
  remote: Snapshot,
  choices: Record<string, "local" | "remote"> = {},
) {
  const result = emptySnapshot();
  const conflicts: Conflict[] = [];
  for (const kind of ["categories", "entries"] as const) {
    const original = new Map(canonical(base)[kind].map((r) => [r.id, r]));
    const mine = new Map(canonical(local)[kind].map((r) => [r.id, r]));
    const theirs = new Map(canonical(remote)[kind].map((r) => [r.id, r]));
    const rows: (LedgerCategory | SyncEntry)[] = [];
    for (const id of new Set([...original.keys(), ...mine.keys(), ...theirs.keys()])) {
      const b = original.get(id) ?? null,
        l = mine.get(id) ?? null,
        r = theirs.get(id) ?? null;
      const key = `${kind}:${id}`;
      let chosen: LedgerCategory | SyncEntry | null;
      if (equal(l, r)) chosen = l;
      else if (equal(l, b)) chosen = r;
      else if (equal(r, b)) chosen = l;
      else if (choices[key]) chosen = choices[key] === "local" ? l : r;
      else {
        conflicts.push({
          key,
          kind,
          id,
          local: l,
          remote: r,
          localCategory:
            l && "category_id" in l
              ? local.categories.find((c) => c.id === l.category_id)?.name
              : undefined,
          remoteCategory:
            r && "category_id" in r
              ? remote.categories.find((c) => c.id === r.category_id)?.name
              : undefined,
        });
        chosen = l;
      }
      if (chosen) rows.push(chosen);
    }
    if (kind === "categories") result.categories = rows as LedgerCategory[];
    else result.entries = rows as SyncEntry[];
  }
  // Keep a category needed by a concurrently added entry instead of losing the entry.
  for (const entry of result.entries) {
    if (!result.categories.some((c) => c.id === entry.category_id)) {
      const category = [...remote.categories, ...local.categories, ...base.categories].find(
        (c) => c.id === entry.category_id,
      );
      if (category) result.categories.push(category);
    }
  }
  // Two offline devices may create the same category with different UUIDs.
  // Share one identity and keep every entry, rather than producing an invalid
  // duplicate-name snapshot that neither device can accept.
  const originalCategories = new Set(base.categories.map((c) => c.id));
  const categoriesByName = new Map<string, LedgerCategory>();
  const aliases = new Map<string, string>();
  for (const category of [...result.categories].sort(
    (a, b) =>
      Number(originalCategories.has(b.id)) - Number(originalCategories.has(a.id)) ||
      a.id.localeCompare(b.id),
  )) {
    const key = `${category.kind}:${category.name.trim()}`;
    const existing = categoriesByName.get(key);
    if (existing) {
      if (originalCategories.has(existing.id) || originalCategories.has(category.id)) {
        if (!conflicts.length)
          throw new Error(
            `หมวดหมู่ “${category.name}” มีชื่อซ้ำจากการแก้สองเครื่อง เปลี่ยนชื่อหมวดหมู่ที่เพิ่งแก้ให้ต่างกัน แล้วซิงก์อีกครั้ง`,
          );
        continue;
      }
      aliases.set(category.id, existing.id);
    } else categoriesByName.set(key, category);
  }
  result.categories = [...categoriesByName.values()];
  result.entries = result.entries.map((e) => ({
    ...e,
    category_id: aliases.get(e.category_id) ?? e.category_id,
  }));
  return { snapshot: canonical(result), conflicts };
}
export function pendingCount(state: LocalState): number {
  let count = 0;
  for (const kind of ["categories", "entries"] as const) {
    const base = new Map(canonical(state.base_snapshot)[kind].map((r) => [r.id, r]));
    const current = new Map(canonical(state.snapshot)[kind].map((r) => [r.id, r]));
    for (const id of new Set([...base.keys(), ...current.keys()]))
      if (!equal(base.get(id), current.get(id))) count++;
  }
  return count;
}
export function ledgerEntries(snapshot: Snapshot): LedgerEntry[] {
  return snapshot.entries.map((e) => ({ ...e, tax_income_id: e.tax ? `synced:${e.id}` : null }));
}
