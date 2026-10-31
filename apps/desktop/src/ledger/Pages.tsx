import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChartPie,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
} from "lucide-react";
import { EmptyArt } from "../Art";
import CategoryIcon from "./CategoryIcon";
import { command, errorMessage } from "../api";
import { Button, ErrorNotice, Field, Modal, MoneyValue } from "../components";
import { months, shortMonths } from "../money";
import { categoryTotals, fromSatang, kindOf, monthlyTotals } from "./ledger";
import type { Ledger, LedgerCategory, LedgerEntry, LedgerKind } from "./types";

const thaiDate = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${shortMonths[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(0, 4)) + 543}`;
const monthLabel = (month: string) =>
  `${months[Number(month.slice(5, 7)) - 1]} ${Number(month.slice(0, 4)) + 543}`;

function MonthPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const go = (y: number, m: number) => {
    const d = new Date(y, m - 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 9 }, (_, i) => Math.min(year, thisYear - 5) + i).concat(
    year > thisYear + 3 ? [year] : [],
  );
  return (
    <div className="ledger-month" role="group" aria-label="เดือนที่แสดง">
      <button
        type="button"
        className="icon-button"
        aria-label="เดือนก่อนหน้า"
        onClick={() => go(year, month - 1)}
      >
        <ChevronLeft size={18} />
      </button>
      <select aria-label="เดือน" value={month} onChange={(e) => go(year, Number(e.target.value))}>
        {months.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label="ปี" value={year} onChange={(e) => go(Number(e.target.value), month)}>
        {[...new Set(years)].map((y) => (
          <option key={y} value={y}>
            {y + 543}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-button"
        aria-label="เดือนถัดไป"
        onClick={() => go(year, month + 1)}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function Signed({ value }: { value: bigint }) {
  return (
    <span className={value < 0n ? "ledger-negative" : ""}>
      <MoneyValue value={fromSatang(value < 0n ? -value : value)} currency={false} />
      {value < 0n && <span className="sr-only"> ติดลบ</span>}
    </span>
  );
}

export function OverviewPage({
  ledger,
  month,
  onMonth,
  onAdd,
}: {
  ledger: Ledger;
  month: string;
  onMonth: (month: string) => void;
  onAdd: (kind: LedgerKind) => void;
}) {
  const year = Number(month.slice(0, 4));
  const totals = monthlyTotals(ledger.entries, ledger.categories, year);
  const selected = totals[Number(month.slice(5, 7)) - 1];
  const expenses = categoryTotals(ledger.entries, ledger.categories, month, "expense");
  const largest = expenses[0]?.total ?? 0n;
  const yearIncome = totals.reduce((sum, t) => sum + t.income, 0n);
  const yearExpense = totals.reduce((sum, t) => sum + t.expense, 0n);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>รายรับรายจ่าย</h1>
          <p>รู้ว่าเงินเข้าเท่าไร ออกไปกับอะไร และเหลือเก็บเท่าไรในแต่ละเดือน</p>
        </div>
        <div className="ledger-actions">
          <MonthPicker value={month} onChange={onMonth} />
          <Button variant="secondary" onClick={() => onAdd("income")}>
            <Plus size={17} /> รายรับ
          </Button>
          <Button onClick={() => onAdd("expense")}>
            <Plus size={17} /> รายจ่าย
          </Button>
        </div>
      </div>
      <section className="ledger-stats" aria-label={`สรุป${monthLabel(month)}`}>
        <div className="card">
          <span className="card-label">
            <span className="card-icon">
              <ArrowDownLeft size={18} aria-hidden="true" />
            </span>
            รายรับ
          </span>
          <MoneyValue value={fromSatang(selected.income)} />
        </div>
        <div className="card">
          <span className="card-label">
            <span className="card-icon expense">
              <ArrowUpRight size={18} aria-hidden="true" />
            </span>
            รายจ่าย
          </span>
          <MoneyValue value={fromSatang(selected.expense)} />
        </div>
        <div className="card">
          <span className="card-label">
            <span className="card-icon">
              <PiggyBank size={18} aria-hidden="true" />
            </span>
            คงเหลือ
          </span>
          <Signed value={selected.income - selected.expense} />
        </div>
      </section>
      <div className="ledger-grid">
        <section className="card ledger-panel">
          <h2>
            <span className="card-icon">
              <ChartPie size={18} aria-hidden="true" />
            </span>
            รายจ่ายตามหมวด · {monthLabel(month)}
          </h2>
          {expenses.length === 0 ? (
            <div className="panel-empty">
              <EmptyArt className="empty-art" />
              <p className="fine-print">ยังไม่มีรายจ่ายในเดือนนี้</p>
            </div>
          ) : (
            <ul className="ledger-bars">
              {expenses.map(({ category, total }) => (
                <li key={category.id}>
                  <div>
                    <span className="cat-name">
                      <CategoryIcon category={category} />
                      {category.name}
                    </span>
                    <MoneyValue value={fromSatang(total)} currency={false} />
                  </div>
                  <span className="progress-track" aria-hidden="true">
                    <span style={{ width: `${Number((total * 100n) / largest)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card table-card ledger-panel">
          <h2>
            <span className="card-icon">
              <CalendarDays size={18} aria-hidden="true" />
            </span>
            ทั้งปี {year + 543}
          </h2>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="ยอดรายรับรายจ่ายทั้งปี"
          >
            <table>
              <thead>
                <tr>
                  <th>เดือน</th>
                  <th className="align-right">รายรับ</th>
                  <th className="align-right">รายจ่าย</th>
                  <th className="align-right">คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t, i) => (
                  <tr
                    key={i}
                    className={i === Number(month.slice(5, 7)) - 1 ? "ledger-current" : ""}
                  >
                    <td>{months[i]}</td>
                    <td className="align-right">
                      <MoneyValue value={fromSatang(t.income)} currency={false} />
                    </td>
                    <td className="align-right">
                      <MoneyValue value={fromSatang(t.expense)} currency={false} />
                    </td>
                    <td className="align-right">
                      <Signed value={t.income - t.expense} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>รวม</th>
                  <td className="align-right">
                    <MoneyValue value={fromSatang(yearIncome)} currency={false} />
                  </td>
                  <td className="align-right">
                    <MoneyValue value={fromSatang(yearExpense)} currency={false} />
                  </td>
                  <td className="align-right">
                    <Signed value={yearIncome - yearExpense} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

export function EntriesPage({
  ledger,
  month,
  onMonth,
  onEdit,
  onAdd,
  onChanged,
}: {
  ledger: Ledger;
  month: string;
  onMonth: (month: string) => void;
  onEdit: (entry: LedgerEntry) => void;
  onAdd: (kind: LedgerKind) => void;
  onChanged: (taxChanged: boolean) => Promise<void>;
}) {
  const [filter, setFilter] = useState<"all" | LedgerKind>("all");
  const [removing, setRemoving] = useState<LedgerEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = kindOf(ledger.categories);
  const categories = new Map(ledger.categories.map((c) => [c.id, c]));
  const rows = ledger.entries.filter(
    (e) => e.date.startsWith(month) && (filter === "all" || kind(e) === filter),
  );
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await command("delete_ledger_entry", { id: removing.id });
      await onChanged(Boolean(removing.tax_income_id));
      setRemoving(null);
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
          <h1 tabIndex={-1}>รายการทั้งหมด</h1>
          <p>ทุกรายการเก็บในเครื่อง แก้ไขหรือลบได้ตลอด</p>
        </div>
        <Button onClick={() => onAdd("expense")}>
          <Plus size={17} /> เพิ่มรายการ
        </Button>
      </div>
      {error && !removing && <ErrorNotice message={error} onClose={() => setError("")} />}
      <div className="card table-card">
        <div className="table-toolbar">
          <div className="segmented" aria-label="กรองประเภท">
            {(
              [
                ["all", "ทั้งหมด"],
                ["income", "รายรับ"],
                ["expense", "รายจ่าย"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={filter === value ? "active" : ""}
              >
                {label}
              </button>
            ))}
          </div>
          <MonthPicker value={month} onChange={onMonth} />
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="ตารางรายการรายรับรายจ่าย"
        >
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>หมวดหมู่</th>
                <th>บันทึก</th>
                <th className="align-right">จำนวนเงิน</th>
                <th>
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td>{thaiDate(entry.date)}</td>
                  <td>
                    <span className="cat-name">
                      {categories.has(entry.category_id) && (
                        <CategoryIcon category={categories.get(entry.category_id)!} size={16} />
                      )}
                      {categories.get(entry.category_id)?.name}
                    </span>
                    {entry.tax_income_id && (
                      <span className="badge neutral ledger-tax-badge">
                        <Landmark size={12} aria-hidden="true" /> นับภาษี
                      </span>
                    )}
                  </td>
                  <td>{entry.note || "—"}</td>
                  <td className={`align-right ledger-${kind(entry)}`}>
                    {kind(entry) === "income" ? "+" : "−"}
                    <MoneyValue value={entry.amount} currency={false} />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={`แก้ไข ${categories.get(entry.category_id)?.name} ${thaiDate(entry.date)}`}
                        onClick={() => onEdit(entry)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`ลบ ${categories.get(entry.category_id)?.name} ${thaiDate(entry.date)}`}
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
              <EmptyArt className="empty-art" />
              <h3>ยังไม่มีรายการใน{monthLabel(month)}</h3>
              <p>เพิ่มรายการเอง หรือนำเข้าจากไฟล์ CSV ของธนาคาร</p>
            </div>
          )}
        </div>
        <footer className="table-footer">{rows.length} รายการ · จำนวนเงินเป็นบาท</footer>
      </div>
      {removing && (
        <Modal title="ลบรายการนี้?" onClose={() => setRemoving(null)}>
          <p>
            {categories.get(removing.category_id)?.name} วันที่ {thaiDate(removing.date)} จำนวน{" "}
            <MoneyValue value={removing.amount} /> จะถูกลบ
            {removing.tax_income_id && " รายได้ที่นับในภาษีจากรายการนี้จะถูกลบด้วย"}
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

export function CategoriesPage({
  ledger,
  onChanged,
}: {
  ledger: Ledger;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ kind: LedgerKind; category: LedgerCategory | null }>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const used = new Set(ledger.entries.map((e) => e.category_id));
  const open = (kind: LedgerKind, category: LedgerCategory | null) => {
    setEditing({ kind, category });
    setName(category?.name ?? "");
    setError("");
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
      setEditing(undefined);
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
          <h1 tabIndex={-1}>หมวดหมู่</h1>
          <p>ตั้งชื่อหมวดให้ตรงกับชีวิตจริง เพื่อให้สรุปรายเดือนอ่านง่าย</p>
        </div>
      </div>
      {error && !editing && <ErrorNotice message={error} onClose={() => setError("")} />}
      <div className="ledger-grid">
        {(
          [
            ["expense", "หมวดรายจ่าย"],
            ["income", "หมวดรายรับ"],
          ] as const
        ).map(([kind, title]) => (
          <section key={kind} className="card ledger-panel">
            <div className="card-heading">
              <h2>{title}</h2>
              <Button variant="secondary" onClick={() => open(kind, null)}>
                <Plus size={16} /> เพิ่มหมวด
              </Button>
            </div>
            <ul className="ledger-category-list">
              {ledger.categories
                .filter((c) => c.kind === kind)
                .map((category) => (
                  <li key={category.id}>
                    <span className="cat-name">
                      <CategoryIcon category={category} size={20} />
                      {category.name}
                    </span>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        aria-label={`เปลี่ยนชื่อ ${category.name}`}
                        onClick={() => open(kind, category)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`ลบ ${category.name}`}
                        disabled={busy || used.has(category.id)}
                        title={used.has(category.id) ? "หมวดนี้ยังมีรายการอยู่" : undefined}
                        onClick={() =>
                          void run(() => command("delete_ledger_category", { id: category.id }))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      {editing && (
        <Modal
          title={editing.category ? "เปลี่ยนชื่อหมวด" : "เพิ่มหมวด"}
          onClose={() => setEditing(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                command("save_ledger_category", {
                  request: { id: editing.category?.id ?? null, kind: editing.kind, name },
                }),
              );
            }}
          >
            <Field
              label="ชื่อหมวด"
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            {error && <ErrorNotice message={error} />}
            <div className="modal-actions">
              <Button variant="secondary" disabled={busy} onClick={() => setEditing(undefined)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={busy}>
                บันทึก
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
