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
