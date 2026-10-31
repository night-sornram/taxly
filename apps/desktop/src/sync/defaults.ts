import { emptyTax } from "./model";
import type { Snapshot } from "./model";
export function starterSnapshot(): Snapshot {
  const income = [
    ["salary", "เงินเดือน"],
    ["bonus", "โบนัส"],
    ["side", "รายได้เสริม"],
    ["other", "รายรับอื่น"],
  ];
  const expense = [
    ["food", "อาหารและเครื่องดื่ม"],
    ["transport", "เดินทาง"],
    ["housing", "ที่พักและค่าเช่า"],
    ["utilities", "ค่าน้ำ ค่าไฟ ค่าโทรศัพท์"],
    ["shopping", "ช้อปปิ้ง"],
    ["health", "สุขภาพ"],
    ["entertainment", "บันเทิง"],
    ["education", "การศึกษา"],
    ["insurance", "ประกัน"],
    ["other", "รายจ่ายอื่น"],
  ];
  return {
    categories: [
      ...income.map(([id, name]) => ({ id: `income-${id}`, kind: "income" as const, name })),
      ...expense.map(([id, name]) => ({ id: `expense-${id}`, kind: "expense" as const, name })),
    ],
    entries: [],
    tax: emptyTax(),
  };
}
