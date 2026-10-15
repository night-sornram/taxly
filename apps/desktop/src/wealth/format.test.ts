import { describe, expect, it } from "vitest";
import { dateLabel, decimal, percentage, today } from "./format";

describe("wealth decimal presentation", () => {
  it("preserves values above the safe integer limit without floating point conversion", () => {
    expect(decimal("900719925474099312345.12345678")).toBe("900,719,925,474,099,312,345.12345678");
    expect(decimal("-1250.05")).toBe("-1,250.05");
    expect(decimal("0")).toBe("0.00");
  });
  it("keeps missing or invalid financial values unavailable", () => {
    expect(decimal(null)).toBe("—");
    expect(decimal("NaN")).toBe("—");
    expect(percentage(null)).toBe("—");
  });
  it("converts return fractions to percent using decimal text", () => {
    expect(percentage("0.05")).toBe("5.00%");
    expect(percentage("-0.0125")).toBe("-1.25%");
    expect(percentage("1.5")).toBe("150.00%");
    expect(percentage("0.000001")).toBe("0.00%");
    expect(percentage("0.090267983")).toBe("9.03%");
    expect(percentage("-0.000001")).toBe("0.00%");
  });
  it("uses Bangkok dates and displays Gregorian input dates in Thai", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateLabel("2026-01-03")).toContain("2569");
    expect(dateLabel(null)).toBe("ยังไม่มีข้อมูล");
  });
});
