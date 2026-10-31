import {
  ArrowDownLeft,
  BookOpen,
  ChartColumn,
  ListChecks,
  Receipt,
  Wallet,
  Calculator,
  ChevronRight,
  FileCheck2,
  Info,
  Leaf,
  Plus,
  Sparkles,
} from "lucide-react";
import type { Calculation, Workspace } from "./types";
import { Button, MoneyValue, Notice, TextLink } from "./components";
import { EmptyArt, MoneyArt } from "./Art";
import { incomeKindLabel } from "./Income";
import { formatMoney, proportion, shortMonths } from "./money";

export default function Dashboard({
  data,
  workspace,
  onNavigate,
  onAdd,
  onSave,
  saving,
}: {
  data: Calculation;
  workspace: Workspace;
  onNavigate: (view: "income" | "deductions" | "explanation" | "history") => void;
  onAdd: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const restricted = data.scope_issues.length > 0;
  const partialIncome = !workspace.profile?.income_complete;
  const share = proportion(data.actual_income, data.gross_income);
  const actualCount = workspace.income.filter((item) => item.basis === "actual").length;
  const forecastCount = workspace.income.filter((item) => item.basis === "forecast").length;
  const tasks = [
    !workspace.profile?.income_complete && {
      label: "ตรวจว่ารายได้ทั้งปีครบแล้ว",
      description: "รวมทุกนายจ้าง โบนัส และเดือนที่ไม่มีรายได้",
      view: "income" as const,
    },
    data.unknown_withholding_count > 0 && {
      label: `เติมภาษีหัก ณ ที่จ่าย ${data.unknown_withholding_count} รายการ`,
      description: "ตรวจได้จากสลิปหรือหนังสือรับรอง 50 ทวิ",
      view: "income" as const,
    },
    !workspace.profile?.facts.social_security_confirmed && {
      label: "ตรวจยอดประกันสังคมที่ใช้สิทธิ์ได้",
      description: "ยอดจ่ายจริงอาจต่างจากเพดานของปี",
      view: "deductions" as const,
    },
    data.scope_issues.length > 0 && {
      label: "ทบทวนขอบเขตและสิทธิ์ของคุณ",
      description: "บางเงื่อนไขยังไม่รวมในผลประมาณการนี้",
      view: "deductions" as const,
    },
  ].filter(Boolean) as {
    label: string;
    description: string;
    view: "income" | "deductions";
  }[];
  if (workspace.income.length === 0 && partialIncome) {
    return (
      <section className="card empty-state">
        <EmptyArt className="empty-art" />
        <h1 tabIndex={-1}>เริ่มจากรายได้รายการแรก</h1>
        <p>ยังมีข้อมูลไม่เพียงพอสำหรับประมาณการภาษี การไม่มีรายการไม่ได้หมายความว่าภาษีเป็นศูนย์</p>
        <Button onClick={onAdd}>
          <Plus size={17} /> เพิ่มรายได้
        </Button>
      </section>
    );
  }
  const actions = [
    { label: "เพิ่มรายได้", icon: Plus, onClick: onAdd },
    { label: "สิทธิ์ลดหย่อน", icon: Leaf, onClick: () => onNavigate("deductions") },
    { label: "วิธีคำนวณ", icon: Calculator, onClick: () => onNavigate("explanation") },
    {
      label: saving ? "กำลังบันทึก…" : "บันทึกผลสรุป",
      icon: Sparkles,
      onClick: onSave,
      disabled: saving,
    },
  ];
  const filingTitle =
    data.filing === "required"
      ? "ปีนี้คุณมีหน้าที่ยื่นแบบ"
      : data.filing === "not_required"
        ? "ยังไม่เกินเกณฑ์บังคับยื่น"
        : "ยังต้องตรวจหน้าที่ยื่นแบบ";
  const filingNote =
    data.filing === "required"
      ? "รายได้เงินเดือนจริงเกินเกณฑ์ 120,000 บาทแล้ว"
      : data.filing === "not_required"
        ? "ถ้าถูกหักภาษีไว้ ณ ที่จ่าย อาจยื่นขอคืนได้"
        : "รอข้อมูลจริงครบปี และตรวจกรณีที่ยังไม่รองรับ";
  return (
    <>
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>
            เห็นภาพภาษี <span>สบายใจขึ้นอีกนิด</span>
          </h1>
          <p>มาดูว่าปีนี้คุณมาไกลแค่ไหน และมีอะไรให้ค่อย ๆ ตรวจเพิ่ม</p>
        </div>
      </div>
      <section className="tax-hero">
        <div className="hero-body">
          <div className="hero-top">
            <span>
              <span className="status-dot" />{" "}
              {restricted || partialIncome ? "ภาษีจากข้อมูลพื้นฐานที่มี" : "ภาษีทั้งปีโดยประมาณ"}
            </span>
            <span className="hero-year">ปีภาษี {data.year + 543}</span>
          </div>
          <MoneyValue value={data.annual_tax} large />
          <p>
            {restricted || partialIncome
              ? "ยังไม่ครอบคลุมข้อมูลหรือสิทธิ์ที่ขาดอยู่"
              : "จากรายได้ที่บันทึกและคาดการณ์ไว้ทั้งปี"}
          </p>
          <div className="hero-comparison">
            <span className="hero-icon">
              <ArrowDownLeft size={18} />
            </span>
            <span>ภาษีที่ถูกหักแล้วจริง</span>
            <strong>
              {formatMoney(data.actual_withholding)} <small>บาท</small>
            </strong>
          </div>
          <div className="hero-note">
            <Info size={14} />
            <span>
              {data.unknown_withholding_count
                ? "ยังมีภาษีหัก ณ ที่จ่ายที่ไม่ทราบ จึงยังสรุปส่วนต่างไม่ได้"
                : "ตัวเลขนี้เป็นประมาณการ ยังไม่ใช่ยอดสำหรับชำระหรือขอคืน"}
            </span>
          </div>
          <button className="hero-link" onClick={() => onNavigate("explanation")}>
            ตัวเลขนี้มาจากไหน <ChevronRight size={15} />
          </button>
        </div>
        <MoneyArt className="hero-art" />
        <div className="quick-actions">
          {actions.map((action) => (
            <button key={action.label} onClick={action.onClick} disabled={action.disabled}>
              <span className="quick-icon">
                <action.icon size={22} aria-hidden="true" />
              </span>
              {action.label}
            </button>
          ))}
        </div>
      </section>
      {(restricted || partialIncome) && (
        <Notice tone="warning">
          <strong>ภาพจากข้อมูลพื้นฐานที่มีอยู่ ยังไม่ครบทั้งปี</strong>
          <p>
            {partialIncome
              ? "ยังไม่ได้ยืนยันรายได้ทุกนายจ้างและโบนัส ตัวเลขอาจเปลี่ยนเมื่อเติมข้อมูล"
              : "มีกรณีหรือสิทธิ์ที่ยังไม่รองรับ จึงยังสรุปยอดชำระหรือคืนไม่ได้"}
          </p>
          {restricted && (
            <ul>
              {data.scope_issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      <h2 className="section-title">กระเป๋าภาษีของคุณ</h2>
      <div className="pockets">
        <section className="pocket tone-mint income-summary">
          <span className="pocket-icon">
            <Wallet size={20} aria-hidden="true" />
          </span>
          <span className="pocket-label">
            {restricted || partialIncome ? "รายได้ที่บันทึกและคาดไว้" : "รายได้ทั้งปีที่คาดไว้"}
          </span>
          <MoneyValue value={data.gross_income} />
          <div
            className="income-split"
            role="img"
            aria-label={`ยอดจริง ${formatMoney(data.actual_income)} บาท คาดการณ์ ${formatMoney(data.forecast_income)} บาท`}
          >
            <span className="actual-segment" style={{ width: `${share}%` }} />
            <span className="forecast-segment" style={{ width: `${100 - share}%` }} />
          </div>
          <small>
            ยอดจริง {actualCount} รายการ · คาดการณ์ {forecastCount} รายการ
          </small>
          <TextLink onClick={() => onNavigate("income")}>ดูรายได้รายเดือน</TextLink>
        </section>
        <section className="pocket tone-lilac taxable-summary">
          <span className="pocket-icon">
            <Receipt size={20} aria-hidden="true" />
          </span>
          <span className="pocket-label">เงินได้สุทธิที่ใช้คำนวณ</span>
          <MoneyValue value={data.taxable_income} />
          <small>
            หักค่าใช้จ่าย {formatMoney(data.expenses)} · ส่วนตัว{" "}
            {formatMoney(data.personal_allowance)} · ประกันสังคม {formatMoney(data.social_security)}
          </small>
          <TextLink onClick={() => onNavigate("explanation")}>ดูวิธีคิดทีละขั้น</TextLink>
        </section>
        <section className="pocket tone-peach">
          <span className="pocket-icon">
            <Leaf size={20} aria-hidden="true" />
          </span>
          <span className="pocket-label">ประกันสังคมช่วยลดภาษี</span>
          <MoneyValue value={data.social_security_savings} />
          <small>เงินสมทบที่คุณจ่ายไปแล้ว ช่วยลดภาษีเชิงคำนวณในประมาณการนี้</small>
          <TextLink onClick={() => onNavigate("deductions")}>ตรวจสิทธิ์ของฉัน</TextLink>
        </section>
        <section className="pocket tone-sky">
          <span className="pocket-icon">
            <FileCheck2 size={20} aria-hidden="true" />
          </span>
          <span className="pocket-label">หน้าที่ยื่นแบบ</span>
          <strong className="pocket-status">{filingTitle}</strong>
          <small>{filingNote}</small>
          <TextLink onClick={() => onNavigate("explanation")}>เข้าใจเรื่องการยื่นแบบ</TextLink>
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="card monthly-card">
          <div className="section-heading">
            <h2>
              <span className="card-icon">
                <ChartColumn size={18} aria-hidden="true" />
              </span>
              รายได้แต่ละเดือน
            </h2>
            <div className="chart-legend">
              <span>
                <i className="legend-dot actual" /> ยอดจริง
              </span>
              <span>
                <i className="legend-dot forecast" /> คาดการณ์
              </span>
              <span>
                <i className="legend-dot bonus" /> โบนัส
              </span>
              <span>
                <i className="legend-dot other" /> รายได้อื่น
              </span>
            </div>
          </div>
          <div className="monthly-chart" role="group" aria-label="รายการรายได้แยกตามเดือน">
            {shortMonths.map((month, index) => {
              const rows = workspace.income.filter((item) => item.month === index + 1);
              const actual = rows.filter((item) => item.basis === "actual");
              const forecast = rows.filter((item) => item.basis === "forecast");
              const display = rows
                .map(
                  (item) =>
                    `${incomeKindLabel(item.kind)} ${formatMoney(item.gross)} บาท (${item.basis === "actual" ? "ยอดจริง" : "คาดการณ์"})`,
                )
                .join(", ");
              // Each entry is a segment scaled against annual gross. No tax or monetary totals are calculated here.
              return (
                <button
                  key={month}
                  className="chart-column"
                  title={`${month}: ${display || "ยังไม่มีรายการ"}`}
                  onClick={() => onNavigate("income")}
                  aria-label={`${month}: ${display || "ยังไม่มีรายการ"}`}
                >
                  <div className="chart-bar-space">
                    <div className="chart-bar">
                      {forecast.map((item) => (
                        <span
                          key={item.id}
                          className={`forecast ${item.kind === "salary" ? "" : item.kind}`}
                          style={{
                            height: `${Math.max(3, Math.min(125, proportion(item.gross, data.gross_income) * 9))}px`,
                          }}
                        />
                      ))}
                      {actual.map((item) => (
                        <span
                          key={item.id}
                          className={`actual ${item.kind === "salary" ? "" : item.kind}`}
                          style={{
                            height: `${Math.max(3, Math.min(125, proportion(item.gross, data.gross_income) * 9))}px`,
                          }}
                        />
                      ))}
                      {rows.length === 0 && <span className="empty-bar" />}
                    </div>
                  </div>
                  <small>{month}</small>
                </button>
              );
            })}
          </div>
          <div className="chart-footer">
            <span>กดที่เดือนเพื่อดูและแก้ไขรายการ</span>
            <span>ยอดที่ยังไม่ยืนยันจะเป็นคาดการณ์เสมอ</span>
          </div>
        </section>
        <section className="card next-steps">
          <div className="section-heading">
            <h2>
              <span className="card-icon">
                <ListChecks size={18} aria-hidden="true" />
              </span>
              สิ่งที่ต้องทำ
            </h2>
            <span className="count-badge">{tasks.length}</span>
          </div>
          {tasks.length ? (
            tasks.slice(0, 3).map((task) => (
              <button className="task-row" key={task.label} onClick={() => onNavigate(task.view)}>
                <span className="task-circle" />
                <span>
                  <strong>{task.label}</strong>
                  <small>{task.description}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))
          ) : (
            <div className="all-complete">
              <EmptyArt className="empty-art" />
              <strong>ข้อมูลพื้นฐานครบแล้ว</strong>
              <p>ยังต้องตรวจชุดกฎและวิธีปัดเศษก่อนนำผลไปใช้ยื่นแบบ</p>
            </div>
          )}
          <TextLink onClick={() => onNavigate("deductions")}>สำรวจสิทธิ์ที่คุณมีอยู่แล้ว</TextLink>
        </section>
      </div>
      {data.unknown_withholding_count > 0 && (
        <Notice>
          <strong>ภาษีที่ยังเหลือก่อนรวมภาษีหักที่ยังไม่ทราบ:</strong>{" "}
          {formatMoney(data.remaining_after_actual_withholding)} บาท —
          ใช้เครดิตที่บันทึกจริงแล้วเท่านั้น ยังไม่ใช่ยอดชำระปลายปี
        </Notice>
      )}
      {data.difference_preview && (
        <Notice>
          <strong>ส่วนต่างเชิงคำนวณเท่านั้น:</strong>{" "}
          {data.difference_preview.kind === "balanced"
            ? "ภาษีและเครดิตเท่ากัน"
            : `${data.difference_preview.kind === "payable" ? "ภาษีมากกว่าเครดิต" : "เครดิตมากกว่าภาษี"} ${formatMoney(data.difference_preview.amount)} บาท`}{" "}
          — ยังไม่ใช่ยอดชำระหรือคืน ต้องยืนยันวิธีปัดเศษและตรวจข้อมูลก่อน
        </Notice>
      )}
      <footer className="dashboard-footer">
        <span>
          <BookOpen size={14} /> กฎ {data.rule_set_id} · ตรวจ 15 ต.ค. 2569 ·{" "}
          {data.rules_status === "provisional" ? "กฎสำหรับประมาณการ" : "ทบทวนกฎพื้นฐานแล้ว"} ·
          ยังตรวจวิธีปัดเศษ
        </span>
      </footer>
    </>
  );
}
