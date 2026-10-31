import { describe, expect, it } from "vitest";
import {
  categoryTotals,
  fromSatang,
  monthlyTotals,
  parseCsvAmount,
  parseCsvDate,
  previewRows,
} from "./ledger";
import type { LedgerCategory, LedgerEntry } from "./types";

const categories: LedgerCategory[] = [
  { id: "in", kind: "income", name: "เงินเดือน" },
  { id: "food", kind: "expense", name: "อาหาร" },
  { id: "bus", kind: "expense", name: "เดินทาง" },
];
const entry = (date: string, category_id: string, amount: string, note = ""): LedgerEntry => ({
  id: `${date}${category_id}${amount}`,
  date,
  category_id,
  amount,
  note,
  tax_income_id: null,
});

describe("ledger totals", () => {
  it("sums exact satang by month and category", () => {
    const entries = [
      entry("2026-01-25", "in", "30000.00"),
      entry("2026-01-02", "food", "0.10"),
      entry("2026-01-03", "food", "0.20"),
      entry("2026-01-04", "bus", "45.00"),
      entry("2025-01-04", "bus", "99.00"),
    ];
    const january = monthlyTotals(entries, categories, 2026)[0];
    expect(fromSatang(january.income)).toBe("30000.00");
    expect(fromSatang(january.expense)).toBe("45.30");
    expect(fromSatang(january.income - january.expense)).toBe("29954.70");
    expect(fromSatang(-5n)).toBe("-0.05");
    expect(
      categoryTotals(entries, categories, "2026-01", "expense").map((r) => [
        r.category.id,
        fromSatang(r.total),
      ]),
    ).toEqual([
      ["bus", "45.00"],
      ["food", "0.30"],
    ]);
  });
});

describe("CSV parsing", () => {
  it("reads Thai bank date styles", () => {
    expect(parseCsvDate("05/02/2569", "dmy")).toBe("2026-02-05");
    expect(parseCsvDate("05-02-69 13:45", "dmy")).toBe("2026-02-05");
    expect(parseCsvDate("2026-02-05", "ymd")).toBe("2026-02-05");
    expect(parseCsvDate("02/05/26", "mdy")).toBe("2026-02-05");
    expect(parseCsvDate("31/02/2026", "dmy")).toBeNull();
    expect(parseCsvDate("ยอดยกมา", "dmy")).toBeNull();
  });
  it("reads signed and decorated amounts", () => {
    expect(parseCsvAmount("-1,250.50")).toEqual({ amount: "1250.50", negative: true });
    expect(parseCsvAmount("(45)")).toEqual({ amount: "45.00", negative: true });
    expect(parseCsvAmount("45.00-")).toEqual({ amount: "45.00", negative: true });
    expect(parseCsvAmount("฿ 300")).toEqual({ amount: "300.00", negative: false });
    expect(parseCsvAmount("0.00")).toBeNull();
    expect(parseCsvAmount("")).toBeNull();
    expect(parseCsvAmount("1.234")).toBeNull();
  });
  it("previews split columns, flags errors and existing duplicates", () => {
    const rows = [
      ["ธนาคารตัวอย่าง"],
      ["วันที่", "รายการ", "ถอน", "ฝาก"],
      ["01/03/2569", "ร้านกาแฟ", "65.00", ""],
      ["02/03/2569", "เงินเดือน", "", "30,000.00"],
      ["03/03/2569", "ผิดพลาด", "", ""],
    ];
    const preview = previewRows(
      rows,
      {
        headerRow: 1,
        date: 0,
        order: "dmy",
        amount: { mode: "split", out: 2, in: 3 },
        note: 1,
        expenseCategory: "food",
        incomeCategory: "in",
      },
      [entry("2026-03-01", "food", "65.00", "ร้านกาแฟ")],
      categories,
    );
    expect(preview.map((r) => [r.line, r.kind, r.category_id, r.duplicate, r.error])).toEqual([
      [3, "expense", "food", true, null],
      [4, "income", "in", false, null],
      [5, "expense", "food", false, "จำนวนเงินอ่านไม่ได้"],
    ]);
  });
});
