import { useEffect, useState } from "react";
import { Check, FileDown, FileSpreadsheet, Upload, X } from "lucide-react";
import { command, errorMessage, isCancelled } from "../api";
import { Button, ErrorNotice, Field, Notice } from "../components";
import { AccountsOptions, Empty, PageTitle, Select, Table } from "./ui";
import type { ImportRequest, ImportReview, WealthData } from "./types";

const fields: [string, string][] = [
  ["date", "วันที่"],
  ["kind", "ประเภทรายการ"],
  ["symbol", "สัญลักษณ์"],
  ["exchange", "ตลาด"],
  ["instrument_id", "ID หลักทรัพย์"],
  ["instrument_kind", "ประเภทหลักทรัพย์ (stock/etf)"],
  ["currency", "สกุลเงิน"],
  ["quantity", "จำนวนหน่วย / เงินสดตั้งต้น"],
  ["unit_price", "ราคาต่อหน่วย"],
  ["amount", "เงินสดสุทธิ"],
  ["fee", "ค่าธรรมเนียม"],
  ["tax", "ภาษีหัก ณ ที่จ่าย"],
  ["note", "บันทึกช่วยจำ"],
  ["related_account_id", "ID บัญชีปลายทาง"],
  ["counter_currency", "สกุลเงินที่ได้รับ"],
  ["counter_amount", "จำนวนเงินที่ได้รับ"],
  ["cost_basis", "ต้นทุนรวม"],
  ["cost_basis_base", "ต้นทุนในสกุลรายงาน"],
];
export default function ImportPage({
  data,
  onChanged,
  onAccount,
}: {
  data: WealthData;
  onChanged: () => Promise<void>;
  onAccount: () => void;
}) {
  const [request, setRequest] = useState<ImportRequest>({
    account_id: data.accounts[0]?.id ?? "",
    mode: "activities",
    date_format: "iso",
    mapping: {},
    mapping_name: "",
    csv: null,
    file_token: null,
    symbol_mappings: {},
  });
  const [review, setReview] = useState<ImportReview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dirty, setDirty] = useState(false);
  const [symbol, setSymbol] = useState("");
  useEffect(
    () => () => {
      void command("cancel_wealth_import").catch(() => {});
    },
    [],
  );
  const preview = async () => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await command<ImportReview>("preview_wealth_import", { request });
      setReview(result);
      setRequest({ ...request, mapping: result.mapping, file_token: result.token });
      setSelected(
        result.rows.filter((r) => !r.duplicate && r.errors.length === 0).map((r) => r.index),
      );
      setDirty(false);
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await command("cancel_wealth_import");
      setReview(null);
      setRequest({ ...request, file_token: null });
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!review || dirty) return;
    setBusy(true);
    setError("");
    try {
      const result = await command<{ imported: number; skipped: number }>("commit_wealth_import", {
        token: review.token,
        includeRows: selected,
      });
      setReview(null);
      setRequest({ ...request, file_token: null });
      await onChanged();
      setSuccess(`นำเข้าแล้ว ${result.imported} รายการ · ข้าม ${result.skipped} รายการ`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const changeRequest = (change: Partial<ImportRequest>) => {
    setRequest({ ...request, ...change });
    if (review) setDirty(true);
  };
  const template = async () => {
    setBusy(true);
    try {
      await command("save_wealth_template", { mode: request.mode });
      setSuccess("บันทึกไฟล์ต้นแบบแล้ว");
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!data.accounts.length)
    return (
      <>
        <PageTitle eyebrow="BRING YOUR HISTORY" title="นำเข้าข้อมูล">
          เริ่มจากบัญชีที่ต้องการเก็บรายการนี้
        </PageTitle>
        <Empty title="เพิ่มบัญชีก่อนนำเข้า" action="เพิ่มบัญชี" onAction={onAccount}>
          แต่ละไฟล์จะนำเข้าไปยังบัญชีที่คุณเลือก
        </Empty>
      </>
    );
  return (
    <>
      <PageTitle eyebrow="BRING YOUR HISTORY" title="นำเข้าข้อมูล">
        ตรวจทุกแถวก่อนบันทึกจริง รองรับไฟล์ CSV แบบ UTF-8
      </PageTitle>
      {error && <ErrorNotice message={error} onClose={() => setError("")} />}
      {success && <Notice tone="success">{success}</Notice>}
      <section className="card wealth-import-setup">
        <div className="wealth-section-heading">
          <div>
            <h2>
              01 <span>เลือกข้อมูลตั้งต้น</span>
            </h2>
            <p>ใช้ประวัติครบถ้วน หรือเริ่มจากยอดที่คุณมีอยู่</p>
          </div>
          <FileSpreadsheet size={25} />
        </div>
        <fieldset disabled={busy}>
          <div className="wealth-grid-three">
            <Select
              label="บัญชีที่จะนำเข้า"
              value={request.account_id}
              onChange={(e) => changeRequest({ account_id: e.target.value })}
            >
              <AccountsOptions data={data} />
            </Select>
            <Select
              label="รูปแบบข้อมูล"
              value={request.mode}
              onChange={(e) => changeRequest({ mode: e.target.value })}
            >
              <option value="activities">ประวัติรายการลงทุน</option>
              <option value="opening_positions">ยอดตั้งต้น</option>
            </Select>
            <Select
              label="รูปแบบวันที่"
              value={request.date_format}
              onChange={(e) => changeRequest({ date_format: e.target.value })}
            >
              <option value="iso">YYYY-MM-DD (ค.ศ.)</option>
              <option value="dmy">DD/MM/YYYY (ค.ศ.)</option>
              <option value="buddhist">DD/MM/YYYY (พ.ศ.)</option>
            </Select>
          </div>
          <div className="wealth-actions">
            <Button onClick={() => void preview()} disabled={busy}>
              <Upload size={16} />
              {busy ? "กำลังอ่านไฟล์…" : review ? "ตรวจตัวอย่างใหม่" : "เลือกไฟล์ CSV"}
            </Button>
            <Button variant="secondary" onClick={() => void template()} disabled={busy}>
              <FileDown size={16} />
              ดาวน์โหลดไฟล์ต้นแบบ
            </Button>
            {review && (
              <Button variant="ghost" onClick={() => void cancel()} disabled={busy}>
                <X size={16} />
                ยกเลิกการนำเข้า
              </Button>
            )}
          </div>
        </fieldset>
      </section>
      {!review && (
        <Notice>
          ไฟล์จะถูกอ่านในเครื่อง การเลือกไฟล์ยังไม่บันทึกรายการ
          ราคาซื้อขายและยอดเงินสดสุทธิต้องรวมค่าธรรมเนียมและภาษีตามที่ระบุในไฟล์ต้นแบบ
        </Notice>
      )}
      {review && (
        <>
          <section className="card">
            <div className="wealth-section-heading">
              <div>
                <h2>
                  02 <span>จับคู่คอลัมน์</span>
                </h2>
                <p>
                  {review.filename} · {review.rows.length} แถว
                </p>
              </div>
              <span className="wealth-tag">ยังไม่บันทึก</span>
            </div>
            <fieldset disabled={busy}>
              <div className="wealth-grid-three">
                <Select
                  label="ใช้รูปแบบที่บันทึก"
                  defaultValue=""
                  onChange={(e) => {
                    const mapping = data.import_mappings.find((m) => m.id === e.target.value);
                    if (mapping)
                      changeRequest({
                        mapping: mapping.columns,
                        mapping_name: mapping.name,
                        date_format: mapping.date_format,
                        mode: mapping.mode,
                      });
                  }}
                >
                  <option value="">จับคู่ด้วยตัวเอง</option>
                  {data.import_mappings.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                <Field
                  label="บันทึกรูปแบบนี้ในชื่อ (ถ้าต้องการ)"
                  value={request.mapping_name}
                  onChange={(e) => changeRequest({ mapping_name: e.target.value })}
                />
              </div>
              <details open>
                <summary>คอลัมน์ในไฟล์ → ข้อมูลใน Taxly</summary>
                <div className="wealth-mapping-grid">
                  {fields
                    .filter(([key]) =>
                      request.mode === "opening_positions"
                        ? [
                            "date",
                            "symbol",
                            "exchange",
                            "instrument_id",
                            "instrument_kind",
                            "currency",
                            "quantity",
                            "cost_basis",
                            "cost_basis_base",
                          ].includes(key)
                        : !key.startsWith("cost_basis"),
                    )
                    .map(([key, label]) => (
                      <Select
                        key={key}
                        label={label}
                        value={request.mapping[key] ?? ""}
                        onChange={(e) =>
                          changeRequest({ mapping: { ...request.mapping, [key]: e.target.value } })
                        }
                      >
                        <option value="">ไม่ใช้คอลัมน์</option>
                        {review.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </Select>
                    ))}
                </div>
              </details>
              <details>
                <summary>จับคู่สัญลักษณ์กับหลักทรัพย์ที่มีอยู่</summary>
                <p className="wealth-help">ระบุสัญลักษณ์ตรงกับในไฟล์เพื่อแก้ตลาดหรือชื่อที่กำกวม</p>
                <div className="form-grid">
                  <Field
                    label="สัญลักษณ์ในไฟล์"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                  />
                  <Select
                    label="ใช้หลักทรัพย์"
                    value={request.symbol_mappings[symbol] ?? ""}
                    onChange={(e) => {
                      if (symbol.trim())
                        changeRequest({
                          symbol_mappings: {
                            ...request.symbol_mappings,
                            [symbol.trim()]: e.target.value,
                          },
                        });
                    }}
                  >
                    <option value="">เลือกหลักทรัพย์</option>
                    {data.instruments.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.symbol} · {i.exchange} · {i.currency}
                      </option>
                    ))}
                  </Select>
                </div>
                {Object.entries(request.symbol_mappings)
                  .filter(([, id]) => id)
                  .map(([key, id]) => (
                    <p key={key}>
                      {key} → {data.instruments.find((i) => i.id === id)?.symbol}{" "}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          const next = { ...request.symbol_mappings };
                          delete next[key];
                          changeRequest({ symbol_mappings: next });
                        }}
                      >
                        ลบการจับคู่
                      </button>
                    </p>
                  ))}
              </details>
              {dirty && (
                <Notice tone="warning">
                  การจับคู่มีการเปลี่ยนแปลง กดตรวจตัวอย่างใหม่ก่อนยืนยัน
                </Notice>
              )}
              <Button variant="secondary" onClick={() => void preview()} disabled={busy}>
                ตรวจตัวอย่างใหม่
              </Button>
            </fieldset>
          </section>
          {review.new_instruments.length > 0 && (
            <Notice>
              จะสร้างหลักทรัพย์ใหม่เมื่อยืนยัน:{" "}
              {review.new_instruments
                .map((i) => `${i.symbol} (${i.kind.toUpperCase()} / ${i.exchange} / ${i.currency})`)
                .join(", ")}{" "}
              หากเป็นหลักทรัพย์เดิม ให้จับคู่สัญลักษณ์ด้านบน
            </Notice>
          )}
          <section className="card wealth-card-flush">
            <div className="wealth-section-heading">
              <div>
                <h2>
                  03 <span>ตรวจสอบและยืนยัน</span>
                </h2>
                <p>แถวซ้ำถูกข้ามไว้ก่อน คุณเลือกนำเข้าได้หากตั้งใจให้เป็นอีกรายการ</p>
              </div>
            </div>
            <Table caption="ตัวอย่างรายการ CSV ก่อนนำเข้า">
              <thead>
                <tr>
                  <th>นำเข้า</th>
                  <th>แถว</th>
                  {review.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th>ผลการตรวจสอบ</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row) => (
                  <tr key={row.index}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`นำเข้าแถว ${row.index}`}
                        checked={selected.includes(row.index)}
                        disabled={busy || dirty || row.errors.length > 0}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, row.index]
                              : selected.filter((i) => i !== row.index),
                          )
                        }
                      />
                    </td>
                    <td>{row.index}</td>
                    {review.headers.map((h) => (
                      <td key={h}>{row.values[h] || "—"}</td>
                    ))}
                    <td>
                      {row.errors.length ? (
                        <span className="wealth-negative">{row.errors.join(" · ")}</span>
                      ) : row.duplicate ? (
                        <span className="wealth-tag">อาจซ้ำ</span>
                      ) : (
                        <span className="wealth-positive">
                          <Check size={13} /> พร้อม
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="wealth-import-confirm">
              <span>
                เลือก {selected.length} จาก {review.rows.length} แถว
              </span>
              <Button
                onClick={() => void commit()}
                disabled={busy || dirty || selected.length === 0}
              >
                {busy ? "กำลังบันทึก…" : `ยืนยันนำเข้า ${selected.length} รายการ`}
              </Button>
            </div>
          </section>
        </>
      )}
    </>
  );
}
