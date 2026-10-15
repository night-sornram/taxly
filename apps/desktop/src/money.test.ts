import { describe, it, expect } from "vitest";
import { formatMoney, normalizeAmount, optionalAmount, withholdingRate } from "./money";

describe("exact decimal boundary", () => {
  it("normalizes Thai digits without float conversion", () => {
    expect(normalizeAmount("๓๐,๐๐๐.๕๐")).toBe("30000.50");
    expect(normalizeAmount("90071992547409.91")).toBe("90071992547409.91");
    expect(formatMoney("90071992547409.91")).toBe("90,071,992,547,409.91");
  });
  it("preserves sub-satang derived results for disclosure", () => {
    expect(formatMoney("0.0005")).toBe("0.0005");
  });
  it("does not turn unknown into zero", () => {
    expect(optionalAmount("")).toBeNull();
    expect(optionalAmount("0")).toBe("0.00");
  });
  it.each(["-1", "1e3", "NaN", "1.001", "10,00", "1.", "92233720368547758.08"])(
    "rejects invalid input %s",
    (input) => {
      expect(() => normalizeAmount(input)).toThrow();
    },
  );
});

describe("withholding quick rate", () => {
  it("applies 3% and 5% with exact satang arithmetic", () => {
    expect(withholdingRate("30,000", 3)).toBe("900.00");
    expect(withholdingRate("30000", 5)).toBe("1500.00");
    expect(withholdingRate("1234.56", 3)).toBe("37.04");
    expect(withholdingRate("0.17", 3)).toBe("0.01");
  });
  it("returns null for empty or invalid amounts", () => {
    expect(withholdingRate("", 3)).toBeNull();
    expect(withholdingRate("abc", 5)).toBeNull();
    expect(withholdingRate("-1", 3)).toBeNull();
  });
});
