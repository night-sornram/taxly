import { useId, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  ChevronRight,
  Plus,
  Wallet,
} from "lucide-react";
import { Button } from "../components";
import { compareValues, dateLabel, decimal, percentage, signedClass } from "./format";
import { PageTitle, Table, Value } from "./ui";
import type { Portfolio, WealthWorkspace } from "./types";
export default function Overview({
  workspace,
  onAccount,
  onActivity,
  onOpening,
  onImport,
  onHoldings,
}: {
  workspace: WealthWorkspace;
  onAccount: () => void;
  onActivity: () => void;
  onOpening: () => void;
  onImport: () => void;
  onHoldings: () => void;
}) {
  const { data, portfolio: p } = workspace;
  return (
    <>
      <PageTitle
        title="ภาพรวมการลงทุน"
        actions={
          <>
            <Button variant="secondary" onClick={onImport}>
              นำเข้า CSV
            </Button>
            <Button onClick={data.accounts.length ? onActivity : onAccount}>
              <Plus size={16} />
              {data.accounts.length ? "เพิ่มรายการ" : "เพิ่มบัญชี"}
            </Button>
          </>
        }
      >
        สรุปมูลค่า กำไรขาดทุน และผลตอบแทนของพอร์ตในช่วงที่เลือก
      </PageTitle>
      {!data.accounts.length ? (
        <div className="wealth-welcome">
          <div>
            <span className="wealth-eyebrow">เริ่มต้นใช้งาน</span>
            <h2>
              รวมหุ้น ETF และเงินสด
              <br />
              <em>ไว้ในที่เดียว</em>
            </h2>
            <p>เริ่มจากสร้างบัญชีแรก แล้วบันทึกรายการย้อนหลัง หรือใส่ยอดที่คุณมีอยู่ในวันนี้</p>
            <Button onClick={onAccount}>
              <Plus size={17} />
              สร้างบัญชีลงทุนแรก
            </Button>
          </div>
          <div className="wealth-welcome-art" aria-hidden="true">
            <span />
            <span />
            <span />
            <ChartNoAxesCombined size={76} strokeWidth={1} />
          </div>
        </div>
      ) : (
        <>
          <div className="wealth-metrics">
            <section className="wealth-metric wealth-metric-main">
              <span>มูลค่าพอร์ตทั้งหมด</span>
              <h2>
                <Value value={p.total_value} currency={p.reporting_currency} />
              </h2>
              <small>
                {p.total_value === null
                  ? `มูลค่าที่ทราบ ${decimal(p.known_value)} ${p.reporting_currency} · บางรายการยังไม่มีราคา`
                  : `ณ ${dateLabel(p.as_of)}`}
              </small>
              <span className="wealth-metric-spark" aria-hidden="true">
                ↗
              </span>
            </section>
            <section className="wealth-metric">
              <span>กำไร / ขาดทุนในช่วง</span>
              <h2 className={signedClass(p.period_gain)}>
                <Value value={p.period_gain} currency={p.reporting_currency} />
              </h2>
              <small>ไม่รวมเงินฝากและเงินถอนระหว่างช่วง</small>
            </section>
            <section className="wealth-metric">
              <span>ผลตอบแทนตามช่วงเวลา</span>
              <h2 className={signedClass(p.twr)}>{percentage(p.twr)}</h2>
              <small>Time-weighted return (TWR)</small>
            </section>
            <section className="wealth-metric">
              <span>เงินสดในบัญชี</span>
              <h2>
                <Value value={p.cash_value} currency={p.reporting_currency} />
              </h2>
              <small>
                {p.cash.length} รายการเงินสด · {data.accounts.length} บัญชี
              </small>
            </section>
          </div>
          {!data.activities.length && !data.opening_positions.length && (
            <div className="wealth-start-options">
              <div>
                <span className="wealth-eyebrow">เลือกวิธีเริ่มต้น</span>
                <h2>เพิ่มข้อมูลแรกเข้าพอร์ต</h2>
              </div>
              <button onClick={onActivity}>
                <ArrowUpRight size={20} />
                <strong>เริ่มจากรายการแรก</strong>
                <span>บันทึกเงินฝากและการซื้อขาย</span>
              </button>
              <button onClick={onOpening}>
                <Wallet size={20} />
                <strong>เริ่มจากยอดปัจจุบัน</strong>
                <span>ใส่หุ้นและเงินสด ณ วันตั้งต้น</span>
              </button>
            </div>
          )}
          <div className="wealth-overview-grid">
            <PerformanceChart portfolio={p} />
            <section className="card wealth-allocation">
              <div className="wealth-section-heading">
                <div>
                  <h2>สัดส่วนสินทรัพย์</h2>
                </div>
                <span className="wealth-tag">{p.reporting_currency}</span>
              </div>
              {p.holdings.length ? (
                <>
                  <div
                    className="wealth-allocation-bar"
                    aria-label="แถบแสดงสัดส่วนหลักทรัพย์เทียบมูลค่าพอร์ต"
                  >
                    {p.holdings.map(
                      (h, i) =>
                        h.allocation !== null && (
                          <span
                            key={`${h.account_id}-${h.instrument_id}`}
                            style={{
                              width: `${Math.max(0, Number(h.allocation)) * 100}%`,
                              background: `var(--wealth-chart-${i % 5})`,
                            }}
                            title={`${data.instruments.find((a) => a.id === h.instrument_id)?.symbol}: ${percentage(h.allocation)}`}
                          />
                        ),
                    )}
                  </div>
                  <div className="wealth-allocation-list">
                    {p.holdings.slice(0, 7).map((h, i) => (
                      <div key={`${h.account_id}-${h.instrument_id}`}>
                        <span
                          className="wealth-color-dot"
                          style={{ background: `var(--wealth-chart-${i % 5})` }}
                        />
                        <div>
                          <strong>
                            {data.instruments.find((a) => a.id === h.instrument_id)?.symbol}
                          </strong>
                          <small>{data.accounts.find((a) => a.id === h.account_id)?.name}</small>
                        </div>
                        <span>{percentage(h.allocation)}</span>
                      </div>
                    ))}
                  </div>
                  <small className="wealth-help">
                    คิดเป็นสัดส่วนของมูลค่าพอร์ตทั้งหมด (รวมเงินสด) รายการที่ยังไม่มีราคาแสดงเป็น —
                  </small>
                </>
              ) : (
                <div className="wealth-chart-empty">
                  <ChartNoAxesCombined size={29} />
                  <p>สัดส่วนจะปรากฏเมื่อมีหลักทรัพย์ในพอร์ต</p>
                </div>
              )}
            </section>
          </div>
          <div className="wealth-overview-grid">
            <section className="card wealth-card-flush">
              <div className="wealth-section-heading">
                <div>
                  <h2>หลักทรัพย์ในพอร์ต</h2>
                </div>
                <button className="wealth-inline-link" onClick={onHoldings}>
                  ดูทั้งหมด <ChevronRight size={15} />
                </button>
              </div>
              {p.holdings.length ? (
                <Table caption="หลักทรัพย์และมูลค่าในสกุลรายงาน">
                  <thead>
                    <tr>
                      <th>หลักทรัพย์</th>
                      <th className="numeric">มูลค่า ({p.reporting_currency})</th>
                      <th className="numeric">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...p.holdings]
                      .sort((a, b) => compareValues(b.market_value_base, a.market_value_base))
                      .slice(0, 6)
                      .map((h) => (
                        <tr key={`${h.account_id}-${h.instrument_id}`}>
                          <td>
                            <strong>
                              {data.instruments.find((i) => i.id === h.instrument_id)?.symbol}
                            </strong>
                            <small>{data.accounts.find((a) => a.id === h.account_id)?.name}</small>
                          </td>
                          <td className="numeric">
                            <Value value={h.market_value_base} />
                          </td>
                          <td className="numeric">
                            <Value value={h.quantity} digits={0} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              ) : (
                <p className="wealth-inline-empty">
                  ยังไม่มีหลักทรัพย์ เพิ่มรายการซื้อหรือยอดตั้งต้นเพื่อเริ่มติดตาม
                </p>
              )}
            </section>
            <section className="card">
              <div className="wealth-section-heading">
                <div>
                  <h2>บัญชีของคุณ</h2>
                </div>
              </div>
              <div className="wealth-account-summary">
                {data.accounts
                  .filter((a) => p.accounts.some((v) => v.id === a.id))
                  .map((a, index) => (
                    <div key={a.id}>
                      <span className="wealth-account-icon">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong>{a.name}</strong>
                      <Value
                        value={p.accounts.find((v) => v.id === a.id)?.value}
                        currency={p.reporting_currency}
                      />
                    </div>
                  ))}
              </div>
            </section>
          </div>
          <details className="wealth-method">
            <summary>อ่านวิธีคำนวณและขอบเขตข้อมูล</summary>
            <p>
              คำนวณกำไรจากต้นทุนแบบ FIFO ผลตอบแทนแบบ TWR ซึ่งตัดผลของการฝากต้นวันและถอนสิ้นวันออก
              การโอนระหว่างบัญชีที่เลือกอยู่นับเป็นรายการภายใน
            </p>
            <p>
              รายการแรกสุด: {dateLabel(p.earliest_date)} · เริ่มคำนวณผลตอบแทนจาก:{" "}
              {dateLabel(p.start_date)} ยอดตั้งต้นไม่สร้างผลตอบแทนย้อนหลัง
              และต้นทุนที่ไม่ทราบจะไม่ถูกนับเป็นศูนย์
            </p>
            <p>
              มูลค่าแต่ละวันใช้ราคาและอัตราแลกเปลี่ยน ณ หรือก่อนวันนั้น
              รายการที่ไม่มีราคาจะมีข้อความแจ้งเตือน ผลการลงทุนยังไม่นำไปรวมในประมาณการภาษี
            </p>
          </details>
        </>
      )}
    </>
  );
}
function PerformanceChart({ portfolio }: { portfolio: Portfolio }) {
  const id = useId();
  const [mode, setMode] = useState<"value" | "twr">("value");
  const series = portfolio.series;
  // Floating point is used only to project backend-calculated decimals onto SVG coordinates.
  const values = series.map((s) => (s[mode] === null ? null : Number(s[mode])));
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const minimum = known.length ? Math.min(...known) : 0;
  const maximum = known.length ? Math.max(...known) : 0;
  const spread = maximum - minimum || Math.abs(maximum) * 0.1 || 1;
  const paths: string[] = [];
  let segment = "";
  values.forEach((v, index) => {
    if (v === null) {
      if (segment) paths.push(segment);
      segment = "";
      return;
    }
    const x = 14 + (index / Math.max(1, values.length - 1)) * 672;
    const y = 192 - ((v - minimum) / spread) * 154;
    segment += `${segment ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  if (segment) paths.push(segment);
  return (
    <section className="card wealth-performance">
      <div className="wealth-section-heading">
        <div>
          <h2>{mode === "value" ? "มูลค่าพอร์ตตามเวลา" : "ผลตอบแทนของพอร์ต"}</h2>
        </div>
        <div className="wealth-segment" aria-label="ข้อมูลบนกราฟ">
          <button onClick={() => setMode("value")} aria-pressed={mode === "value"}>
            มูลค่า
          </button>
          <button onClick={() => setMode("twr")} aria-pressed={mode === "twr"}>
            ผลตอบแทน
          </button>
        </div>
      </div>
      {known.length ? (
        <figure className="wealth-chart">
          <div className="wealth-chart-range">
            <span>
              {mode === "value"
                ? `${decimal(series[values.indexOf(maximum)]?.[mode])} ${portfolio.reporting_currency}`
                : percentage(series[values.indexOf(maximum)]?.[mode])}
            </span>
            <span>
              {mode === "value"
                ? `${decimal(series[values.indexOf(minimum)]?.[mode])} ${portfolio.reporting_currency}`
                : percentage(series[values.indexOf(minimum)]?.[mode])}
            </span>
          </div>
          <svg viewBox="0 0 700 220" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
            <title id={`${id}-title`}>
              {mode === "value" ? "กราฟมูลค่าพอร์ต" : "กราฟผลตอบแทน"}
            </title>
            <desc id={`${id}-desc`}>
              ตั้งแต่ {dateLabel(series[0]?.date ?? null)} ถึง{" "}
              {dateLabel(series.at(-1)?.date ?? null)} ช่องว่างหมายถึงข้อมูลไม่ครบ
              มีข้อมูลแบบตารางด้านล่าง
            </desc>
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--wealth-chart-0)" stopOpacity=".18" />
                <stop offset="100%" stopColor="var(--wealth-chart-0)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[38, 89, 140, 192].map((y) => (
              <line
                x1="14"
                x2="686"
                y1={y}
                y2={y}
                key={y}
                stroke="var(--line)"
                strokeDasharray="3 5"
              />
            ))}
            {paths.map((path, index) => (
              <path
                key={index}
                d={path}
                fill="none"
                stroke="var(--wealth-chart-0)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {known.length === 1 && <circle cx="14" cy="192" r="4" fill="var(--wealth-chart-0)" />}
          </svg>
          <figcaption>
            <span>{dateLabel(series[0]?.date ?? null)}</span>
            <span>{dateLabel(series.at(-1)?.date ?? null)}</span>
          </figcaption>
        </figure>
      ) : (
        <div className="wealth-chart-empty">
          <ArrowDownRight size={28} />
          <p>บันทึกรายการและเพิ่มราคา แล้วกราฟจะแสดงที่นี่</p>
        </div>
      )}
      <details className="wealth-chart-data">
        <summary>ดูข้อมูลกราฟแบบตาราง</summary>
        <Table caption="มูลค่าและผลตอบแทนรายวัน">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>มูลค่า ({portfolio.reporting_currency})</th>
              <th>TWR</th>
              <th>กระแสเงินสดสุทธิ</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.date}>
                <td>{dateLabel(s.date)}</td>
                <td>
                  <Value value={s.value} />
                </td>
                <td>{percentage(s.twr)}</td>
                <td>
                  <Value value={s.net_flow} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </details>
      {portfolio.quality !== "ok" && (
        <p className="wealth-help">
          วันที่ไม่มีราคา อัตราแลกเปลี่ยน หรือข้อมูลตั้งต้นครบ จะแสดงเป็น —
        </p>
      )}
    </section>
  );
}
