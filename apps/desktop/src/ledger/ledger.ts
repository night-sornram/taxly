import { normalizeAmount } from "../money";
import type { LedgerCategory, LedgerEntry, LedgerKind } from "./types";

/** Display totals only; amounts are exact satang so no float rounding creeps in. */
export function toSatang(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}
export function fromSatang(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export interface Totals {
  income: bigint;
  expense: bigint;
}
export function kindOf(categories: LedgerCategory[]) {
  const kinds = new Map(categories.map((c) => [c.id, c.kind]));
  return (entry: LedgerEntry): LedgerKind => kinds.get(entry.category_id) ?? "expense";
}
/** Twelve monthly totals for a Gregorian year. */
export function monthlyTotals(
  entries: LedgerEntry[],
  categories: LedgerCategory[],
  year: number,
): Totals[] {
  const kind = kindOf(categories);
  const totals = Array.from({ length: 12 }, () => ({ income: 0n, expense: 0n }));
  for (const entry of entries) {
    if (Number(entry.date.slice(0, 4)) !== year) continue;
    totals[Number(entry.date.slice(5, 7)) - 1][kind(entry)] += toSatang(entry.amount);
  }
  return totals;
}
/** Per-category totals for entries whose date starts with `prefix` (YYYY or YYYY-MM). */
export function categoryTotals(
  entries: LedgerEntry[],
  categories: LedgerCategory[],
  prefix: string,
  kind: LedgerKind,
): { category: LedgerCategory; total: bigint }[] {
  const sums = new Map<string, bigint>();
  for (const entry of entries)
    if (entry.date.startsWith(prefix))
      sums.set(entry.category_id, (sums.get(entry.category_id) ?? 0n) + toSatang(entry.amount));
  return categories
    .filter((category) => category.kind === kind && sums.has(category.id))
    .map((category) => ({ category, total: sums.get(category.id)! }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

export type DateOrder = "dmy" | "ymd" | "mdy";
/** Bank-statement dates to ISO. Buddhist-era years (≥ 2400) are converted; time suffixes ignored. */
export function parseCsvDate(raw: string, order: DateOrder): string | null {
  const parts = raw.trim().split(/[\sT]/)[0].split(/[/.-]/);
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,4}$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  let [year, month, day] = order === "ymd" ? [a, b, c] : order === "dmy" ? [c, b, a] : [c, a, b];
  if (year < 100) year += year >= 43 ? 2500 : 2000; // two-digit years: 43+ are BE (e.g. 69 → 2569)
  if (year >= 2400) year -= 543;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2100 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return date.toISOString().slice(0, 10);
}
/** Signed statement amount: "-45.00", "(45.00)", "45.00-", "฿1,250.50". Zero/blank → null. */
export function parseCsvAmount(raw: string): { amount: string; negative: boolean } | null {
  let text = raw.trim().replace(/฿|THB|บาท|\s/gi, "");
  let negative = false;
  if (/^\(.*\)$/.test(text)) [text, negative] = [text.slice(1, -1), true];
  if (text.startsWith("-")) [text, negative] = [text.slice(1), !negative];
  else if (text.endsWith("-")) [text, negative] = [text.slice(0, -1), !negative];
  else if (text.startsWith("+")) text = text.slice(1);
  try {
    const amount = normalizeAmount(text);
    return toSatang(amount) === 0n ? null : { amount, negative };
  } catch {
    return null;
  }
}

export interface CsvMapping {
  headerRow: number;
  date: number;
  order: DateOrder;
  /** One signed column (negative = expense), or separate withdrawal/deposit columns. */
  amount: { mode: "signed"; column: number } | { mode: "split"; out: number; in: number };
  note: number | null;
  expenseCategory: string;
  incomeCategory: string;
}
export interface ImportPreview {
  line: number;
  date: string | null;
  amount: string | null;
  kind: LedgerKind;
  note: string;
  category_id: string;
  duplicate: boolean;
  error: string | null;
}
export function previewRows(
  rows: string[][],
  mapping: CsvMapping,
  existing: LedgerEntry[],
  categories: LedgerCategory[],
): ImportPreview[] {
  const kind = kindOf(categories);
  const seen = new Set(existing.map((e) => `${e.date}|${e.amount}|${kind(e)}|${e.note}`));
  return rows.slice(mapping.headerRow + 1).map((row, index) => {
    const cell = (column: number) => row[column] ?? "";
    const date = parseCsvDate(cell(mapping.date), mapping.order);
    let parsed: { amount: string; kind: LedgerKind } | null = null;
    if (mapping.amount.mode === "signed") {
      const value = parseCsvAmount(cell(mapping.amount.column));
      if (value) parsed = { amount: value.amount, kind: value.negative ? "expense" : "income" };
    } else {
      const out = parseCsvAmount(cell(mapping.amount.out));
      const into = parseCsvAmount(cell(mapping.amount.in));
      if (out && !into) parsed = { amount: out.amount, kind: "expense" };
      else if (into && !out) parsed = { amount: into.amount, kind: "income" };
    }
    const resolvedKind = parsed?.kind ?? "expense";
    const note = (mapping.note === null ? "" : cell(mapping.note)).trim().slice(0, 500);
    return {
      line: mapping.headerRow + index + 2,
      date,
      amount: parsed?.amount ?? null,
      kind: resolvedKind,
      note,
      category_id: resolvedKind === "income" ? mapping.incomeCategory : mapping.expenseCategory,
      duplicate: Boolean(
        date && parsed && seen.has(`${date}|${parsed.amount}|${resolvedKind}|${note}`),
      ),
      error: !date ? "วันที่อ่านไม่ได้" : !parsed ? "จำนวนเงินอ่านไม่ได้" : null,
    };
  });
}
