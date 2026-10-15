/** Display decimal strings without passing financial values through floating point. */
export function decimal(value: string | null | undefined, digits = 2): string {
  if (value == null) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "—";
  const [, sign, whole, fraction = ""] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const places = Math.max(digits, Math.min(fraction.replace(/0+$/, "").length, 8));
  return `${sign}${grouped}${places ? `.${fraction.padEnd(places, "0").slice(0, places)}` : ""}`;
}
export function percentage(value: string | null | undefined): string {
  if (value == null) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "—";
  const [, sign, whole, fraction = ""] = match;
  // Ratios are shifted two places and rounded for display using exact integers.
  const padded = fraction.padEnd(5, "0");
  const hundredths = BigInt(`${whole}${padded.slice(0, 4)}`) + (padded[4] >= "5" ? 1n : 0n);
  return `${hundredths === 0n ? "" : sign}${decimal(String(hundredths / 100n), 0)}.${String(hundredths % 100n).padStart(2, "0")}%`;
}
export function today(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"].map((key) => parts.find((p) => p.type === key)?.value).join("-");
}
export function dateLabel(date: string | null): string {
  if (!date) return "ยังไม่มีข้อมูล";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
export const activityLabels: Record<string, string> = {
  deposit: "ฝากเงิน",
  withdrawal: "ถอนเงิน",
  buy: "ซื้อ",
  sell: "ขาย",
  dividend: "เงินปันผล",
  interest: "ดอกเบี้ย",
  fee: "ค่าธรรมเนียม",
  tax: "ภาษีหัก ณ ที่จ่าย",
  split: "แตกหุ้น",
  transfer: "โอนระหว่างบัญชี",
  fx: "แลกสกุลเงิน",
};
export function signedClass(value: string | null | undefined): string {
  return value == null ? "" : value.startsWith("-") ? "wealth-negative" : "wealth-positive";
}

/** Ordering for non-negative portfolio values, with unavailable values last. */
export function compareValues(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  const [aw, af = ""] = a.split(".");
  const [bw, bf = ""] = b.split(".");
  if (aw.length !== bw.length) return aw.length - bw.length;
  const whole = aw.localeCompare(bw);
  return (
    whole ||
    af
      .padEnd(Math.max(af.length, bf.length), "0")
      .localeCompare(bf.padEnd(Math.max(af.length, bf.length), "0"))
  );
}

const satangOf = (raw: string | null): bigint | null => {
  if (raw == null || raw.trim() === "") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim().replace(/,/g, ""));
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  return sign ? -value : value;
};
const moneyOf = (satang: bigint): string =>
  `${satang / 100n}.${(satang % 100n).toString().padStart(2, "0")}`;

/** UI convenience for buy/sell entry: derive the unit price from the total
 *  cash amount, charges, and quantity using exact BigInt arithmetic (half-up).
 *  Returns null until every input is a valid non-negative amount. */
export function unitPriceFromTotal(
  kind: "buy" | "sell",
  quantity: string | null,
  amount: string | null,
  fee: string | null,
  tax: string | null,
): string | null {
  const quantityMatch = /^(\d+)(?:\.(\d{1,12}))?$/.exec((quantity ?? "").trim().replace(/,/g, ""));
  if (!quantityMatch) return null;
  const [, quantityWhole, quantityFraction = ""] = quantityMatch;
  const scale = 10n ** BigInt(quantityFraction.length);
  const quantityUnits = BigInt(quantityWhole) * scale + BigInt(quantityFraction || "0");
  if (quantityUnits <= 0n) return null;
  const total = satangOf(amount);
  if (total === null || total <= 0n) return null;
  const basis =
    kind === "buy"
      ? total - (satangOf(fee) ?? 0n) - (satangOf(tax) ?? 0n)
      : total + (satangOf(fee) ?? 0n) + (satangOf(tax) ?? 0n);
  if (basis <= 0n) return null;
  const priceSatang = (basis * scale + quantityUnits / 2n) / quantityUnits;
  if (priceSatang <= 0n) return null;
  return moneyOf(priceSatang);
}

export interface TradePreviewResult {
  currentValue: string;
  gain: string;
  percent: string;
}

/** Live form preview: profit or loss of the entered trade against the newest
 *  stored price. Pure BigInt arithmetic; never persisted. */
export function tradePreview(
  kind: "buy" | "sell",
  quantity: string | null,
  unitPrice: string | null,
  fee: string | null,
  tax: string | null,
  currentClose: string | null,
): TradePreviewResult | null {
  const quantityMatch = /^(\d+)(?:\.(\d{1,12}))?$/.exec((quantity ?? "").trim().replace(/,/g, ""));
  const priceSatang = satangOf(unitPrice);
  const closeSatang = satangOf(currentClose);
  if (!quantityMatch || priceSatang === null || priceSatang <= 0n) return null;
  if (closeSatang === null || closeSatang <= 0n) return null;
  const [, quantityWhole, quantityFraction = ""] = quantityMatch;
  const scale = 10n ** BigInt(quantityFraction.length);
  const quantityUnits = BigInt(quantityWhole) * scale + BigInt(quantityFraction || "0");
  if (quantityUnits <= 0n) return null;
  // units are quantityUnits × satang; convert back to whole satang (half-up).
  const scaledValue = (units: bigint) => (units + scale / 2n) / scale;
  const charges = (satangOf(fee) ?? 0n) + (satangOf(tax) ?? 0n);
  const currentValue = scaledValue(quantityUnits * closeSatang);
  const tradedValue = scaledValue(quantityUnits * priceSatang);
  const gain =
    kind === "buy" ? currentValue - tradedValue - charges : tradedValue - charges - currentValue;
  const basis = kind === "buy" ? tradedValue + charges : currentValue;
  let percent = "—";
  if (basis > 0n) {
    const negative = gain < 0n;
    const magnitude = negative ? -gain : gain;
    const hundredths = (magnitude * 10000n + basis / 2n) / basis;
    percent = `${negative ? "-" : ""}${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`;
  }
  return { currentValue: moneyOf(currentValue), gain: moneyOf(gain), percent };
}
