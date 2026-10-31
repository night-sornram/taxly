import { useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { command, errorMessage, isCancelled } from "../api";
import { Button, ErrorNotice, MoneyValue, Notice } from "../components";
import { previewRows } from "./ledger";
import type { CsvMapping, DateOrder } from "./ledger";
import type { CsvFile, Ledger } from "./types";

const guess = (headers: string[], pattern: RegExp) => {
  const index = headers.findIndex((h) => pattern.test(h));
  return index < 0 ? null : index;
};

export default function ImportPage({
  ledger,
  onImported,
}: {
  ledger: Ledger;
  onImported: (count: number) => Promise<void>;
}) {
  const [file, setFile] = useState<CsvFile | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [overrides, setOverrides] = useState<
    Record<number, { include?: boolean; category?: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstOf = (kind: "income" | "expense") =>
    ledger.categories.find((c) => c.kind === kind && c.id.endsWith("other"))?.id ??
    ledger.categories.find((c) => c.kind === kind)?.id ??
    "";
  const autoMap = (rows: string[][], headerRow: number): CsvMapping => {
    const headers = rows[headerRow] ?? [];
    const out = guess(headers, /ถอน|จ่าย|withdraw|debit/i);
    const into = guess(headers, /ฝาก|รับ|deposit|credit/i);
    const amount = guess(headers, /จำนวน|amount|ยอด/i);
    return {
      headerRow,
      date: guess(headers, /วันที่|date/i) ?? 0,
      order: "dmy",
      amount:
        out !== null && into !== null
          ? { mode: "split", out, in: into }
          : { mode: "signed", column: amount ?? 1 },
      note: guess(headers, /รายละเอียด|รายการ|บันทึก|description|detail|memo|note/i),
      expenseCategory: firstOf("expense"),
      incomeCategory: firstOf("income"),
    };
  };
  const pick = async () => {
    setError("");
    setBusy(true);
    try {
      const next = await command<CsvFile>("read_ledger_csv");
      setFile(next);
      setMapping(autoMap(next.rows, 0));
      setOverrides({});
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const preview = useMemo(
    () =>
      file && mapping ? previewRows(file.rows, mapping, ledger.entries, ledger.categories) : [],
    [file, mapping, ledger],
  );
  const kinds = new Map(ledger.categories.map((c) => [c.id, c.kind]));
  const rows = preview.map((row) => {
    // A remap can flip a row's kind; drop a category override that no longer matches it.
    const override = overrides[row.line]?.category;
    return {
      ...row,
      category_id: override && kinds.get(override) === row.kind ? override : row.category_id,
      include: !row.error && (overrides[row.line]?.include ?? !row.duplicate),
    };
  });
  const chosen = rows.filter((row) => row.include);
  const commit = async () => {
    setBusy(true);
    setError("");
    try {
      const count = await command<number>("import_ledger_entries", {
        rows: chosen.map((row) => ({
          date: row.date,
          category_id: row.category_id,
          amount: row.amount,
          note: row.note,
        })),
      });
      setFile(null);
      setMapping(null);
      await onImported(count);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const headers = file && mapping ? (file.rows[mapping.headerRow] ?? []) : [];
  const column = (
    label: string,
    value: number | null,
    set: (v: number | null) => void,
    optional = false,
  ) => (
    <label className="field">
      <span>{label}</span>
      <select
        value={value ?? -1}
        onChange={(e) => set(Number(e.target.value) < 0 ? null : Number(e.target.value))}
      >
        {optional && <option value={-1}>ไม่ใช้</option>}
        {headers.map((header, i) => (
          <option key={i} value={i}>
            {header || `คอลัมน์ ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
  const update = (patch: Partial<CsvMapping>) => mapping && setMapping({ ...mapping, ...patch });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>นำเข้า CSV</h1>
          <p>นำรายการจากไฟล์ของธนาคารหรือบัตรเครดิตเข้ามา ตรวจดูก่อนบันทึกทุกครั้ง</p>
        </div>
        <Button
          variant={file ? "secondary" : "primary"}
          onClick={() => void pick()}
          disabled={busy}
        >
          <FileSpreadsheet size={17} /> {file ? "เลือกไฟล์อื่น" : "เลือกไฟล์ CSV"}
        </Button>
      </div>
      {error && <ErrorNotice message={error} onClose={() => setError("")} />}
      {!file || !mapping ? (
        <div className="card empty-state">
          <FileSpreadsheet size={30} />
          <h3>ยังไม่ได้เลือกไฟล์</h3>
          <p>
            รองรับไฟล์ CSV แบบ UTF-8 และภาษาไทยแบบเก่า (TIS-620) ขนาดไม่เกิน 5 MiB
            ประมวลผลไฟล์ในเครื่อง เฉพาะรายการที่เลือกจะเข้าบัญชีและซิงก์เมื่อเปิดใช้
          </p>
        </div>
      ) : (
        <>
          <section className="card ledger-panel">
            <h2>จับคู่คอลัมน์ · {file.file_name}</h2>
            <div className="form-grid">
              <label className="field">
                <span>แถวหัวตาราง</span>
                <select
                  value={mapping.headerRow}
                  onChange={(e) => {
                    setMapping(autoMap(file.rows, Number(e.target.value)));
                    setOverrides({});
                  }}
                >
                  {file.rows.slice(0, 15).map((row, i) => (
                    <option key={i} value={i}>
                      แถว {i + 1}: {row.join(" | ").slice(0, 60)}
                    </option>
                  ))}
                </select>
              </label>
              {column("วันที่", mapping.date, (v) => update({ date: v ?? 0 }))}
              <label className="field">
                <span>รูปแบบวันที่</span>
                <select
                  value={mapping.order}
                  onChange={(e) => update({ order: e.target.value as DateOrder })}
                >
                  <option value="dmy">วัน/เดือน/ปี</option>
                  <option value="ymd">ปี-เดือน-วัน</option>
                  <option value="mdy">เดือน/วัน/ปี</option>
                </select>
              </label>
              <label className="field">
                <span>รูปแบบจำนวนเงิน</span>
                <select
                  value={mapping.amount.mode}
                  onChange={(e) =>
                    update({
                      amount:
                        e.target.value === "split"
                          ? { mode: "split", out: 0, in: 0 }
                          : { mode: "signed", column: 0 },
                    })
                  }
                >
                  <option value="signed">คอลัมน์เดียว (ติดลบ = รายจ่าย)</option>
                  <option value="split">แยกคอลัมน์ถอน / ฝาก</option>
                </select>
              </label>
              {mapping.amount.mode === "signed" ? (
                column("จำนวนเงิน", mapping.amount.column, (v) =>
                  update({ amount: { mode: "signed", column: v ?? 0 } }),
                )
              ) : (
                <>
                  {column("ถอน / จ่าย", mapping.amount.out, (v) =>
                    update({
                      amount: {
                        ...(mapping.amount as { mode: "split"; out: number; in: number }),
                        out: v ?? 0,
                      },
                    }),
                  )}
                  {column("ฝาก / รับ", mapping.amount.in, (v) =>
                    update({
                      amount: {
                        ...(mapping.amount as { mode: "split"; out: number; in: number }),
                        in: v ?? 0,
                      },
                    }),
                  )}
                </>
              )}
              {column("บันทึก / รายละเอียด", mapping.note, (v) => update({ note: v }), true)}
            </div>
          </section>
          <section className="card table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>นำเข้า</th>
                    <th>แถว</th>
                    <th>วันที่</th>
                    <th>รายละเอียด</th>
                    <th>หมวดหมู่</th>
                    <th className="align-right">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.line} className={row.error ? "ledger-invalid" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`นำเข้าแถว ${row.line}`}
                          checked={row.include}
                          disabled={Boolean(row.error)}
                          onChange={(e) =>
                            setOverrides({
                              ...overrides,
                              [row.line]: { ...overrides[row.line], include: e.target.checked },
                            })
                          }
                        />
                      </td>
                      <td>{row.line}</td>
                      <td>{row.date ?? "—"}</td>
                      <td>
                        {row.note || "—"}
                        {row.error && <small className="field-error">{row.error}</small>}
                        {row.duplicate && <small>อาจซ้ำกับรายการที่มีอยู่</small>}
                      </td>
                      <td>
                        <select
                          aria-label={`หมวดหมู่แถว ${row.line}`}
                          value={row.category_id}
                          disabled={Boolean(row.error)}
                          onChange={(e) =>
                            setOverrides({
                              ...overrides,
                              [row.line]: { ...overrides[row.line], category: e.target.value },
                            })
                          }
                        >
                          {ledger.categories
                            .filter((c) => c.kind === row.kind)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className={`align-right ledger-${row.kind}`}>
                        {row.amount ? (
                          <>
                            {row.kind === "income" ? "+" : "−"}
                            <MoneyValue value={row.amount} currency={false} />
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="table-footer">
              เลือก {chosen.length} จาก {rows.length} แถว · แถวที่อ่านไม่ได้จะถูกข้าม
            </footer>
          </section>
          <Notice>
            รายการนำเข้าจะไม่ถูกนับในภาษีอัตโนมัติ แก้ไขรายรับแต่ละรายการภายหลังเพื่อเชื่อมกับภาษี
          </Notice>
          <div className="modal-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setFile(null);
                setMapping(null);
              }}
            >
              ยกเลิก
            </Button>
            <Button disabled={busy || chosen.length === 0} onClick={() => void commit()}>
              {busy ? "กำลังนำเข้า…" : `นำเข้า ${chosen.length} รายการ`}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
