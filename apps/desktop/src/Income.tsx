import { useState } from "react";
import { Check, CheckCheck, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { command, errorMessage } from "./api";
import {
  BasisBadge,
  Button,
  Checkbox,
  ErrorNotice,
  Field,
  Modal,
  MoneyValue,
  MonthSelect,
  Notice,
} from "./components";
import { months, normalizeAmount, optionalAmount, withholdingRate } from "./money";
import type { Basis, Deduction, Income, Workspace } from "./types";

export function incomeKindLabel(kind: Income["kind"]): string {
  return kind === "salary" ? "เงินเดือน" : kind === "bonus" ? "โบนัส" : "รายได้อื่น";
}

export function IncomeEditor({
  entry,
  workspace,
  onClose,
  onSaved,
}: {
  entry: Income | null;
  workspace: Workspace;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [source, setSource] = useState(
    entry
      ? workspace.sources.find((source) => source.id === entry.source_id)?.label || ""
      : workspace.sources[0]?.label || "",
  );
  const [month, setMonth] = useState(entry?.month || 1);
  const [kind, setKind] = useState(entry?.kind || "salary");
  const [basis, setBasis] = useState<Basis>(entry?.basis || "actual");
  const [gross, setGross] = useState(entry?.gross || "");
  const [withholding, setWithholding] = useState(entry?.withholding ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await command("upsert_income", {
        request: {
          id: entry?.id ?? null,
          year: workspace.year,
          source_label: source.trim(),
          month,
          kind,
          basis,
          gross: normalizeAmount(gross),
          withholding: optionalAmount(withholding),
          note: note.trim(),
        },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={entry ? "แก้ไขรายได้" : "เพิ่มรายได้"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)}>
        <Field
          label="ชื่อนายจ้าง"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          list="employers"
          maxLength={100}
          required
          autoFocus
        />
        <datalist id="employers">
          {workspace.sources.map((source) => (
            <option key={source.id} value={source.label} />
          ))}
        </datalist>
        <div className="form-grid">
          <MonthSelect label="เดือนที่รับเงิน" value={month} onChange={setMonth} />
          <label className="field">
            <span>ประเภท</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Income["kind"])}>
              <option value="salary">เงินเดือน</option>
              <option value="bonus">โบนัส</option>
              <option value="other">รายได้อื่น (ครั้งเดียว)</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>สถานะของจำนวนนี้</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="actual">รับแล้วจริง / ตรวจแล้ว</option>
            <option value="forecast">คาดการณ์ / ยังไม่ยืนยัน</option>
          </select>
        </label>
        {kind === "other" && (
          <p className="fine-print">
            รายได้อื่นจะนำรวมเข้าคำนวณเต็มจำนวน โดยยังไม่หักค่าใช้จ่ายตามหลักเกณฑ์จริง
            ผลประมาณการจึงอาจสูงกว่าภาษีที่ต้องชำระจริง
          </p>
        )}
        <Field
          label="รายได้ก่อนหัก (บาท)"
          inputMode="decimal"
          value={gross}
          onChange={(e) => setGross(e.target.value)}
          placeholder="เช่น 30,000"
          required
        />
        <Field
          label="ภาษีที่ถูกหัก (บาท)"
          inputMode="decimal"
          value={withholding}
          onChange={(e) => setWithholding(e.target.value)}
          hint="เว้นว่างหากไม่ทราบ กรอก 0 เฉพาะเมื่อยืนยันว่าไม่มี"
        />
        <div className="wht-quick">
          <span className="fine-print">หัก ณ ที่จ่ายจากยอดก่อนหัก</span>
          <div className="segmented" aria-label="อัตราภาษีหัก ณ ที่จ่าย">
            {([3, 5] as const).map((rate) => {
              const amount = withholdingRate(gross, rate);
              return (
                <button
                  key={rate}
                  type="button"
                  disabled={!amount}
                  onClick={() => setWithholding(amount!)}
                >
                  {rate}%
                </button>
              );
            })}
          </div>
          <span className="fine-print">3% ค่าจ้างทำของ ค่าบริการ ค่าโฆษณา · 5% ค่าเช่า</span>
        </div>
        <Field
          label="บันทึกช่วยจำ"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น รอปรับเงินเดือนเดือนหน้า"
        />
        <Notice>
          หนึ่งนายจ้างมีเงินเดือนปกติหนึ่งรายการต่อเดือน
          เปลี่ยนรายการคาดการณ์เดิมเป็นยอดจริงเพื่อไม่ให้นับซ้ำ
        </Notice>
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "บันทึกรายได้"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function IncomePage({
  workspace,
  onEdit,
  onChanged,
  onProfile,
}: {
  workspace: Workspace;
  onEdit: (entry: Income | null) => void;
  onChanged: () => Promise<void>;
  onProfile: () => void;
}) {
  const [month, setMonth] = useState(0);
  const [basis, setBasis] = useState("all");
  const [removing, setRemoving] = useState<Income | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = workspace.income.filter(
    (entry) => (month === 0 || entry.month === month) && (basis === "all" || entry.basis === basis),
  );
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await command("delete_income", { year: workspace.year, id: removing.id });
      await onChanged();
      setRemoving(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmIncome = async (checked: boolean) => {
    setBusy(true);
    try {
      await command("save_profile", {
        year: workspace.year,
        facts: workspace.profile!.facts,
        incomeComplete: checked,
      });
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>รายได้ของฉัน</h1>
          <p>เงินเดือน โบนัส และภาษีที่ถูกหัก จัดให้เป็นเรื่องเดียวกัน</p>
        </div>
        <Button onClick={() => onEdit(null)}>
          <Plus size={17} /> เพิ่มรายได้
        </Button>
      </div>
      {error && <ErrorNotice message={error} onClose={() => setError("")} />}
      <div className="card table-card">
        <div className="table-toolbar">
          <div className="segmented" aria-label="กรองสถานะ">
            {[
              ["all", "ทั้งหมด"],
              ["actual", "ยอดจริง"],
              ["forecast", "คาดการณ์"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setBasis(value)}
                aria-pressed={basis === value}
                className={basis === value ? "active" : ""}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="compact-select">
            <span className="sr-only">เดือนที่แสดง</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              <option value={0}>ทุกเดือน</option>
              {months.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>เดือน / นายจ้าง</th>
                <th>ประเภท</th>
                <th>สถานะ</th>
                <th className="align-right">ก่อนหัก</th>
                <th className="align-right">ภาษีที่หัก</th>
                <th>บันทึก</th>
                <th>
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{months[entry.month - 1]}</strong>
                    <small>
                      {workspace.sources.find((source) => source.id === entry.source_id)?.label}
                    </small>
                  </td>
                  <td>{incomeKindLabel(entry.kind)}</td>
                  <td>
                    <BasisBadge basis={entry.basis} />
                  </td>
                  <td className="align-right">
                    <MoneyValue value={entry.gross} currency={false} />
                  </td>
                  <td className="align-right">
                    {entry.withholding === null ? (
                      <span className="unknown">ยังไม่ทราบ</span>
                    ) : (
                      <MoneyValue value={entry.withholding} currency={false} />
                    )}
                  </td>
                  <td>{entry.note || "—"}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={`แก้ไข${incomeKindLabel(entry.kind)} ${months[entry.month - 1]}`}
                        onClick={() => onEdit(entry)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`ลบรายได้ ${months[entry.month - 1]}`}
                        onClick={() => setRemoving(entry)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="empty-state">
              <CheckCheck size={30} />
              <h3>ยังไม่มีรายการในมุมมองนี้</h3>
              <p>เปลี่ยนตัวกรองหรือเพิ่มรายได้ที่ต้องการบันทึก</p>
            </div>
          )}
        </div>
        <footer className="table-footer">
          {rows.length} รายการ · จำนวนเงินเป็นบาท · ยอดจริงและคาดการณ์แยกสถานะเสมอ
        </footer>
      </div>
      <div className="card confirmation-card">
        <div>
          <h2>
            <Check size={19} /> ตรวจความครบถ้วนของทั้งปี
          </h2>
          <p>รวมทุกนายจ้าง โบนัส และเดือนที่ไม่มีรายได้แล้ว หากยังไม่แน่ใจ ให้เว้นไว้ก่อน</p>
          <Checkbox
            checked={workspace.profile?.income_complete ?? false}
            onChange={(checked) => {
              if (!busy) void confirmIncome(checked);
            }}
          >
            ฉันบันทึกหรือประมาณรายได้ทั้งปีครบแล้ว
          </Checkbox>
        </div>
        <Button variant="secondary" onClick={onProfile}>
          ทบทวนข้อมูลผู้เสียภาษี
        </Button>
      </div>
      {removing && (
        <Modal title="ลบรายการรายได้นี้?" onClose={() => setRemoving(null)}>
          <p>
            รายได้เดือน{months[removing.month - 1]} จำนวน <MoneyValue value={removing.gross} />{" "}
            จะถูกลบ ผลสรุปเก่ายังคงอยู่ในประวัติ และต้องยืนยันรายได้ครบปีใหม่
          </p>
          {error && <ErrorNotice message={error} />}
          <div className="modal-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>
              เก็บไว้ก่อน
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy ? "กำลังลบ…" : "ลบรายการ"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function DeductionEditor({
  entry,
  year,
  onClose,
  onSaved,
}: {
  entry: Deduction | null;
  year: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [month, setMonth] = useState(entry?.month || 1);
  const [basis, setBasis] = useState<Basis>(entry?.basis || "actual");
  const [amount, setAmount] = useState(entry?.amount || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await command("upsert_deduction", {
        request: {
          id: entry?.id ?? null,
          year,
          month,
          basis,
          amount: normalizeAmount(amount),
        },
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={entry ? "แก้ไขประกันสังคม" : "เพิ่มประกันสังคม"} onClose={onClose}>
      <form onSubmit={(e) => void save(e)}>
        <MonthSelect label="เดือนที่จ่ายเงินสมทบ" value={month} onChange={setMonth} />
        <label className="field">
          <span>สถานะ</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="actual">จ่ายแล้วจริง</option>
            <option value="forecast">คาดการณ์ / ยังไม่ยืนยัน</option>
          </select>
        </label>
        <Field
          label="เงินสมทบฝ่ายลูกจ้าง (บาท)"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <Notice>
          บันทึกยอดรวมจากทุกนายจ้างหนึ่งครั้งต่อเดือน
          ใช้ยอดที่เข้าเงื่อนไขหลังตรวจกรณีลดอัตราหรือเงินสมทบคืน
        </Notice>
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "บันทึกประกันสังคม"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
