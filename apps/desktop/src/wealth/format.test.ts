import { describe, expect, it } from "vitest";
import {
  dateLabel,
  decimal,
  netCashForTrade,
  percentage,
  today,
  tradePreview,
  unitPriceFromTotal,
} from "./format";

describe("wealth decimal presentation", () => {
  it("rounds money to two places without floating point conversion", () => {
    expect(decimal("900719925474099312345.12345678")).toBe("900,719,925,474,099,312,345.12");
    expect(decimal("-926.63005828")).toBe("-926.63");
    expect(decimal("1.005")).toBe("1.01");
    expect(decimal("-1250.05")).toBe("-1,250.05");
    expect(decimal("0")).toBe("0.00");
  });
  it("rounds to the requested precision for FX and keeps quantities intact", () => {
    expect(decimal("35.123456", 4)).toBe("35.1235");
    expect(decimal("0.123456789012", 0)).toBe("0.12345678");
    expect(decimal("12", 0)).toBe("12");
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

describe("unit price from total amount", () => {
  it("derives buy price by removing charges from the total", () => {
    expect(unitPriceFromTotal("buy", "100", "10,100.00", "50", "50")).toBe("100.00");
    expect(unitPriceFromTotal("sell", "10", "995", "5", null)).toBe("100.00");
  });
  it("supports fractional shares with exact integer math", () => {
    expect(unitPriceFromTotal("buy", "0.5", "500", "0", "0")).toBe("1000.00");
    expect(unitPriceFromTotal("buy", "3.75", "1500.00", "0", "0")).toBe("400.00");
  });
  it("returns null until inputs are usable", () => {
    expect(unitPriceFromTotal("buy", null, "100", "0", "0")).toBeNull();
    expect(unitPriceFromTotal("buy", "0", "100", "0", "0")).toBeNull();
    expect(unitPriceFromTotal("buy", "10", null, "0", "0")).toBeNull();
    expect(unitPriceFromTotal("buy", "10", "5", "10", "0")).toBeNull();
  });
});

describe("trade profit preview", () => {
  it("previews a buy against the newest stored price", () => {
    const preview = tradePreview("buy", "100", "100", "50", "50", "160");
    expect(preview?.currentValue).toBe("16000.00");
    expect(preview?.gain).toBe("5900.00");
    expect(preview?.percent).toBe("58.42");
  });
  it("charges reduce the gain and sells compare the other direction", () => {
    const preview = tradePreview("sell", "10", "150", "10", null, "160");
    expect(preview?.gain).toBe("-110.00");
    expect(preview?.percent).toBe("-6.88");
  });
  it("returns null until price or close is usable", () => {
    expect(tradePreview("buy", "10", null, "0", "0", "100")).toBeNull();
    expect(tradePreview("buy", "10", "100", "0", "0", null)).toBeNull();
  });
});

describe("net cash for trade", () => {
  it("computes buy cash with charges and sell cash after charges", () => {
    expect(netCashForTrade("buy", "10", "100", "50", "50")).toBe("1100.00");
    expect(netCashForTrade("sell", "10", "100", "50", null)).toBe("950.00");
  });
  it("supports fractional quantities and returns null until usable", () => {
    expect(netCashForTrade("buy", "0.5", "200", "0", "0")).toBe("100.00");
    expect(netCashForTrade("buy", null, "100", "0", "0")).toBeNull();
    expect(netCashForTrade("buy", "10", null, "0", "0")).toBeNull();
    expect(netCashForTrade("sell", "1", "100", "200", "0")).toBeNull();
  });
});
