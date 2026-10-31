import { useEffect, useState } from "react";
import { command, errorMessage, isDesktop } from "../api";
import { Button, Checkbox, ErrorNotice, Field, Modal, Notice } from "../components";
import { normalizeAmount, optionalAmount, withholdingRate } from "../money";
import type { Income, Workspace } from "../types";
import type { LedgerCategory, LedgerEntry, LedgerKind } from "./types";
import CategoryIcon from "./CategoryIcon";

export const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const taxKindFor = (categoryId: string): Income["kind"] =>
  categoryId === "income-salary" ? "salary" : categoryId === "income-bonus" ? "bonus" : "other";

export default function EntryEditor({
  entry,
  initialKind,
  categories,
  onClose,
  onSaved,
}: {
  entry: LedgerEntry | null;
  initialKind: LedgerKind;
  categories: LedgerCategory[];
  onClose: () => void;
  onSaved: (taxChanged: boolean) => Promise<void>;
}) {
  const current = categories.find((c) => c.id === entry?.category_id);
  const [kind, setKind] = useState<LedgerKind>(current?.kind ?? initialKind);
  const options = categories.filter((c) => c.kind === kind);
  const [categoryId, setCategoryId] = useState(entry?.category_id ?? options[0]?.id ?? "");
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const [amount, setAmount] = useState(entry?.amount ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [linked, setLinked] = useState(Boolean(entry?.tax_income_id));
  const [payer, setPayer] = useState(entry?.tax?.source_label ?? "");
  const [payers, setPayers] = useState<string[]>([]);
  const [taxKind, setTaxKind] = useState<Income["kind"]>(
    entry?.tax?.kind ?? taxKindFor(categoryId),
  );
  const [withholding, setWithholding] = useState(entry?.tax?.withholding ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const year = Number(date.slice(0, 4));
  // Prefill the tax fields from the linked tax income, and offer known employers.
  useEffect(() => {
    if (kind !== "income" || !year || !isDesktop()) return;
    let cancelled = false;
    void command<Workspace>("get_year_workspace", { year })
      .then((workspace) => {
        if (cancelled) return;
        setPayers(workspace.sources.map((s) => s.label));
        const income = workspace.income.find((i) => i.id === entry?.tax_income_id);
        if (income) {
          setPayer(workspace.sources.find((s) => s.id === income.source_id)?.label ?? "");
          setTaxKind(income.kind);
          setWithholding(income.withholding ?? "");
        } else setPayer((value) => value || workspace.sources[0]?.label || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, year, entry?.tax_income_id]);
  const switchKind = (next: LedgerKind) => {
    setKind(next);
    setCategoryId(categories.find((c) => c.kind === next)?.id ?? "");
    if (next === "expense") setLinked(false);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const tax =
        kind === "income" && linked
          ? {
              source_label: payer.trim(),
              kind: taxKind,
              withholding: optionalAmount(withholding),
            }
          : null;
      await command("save_ledger_entry", {
        request: {
          id: entry?.id ?? null,
          date,
          category_id: categoryId,
          amount: normalizeAmount(amount),
          note: note.trim(),
          tax,
        },
      });
      await onSaved(Boolean(tax) || Boolean(entry?.tax_income_id));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={entry ? "แก้ไขรายการ" : "เพิ่มรายการ"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)}>
        <div className="segmented ledger-kind" role="group" aria-label="ประเภทรายการ">
          {(
            [
              ["expense", "รายจ่าย"],
              ["income", "รายรับ"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              className={kind === value ? "active" : ""}
              onClick={() => switchKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field
            label="วันที่"
            type="date"
            value={date}
            min="2000-01-01"
            max="2100-12-31"
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <Field
            label="จำนวนเงิน (บาท)"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="เช่น 120"
            required
            autoFocus
          />
        </div>
        <fieldset className="field category-picker">
          <legend>หมวดหมู่</legend>
          <div className="cat-grid">
            {options.map((category) => (
              <label key={category.id} className={categoryId === category.id ? "selected" : ""}>
                <input
                  className="cat-radio"
                  type="radio"
                  name="ledger-category"
                  value={category.id}
                  checked={categoryId === category.id}
                  onChange={() => {
                    setCategoryId(category.id);
                    if (!entry?.tax_income_id) setTaxKind(taxKindFor(category.id));
                  }}
                  required
                />
                <CategoryIcon category={category} size={20} />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label="บันทึกช่วยจำ"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === "income" ? "เช่น ค่าจ้างงานออกแบบ" : "เช่น ข้าวกลางวัน"}
        />
        {kind === "income" && (
          <div className="ledger-tax-link">
            {![2025, 2026].includes(year) && (
              <Notice>
                การเชื่อมภาษีรองรับปี 2568 และ 2569 เท่านั้น รายรับปีอื่นบันทึกได้โดยไม่เลือกนับภาษี
              </Notice>
            )}
            <Checkbox checked={linked} onChange={setLinked}>
              นับรายการนี้เป็นรายได้ในการคำนวณภาษีปี {year ? year + 543 : ""}
            </Checkbox>
            {linked && (
              <>
                <div className="form-grid">
                  <Field
                    label="ผู้จ่ายเงิน / นายจ้าง"
                    value={payer}
                    list="ledger-payers"
                    maxLength={100}
                    onChange={(e) => setPayer(e.target.value)}
                    required
                  />
                  <datalist id="ledger-payers">
                    {payers.map((label) => (
                      <option key={label} value={label} />
                    ))}
                  </datalist>
                  <label className="field">
                    <span>ประเภทรายได้ภาษี</span>
                    <select
                      value={taxKind}
                      onChange={(e) => setTaxKind(e.target.value as Income["kind"])}
                    >
                      <option value="salary">เงินเดือน</option>
                      <option value="bonus">โบนัส</option>
                      <option value="other">รายได้อื่น (ครั้งเดียว)</option>
                    </select>
                  </label>
                </div>
                <Field
                  label="ภาษีที่ถูกหัก ณ ที่จ่าย (บาท)"
                  inputMode="decimal"
                  value={withholding}
                  onChange={(e) => setWithholding(e.target.value)}
                  hint="เว้นว่างหากไม่ทราบ กรอก 0 เฉพาะเมื่อยืนยันว่าไม่มี"
                />
                <div className="wht-quick">
                  <div className="segmented" aria-label="อัตราภาษีหัก ณ ที่จ่าย">
                    {([3, 5] as const).map((rate) => {
                      const value = withholdingRate(amount, rate);
                      return (
                        <button
                          key={rate}
                          type="button"
                          disabled={!value}
                          onClick={() => setWithholding(value!)}
                        >
                          {rate}%
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Notice>
                  ยอดนี้จะถูกบันทึกในหน้า “รายได้ของฉัน” ของปีภาษีนั้นด้วย
                  แก้ไขหรือลบที่นี่แล้วภาษีจะตามไปด้วย ต้องเริ่มต้นข้อมูลปีภาษีนั้นก่อน
                </Notice>
              </>
            )}
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={busy || !categoryId}>
            {busy ? "กำลังบันทึก…" : "บันทึกรายการ"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
