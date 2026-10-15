import { useState } from "react";
import {
  BookOpen,
  Check,
  FileClock,
  Heart,
  Leaf,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  Calculation,
  Deduction,
  Facts,
  Guidance,
  RuleSource,
  Snapshot,
  Workspace,
} from "./types";
import { command, errorMessage } from "./api";
import {
  Answer,
  BasisBadge,
  Button,
  Checkbox,
  ErrorNotice,
  Modal,
  MoneyValue,
  Notice,
  TextLink,
} from "./components";
import { formatMoney, months } from "./money";

export function ProfileEditor({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [facts, setFacts] = useState<Facts>(workspace.profile!.facts);
  const [complete, setComplete] = useState(workspace.profile!.income_complete);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await command("save_profile", {
        year: workspace.year,
        facts,
        incomeComplete: complete,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (key: keyof Facts, value: boolean | null) =>
    setFacts((current) => ({ ...current, [key]: value }));
  return (
    <Modal title="ทบทวนข้อมูลผู้เสียภาษี" onClose={onClose}>
      <Answer
        label="เป็นโสดตลอดปีภาษีนี้ใช่ไหม?"
        value={facts.single}
        onChange={(v) => set("single", v)}
      />
      <Answer
        label="อายุต่ำกว่า 65 ปีใช่ไหม?"
        value={facts.under_65}
        onChange={(v) => set("under_65", v)}
      />
      <Answer
        label="มีเฉพาะเงินเดือนและโบนัสในประเทศใช่ไหม?"
        value={facts.domestic_salary_only}
        onChange={(v) => set("domestic_salary_only", v)}
      />
      <Answer
        label="ไม่มีสิทธิยกเว้นพิเศษ เงินก้อนออกจากงาน หรือผลประโยชน์อื่นใช่ไหม?"
        value={facts.no_special_cases}
        onChange={(v) => set("no_special_cases", v)}
      />
      <Answer
        label="ไม่มีสิทธิ์ลดหย่อนอื่นนอกเหนือจากส่วนตัวและประกันสังคมใช่ไหม?"
        value={facts.no_other_deductions}
        onChange={(v) => set("no_other_deductions", v)}
      />
      <Checkbox
        checked={facts.social_security_confirmed}
        onChange={(v) => set("social_security_confirmed", v)}
      >
        ตรวจยอดประกันสังคมที่ใช้สิทธิ์ได้ รวมกรณีไม่จ่าย ลดอัตรา และคืนเงินสมทบแล้ว
      </Checkbox>
      <Checkbox checked={complete} onChange={setComplete}>
        บันทึกหรือประมาณรายได้ทั้งปีครบแล้ว
      </Checkbox>
      <Notice>คำตอบที่ไม่ใช่หรือไม่แน่ใจจะไม่ถูกแทนด้วยกรณีพื้นฐาน แอปจะระบุข้อจำกัดไว้ในผล</Notice>
      {error && <ErrorNotice message={error} />}
      <div className="modal-actions">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          ยกเลิก
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
        </Button>
      </div>
    </Modal>
  );
}

export function DeductionsPage({
  workspace,
  guidance,
  onEdit,
  onChanged,
  onProfile,
  onSource,
}: {
  workspace: Workspace;
  guidance: Guidance[];
  onEdit: (entry: Deduction | null) => void;
  onChanged: () => Promise<void>;
  onProfile: () => void;
  onSource: (id: string) => void;
}) {
  const [removing, setRemoving] = useState<Deduction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await command("delete_deduction", {
        year: workspace.year,
        id: removing.id,
      });
      await onChanged();
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
          <h1 tabIndex={-1}>สิทธิ์ที่อาจเป็นของคุณ</h1>
          <p>เริ่มจากสิ่งที่จ่ายไปแล้ว ตรวจให้ชัดก่อนใช้สิทธิ์ ไม่จำเป็นต้องซื้ออะไรเพิ่ม</p>
        </div>
        <Button variant="secondary" onClick={onProfile}>
          ทบทวนข้อมูลของฉัน
        </Button>
      </div>
      <Notice>
        รุ่นนี้รวมเฉพาะสิทธิ์ส่วนตัวและประกันสังคม ม.33 สิทธิ์อื่นด้านล่างยังไม่รวมในผลคำนวณ
      </Notice>
      <div className="guidance-grid">
        {guidance.map((card) => (
          <section
            key={card.code}
            className={`card guidance-card ${card.status === "not_included" ? "unsupported" : ""}`}
          >
            <div className="card-heading">
              <span className="soft-icon">
                {card.code === "personal" ? (
                  <Heart size={20} />
                ) : card.code === "sso_33" ? (
                  <ShieldCheck size={20} />
                ) : (
                  <Leaf size={20} />
                )}
              </span>
              <span className={`badge ${card.status === "not_included" ? "neutral" : "actual"}`}>
                {card.status === "included"
                  ? "รวมให้แล้ว"
                  : card.status === "not_included"
                    ? "ยังไม่รวมในรุ่นนี้"
                    : "ตรวจยอดเอง"}
              </span>
            </div>
            <h2>{card.title}</h2>
            <p>{card.explanation}</p>
            {card.limit !== null && (
              <div className="guidance-limit">
                <span>
                  {card.code === "personal"
                    ? "สิทธิ์พื้นฐานต่อปี"
                    : "กรอบสูงสุดกรณีอัตราปกติเต็มปี"}
                </span>
                <MoneyValue value={card.limit} />
              </div>
            )}
            {card.savings !== null && (
              <p className="savings">
                ลดภาษีเชิงคำนวณ <b>{formatMoney(card.savings)} บาท</b> จากข้อมูลที่บันทึก
              </p>
            )}
            <details>
              <summary>เงื่อนไขและเอกสาร</summary>
              <p>{card.conditions}</p>
              <ul>
                {card.documents.map((document) => (
                  <li key={document}>{document}</li>
                ))}
              </ul>
              <TextLink external onClick={() => onSource(card.source_ids[0])}>
                ดูแหล่งอ้างอิงของปีนี้
              </TextLink>
            </details>
          </section>
        ))}
      </div>
      <section className="card table-card">
        <div className="section-heading padded">
          <div>
            <h2>ประกันสังคมรายเดือน</h2>
          </div>
          <Button variant="secondary" onClick={() => onEdit(null)}>
            <Plus size={16} /> เพิ่มรายการ
          </Button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>เดือน</th>
                <th>สถานะ</th>
                <th className="align-right">จำนวนเงิน (บาท)</th>
                <th>
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {workspace.deductions.map((entry) => (
                <tr key={entry.id}>
                  <td>{months[entry.month - 1]}</td>
                  <td>
                    <BasisBadge basis={entry.basis} />
                  </td>
                  <td className="align-right">
                    <MoneyValue value={entry.amount} currency={false} />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        onClick={() => onEdit(entry)}
                        aria-label={`แก้ไขประกันสังคม ${months[entry.month - 1]}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => setRemoving(entry)}
                        aria-label={`ลบประกันสังคม ${months[entry.month - 1]}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {workspace.deductions.length === 0 && (
            <div className="empty-state">
              <p>ยังไม่มีรายการประกันสังคม หากไม่ได้จ่าย ให้ยืนยันข้อมูลใน “ทบทวนข้อมูลของฉัน”</p>
            </div>
          )}
        </div>
      </section>
      {removing && (
        <Modal title="ลบประกันสังคมรายการนี้?" onClose={() => setRemoving(null)}>
          <p>
            ลบยอดเดือน{months[removing.month - 1]} จำนวน <MoneyValue value={removing.amount} />{" "}
            และกลับไปตรวจความครบถ้วนอีกครั้ง
          </p>
          {error && <ErrorNotice message={error} />}
          <div className="modal-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>
              เก็บไว้ก่อน
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              ลบรายการ
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Explanation({
  data,
  sources,
  onSource,
  archived = false,
}: {
  data: Calculation;
  sources: RuleSource[];
  onSource: (id: string) => void;
  archived?: boolean;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>ทำไมได้ตัวเลขนี้?</h1>
          <p>
            {archived
              ? "ผลที่เคยบันทึกไว้ ข้อมูลปัจจุบันอาจเปลี่ยนแล้ว"
              : "ดูวิธีคิดทีละขั้น ทุกตัวเลขมีที่มา"}
          </p>
        </div>
        <span className="badge neutral">ปีภาษี {data.year + 543}</span>
      </div>
      {data.scope_issues.length > 0 && (
        <Notice tone="warning">
          <strong>ยังไม่ใช่ภาพภาษีที่ครบถ้วน</strong>
          <ul>
            {data.scope_issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Notice>
      )}
      <div className="calculation-layout">
        <section className="card steps-card">
          {data.steps.map((step, i) => (
            <div className="calculation-step" key={step.rule_id}>
              <span className="step-number">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h2>{step.label}</h2>
                <p>{step.formula}</p>
                <div className="step-sources">
                  {step.source_ids.map((id) => (
                    <button key={id} onClick={() => onSource(id)}>
                      <BookOpen size={11} /> แหล่งอ้างอิง
                    </button>
                  ))}
                </div>
              </div>
              <MoneyValue value={step.amount} />
            </div>
          ))}
        </section>
        <aside className="card explanation-side">
          <span className="soft-icon">
            <BookOpen size={22} />
          </span>
          <h2>ภาษีเป็นขั้นบันได</h2>
          <p>แต่ละช่วงรายได้ใช้อัตราของช่วงนั้น ไม่ได้นำรายได้ทั้งหมดไปคูณอัตราสูงสุด</p>
          <div className="side-total">
            <span>ภาษีทั้งปีโดยประมาณ</span>
            <MoneyValue value={data.annual_tax} />
          </div>
          <hr />
          <h3>หน้าที่ยื่น ≠ ภาษีที่ต้องจ่าย</h3>
          <p>
            ผู้โสดที่มีเงินเดือนอย่างเดียวเกิน 120,000 บาทต้องยื่นแบบ แม้ภาษีเป็นศูนย์
            ถ้าไม่ถึงเกณฑ์บังคับยื่นแต่มีภาษีถูกหัก อาจยื่นเพื่อขอคืนได้
          </p>
        </aside>
      </div>
      <section className="card table-card">
        <div className="section-heading padded">
          <h2>ภาษีของเงินได้แต่ละช่วง</h2>
          <span className="fine-print">จำนวนเงินเป็นบาท</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ช่วงเงินได้สุทธิ</th>
                <th>อัตราที่ใช้</th>
                <th className="align-right">เงินได้ในช่วง</th>
                <th className="align-right">ภาษีในช่วง</th>
              </tr>
            </thead>
            <tbody>
              {data.bands.map((band) => (
                <tr key={band.lower}>
                  <td>
                    {formatMoney(band.lower)}{" "}
                    {band.upper ? `– ${formatMoney(band.upper)}` : "ขึ้นไป"}
                  </td>
                  <td>
                    {Number(band.rate) === 0 ? (
                      <>
                        ยกเว้น
                        <br />
                        <small className="fine-print">
                          อัตราตามกฎหมาย {Number(band.statutory_rate) * 100}%
                        </small>
                      </>
                    ) : (
                      `${Number(band.rate) * 100}%`
                    )}
                  </td>
                  <td className="align-right">
                    <MoneyValue value={band.taxable_amount} currency={false} />
                  </td>
                  <td className="align-right">
                    <MoneyValue value={band.tax} currency={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card sources-card">
        <div className="section-heading">
          <div>
            <h2>ชุดกฎและแหล่งอ้างอิง</h2>
          </div>
          <span className="badge neutral">{data.rule_set_id}</span>
        </div>
        {sources.map((source) => (
          <div className="source-row" key={source.id}>
            <div>
              <strong>{source.title}</strong>
              <p>
                {source.authority} · {source.locator}
              </p>
              <small>
                ตรวจ {source.checked_on}{" "}
                {source.published_on ? `· ประกาศ ${source.published_on}` : ""}
              </small>
            </div>
            <TextLink external onClick={() => onSource(source.id)}>
              เปิดเอกสาร
            </TextLink>
          </div>
        ))}
        <Notice>
          อ่านคำอธิบายและคำนวณได้ขณะออฟไลน์ การเปิดเอกสารฉบับเต็มใช้เบราว์เซอร์และอินเทอร์เน็ต
        </Notice>
      </section>
      <section className="card warnings-card">
        <h2>สิ่งที่ควรรู้เกี่ยวกับผลนี้</h2>
        <ul>
          {data.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
        <p>Taxly ไม่ส่งแบบหรือชำระภาษีแทนคุณ และไม่ได้รับรองยอดนี้โดยกรมสรรพากร</p>
      </section>
    </>
  );
}

export function HistoryPage({
  history,
  revision,
  onSave,
  onView,
}: {
  history: Snapshot[];
  revision: number;
  onSave: () => void;
  onView: (snapshot: Snapshot) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>ผลสรุปที่เคยบันทึก</h1>
          <p>เก็บข้อมูล กฎ และผลในเวลานั้นไว้ การคำนวณใหม่ไม่เขียนทับประวัติ</p>
        </div>
        <Button onClick={onSave}>
          <Plus size={16} /> บันทึกผลปัจจุบัน
        </Button>
      </div>
      <div className="history-list">
        {history.map((snapshot) => {
          const result = JSON.parse(snapshot.result_json) as Calculation;
          return (
            <article className="card history-card" key={snapshot.id}>
              <span className="soft-icon">
                <FileClock size={23} />
              </span>
              <div>
                <h2>ภาพรวมปีภาษี {snapshot.tax_year + 543}</h2>
                <p>
                  {new Date(snapshot.created_at).toLocaleString("th-TH", {
                    timeZone: "Asia/Bangkok",
                  })}
                </p>
                <small>
                  {snapshot.rule_set_id} · Engine {snapshot.engine_version}
                </small>
              </div>
              <div>
                <span
                  className={`badge ${snapshot.data_revision === revision ? "actual" : "neutral"}`}
                >
                  {snapshot.data_revision === revision ? (
                    <>
                      <Check size={12} />
                      ตรงกับข้อมูลปัจจุบัน
                    </>
                  ) : (
                    "ข้อมูลปัจจุบันเปลี่ยนแล้ว"
                  )}
                </span>
                <MoneyValue value={result.annual_tax} />
              </div>
              <Button variant="secondary" onClick={() => onView(snapshot)}>
                เปิดผลเดิม
              </Button>
            </article>
          );
        })}
        {history.length === 0 && (
          <div className="card empty-state">
            <FileClock size={36} />
            <h2>ยังไม่มีผลสรุปที่บันทึก</h2>
            <p>บันทึกภาพรวมครั้งแรก เพื่อกลับมาตรวจข้อมูลและชุดกฎที่ใช้ในวันนั้น</p>
          </div>
        )}
      </div>
    </>
  );
}
