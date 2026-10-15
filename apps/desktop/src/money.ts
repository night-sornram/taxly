/** Formatting and input normalization only. All tax arithmetic belongs to Rust. */
export function normalizeAmount(raw: string): string {
  const ascii = raw.trim().replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(ascii))
    throw new Error("กรอกจำนวนเงินไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง");
  const value = ascii.replaceAll(",", "");
  const [whole, fraction = ""] = value.split(".");
  const satang = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (satang > 9223372036854775807n) throw new Error("จำนวนเงินเกินช่วงที่รองรับ");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}
export function optionalAmount(raw: string): string | null {
  return raw.trim() === "" ? null : normalizeAmount(raw);
}
/** Editor convenience only: applies a common WHT rate (3% services, 5% rent)
 *  with exact satang integers, rounding half-up. Returns null on invalid input. */
export function withholdingRate(raw: string, percent: 3 | 5): string | null {
  try {
    const [whole, fraction = ""] = normalizeAmount(raw).split(".");
    const satang = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    const withheld = (satang * BigInt(percent) + 50n) / 100n;
    return `${withheld / 100n}.${(withheld % 100n).toString().padStart(2, "0")}`;
  } catch {
    return null;
  }
}
export function formatMoney(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${BigInt(whole).toLocaleString("th-TH")}.${fraction.padEnd(2, "0")}`;
}
export function proportion(part: string, total: string): number {
  // Bounded visual ratio; never used for tax or persisted monetary values.
  const integer = (s: string) => BigInt(s.split(".")[0]);
  const denominator = integer(total);
  return denominator === 0n ? 0 : Number((integer(part) * 10000n) / denominator) / 100;
}
export const months = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
export const shortMonths = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
