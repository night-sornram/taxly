import { normalizeAmount } from "../money";
import type { LedgerCategory, LedgerEntry } from "../ledger/types";
import type { Facts } from "../types";

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
/** Tax data that travels between devices. Ledger-linked tax incomes are not
 * listed here: each device rebuilds them from the entry's tax link. */
export interface TaxYearRow {
  id: string;
  year: number;
  facts: Facts;
  income_complete: boolean;
}
export interface TaxIncomeRow {
  id: string;
  year: number;
  source_label: string;
  month: number;
  kind: "salary" | "bonus" | "other";
  basis: "actual" | "forecast";
  gross: string;
  withholding: string | null;
  note: string;
}
export interface TaxDeductionRow {
  id: string;
  year: number;
  month: number;
  basis: "actual" | "forecast";
  amount: string;
}
export interface TaxSnapshot {
  years: TaxYearRow[];
  incomes: TaxIncomeRow[];
  deductions: TaxDeductionRow[];
}
export interface Snapshot {
  categories: LedgerCategory[];
  entries: SyncEntry[];
  tax: TaxSnapshot;
}
type Row = LedgerCategory | SyncEntry | TaxYearRow | TaxIncomeRow | TaxDeductionRow;
type RowKind = "categories" | "entries" | "years" | "incomes" | "deductions";
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
  kind: RowKind;
  id: string;
  local: Row | null;
  remote: Row | null;
  localCategory?: string;
  remoteCategory?: string;
}
export const emptyTax = (): TaxSnapshot => ({ years: [], incomes: [], deductions: [] });
export const emptySnapshot = (): Snapshot => ({ categories: [], entries: [], tax: emptyTax() });
const byId = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
const optionalAmount = (value: string | null) => (value === null ? null : normalizeAmount(value));
// Snapshots written before tax sync have no tax section.
export function canonicalTax(tax: TaxSnapshot | undefined): TaxSnapshot {
  const t = tax ?? emptyTax();
  return {
    years: byId(
      t.years.map((y) => ({
        id: String(y.year),
        year: y.year,
        facts: {
          single: y.facts.single,
          under_65: y.facts.under_65,
          domestic_salary_only: y.facts.domestic_salary_only,
          no_special_cases: y.facts.no_special_cases,
          no_other_deductions: y.facts.no_other_deductions,
          social_security_confirmed: y.facts.social_security_confirmed,
        },
        income_complete: y.income_complete,
      })),
    ),
    incomes: byId(
      t.incomes.map((i) => ({
        id: i.id,
        year: i.year,
        source_label: i.source_label.trim(),
        month: i.month,
        kind: i.kind,
        basis: i.basis,
        gross: normalizeAmount(i.gross),
        withholding: optionalAmount(i.withholding),
        note: i.note.trim(),
      })),
    ),
    deductions: byId(
      t.deductions.map((d) => ({
        id: d.id,
        year: d.year,
        month: d.month,
        basis: d.basis,
        amount: normalizeAmount(d.amount),
      })),
    ),
  };
}
export function canonical(snapshot: Snapshot): Snapshot {
  return {
    tax: canonicalTax(snapshot.tax),
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
  validateTax("tax" in value ? value.tax : undefined, idOk, amountOk);
  return canonical(value as Snapshot);
}
const TAX_YEARS = [2025, 2026];
function validateTax(
  tax: unknown,
  idOk: (id: unknown) => id is string,
  amountOk: (amount: unknown, zero: boolean) => boolean,
) {
  const bad = () => new Error("ข้อมูลภาษีที่ซิงก์ไม่ถูกต้อง");
  if (tax === undefined) return;
  const t = tax as Partial<Record<keyof TaxSnapshot, unknown>>;
  if (
    !tax ||
    typeof tax !== "object" ||
    Object.keys(tax).length !== 3 ||
    !Array.isArray(t.years) ||
    !Array.isArray(t.incomes) ||
    !Array.isArray(t.deductions) ||
    t.years.length > 20 ||
    t.incomes.length > 50_000 ||
    t.deductions.length > 1_000
  )
    throw bad();
  const month = (m: unknown) => Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 12;
  const basis = (b: unknown) => b === "actual" || b === "forecast";
  const flag = (f: unknown) => f === null || typeof f === "boolean";
  const years = new Set<number>();
  for (const y of t.years as TaxYearRow[]) {
    const f = y?.facts as unknown as Record<string, unknown> | undefined;
    if (
      !y ||
      !TAX_YEARS.includes(y.year) ||
      y.id !== String(y.year) ||
      years.has(y.year) ||
      typeof y.income_complete !== "boolean" ||
      !f ||
      typeof f !== "object" ||
      Object.keys(f).length !== 6 ||
      typeof f.social_security_confirmed !== "boolean" ||
      ![
        "single",
        "under_65",
        "domestic_salary_only",
        "no_special_cases",
        "no_other_deductions",
      ].every((k) => k in f && flag(f[k]))
    )
      throw bad();
    years.add(y.year);
  }
  const ids = new Set<string>();
  const salaries = new Set<string>();
  for (const i of t.incomes as TaxIncomeRow[]) {
    if (
      !i ||
      !idOk(i.id) ||
      ids.has(i.id) ||
      !years.has(i.year) ||
      typeof i.source_label !== "string" ||
      !i.source_label.trim() ||
      [...i.source_label].length > 100 ||
      !month(i.month) ||
      !["salary", "bonus", "other"].includes(i.kind) ||
      !basis(i.basis) ||
      !amountOk(i.gross, true) ||
      (i.withholding !== null && !amountOk(i.withholding, true)) ||
      typeof i.note !== "string" ||
      [...i.note].length > 500
    )
      throw bad();
    ids.add(i.id);
    if (i.kind === "salary") {
      const key = salaryKey(i);
      if (salaries.has(key)) throw bad();
      salaries.add(key);
    }
  }
  ids.clear();
  const months = new Set<string>();
  for (const d of t.deductions as TaxDeductionRow[]) {
    if (
      !d ||
      !idOk(d.id) ||
      ids.has(d.id) ||
      !years.has(d.year) ||
      !month(d.month) ||
      !basis(d.basis) ||
      !amountOk(d.amount, true) ||
      months.has(`${d.year}:${d.month}`)
    )
      throw bad();
    ids.add(d.id);
    months.add(`${d.year}:${d.month}`);
  }
}
// The tax database allows one salary per employer per month and one social
// security row per month; these keys find copies created separately offline.
const salaryKey = (i: TaxIncomeRow) => `${i.year}:${i.source_label.trim()}:${i.month}`;
const naturalKey = (kind: "incomes" | "deductions", row: TaxIncomeRow | TaxDeductionRow) =>
  kind === "incomes"
    ? (row as TaxIncomeRow).kind === "salary"
      ? `salary:${salaryKey(row as TaxIncomeRow)}`
      : null
    : `sso:${row.year}:${row.month}`;

/** Three-way merge: independent changes combine; competing edits require a choice. */
export function mergeSnapshots(
  base: Snapshot,
  local: Snapshot,
  remote: Snapshot,
  choices: Record<string, "local" | "remote"> = {},
) {
  const result = emptySnapshot();
  const conflicts: Conflict[] = [];
  const [b0, l0, r0] = [canonical(base), canonical(local), canonical(remote)];
  const mergeRows = <T extends Row>(kind: RowKind, pick: (s: Snapshot) => T[]): T[] => {
    const original = new Map(pick(b0).map((r) => [r.id, r]));
    const mine = new Map(pick(l0).map((r) => [r.id, r]));
    const theirs = new Map(pick(r0).map((r) => [r.id, r]));
    const rows: T[] = [];
    for (const id of new Set([...original.keys(), ...mine.keys(), ...theirs.keys()])) {
      const b = original.get(id) ?? null,
        l = mine.get(id) ?? null,
        r = theirs.get(id) ?? null;
      const key = `${kind}:${id}`;
      let chosen: T | null;
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
    return rows;
  };
  result.categories = mergeRows("categories", (s) => s.categories);
  result.entries = mergeRows("entries", (s) => s.entries);
  result.tax.years = mergeRows("years", (s) => s.tax.years);
  // Two devices that each set up the same month keep one copy: identical
  // values merge silently, different values need the user's choice.
  const dedupe = <T extends TaxIncomeRow | TaxDeductionRow>(
    kind: "incomes" | "deductions",
    rows: T[],
  ): T[] => {
    const remoteIds = new Set(r0.tax[kind].map((r) => r.id));
    const kept = new Map<string, T>();
    const out: T[] = [];
    for (const row of [...rows].sort(
      (a, b) =>
        Number(remoteIds.has(b.id)) - Number(remoteIds.has(a.id)) || a.id.localeCompare(b.id),
    )) {
      const natural = naturalKey(kind, row);
      const first = natural ? kept.get(natural) : undefined;
      if (!natural || !first) {
        if (natural) kept.set(natural, row);
        out.push(row);
        continue;
      }
      const same = equal({ ...first, id: "" }, { ...row, id: "" });
      const key = `${kind}:same:${natural}`;
      if (same || choices[key] === "remote") continue;
      if (choices[key] === "local") {
        out.splice(out.indexOf(first), 1, row);
        kept.set(natural, row);
        continue;
      }
      conflicts.push({ key, kind, id: natural, local: row, remote: first });
    }
    return out;
  };
  result.tax.incomes = dedupe(
    "incomes",
    mergeRows("incomes", (s) => s.tax.incomes),
  );
  result.tax.deductions = dedupe(
    "deductions",
    mergeRows("deductions", (s) => s.tax.deductions),
  );
  // Keep the tax year needed by a concurrently added income or deduction.
  for (const row of [...result.tax.incomes, ...result.tax.deductions])
    if (!result.tax.years.some((y) => y.year === row.year)) {
      const year = [...r0.tax.years, ...l0.tax.years, ...b0.tax.years].find(
        (y) => y.year === row.year,
      );
      if (year) result.tax.years.push(year);
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
  const rows = (s: Snapshot): Row[][] => {
    const c = canonical(s);
    return [c.categories, c.entries, c.tax.years, c.tax.incomes, c.tax.deductions];
  };
  const [before, after] = [rows(state.base_snapshot), rows(state.snapshot)];
  for (let i = 0; i < before.length; i++) {
    const base = new Map<string, Row>(before[i].map((r) => [r.id, r]));
    const current = new Map<string, Row>(after[i].map((r) => [r.id, r]));
    for (const id of new Set([...base.keys(), ...current.keys()]))
      if (!equal(base.get(id), current.get(id))) count++;
  }
  return count;
}
export function ledgerEntries(snapshot: Snapshot): LedgerEntry[] {
  return snapshot.entries.map((e) => ({ ...e, tax_income_id: e.tax ? `synced:${e.id}` : null }));
}
