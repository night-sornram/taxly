import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  HeartHandshake,
  Leaf,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { command, errorMessage } from "./api";
import {
  Answer,
  Brand,
  Button,
  Checkbox,
  ErrorNotice,
  Field,
  MoneyValue,
  MonthSelect,
  Notice,
  PrivacyNote,
  ThemeToggle,
} from "./components";
import { emptyFacts } from "./types";
import { MoneyArt } from "./Art";
import type { OnboardingDraft, Facts } from "./types";
import { normalizeAmount, optionalAmount, months } from "./money";

const labels = [
  "เริ่มต้น",
  "รู้จักคุณ",
  "รายได้",
  "ยอดจริง",
  "โบนัส",
  "ประกันสังคม",
  "สิทธิ์อื่น",
  "ตรวจข้อมูล",
];
function initialDraft(draft: unknown): OnboardingDraft {
  const defaults: OnboardingDraft = {
    step: 0,
    facts: { ...emptyFacts },
    source_label: "",
    monthly_salary: "",
    start_month: 1,
    end_month: 12,
    actual_through: 0,
    monthly_withholding: "",
    forecast_withholding: false,
    monthly_sso: "",
    bonus: "",
    bonus_month: 12,
    bonus_basis: "forecast",
    bonus_withholding: "",
    income_complete: false,
  };
  if (typeof draft !== "object" || draft === null) return defaults;
  const saved = draft as Partial<OnboardingDraft>;
  const restored = {
    ...defaults,
    ...saved,
    facts: { ...defaults.facts, ...saved.facts },
    step: Math.min(7, Math.max(0, Number(saved.step) || 0)),
  };
  if (restored.step > 2) {
    try {
      normalizeAmount(restored.monthly_salary);
    } catch {
      restored.step = 2;
    }
  }
  return restored;
}

export default function Onboarding({
  year,
  draft,
  onComplete,
}: {
  year: number;
  draft: unknown;
  onComplete: () => Promise<void>;
}) {
  const [data, setData] = useState(() => initialDraft(draft));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) =>
    setData((current) => ({ ...current, [key]: value }));
  const fact = (key: keyof Facts, value: boolean | null) =>
    setData((current) => ({
      ...current,
      facts: { ...current.facts, [key]: value },
    }));
  const validate = () => {
    if (data.step === 2) {
      normalizeAmount(data.monthly_salary);
      if (!data.source_label.trim()) throw new Error("ระบุชื่อนายจ้าง");
      if (data.start_month > data.end_month)
        throw new Error("เดือนเริ่มต้องไม่อยู่หลังเดือนสุดท้าย");
    }
    if (data.step === 3) optionalAmount(data.monthly_withholding);
    if (data.step === 4) {
      optionalAmount(data.bonus);
      optionalAmount(data.bonus_withholding);
    }
    if (data.step === 5) {
      optionalAmount(data.monthly_sso);
      if (data.facts.social_security_confirmed && data.monthly_sso.trim() === "")
        throw new Error("ระบุประกันสังคมที่จ่าย หากไม่มีให้กรอก 0");
    }
  };
  const next = async (step: number) => {
    setError("");
    setBusy(true);
    try {
      if (step > data.step) validate();
      const nextData = { ...data, step };
      await command("save_onboarding_draft", { year, draft: nextData });
      setData(nextData);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setError("");
    setBusy(true);
    try {
      if (data.income_complete && data.bonus.trim() === "")
        throw new Error("ยืนยันรายได้ครบทั้งปีแล้ว กรุณากรอกโบนัสด้วย ถ้าไม่มีให้กรอก 0");
      if (data.facts.social_security_confirmed && data.monthly_sso.trim() === "")
        throw new Error("โปรดระบุยอดประกันสังคม หรือกรอก 0 หากไม่มี");
      await command("save_onboarding", {
        request: {
          year,
          facts: data.facts,
          source_label: data.source_label.trim(),
          monthly_salary: normalizeAmount(data.monthly_salary),
          start_month: data.start_month,
          end_month: data.end_month,
          actual_through: data.actual_through,
          monthly_withholding: optionalAmount(data.monthly_withholding),
          forecast_withholding: data.forecast_withholding,
          monthly_sso: optionalAmount(data.monthly_sso),
          bonus: optionalAmount(data.bonus),
          bonus_month: data.bonus_month,
          bonus_basis: data.bonus_basis,
          bonus_withholding: optionalAmount(data.bonus_withholding),
          income_complete: data.income_complete,
        },
      });
      await onComplete();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const outside = [
    data.facts.single,
    data.facts.under_65,
    data.facts.domestic_salary_only,
    data.facts.no_special_cases,
    data.facts.no_other_deductions,
  ].some((answer) => answer !== true);
  return (
    <div className="onboarding">
      <header className="onboarding-top">
        <Brand />
        <span className="year-tag">ปีภาษี {year + 543}</span>
        <PrivacyNote />
        <ThemeToggle />
      </header>
      <main className="onboarding-layout">
        <aside className="onboarding-aside">
          <h1>
            เรื่องภาษี
            <br />
            ค่อย ๆ เข้าใจ
            <br />
            <span>ไปด้วยกัน</span>
          </h1>
          <p>
            ไม่ต้องรู้ศัพท์ภาษี
            <br />
            แค่เริ่มจากเรื่องที่คุณรู้อยู่แล้ว
          </p>
          <ol>
            {labels.slice(1).map((label, i) => (
              <li
                key={label}
                className={data.step === i + 1 ? "current" : data.step > i + 1 ? "done" : ""}
              >
                <span>
                  {data.step > i + 1 ? <Check size={13} /> : String(i + 1).padStart(2, "0")}
                </span>
                {label}
              </li>
            ))}
          </ol>
          <MoneyArt className="aside-art" />
        </aside>
        <section className="onboarding-card" aria-label="เริ่มต้นใช้งาน">
          <div className="step-meta">
            <span>{data.step === 0 ? "ยินดีต้อนรับ" : `ขั้นที่ ${data.step} จาก 7`}</span>
            <span>{labels[data.step]}</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${(data.step / 7) * 100}%` }} />
          </div>
          {data.step === 0 && (
            <div className="welcome-step">
              <span className="welcome-symbol">
                <HeartHandshake size={44} strokeWidth={1.4} />
              </span>
              <span className="eyebrow">สวัสดี ยินดีที่ได้รู้จัก</span>
              <h2>
                เริ่มเรื่องภาษี
                <br />
                แบบสบายใจกัน
              </h2>
              <p>
                ตอบคำถามง่าย ๆ แล้วเราจะช่วยจัดภาพรวมภาษีให้คุณเห็นทีละขั้น ใช้เวลาเริ่มต้นประมาณ 5
                นาที
              </p>
              <div className="welcome-points">
                <span>
                  <Leaf size={18} /> ภาษาคน ไม่ใช่ภาษาบัญชี
                </span>
                <span>
                  <ShieldCheck size={18} /> ไม่ต้องสมัคร ข้อมูลอยู่ในเครื่อง
                </span>
                <span>
                  <Sparkles size={18} /> รู้ที่มาของทุกตัวเลข
                </span>
              </div>
              <Notice>
                รุ่นนี้ช่วยประมาณการเงินเดือนสำหรับผู้โสดอายุต่ำกว่า 65 ปี
                ยังไม่ส่งแบบภาษีหรือชำระภาษีแทนคุณ
              </Notice>
            </div>
          )}
          {data.step === 1 && (
            <>
              <h2>เริ่มจากรู้จักคุณนิดหนึ่ง</h2>
              <p className="lead">
                คำตอบช่วยให้เราใช้กฎที่เหมาะกับคุณ หากไม่แน่ใจ เลือกไว้ก่อนแล้วค่อยตรวจเพิ่มได้
              </p>
              <Answer
                label="คุณเป็นโสดตลอดปีภาษีนี้ใช่ไหม?"
                value={data.facts.single}
                onChange={(v) => fact("single", v)}
              />
              <Answer
                label="ปีนี้คุณอายุต่ำกว่า 65 ปีใช่ไหม?"
                value={data.facts.under_65}
                onChange={(v) => fact("under_65", v)}
              />
              <Answer
                label="มีเฉพาะเงินเดือนหรือโบนัสในประเทศไทยใช่ไหม?"
                hint="ถ้ามีงานรับจ้าง ค่าเช่า เงินปันผล หรือเงินได้ต่างประเทศ ให้เลือกไม่ใช่"
                value={data.facts.domestic_salary_only}
                onChange={(v) => fact("domestic_salary_only", v)}
              />
              <Answer
                label="ไม่มีสิทธิยกเว้นพิเศษหรือเงินก้อนออกจากงานใช่ไหม?"
                hint="รวมสิทธิ์คนพิการ หุ้น บ้านพัก หรือภาษีที่นายจ้างออกให้"
                value={data.facts.no_special_cases}
                onChange={(v) => fact("no_special_cases", v)}
              />
            </>
          )}
          {data.step === 2 && (
            <>
              <h2>
                เงินเดือนก่อนหัก
                <br />
                เดือนละเท่าไร?
              </h2>
              <p className="lead">
                ใช้ยอดก่อนหักภาษีและประกันสังคม ซึ่งอาจมากกว่ายอดที่เข้าบัญชีของคุณ
              </p>
              <Field
                label="ชื่อนายจ้าง"
                value={data.source_label}
                maxLength={100}
                onChange={(e) => update("source_label", e.target.value)}
                placeholder="เช่น งานประจำของฉัน"
              />
              <Field
                label="เงินเดือนต่อเดือน (บาท)"
                inputMode="decimal"
                value={data.monthly_salary}
                onChange={(e) => update("monthly_salary", e.target.value)}
                placeholder="เช่น 30,000"
              />
              <div className="form-grid">
                <MonthSelect
                  label="เริ่มรับเงินเดือน"
                  value={data.start_month}
                  onChange={(v) => update("start_month", v)}
                />
                <MonthSelect
                  label="ถึงเดือน"
                  value={data.end_month}
                  onChange={(v) => update("end_month", v)}
                />
              </div>
              <Notice>
                มีหลายนายจ้างหรือเงินเดือนไม่เท่ากัน? เริ่มจากแห่งแรก
                แล้วเพิ่มหรือปรับรายเดือนได้ในหน้า “รายได้” ก่อนยืนยันว่าครบทั้งปี
              </Notice>
            </>
          )}
          {data.step === 3 && (
            <>
              <h2>
                แยกยอดที่รู้จริง
                <br />
                กับยอดที่คาดไว้
              </h2>
              <p className="lead">
                ยืนยันเฉพาะเดือนที่คุณตรวจแล้ว เดือนที่เหลือจะมีป้าย “คาดการณ์” เสมอ
              </p>
              <MonthSelect
                label="ตรวจยอดจริงแล้วถึงเดือน"
                value={data.actual_through}
                allowNone
                onChange={(v) => update("actual_through", v)}
              />
              <Field
                label="ภาษีที่หักไว้ต่อเดือน (บาท)"
                hint="เว้นว่างหากยังไม่ทราบ กรอก 0 เฉพาะเมื่อยืนยันว่าไม่มี"
                inputMode="decimal"
                value={data.monthly_withholding}
                onChange={(e) => update("monthly_withholding", e.target.value)}
                placeholder="ยังไม่ทราบ"
              />
              <Checkbox
                checked={data.forecast_withholding}
                onChange={(v) => update("forecast_withholding", v)}
              >
                ใช้ยอดหักนี้เป็นการคาดการณ์เดือนที่เหลือด้วย
              </Checkbox>
              <Notice>
                ถ้าภาษีที่หักแต่ละเดือนไม่เท่ากัน ให้แก้รายการภายหลังตามสลิปหรือหนังสือรับรอง 50 ทวิ
              </Notice>
            </>
          )}
          {data.step === 4 && (
            <>
              <h2>มีโบนัสในปีนี้ไหม?</h2>
              <p className="lead">
                ใช้เดือนที่รับเงินหรือคาดว่าจะรับเงินจริง โบนัสยังไม่ทราบจำนวนให้เว้นว่าง
                หากไม่มีให้กรอก 0
              </p>
              <Field
                label="โบนัส (บาท)"
                inputMode="decimal"
                value={data.bonus}
                onChange={(e) => update("bonus", e.target.value)}
                placeholder="0 หากไม่มี หรือเว้นไว้หากยังไม่ทราบ"
              />
              <div className="form-grid">
                <MonthSelect
                  label="เดือนที่รับโบนัส"
                  value={data.bonus_month}
                  onChange={(v) => update("bonus_month", v)}
                />
                <label className="field">
                  <span>สถานะโบนัส</span>
                  <select
                    value={data.bonus_basis}
                    onChange={(e) => update("bonus_basis", e.target.value as "actual" | "forecast")}
                  >
                    <option value="forecast">คาดว่าจะรับ</option>
                    <option value="actual">รับแล้วจริง</option>
                  </select>
                </label>
              </div>
              <Field
                label="ภาษีที่หักจากโบนัส (บาท)"
                inputMode="decimal"
                value={data.bonus_withholding}
                onChange={(e) => update("bonus_withholding", e.target.value)}
                hint="เว้นว่างหากยังไม่ทราบ"
              />
              <Notice>
                เงินชดเชยหรือเงินก้อนจากการออกจากงานมีเงื่อนไขเฉพาะ ไม่ควรใส่เป็นโบนัสทั่วไป
              </Notice>
            </>
          )}
          {data.step === 5 && (
            <>
              <h2>
                ประกันสังคม
                <br />
                ที่คุณจ่ายไป
              </h2>
              <p className="lead">
                ใช้เงินสมทบฝ่ายลูกจ้าง ม.33 ของคุณตามที่จ่ายจริง ไม่ใช่ส่วนที่นายจ้างสมทบ
              </p>
              <Field
                label="ประกันสังคมต่อเดือน (บาท)"
                inputMode="decimal"
                value={data.monthly_sso}
                onChange={(e) => update("monthly_sso", e.target.value)}
                hint="เว้นว่างหากไม่ทราบ · ถ้าไม่จ่าย กรอก 0 ระบบไม่เติมเพดานให้อัตโนมัติ"
              />
              <Checkbox
                checked={data.facts.social_security_confirmed}
                onChange={(v) => fact("social_security_confirmed", v)}
              >
                ตรวจแล้วว่าเป็นยอดที่เข้าเงื่อนไข รวมกรณีลดอัตรา ส่งเกิน และได้รับเงินคืน
              </Checkbox>
              <Notice>
                ระบบจะใช้จำนวนนี้ตั้งต้นรายเดือนตามช่วงงานและสถานะยอดจริง/คาดการณ์
                คุณแก้แต่ละเดือนได้ภายหลัง
              </Notice>
            </>
          )}
          {data.step === 6 && (
            <>
              <h2>
                มีสิทธิ์อื่น
                <br />
                ที่ควรตรวจเพิ่มไหม?
              </h2>
              <p className="lead">
                รุ่นนี้รวมสิทธิ์ส่วนตัวและประกันสังคม ส่วนรายการด้านล่างยังไม่รวมในผลคำนวณ
              </p>
              <div className="deduction-chips">
                {[
                  "ประกันชีวิต / สุขภาพ",
                  "บุตร / บิดามารดา",
                  "กองทุน / เงินออม",
                  "ดอกเบี้ยบ้าน",
                  "เงินบริจาค",
                ].map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <Answer
                label="คุณยืนยันว่าไม่มีสิทธิ์ลดหย่อนอื่นนอกเหนือจากส่วนตัวและประกันสังคมใช่ไหม?"
                value={data.facts.no_other_deductions}
                onChange={(v) => fact("no_other_deductions", v)}
              />
              <Notice>
                หากมีหรือไม่แน่ใจ ยังดูภาพจากข้อมูลพื้นฐานได้
                แต่เราจะไม่สรุปยอดชำระหรือคืนจนกว่าขอบเขตสิทธิ์จะครบ
              </Notice>
            </>
          )}
          {data.step === 7 && (
            <>
              <span className="review-icon">
                <Check size={27} />
              </span>
              <h2>
                ตรวจอีกนิด
                <br />
                แล้วดูภาพรวมกัน
              </h2>
              <div className="review-list">
                <div>
                  <span>ปีภาษี</span>
                  <strong>{year + 543}</strong>
                </div>
                <div>
                  <span>นายจ้าง</span>
                  <strong>{data.source_label}</strong>
                </div>
                <div>
                  <span>เงินเดือนต่อเดือน</span>
                  <MoneyValue value={normalizeAmount(data.monthly_salary)} />
                </div>
                <div>
                  <span>ช่วงรับเงินเดือน</span>
                  <strong>
                    {months[data.start_month - 1]} – {months[data.end_month - 1]}
                  </strong>
                </div>
                <div>
                  <span>ยืนยันยอดจริงถึง</span>
                  <strong>
                    {data.actual_through ? months[data.actual_through - 1] : "ยังไม่ยืนยัน"}
                  </strong>
                </div>
                <div>
                  <span>ภาษีหักต่อเดือน</span>
                  <strong>
                    {data.monthly_withholding ? `${data.monthly_withholding} บาท` : "ยังไม่ทราบ"}
                  </strong>
                </div>
              </div>
              {outside && (
                <Notice tone="warning">
                  บางคำตอบอยู่นอกขอบเขตที่รองรับ ผลที่ได้จะเป็นภาพเฉพาะข้อมูลพื้นฐาน
                  และยังไม่สรุปยอดชำระหรือคืน
                </Notice>
              )}
              <Checkbox
                checked={data.income_complete}
                onChange={(v) => update("income_complete", v)}
              >
                ฉันบันทึกหรือประมาณรายได้ทั้งปีครบทุกนายจ้างแล้ว รวมโบนัสและเดือนที่ไม่มีรายได้
              </Checkbox>
              <p className="fine-print">
                หากยังมีนายจ้างหรือรายการอื่นให้เพิ่ม อย่าเพิ่งเลือกช่องนี้
                แก้ข้อมูลและยืนยันภายหลังได้
              </p>
              <Notice>
                ทุกผลเป็นประมาณการ ยังต้องตรวจวิธีปัดเศษและข้อมูลกับกรมสรรพากรก่อนนำไปยื่นแบบ
              </Notice>
            </>
          )}
          {error && <ErrorNotice message={error} />}
          <footer className="wizard-actions">
            {data.step > 0 ? (
              <Button variant="ghost" disabled={busy} onClick={() => void next(data.step - 1)}>
                <ArrowLeft size={16} /> ย้อนกลับ
              </Button>
            ) : (
              <PrivacyNote />
            )}
            {data.step === 7 ? (
              <Button disabled={busy} onClick={() => void finish()}>
                {busy ? "กำลังบันทึก…" : "ดูภาพรวมภาษีของฉัน"}
                <ArrowRight size={17} />
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void next(data.step + 1)}>
                {data.step === 0 ? "เริ่มเรื่องภาษีของฉัน" : busy ? "กำลังบันทึก…" : "ถัดไป"}
                <ArrowRight size={17} />
              </Button>
            )}
          </footer>
        </section>
      </main>
      <footer className="onboarding-footer">
        Taxly ไม่ยื่นแบบหรือชำระภาษีแทนคุณ · ไม่มีการส่งข้อมูลการเงินออกจากเครื่อง
      </footer>
    </div>
  );
}
