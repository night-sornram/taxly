import { expect, it } from "vitest";
import { Banknote, Car, Coffee, GraduationCap, Tag, Utensils, Wallet } from "lucide-react";
import { categoryLook } from "./CategoryIcon";

const look = (id: string, name: string, kind: "income" | "expense" = "expense") =>
  categoryLook({ id, kind, name })[0];

it("gives starter categories their fixed icon", () => {
  expect(look("expense-food", "ชื่อที่ผู้ใช้แก้แล้ว")).toBe(Utensils);
  expect(look("income-salary", "เงินเดือน", "income")).toBe(Banknote);
});

it("matches custom category names, longer words first", () => {
  expect(look("c1", "ค่ากาแฟ")).toBe(Coffee);
  expect(look("c2", "ค่าน้ำมันรถ")).toBe(Car);
  expect(look("c3", "ซื้อหนังสือ")).toBe(GraduationCap);
  expect(look("c4", "ค่าจ้างจากลูกค้า", "income")).toBe(Banknote);
});

it("falls back by kind", () => {
  expect(look("c5", "อื่น ๆ")).toBe(Tag);
  expect(look("c6", "อื่น ๆ", "income")).toBe(Wallet);
});
