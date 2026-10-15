import { useState } from "react";
import { ArrowRightLeft, Download, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { command, errorMessage } from "../api";
import { Button, ErrorNotice, Field, Modal, Notice } from "../components";
import { activityLabels, dateLabel, signedClass, today } from "./format";
import { Empty, PageTitle, Select, Table, Value } from "./ui";
import type { Editor } from "./Editors";
import type { RefreshResult, WealthWorkspace } from "./types";
type PageProps = { workspace: WealthWorkspace; edit: (editor: Editor) => void };

export function AccountsPage({
  workspace: { data, portfolio },
  edit,
  onDelete,
}: PageProps & { onDelete: (kind: "activity" | "opening", id: string) => void }) {
  return (
    <>
      <PageTitle
        eyebrow="A PLACE FOR EVERY GOAL"
        title="บัญชีลงทุน"
        actions={
          <Button onClick={() => edit({ kind: "account" })}>
            <Plus size={16} />
            เพิ่มบัญชี
          </Button>
        }
      >
        แยกบัญชีให้เห็นชัด พร้อมเงินสดทุกสกุลเงิน
      </PageTitle>
      {!data.accounts.length ? (
        <Empty
          title="บ้านหลังแรกของการลงทุน"
          action="เพิ่มบัญชี"
          onAction={() => edit({ kind: "account" })}
        >
          สร้างบัญชีตามโบรกเกอร์หรือเป้าหมายของคุณ แล้วบันทึกรายการหรือยอดตั้งต้น
        </Empty>
      ) : (
        <>
          <div className="wealth-account-grid">
            {data.accounts
              .filter((a) => portfolio.accounts.some((v) => v.id === a.id))
              .map((a, i) => (
                <section className="card wealth-account-card" key={a.id}>
                  <div className="wealth-section-heading">
                    <span className="wealth-account-icon">{String(i + 1).padStart(2, "0")}</span>
                    <button
                      className="icon-button"
                      aria-label={`แก้ไขบัญชี ${a.name}`}
                      onClick={() => edit({ kind: "account", value: a })}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                  <h2>{a.name}</h2>
                  <div className="wealth-account-value">
                    <Value
                      value={portfolio.accounts.find((v) => v.id === a.id)?.value}
                      currency={portfolio.reporting_currency}
                    />
                  </div>
                  <span className="wealth-eyebrow">เงินสดตามสกุลเงิน</span>
                  {portfolio.cash.filter((c) => c.account_id === a.id).length ? (
                    portfolio.cash
                      .filter((c) => c.account_id === a.id)
                      .map((c) => (
                        <div className="wealth-cash-row" key={c.currency}>
                          <span>{c.currency}</span>
                          <Value value={c.amount} />
                        </div>
                      ))
                  ) : (
                    <p className="wealth-help">ยังไม่มีเงินสด ณ วันที่เลือก</p>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => edit({ kind: "opening", accountId: a.id })}
                  >
                    <Plus size={14} />
                    เพิ่มยอดตั้งต้น
                  </Button>
                </section>
              ))}
          </div>
          <section className="card wealth-card-flush">
            <div className="wealth-section-heading">
              <div>
                <h2>ยอดตั้งต้นของแต่ละบัญชี</h2>
                <p>ต้นทุนที่เว้นว่างจะไม่ถูกสมมติเป็นศูนย์</p>
              </div>
            </div>
            {data.opening_positions.length ? (
              <Table caption="ยอดตั้งต้น">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>บัญชี</th>
                    <th>สินทรัพย์</th>
                    <th className="numeric">จำนวน / เงินสด</th>
                    <th className="numeric">ต้นทุนรวม</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.opening_positions.map((o) => (
                    <tr key={o.id}>
                      <td>{dateLabel(o.date)}</td>
                      <td>{data.accounts.find((a) => a.id === o.account_id)?.name}</td>
                      <td>
                        {data.instruments.find((i) => i.id === o.instrument_id)?.symbol ?? "เงินสด"}
                        <small>{o.currency}</small>
                      </td>
                      <td className="numeric">
                        <Value value={o.quantity} digits={0} />
                      </td>
                      <td className="numeric">
                        <Value value={o.cost_basis} currency={o.currency} />
                      </td>
                      <td>
                        <div className="wealth-row-actions">
                          <button
                            className="icon-button"
                            aria-label={`แก้ไขยอดตั้งต้น ${o.date} ${data.instruments.find((i) => i.id === o.instrument_id)?.symbol ?? o.currency}`}
                            onClick={() => edit({ kind: "opening", value: o })}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`ลบยอดตั้งต้น ${o.date} ${data.instruments.find((i) => i.id === o.instrument_id)?.symbol ?? o.currency}`}
                            onClick={() => onDelete("opening", o.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="wealth-inline-empty">
                หากมีประวัติครบถ้วน ให้เริ่มจากรายการฝากเงินและซื้อขายได้เลย
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
export function HoldingsPage({ workspace: { data, portfolio }, edit }: PageProps) {
  const [query, setQuery] = useState("");
  const holdings = portfolio.holdings.filter((h) => {
    const i = data.instruments.find((i) => i.id === h.instrument_id);
    return `${i?.symbol} ${i?.name} ${data.accounts.find((a) => a.id === h.account_id)?.name}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
  });
  return (
    <>
      <PageTitle
        eyebrow="KNOW WHAT YOU OWN"
        title="หลักทรัพย์ในพอร์ต"
        actions={
          <Button onClick={() => edit({ kind: "instrument" })}>
            <Plus size={16} />
            เพิ่มหลักทรัพย์
          </Button>
        }
      >
        ติดตามจำนวน มูลค่า และต้นทุน FIFO ของหุ้นและ ETF
      </PageTitle>
      <div className="wealth-search">
        <Search size={17} />
        <input
          type="search"
          aria-label="ค้นหาหลักทรัพย์"
          placeholder="ค้นหาสัญลักษณ์ ชื่อ หรือบัญชี…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <section className="card wealth-card-flush">
        {holdings.length ? (
          <Table caption="หลักทรัพย์ในพอร์ต">
            <thead>
              <tr>
                <th>หลักทรัพย์ / บัญชี</th>
                <th className="numeric">จำนวน</th>
                <th className="numeric">ราคา</th>
                <th className="numeric">ต้นทุนรวม</th>
                <th className="numeric">มูลค่า</th>
                <th className="numeric">กำไรยังไม่ขาย</th>
                <th className="numeric">กำไรขายแล้ว</th>
                <th className="numeric">มูลค่า ({portfolio.reporting_currency})</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const i = data.instruments.find((i) => i.id === h.instrument_id);
                return (
                  <tr key={`${h.account_id}-${h.instrument_id}`}>
                    <td>
                      <strong>{i?.symbol}</strong>
                      <small>
                        {data.accounts.find((a) => a.id === h.account_id)?.name} · {i?.currency}
                      </small>
                    </td>
                    <td className="numeric">
                      <Value value={h.quantity} digits={0} />
                    </td>
                    <td className="numeric">
                      <Value value={h.market_price} />
                    </td>
                    <td className="numeric">
                      <Value value={h.cost_basis} />
                    </td>
                    <td className="numeric">
                      <Value value={h.market_value} />
                    </td>
                    <td className={`numeric ${signedClass(h.unrealized_gain)}`}>
                      <Value value={h.unrealized_gain} />
                    </td>
                    <td className={`numeric ${signedClass(h.realized_gain)}`}>
                      <Value value={h.realized_gain} />
                    </td>
                    <td className="numeric">
                      <Value value={h.market_value_base} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty title={query ? "ไม่พบหลักทรัพย์ที่ค้นหา" : "ยังไม่มีหลักทรัพย์ในพอร์ต"}>
            {query
              ? "ลองค้นหาด้วยชื่อหรือสัญลักษณ์อื่น"
              : "เพิ่มหลักทรัพย์ แล้วบันทึกการซื้อหรือยอดตั้งต้น ตัวเลขจะแสดงจากรายการจริงของคุณ"}
          </Empty>
        )}
      </section>
      <p className="wealth-help">
        ราคา ต้นทุน มูลค่า และกำไรแสดงในสกุลเงินของหลักทรัพย์ ยกเว้นคอลัมน์ที่ระบุสกุลรายงาน —
        หมายถึงข้อมูลไม่ครบ
      </p>
      {data.instruments.length > 0 && (
        <details className="card wealth-instrument-list">
          <summary>ทะเบียนหลักทรัพย์ ({data.instruments.length})</summary>
          <Table caption="ทะเบียนหลักทรัพย์">
            <thead>
              <tr>
                <th>สัญลักษณ์</th>
                <th>ชื่อ</th>
                <th>ตลาด / สกุลเงิน</th>
                <th>ประเภท</th>
                <th>Yahoo Finance</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.instruments.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.symbol}</strong>
                  </td>
                  <td>{i.name}</td>
                  <td>
                    {i.exchange} / {i.currency}
                  </td>
                  <td>{i.kind.toUpperCase()}</td>
                  <td>{i.provider_symbol}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`แก้ไขหลักทรัพย์ ${i.symbol}`}
                      onClick={() => edit({ kind: "instrument", value: i })}
                    >
                      <Pencil size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </details>
      )}
    </>
  );
}
export function ActivityPage({
  workspace: { data, portfolio },
  edit,
  onDelete,
  onAccount,
  onImport,
}: PageProps & {
  onDelete: (kind: "activity" | "opening", id: string) => void;
  onAccount: () => void;
  onImport: () => void;
}) {
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const activities = [...data.activities]
    .filter(
      (a) =>
        (!kind || a.kind === kind) &&
        a.date <= portfolio.as_of &&
        (!portfolio.start_date || a.date >= portfolio.start_date) &&
        portfolio.accounts.some((v) => v.id === a.account_id || v.id === a.related_account_id) &&
        `${a.note} ${data.instruments.find((i) => i.id === a.instrument_id)?.symbol ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence);
  return (
    <>
      <PageTitle
        eyebrow="THE STORY BEHIND YOUR PORTFOLIO"
        title="รายการลงทุน"
        actions={
          <>
            <Button variant="secondary" onClick={onImport}>
              นำเข้า CSV
            </Button>
            <Button
              onClick={() => (data.accounts.length ? edit({ kind: "activity" }) : onAccount())}
            >
              <Plus size={16} />
              เพิ่มรายการ
            </Button>
          </>
        }
      >
        ทุกการเคลื่อนไหวของหุ้นและเงินสด คำนวณจากรายการในเครื่อง
      </PageTitle>
      <div className="wealth-list-filters">
        <div className="wealth-search">
          <Search size={17} />
          <input
            aria-label="ค้นหารายการ"
            type="search"
            placeholder="ค้นหาสัญลักษณ์หรือบันทึก…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select label="ประเภทรายการ" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">ทุกประเภท</option>
          {Object.entries(activityLabels).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </Select>
      </div>
      <section className="card wealth-card-flush">
        {activities.length ? (
          <Table caption="รายการลงทุน">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>รายการ</th>
                <th>บัญชี / หลักทรัพย์</th>
                <th className="numeric">จำนวน</th>
                <th className="numeric">ราคา</th>
                <th className="numeric">เงินสดสุทธิ</th>
                <th>บันทึก</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id}>
                  <td>{dateLabel(a.date)}</td>
                  <td>
                    <span className={`wealth-activity-kind ${a.kind}`}>
                      {activityLabels[a.kind] ?? a.kind}
                    </span>
                  </td>
                  <td>
                    {data.accounts.find((v) => v.id === a.account_id)?.name}
                    <small>
                      {a.instrument_id
                        ? data.instruments.find((i) => i.id === a.instrument_id)?.symbol
                        : a.kind === "transfer"
                          ? `→ ${data.accounts.find((v) => v.id === a.related_account_id)?.name}`
                          : a.kind === "fx"
                            ? `→ ${a.counter_amount} ${a.counter_currency}`
                            : a.currency}
                    </small>
                  </td>
                  <td className="numeric">
                    <Value value={a.quantity} digits={0} />
                  </td>
                  <td className="numeric">
                    <Value value={a.unit_price} />
                  </td>
                  <td className="numeric">
                    <Value value={a.amount} currency={a.currency} />
                    {a.amount === null && <small>คำนวณจากจำนวนและราคา</small>}
                  </td>
                  <td>{a.note || "—"}</td>
                  <td>
                    <div className="wealth-row-actions">
                      <button
                        className="icon-button"
                        aria-label={`แก้ไขรายการ ${activityLabels[a.kind]} ${a.date}`}
                        onClick={() => edit({ kind: "activity", value: a })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`ลบรายการ ${activityLabels[a.kind]} ${a.date}`}
                        onClick={() => onDelete("activity", a.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty title="ยังไม่มีรายการในช่วงนี้">
            เพิ่มรายการแรก เปลี่ยนช่วงวันที่ หรือนำเข้าประวัติจากไฟล์ CSV
          </Empty>
        )}
      </section>
    </>
  );
}

export function MarketPage({
  workspace: { data, portfolio },
  edit,
  onChanged,
}: PageProps & { onChanged: () => Promise<void> }) {
  const [currency, setCurrency] = useState(data.preferences.reporting_currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [startDate, setStartDate] = useState(portfolio.earliest_date ?? today());
  const [endDate, setEndDate] = useState(today());
  const savePreferences = async (
    enabled = data.preferences.market_data_enabled,
    reportingCurrency = currency,
  ) => {
    setBusy(true);
    setError("");
    try {
      await command("save_wealth_preferences", {
        preferences: { reporting_currency: reportingCurrency, market_data_enabled: enabled },
      });
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const next = await command<RefreshResult>("refresh_wealth_market_data", {
        startDate,
        endDate,
      });
      setResult(next);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="YOUR DATA, YOUR CHOICE"
        title="ราคาและสกุลเงิน"
        actions={
          <>
            <Button variant="secondary" onClick={() => edit({ kind: "fx" })}>
              <ArrowRightLeft size={15} />
              บันทึกอัตราแลกเปลี่ยน
            </Button>
            <Button onClick={() => edit({ kind: "price" })} disabled={!data.instruments.length}>
              <Plus size={16} />
              บันทึกราคา
            </Button>
          </>
        }
      >
        เลือกราคาที่คุณใช้ และเห็นวันที่ของข้อมูลเสมอ
      </PageTitle>
      {error && <ErrorNotice message={error} onClose={() => setError("")} />}
      <section className="card">
        <div className="wealth-section-heading">
          <div>
            <h2>สกุลเงินรายงาน</h2>
            <p>ใช้สำหรับมูลค่ารวมและกราฟ ข้อมูลดั้งเดิมยังเก็บตามสกุลของสินทรัพย์</p>
          </div>
        </div>
        <form
          className="wealth-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void savePreferences();
          }}
        >
          <Field
            label="รหัสสกุลเงิน 3 ตัว"
            required
            pattern="[A-Z]{3}"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
          <Button type="submit" disabled={busy || currency === data.preferences.reporting_currency}>
            บันทึกสกุลเงิน
          </Button>
        </form>
        <p className="wealth-help">
          เมื่อเปลี่ยนสกุลรายงาน ต้นทุนตั้งต้นที่แปลงไว้เดิมจะถูกล้างเพื่อไม่ให้ใช้ผิดสกุล
          คุณเติมต้นทุนในสกุลใหม่ได้ที่ยอดตั้งต้น
        </p>
      </section>
      <section className="card">
        <div className="wealth-section-heading">
          <div>
            <h2>ข้อมูลตลาดจาก Yahoo Finance</h2>
            <p>เปิดเฉพาะเมื่อคุณต้องการ และรีเฟรชด้วยตัวเอง</p>
          </div>
          <span className={`wealth-tag ${data.preferences.market_data_enabled ? "enabled" : ""}`}>
            {data.preferences.market_data_enabled ? "เปิดใช้งาน" : "ปิดอยู่"}
          </span>
        </div>
        <p className="wealth-help">
          เมื่อเปิดและกดรีเฟรช แอปจะส่งสัญลักษณ์หลักทรัพย์ คู่สกุลเงิน
          และช่วงวันที่ไปยังผู้ให้บริการผ่านอินเทอร์เน็ต ข้อมูลพอร์ตและรายการซื้อขายยังอยู่ในเครื่อง
          ราคาที่ดาวน์โหลดอาจล่าช้าหรือไม่ครบ
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            void savePreferences(
              !data.preferences.market_data_enabled,
              data.preferences.reporting_currency,
            )
          }
          disabled={busy}
        >
          {data.preferences.market_data_enabled ? "ปิดการดึงข้อมูลตลาด" : "เปิดการดึงข้อมูลตลาด"}
        </Button>
        <form
          className="wealth-refresh-form"
          onSubmit={(e) => {
            e.preventDefault();
            void refresh();
          }}
        >
          <Field
            label="ตั้งแต่วันที่ (ค.ศ.)"
            type="date"
            required
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Field
            label="ถึงวันที่ (ค.ศ.)"
            type="date"
            required
            value={endDate}
            min={startDate}
            max={today()}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <Button type="submit" disabled={busy || !data.preferences.market_data_enabled}>
            <RefreshCw size={15} className={busy ? "spin" : ""} />
            {busy ? "กำลังอัปเดต…" : "รีเฟรชราคาและ FX"}
          </Button>
        </form>
        {result && (
          <>
            <Notice tone={result.failures.length ? "warning" : "success"}>
              อัปเดต {result.updated_prices} ราคา และ {result.updated_fx} อัตราแลกเปลี่ยน
            </Notice>
            {result.failures.length > 0 && (
              <ul className="wealth-failures">
                {result.failures.map((failure, index) => (
                  <li key={index}>{failure}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <section className="card wealth-card-flush">
        <div className="wealth-section-heading">
          <div>
            <h2>ราคาที่เก็บในเครื่อง</h2>
            <p>ราคาบันทึกเองมีลำดับก่อนข้อมูลดาวน์โหลดในวันเดียวกัน</p>
          </div>
          <Download size={19} />
        </div>
        {data.prices.length ? (
          <Table caption="ราคาที่เก็บในเครื่อง">
            <thead>
              <tr>
                <th>หลักทรัพย์</th>
                <th>วันที่ราคา</th>
                <th className="numeric">ราคาปิด</th>
                <th>แหล่งข้อมูล</th>
                <th>อัปเดตล่าสุด</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {[...data.prices]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 500)
                .map((p, index) => (
                  <tr key={`${p.instrument_id}-${p.date}-${p.source}-${index}`}>
                    <td>{data.instruments.find((i) => i.id === p.instrument_id)?.symbol}</td>
                    <td>{dateLabel(p.date)}</td>
                    <td className="numeric">
                      <Value
                        value={p.close}
                        currency={data.instruments.find((i) => i.id === p.instrument_id)?.currency}
                      />
                    </td>
                    <td>{p.source === "manual" ? "บันทึกเอง" : p.source}</td>
                    <td>
                      <Timestamp value={p.fetched_at} />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`บันทึกราคา ${data.instruments.find((i) => i.id === p.instrument_id)?.symbol} ${p.date}`}
                        onClick={() => edit({ kind: "price", value: p })}
                      >
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ) : (
          <p className="wealth-inline-empty">
            ยังไม่มีราคา บันทึกเองเพื่อใช้ออฟไลน์ หรือเปิดข้อมูลตลาดเพื่อรีเฟรช
          </p>
        )}
        {data.prices.length > 500 && (
          <p className="wealth-help wealth-inline-empty">
            แสดง 500 ราคาล่าสุด จาก {data.prices.length} ราคา
          </p>
        )}
      </section>
      <section className="card wealth-card-flush">
        <div className="wealth-section-heading">
          <div>
            <h2>อัตราแลกเปลี่ยนย้อนหลัง</h2>
            <p>1 หน่วยจากสกุลต้นทาง เท่ากับอัตราในสกุลปลายทาง</p>
          </div>
        </div>
        {data.fx_rates.length ? (
          <Table caption="อัตราแลกเปลี่ยนย้อนหลัง">
            <thead>
              <tr>
                <th>คู่สกุลเงิน</th>
                <th>วันที่</th>
                <th className="numeric">อัตรา</th>
                <th>แหล่งข้อมูล</th>
                <th>อัปเดตล่าสุด</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {[...data.fx_rates]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 500)
                .map((r, index) => (
                  <tr key={`${r.from_currency}-${r.to_currency}-${r.date}-${index}`}>
                    <td>
                      {r.from_currency} → {r.to_currency}
                    </td>
                    <td>{dateLabel(r.date)}</td>
                    <td className="numeric">
                      <Value value={r.rate} digits={4} />
                    </td>
                    <td>{r.source === "manual" ? "บันทึกเอง" : r.source}</td>
                    <td>
                      <Timestamp value={r.fetched_at} />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`บันทึกอัตรา ${r.from_currency} ${r.to_currency} ${r.date}`}
                        onClick={() => edit({ kind: "fx", value: r })}
                      >
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ) : (
          <p className="wealth-inline-empty">
            เมื่อใช้สินทรัพย์ต่างสกุล ต้องมีอัตราย้อนหลังสำหรับวันที่ประเมินมูลค่าและต้นทุน
          </p>
        )}
      </section>
    </>
  );
}
function Timestamp({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (
    <>—</>
  ) : (
    <time dateTime={value}>
      {date.toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
      })}
    </time>
  );
}
export function DeleteConfirmation({
  kind,
  busy,
  onClose,
  onDelete,
}: {
  kind: "activity" | "opening";
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      title={kind === "activity" ? "ลบรายการลงทุนนี้?" : "ลบยอดตั้งต้นนี้?"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>ระบบจะคำนวณพอร์ตใหม่จากข้อมูลที่เหลือ หากทำให้ยอดในภายหลังไม่ถูกต้อง การลบจะถูกยกเลิก</p>
      <div className="modal-actions">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          เก็บรายการไว้
        </Button>
        <Button variant="danger" disabled={busy} onClick={onDelete}>
          {busy ? "กำลังลบ…" : "ยืนยันลบรายการ"}
        </Button>
      </div>
    </Modal>
  );
}
