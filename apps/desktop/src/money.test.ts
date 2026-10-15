import { describe, it, expect } from "vitest";
import { formatMoney, normalizeAmount, optionalAmount } from "./money";

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
