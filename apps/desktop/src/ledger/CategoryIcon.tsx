import {
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Clapperboard,
  Coffee,
  CreditCard,
  Dumbbell,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  HandHeart,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  PiggyBank,
  Plane,
  Scissors,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Smartphone,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LedgerCategory } from "./types";

type Tone = "mint" | "peach" | "sky" | "lilac" | "lemon";
type Look = [LucideIcon, Tone];

// Starter categories keep stable ids on desktop and phone, so they map directly.
const starter: Record<string, Look> = {
  "income-salary": [Banknote, "mint"],
  "income-bonus": [Gift, "lemon"],
  "income-side": [Briefcase, "sky"],
  "income-other": [HandCoins, "lilac"],
  "expense-food": [Utensils, "peach"],
  "expense-transport": [Bus, "sky"],
  "expense-housing": [House, "lilac"],
  "expense-utilities": [Zap, "lemon"],
  "expense-shopping": [ShoppingBag, "peach"],
  "expense-health": [HeartPulse, "mint"],
  "expense-entertainment": [Clapperboard, "lilac"],
  "expense-education": [GraduationCap, "sky"],
  "expense-insurance": [ShieldCheck, "mint"],
  "expense-other": [Tag, "lemon"],
};

// Categories people add themselves are matched by name. Order matters:
// longer words come before the shorter words they contain (หนังสือ/หนัง, น้ำมัน/น้ำ).
const keywords: [string[], Look][] = [
  [
    ["เงินเดือน", "ค่าจ้าง", "salary", "wage"],
    [Banknote, "mint"],
  ],
  [
    ["ฟรีแลนซ์", "งานเสริม", "รายได้เสริม", "freelance", "side"],
    [Briefcase, "sky"],
  ],
  [
    ["หนังสือ", "เรียน", "คอร์ส", "การศึกษา", "course", "book"],
    [GraduationCap, "sky"],
  ],
  [
    ["น้ำมัน", "รถ", "ทางด่วน", "จอดรถ", "fuel", "car"],
    [Car, "sky"],
  ],
  [
    ["กาแฟ", "คาเฟ่", "ชานม", "coffee", "cafe"],
    [Coffee, "peach"],
  ],
  [
    ["อาหาร", "ข้าว", "กิน", "ขนม", "food", "eat"],
    [Utensils, "peach"],
  ],
  [
    ["เที่ยว", "ตั๋ว", "เครื่องบิน", "โรงแรม", "travel", "trip"],
    [Plane, "sky"],
  ],
  [
    ["เดินทาง", "แท็กซี่", "bts", "mrt", "grab", "taxi"],
    [Bus, "sky"],
  ],
  [
    ["เช่า", "บ้าน", "คอนโด", "หอ", "rent", "home"],
    [House, "lilac"],
  ],
  [
    ["โทรศัพท์", "มือถือ", "เน็ต", "internet", "phone"],
    [Smartphone, "sky"],
  ],
  [
    ["ค่าไฟ", "ค่าน้ำ", "ไฟฟ้า", "utility"],
    [Zap, "lemon"],
  ],
  [
    ["เสื้อ", "แฟชั่น", "รองเท้า", "cloth"],
    [Shirt, "peach"],
  ],
  [
    ["ช้อป", "ซื้อ", "shop"],
    [ShoppingBag, "peach"],
  ],
  [
    ["ฟิตเนส", "ยิม", "ออกกำลัง", "gym", "fitness"],
    [Dumbbell, "mint"],
  ],
  [
    ["สุขภาพ", "หมอ", "ยา", "โรงพยาบาล", "health"],
    [HeartPulse, "mint"],
  ],
  [
    ["ตัดผม", "ความงาม", "สปา", "beauty", "salon"],
    [Scissors, "lilac"],
  ],
  [
    ["เกม", "game"],
    [Gamepad2, "lilac"],
  ],
  [
    ["หนัง", "บันเทิง", "เพลง", "สตรีม", "movie", "netflix", "music"],
    [Clapperboard, "lilac"],
  ],
  [
    ["ประกัน", "insurance"],
    [ShieldCheck, "mint"],
  ],
  [
    ["แมว", "หมา", "สัตว์", "pet"],
    [PawPrint, "peach"],
  ],
  [
    ["ลูก", "เด็ก", "baby", "kid"],
    [Baby, "lemon"],
  ],
  [
    ["ของขวัญ", "โบนัส", "gift", "bonus"],
    [Gift, "lemon"],
  ],
  [
    ["บริจาค", "ทำบุญ", "donat"],
    [HandHeart, "peach"],
  ],
  [
    ["ลงทุน", "หุ้น", "กองทุน", "ปันผล", "invest", "stock", "dividend"],
    [TrendingUp, "mint"],
  ],
  [
    ["ออม", "เก็บเงิน", "saving"],
    [PiggyBank, "lilac"],
  ],
  [
    ["บัตรเครดิต", "หนี้", "ผ่อน", "credit", "loan"],
    [CreditCard, "lilac"],
  ],
  [
    ["ภาษี", "tax"],
    [Landmark, "sky"],
  ],
  [
    ["นิยาย", "การ์ตูน", "magazine"],
    [BookOpen, "sky"],
  ],
];

export function categoryLook(category: Pick<LedgerCategory, "id" | "kind" | "name">): Look {
  const known = starter[category.id];
  if (known) return known;
  const name = category.name.toLowerCase();
  const match = keywords.find(([words]) => words.some((word) => name.includes(word)));
  if (match) return match[1];
  return category.kind === "income" ? [Wallet, "mint"] : [Tag, "lemon"];
}

/** Decorative round icon shown beside a category name. */
export default function CategoryIcon({
  category,
  size = 18,
}: {
  category: Pick<LedgerCategory, "id" | "kind" | "name">;
  size?: number;
}) {
  const [Icon, tone] = categoryLook(category);
  return (
    <span className={`cat-icon tone-${tone}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
