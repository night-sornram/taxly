import { describe, expect, it } from "vitest";
import { canonical, emptySnapshot, mergeSnapshots, validateSnapshot } from "./model";
import { emptyTax } from "./model";
import type { Snapshot, SyncEntry, TaxIncomeRow } from "./model";
import { parseCsv } from "./mobile";
const entry = (id: string, amount = "1.00"): SyncEntry => ({
  id,
  date: "2026-10-31",
  category_id: "food",
  amount,
  note: "",
  tax: null,
});
const snapshot = (entries: SyncEntry[] = []): Snapshot => ({
  categories: [{ id: "food", kind: "expense", name: "อาหาร" }],
  entries,
  tax: emptyTax(),
});
describe("portable ledger", () => {
  it("combines independent changes and preserves exact money", () => {
    const base = snapshot([entry("original", "0.10")]);
    const mine = snapshot([...base.entries, entry("phone", "0.20")]);
    const theirs = snapshot([entry("original", "99999999999999.99"), entry("desktop", "2.00")]);
    const merged = mergeSnapshots(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.snapshot.entries.map((e) => [e.id, e.amount])).toEqual([
      ["desktop", "2.00"],
      ["original", "99999999999999.99"],
      ["phone", "0.20"],
    ]);
  });
  it("requires an explicit choice for competing edits or deletion", () => {
    const base = snapshot([entry("same")]),
      mine = snapshot([entry("same", "2.00")]),
      theirs = snapshot([]);
    expect(mergeSnapshots(base, mine, theirs).conflicts).toHaveLength(1);
    expect(
      mergeSnapshots(base, mine, theirs, { "entries:same": "local" }).snapshot.entries[0].amount,
    ).toBe("2.00");
    expect(
      mergeSnapshots(base, mine, theirs, { "entries:same": "remote" }).snapshot.entries,
    ).toEqual([]);
  });
  it("retains the category needed by a concurrent new entry", () => {
    const result = mergeSnapshots(snapshot(), emptySnapshot(), snapshot([entry("phone")]));
    expect(validateSnapshot(result.snapshot).categories).toHaveLength(1);
  });
  it("combines identical categories created separately offline without losing entries", () => {
    const a: Snapshot = {
      categories: [{ id: "a", kind: "expense", name: "กาแฟ" }],
      entries: [{ ...entry("phone"), category_id: "a" }],
      tax: emptyTax(),
    };
    const b: Snapshot = {
      categories: [{ id: "b", kind: "expense", name: "กาแฟ" }],
      entries: [{ ...entry("desktop"), category_id: "b" }],
      tax: emptyTax(),
    };
    const merged = mergeSnapshots(emptySnapshot(), a, b);
    expect(merged.conflicts).toEqual([]);
    const valid = validateSnapshot(merged.snapshot);
    expect(valid.categories).toHaveLength(1);
    expect(valid.entries).toHaveLength(2);
    expect(valid.entries.every((e) => e.category_id === valid.categories[0].id)).toBe(true);
  });
  it("keeps established categories separate when concurrent renames produce the same name", () => {
    const base: Snapshot = {
      categories: [
        { id: "a", kind: "expense", name: "อาหาร" },
        { id: "b", kind: "expense", name: "เดินทาง" },
      ],
      entries: [],
      tax: emptyTax(),
    };
    const mine = structuredClone(base),
      theirs = structuredClone(base);
    mine.categories[0].name = "รายวัน";
    theirs.categories[1].name = "รายวัน";
    expect(() => mergeSnapshots(base, mine, theirs)).toThrow("ชื่อซ้ำ");
    expect(mine.categories).toHaveLength(2);
    expect(theirs.categories).toHaveLength(2);
  });
  it("normalizes ordering and rejects invalid dates, amounts and category links", () => {
    expect(
      canonical(snapshot([{ ...entry("a"), amount: "1", note: " note " }])).entries[0],
    ).toMatchObject({ amount: "1.00", note: "note" });
    for (const patch of [
      { date: "2026-02-31" },
      { amount: "0.00" },
      { amount: "1.234" },
      { amount: "1e3" },
      { category_id: "absent" },
      { amount: "92233720368547758.08" },
    ])
      expect(() => validateSnapshot(snapshot([{ ...entry("a"), ...patch }]))).toThrow();
    expect(() =>
      validateSnapshot(
        snapshot([
          { ...entry("a"), tax: { source_label: "payer", kind: "salary", withholding: null } },
        ]),
      ),
    ).toThrow();
  });
  it("parses quoted browser CSV and rejects broken files", () => {
    expect(
      parseCsv('date,note,amount\r\n2026-10-31,"coffee, tea",12.00\n2026-10-31,"two\nlines",3'),
    ).toEqual([
      ["date", "note", "amount"],
      ["2026-10-31", "coffee, tea", "12.00"],
      ["2026-10-31", "two\nlines", "3"],
    ]);
    expect(() => parseCsv('date,"unterminated')).toThrow();
    expect(() => parseCsv('a,"closed"extra')).toThrow();
  });
});

describe("tax sync", () => {
  const facts = {
    single: true,
    under_65: true,
    domestic_salary_only: true,
    no_special_cases: true,
    no_other_deductions: true,
    social_security_confirmed: false,
  };
  const year = { id: "2026", year: 2026, facts, income_complete: false };
  const salary = (id: string, month: number, gross = "30000.00"): TaxIncomeRow => ({
    id,
    year: 2026,
    source_label: "บริษัท",
    month,
    kind: "salary",
    basis: "forecast",
    gross,
    withholding: null,
    note: "",
  });
  const withTax = (incomes: TaxIncomeRow[]): Snapshot => ({
    ...emptySnapshot(),
    tax: { years: [year], incomes, deductions: [] },
  });

  it("reads snapshots written before tax sync as having no tax data", () => {
    expect(validateSnapshot({ categories: [], entries: [] }).tax).toEqual(emptyTax());
  });
  it("merges one copy when two devices set up the same salary offline", () => {
    const phone = withTax([salary("p1", 1), salary("p2", 2)]);
    const desktop = withTax([salary("d1", 1), salary("d2", 2)]);
    const merged = mergeSnapshots(emptySnapshot(), phone, desktop);
    expect(merged.conflicts).toEqual([]);
    expect(validateSnapshot(merged.snapshot).tax.incomes.map((i) => i.id)).toEqual(["d1", "d2"]);
  });
  it("asks which salary to keep when the same month differs", () => {
    const phone = withTax([salary("p1", 1, "31000.00")]);
    const desktop = withTax([salary("d1", 1)]);
    const result = mergeSnapshots(emptySnapshot(), phone, desktop);
    expect(result.conflicts.map((c) => c.key)).toEqual(["incomes:same:salary:2026:บริษัท:1"]);
    const chosen = mergeSnapshots(emptySnapshot(), phone, desktop, {
      "incomes:same:salary:2026:บริษัท:1": "local",
    });
    expect(chosen.snapshot.tax.incomes.map((i) => [i.id, i.gross])).toEqual([["p1", "31000.00"]]);
  });
  it("combines independent tax edits from two devices", () => {
    const base = withTax([salary("a", 1)]);
    const mine = withTax([salary("a", 1), salary("b", 2)]);
    const theirs = withTax([salary("a", 1, "35000.00")]);
    const merged = mergeSnapshots(base, mine, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.snapshot.tax.incomes.map((i) => [i.id, i.gross])).toEqual([
      ["a", "35000.00"],
      ["b", "30000.00"],
    ]);
  });
  it("keeps the tax year a concurrently added income needs", () => {
    const mine = withTax([salary("b", 2)]);
    const merged = mergeSnapshots(withTax([]), mine, emptySnapshot());
    expect(merged.conflicts).toEqual([]);
    expect(validateSnapshot(merged.snapshot).tax.years).toHaveLength(1);
  });
  it("rejects two salaries for one employer and month", () => {
    expect(() => validateSnapshot(withTax([salary("a", 1), salary("b", 1)]))).toThrow("ภาษี");
  });
});
