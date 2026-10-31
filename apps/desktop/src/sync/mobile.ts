import { ledgerEntries } from "./model";
import type { SyncEntry, TaxLink } from "./model";
import type { BrowserStore } from "./store";
import type { CsvFile } from "../ledger/types";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const pushField = () => {
    row.push(field.trim());
    field = "";
    closed = false;
    if (row.length > 64) throw new Error("ไฟล์ต้องมีไม่เกิน 64 คอลัมน์");
  };
  const pushRow = () => {
    pushField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > 20_000) throw new Error("ไฟล์ต้องมีไม่เกิน 20,000 แถว");
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      if (field.trim() || closed) throw new Error("รูปแบบเครื่องหมายคำพูดใน CSV ไม่ถูกต้อง");
      quoted = true;
    } else if (ch === ",") pushField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      if (closed && ch.trim()) throw new Error("รูปแบบ CSV หลังเครื่องหมายคำพูดไม่ถูกต้อง");
      field += ch;
    }
  }
  if (quoted) throw new Error("เครื่องหมายคำพูดใน CSV ปิดไม่ครบ");
  if (field || row.length) pushRow();
  if (!rows.length) throw new Error("ไฟล์ CSV ไม่มีข้อมูล");
  return rows;
}
async function pickCsv(): Promise<CsvFile> {
  const file = await new Promise<File>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = () =>
      input.files?.[0]
        ? resolve(input.files[0])
        : reject({ code: "Cancelled", message: "ยกเลิกเลือกไฟล์" });
    input.addEventListener(
      "cancel",
      () => reject({ code: "Cancelled", message: "ยกเลิกเลือกไฟล์" }),
      { once: true },
    );
    input.click();
  });
  if (file.size > 5 * 1024 * 1024) throw new Error("ไฟล์ CSV ต้องมีขนาดไม่เกิน 5 MiB");
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-874").decode(bytes);
  }
  return { file_name: file.name, rows: parseCsv(text) };
}
export function mobileCommands(store: BrowserStore) {
  return async (name: string, args: Record<string, unknown>) => {
    if (name === "get_ledger") {
      const { snapshot } = await store.read();
      return { categories: snapshot.categories, entries: ledgerEntries(snapshot) };
    }
    if (name === "read_ledger_csv") return pickCsv();
    if (
      ![
        "save_ledger_entry",
        "delete_ledger_entry",
        "save_ledger_category",
        "delete_ledger_category",
        "import_ledger_entries",
      ].includes(name)
    )
      throw new Error("การทำงานนี้ใช้ได้ในแอปคอมพิวเตอร์");
    let count = 0;
    await store.update((state) => {
      const snapshot = state.snapshot;
      if (name === "save_ledger_entry") {
        const request = args.request as Omit<SyncEntry, "id"> & {
          id: string | null;
          tax: TaxLink | null;
        };
        const index = snapshot.entries.findIndex((e) => e.id === request.id);
        if (request.id && index < 0) throw new Error("ไม่พบรายการ กรุณาโหลดข้อมูลใหม่");
        const entry: SyncEntry = {
          id: request.id ?? crypto.randomUUID(),
          date: request.date,
          category_id: request.category_id,
          amount: request.amount,
          note: request.note,
          tax: request.tax,
        };
        if (index < 0) snapshot.entries.push(entry);
        else snapshot.entries[index] = entry;
      } else if (name === "delete_ledger_entry")
        snapshot.entries = snapshot.entries.filter((e) => e.id !== args.id);
      else if (name === "save_ledger_category") {
        const request = args.request as {
          id: string | null;
          kind: "income" | "expense";
          name: string;
        };
        const old = snapshot.categories.find((c) => c.id === request.id);
        if (request.id && !old) throw new Error("ไม่พบหมวดหมู่");
        if (old) {
          if (old.kind !== request.kind)
            throw new Error("เปลี่ยนประเภทรายรับ/รายจ่ายของหมวดเดิมไม่ได้");
          old.name = request.name;
        } else
          snapshot.categories.push({
            id: crypto.randomUUID(),
            kind: request.kind,
            name: request.name,
          });
      } else if (name === "delete_ledger_category") {
        if (snapshot.entries.some((e) => e.category_id === args.id))
          throw new Error("หมวดหมู่นี้ยังมีรายการอยู่ ย้ายรายการไปหมวดอื่นก่อนลบ");
        snapshot.categories = snapshot.categories.filter((c) => c.id !== args.id);
      } else {
        const rows = args.rows as Omit<SyncEntry, "id" | "tax">[];
        if (!Array.isArray(rows) || !rows.length || rows.length > 5000)
          throw new Error("นำเข้าได้ครั้งละ 1–5,000 รายการ");
        snapshot.entries.push(
          ...rows.map((row) => ({ ...row, id: crypto.randomUUID(), tax: null })),
        );
        count = rows.length;
      }
    });
    window.dispatchEvent(new Event("taxly-ledger-changed"));
    return name === "import_ledger_entries" ? count : null;
  };
}
