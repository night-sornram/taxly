import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Search } from "lucide-react";
import { command, errorMessage } from "../api";
import { Button, Checkbox, ErrorNotice, Field, Modal, Notice } from "../components";
import { AccountsOptions, CurrencySelect, InstrumentsOptions, Select } from "./ui";
import {
  activityLabels,
  dateLabel,
  decimal,
  netCashForTrade,
  today,
  tradePreview,
  unitPriceFromTotal,
} from "./format";
import type {
  Account,
  Activity,
  FxRate,
  Instrument,
  InstrumentSearchResult,
  OpeningPosition,
  Price,
  WealthData,
} from "./types";

export type Editor =
  | { kind: "account"; value?: Account }
  | { kind: "instrument"; value?: Instrument }
  | { kind: "activity"; value?: Activity }
  | { kind: "opening"; value?: OpeningPosition; accountId?: string }
  | { kind: "price"; value?: Price }
  | { kind: "fx"; value?: FxRate };
const titles = {
  account: "บัญชีลงทุน",
  instrument: "หลักทรัพย์",
  activity: "รายการลงทุน",
  opening: "ยอดตั้งต้น",
  price: "ราคาที่บันทึกเอง",
  fx: "อัตราแลกเปลี่ยนที่บันทึกเอง",
};
export default function EditorModal({
  editor,
  data,
  onClose,
  onSaved,
}: {
  editor: Editor;
  data: WealthData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (name: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await command(name, args);
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const wrap = (children: ReactNode, submit: (e: FormEvent<HTMLFormElement>) => void) => (
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="wealth-form-fields">
        {error && <ErrorNotice message={error} />}
        {children}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
  return (
    <Modal
      title={`${editor.value ? "แก้ไข" : "เพิ่ม"}${titles[editor.kind]}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {editor.kind === "account" && <AccountForm entry={editor.value} wrap={wrap} save={save} />}
      {editor.kind === "instrument" && (
        <InstrumentForm entry={editor.value} data={data} wrap={wrap} save={save} />
      )}
      {editor.kind === "activity" && (
        <ActivityForm entry={editor.value} data={data} wrap={wrap} save={save} />
      )}
      {editor.kind === "opening" && (
        <OpeningForm
          entry={editor.value}
          accountId={editor.accountId}
          data={data}
          wrap={wrap}
          save={save}
        />
      )}
      {editor.kind === "price" && (
        <PriceForm entry={editor.value} data={data} wrap={wrap} save={save} />
      )}
      {editor.kind === "fx" && <FxForm entry={editor.value} wrap={wrap} save={save} />}
    </Modal>
  );
}
type FormProps = {
  wrap: (children: ReactNode, submit: (e: FormEvent<HTMLFormElement>) => void) => ReactNode;
  save: (name: string, args: Record<string, unknown>) => Promise<void>;
};
const moneyProps = {
  inputMode: "decimal" as const,
  pattern: "[0-9]+([.][0-9]+)?",
  placeholder: "0.00",
};
const currencyProps = { pattern: "[A-Za-z]{3}", maxLength: 3, placeholder: "THB", required: true };
function AccountForm({ entry, wrap, save }: FormProps & { entry?: Account }) {
  const [name, setName] = useState(entry?.name ?? "");
  const [trackCash, setTrackCash] = useState(entry?.track_cash ?? false);
  return wrap(
    <>
      <Field
        label="ชื่อบัญชี"
        value={name}
        required
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="wealth-external-cash">
        <Checkbox checked={trackCash} onChange={setTrackCash}>
          ติดตามเงินสดในบัญชีนี้
        </Checkbox>
        <p className="wealth-help">
          {trackCash
            ? "การซื้อขายจะหักและเพิ่มยอดเงินสดตามรายการจริง"
            : "แยกเงินสดกับการลงทุน: บันทึกการซื้อขายได้อิสระโดยไม่ผูกกับยอดเงินสด"}
        </p>
      </div>
      <p className="wealth-help">ตั้งชื่อให้จำง่าย เช่น บัญชีหุ้นไทย หรือบัญชีต่างประเทศ</p>
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_account", {
        account: {
          id: entry?.id ?? crypto.randomUUID(),
          name: name.trim(),
          track_cash: trackCash,
        },
      });
    },
  );
}
const EXCHANGE_ALIASES: Record<string, string> = {
  SNP: "NASDAQ",
  NMS: "NASDAQ",
  NYQ: "NYSE",
  NYS: "NYSE",
  BKK: "SET",
};
function InstrumentForm({
  entry,
  data,
  wrap,
  save,
}: FormProps & { entry?: Instrument; data: WealthData }) {
  const [form, setForm] = useState<Instrument>(
    entry ?? {
      id: crypto.randomUUID(),
      symbol: "",
      name: "",
      kind: "stock",
      currency: "THB",
      exchange: "SET",
      provider_symbol: "",
    },
  );
  const [results, setResults] = useState<InstrumentSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const marketEnabled = data.preferences.market_data_enabled;
  const search = async () => {
    const query = form.symbol.trim() || form.name.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      const found = await command<InstrumentSearchResult[]>("search_wealth_instruments", {
        query,
      });
      setResults(found);
      if (!found.length) setSearchError("ไม่พบหุ้นหรือ ETF ที่ตรงกับคำค้นนี้");
    } catch (e) {
      setSearchError(errorMessage(e));
    } finally {
      setSearching(false);
    }
  };
  const pick = (found: InstrumentSearchResult) => {
    const exchange = EXCHANGE_ALIASES[found.exchange] ?? found.exchange;
    const thaiListed = found.symbol.endsWith(".BK");
    setForm({
      ...form,
      symbol: thaiListed ? found.symbol.replace(/\.BK$/, "") : found.symbol,
      name: found.name,
      exchange,
      kind: found.kind === "etf" ? "etf" : "stock",
      // The provider's real trading currency, e.g. USD for SCHF/SCHG.
      currency: found.currency || (thaiListed ? "THB" : form.currency),
      provider_symbol: found.symbol,
    });
    setResults(null);
  };
  const field = (key: keyof Instrument, label: string, hint?: string) => (
    <Field
      label={label}
      value={form[key]}
      required={key !== "provider_symbol"}
      hint={hint}
      maxLength={key === "currency" ? 3 : 160}
      onChange={(e) =>
        setForm({ ...form, [key]: key === "name" ? e.target.value : e.target.value.toUpperCase() })
      }
    />
  );
  return wrap(
    <>
      <div className="form-grid">
        {field("symbol", "สัญลักษณ์", "เช่น PTT หรือ VOO")}
        {field("exchange", "ตลาด", "เช่น SET, NASDAQ หรือ NYSE")}
      </div>
      <div className="wealth-search-actions">
        <Button
          variant="secondary"
          type="button"
          disabled={!marketEnabled || searching || !(form.symbol.trim() || form.name.trim())}
          onClick={() => void search()}
        >
          <Search size={15} className={searching ? "spin" : ""} />
          {searching ? "กำลังค้นหา…" : "ค้นหาจาก Yahoo Finance"}
        </Button>
        {!marketEnabled && (
          <span className="wealth-help">เปิดข้อมูลตลาดที่หน้าราคาก่อน จึงจะค้นหาอัตโนมัติได้</span>
        )}
      </div>
      {searchError && <p className="wealth-help">{searchError}</p>}
      {results && results.length > 0 && (
        <div className="wealth-search-results" role="listbox" aria-label="ผลการค้นหาหลักทรัพย์">
          {results.map((found) => (
            <button type="button" role="option" key={found.symbol} onClick={() => pick(found)}>
              <strong>{found.symbol}</strong>
              <span>{found.name}</span>
              <small>
                {found.exchange} · {found.kind === "etf" ? "ETF" : "หุ้น"}
              </small>
            </button>
          ))}
        </div>
      )}
      {field("name", "ชื่อหลักทรัพย์")}
      <div className="form-grid">
        <Select
          label="ประเภท"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
        >
          <option value="stock">หุ้น</option>
          <option value="etf">ETF</option>
        </Select>
        <CurrencySelect
          label="สกุลเงิน"
          value={form.currency}
          onChange={(currency) => setForm({ ...form, currency })}
        />
      </div>
      {field(
        "provider_symbol",
        "สัญลักษณ์ Yahoo Finance",
        "หุ้นไทยใช้ .BK เช่น PTT.BK; เว้นว่างเพื่อใช้สัญลักษณ์ด้านบน",
      )}
      {entry && entry.currency !== form.currency && (
        <Notice>
          การเปลี่ยนสกุลเงินจะอัปเดตรายการและยอดตั้งต้นที่ผูกกับหลักทรัพย์นี้ทั้งหมด
          ให้ใช้สกุลเงินใหม่ตามโดยอัตโนมัติ
        </Notice>
      )}
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_instrument", {
        instrument: { ...form, provider_symbol: form.provider_symbol || form.symbol },
      });
    },
  );
}
function ActivityForm({
  entry,
  data,
  wrap,
  save,
}: FormProps & { entry?: Activity; data: WealthData }) {
  const [form, setForm] = useState<Activity>(
    entry ?? {
      id: crypto.randomUUID(),
      account_id: data.accounts[0]?.id ?? "",
      date: today(),
      kind: "deposit",
      instrument_id: null,
      currency: "THB",
      quantity: null,
      unit_price: null,
      amount: null,
      fee: "0",
      tax: "0",
      related_account_id: null,
      counter_currency: null,
      counter_amount: null,
      sequence: 0,
      note: "",
    },
  );
  const instrument = data.instruments.find((i) => i.id === form.instrument_id);
  const trade = form.kind === "buy" || form.kind === "sell";
  const [amountManual, setAmountManual] = useState(entry?.amount != null);
  // When only the total cash amount is known, derive the unit price in the UI
  // (exact BigInt math) and let the backend re-derive the amount from it, so
  // supplied amounts always reconcile after rounding.
  const derivedPrice =
    trade && !form.unit_price
      ? unitPriceFromTotal(
          form.kind as "buy" | "sell",
          form.quantity,
          form.amount,
          form.fee,
          form.tax,
        )
      : null;
  const latestPrice = form.instrument_id
    ? [...data.prices]
        .filter((price) => price.instrument_id === form.instrument_id)
        .sort((a, b) => b.date.localeCompare(a.date))[0]
    : undefined;
  const effectivePrice = form.unit_price ?? derivedPrice;
  // Live net cash from quantity × price ± charges; shown in the field until
  // the user types their own amount.
  const computedAmount = trade
    ? netCashForTrade(
        form.kind as "buy" | "sell",
        form.quantity,
        form.unit_price,
        form.fee,
        form.tax,
      )
    : null;
  const preview =
    trade && latestPrice && effectivePrice
      ? tradePreview(
          form.kind as "buy" | "sell",
          form.quantity,
          effectivePrice,
          form.fee,
          form.tax,
          latestPrice.close,
        )
      : null;
  const withInstrument = trade || form.kind === "split" || form.kind === "dividend";
  const amountField = (
    key: "quantity" | "unit_price" | "amount" | "fee" | "tax" | "counter_amount",
    label: string,
    required = true,
    hint?: string,
  ) => (
    <Field
      {...moneyProps}
      label={label}
      value={form[key] ?? ""}
      required={required}
      hint={hint}
      onChange={(e) => setForm({ ...form, [key]: e.target.value || null })}
    />
  );
  const changeKind = (kind: string) =>
    setForm({
      ...form,
      kind,
      instrument_id: null,
      quantity: null,
      unit_price: null,
      amount: null,
      fee: "0",
      tax: "0",
      related_account_id: null,
      counter_currency: null,
      counter_amount: null,
    });
  return wrap(
    <>
      <div className="form-grid">
        <Select
          label="บัญชี"
          required
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
        >
          <AccountsOptions data={data} />
        </Select>
        <Field
          label="วันที่ (ค.ศ.)"
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </div>
      <div className="form-grid">
        <Select label="ประเภทรายการ" value={form.kind} onChange={(e) => changeKind(e.target.value)}>
          {Object.entries(activityLabels).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </Select>
        <CurrencySelect
          label="สกุลเงิน"
          value={form.currency}
          disabled={Boolean(instrument)}
          onChange={(currency) => setForm({ ...form, currency })}
        />
      </div>
      {withInstrument && (
        <Select
          label="หลักทรัพย์"
          required={trade || form.kind === "split"}
          value={form.instrument_id ?? ""}
          onChange={(e) => {
            const i = data.instruments.find((i) => i.id === e.target.value);
            setForm({
              ...form,
              instrument_id: i?.id ?? null,
              currency: i?.currency ?? form.currency,
            });
          }}
        >
          <InstrumentsOptions data={data} />
        </Select>
      )}
      {trade && (
        <>
          <div className="form-grid">
            {amountField("quantity", "จำนวนหน่วย")}
            {amountField(
              "unit_price",
              "ราคาต่อหน่วย",
              false,
              "เว้นว่างได้ถ้ากรอกยอดเงินสุทธิแทน ระบบจะคำนวณราคาให้",
            )}
          </div>
          {trade && form.instrument_id && !latestPrice && (
            <p className="wealth-help">
              ยังไม่มีราคาล่าสุดของหลักทรัพย์นี้ในระบบ บันทึกราคาหรือรีเฟรชเพื่อดูกำไรขาดทุนล่วงหน้า
            </p>
          )}
          {(latestPrice || derivedPrice) && (
            <div className="wealth-price-hints">
              {latestPrice && (
                <p className="wealth-help">
                  ราคาล่าสุดในระบบ ({dateLabel(latestPrice.date)}): {decimal(latestPrice.close)}{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setForm({ ...form, unit_price: latestPrice.close })}
                  >
                    ใช้ราคานี้
                  </button>
                </p>
              )}
              {derivedPrice && (
                <p className="wealth-help">
                  จะใช้ราคาต่อหน่วย {derivedPrice} ซึ่งคำนวณจากยอดเงินและจำนวนหุ้นที่กรอก
                </p>
              )}
              {preview && latestPrice && (
                <p
                  className={`wealth-help ${preview.gain.startsWith("-") ? "wealth-negative" : "wealth-positive"}`}
                >
                  ขายที่ราคาปัจจุบัน {decimal(latestPrice.close)} ({dateLabel(latestPrice.date)}):
                  มูลค่า {preview.currentValue} {form.currency} · กำไร/ขาดทุน {preview.gain} (
                  {preview.percent}%)
                </p>
              )}
            </div>
          )}
        </>
      )}
      {form.kind === "split" ? (
        <>
          {amountField(
            "quantity",
            "อัตราส่วนหุ้นใหม่ต่อหุ้นเดิม",
            true,
            "เช่น 2 หมายถึงหุ้นเดิม 1 หน่วย กลายเป็น 2 หน่วย",
          )}
        </>
      ) : (
        <>
          <Field
            {...moneyProps}
            label={trade ? "เงินสดสุทธิ" : "จำนวนเงิน"}
            required={!trade}
            hint={
              trade
                ? computedAmount && !amountManual
                  ? "คำนวณอัตโนมัติจาก จำนวน × ราคา บวกลบค่าธรรมเนียมและภาษี · พิมพ์ทับได้ถ้ายอดจริงต่างออกไป หรือกรอกยอดก่อนเพื่อให้คำนวณราคาต่อหน่วยแทน"
                  : "กรอกยอดรวมที่จ่ายจริง ระบบจะคำนวณราคาต่อหน่วยให้"
                : undefined
            }
            value={amountManual ? (form.amount ?? "") : (form.amount ?? computedAmount ?? "")}
            onChange={(e) => {
              const value = e.target.value;
              setAmountManual(value !== "");
              setForm({ ...form, amount: value || null });
            }}
          />
          {(trade || form.kind === "dividend" || form.kind === "interest") && (
            <div className="form-grid">
              {amountField("fee", "ค่าธรรมเนียม")}
              {amountField("tax", "ภาษีหัก ณ ที่จ่าย")}
            </div>
          )}
        </>
      )}
      {form.kind === "transfer" && (
        <Select
          label="บัญชีปลายทาง"
          required
          value={form.related_account_id ?? ""}
          onChange={(e) => setForm({ ...form, related_account_id: e.target.value })}
        >
          <option value="">เลือกบัญชีปลายทาง</option>
          <AccountsOptions data={data} exclude={form.account_id} />
        </Select>
      )}
      {form.kind === "fx" && (
        <div className="form-grid">
          <Field
            {...currencyProps}
            label="สกุลเงินที่ได้รับ"
            value={form.counter_currency ?? ""}
            onChange={(e) => setForm({ ...form, counter_currency: e.target.value.toUpperCase() })}
          />
          {amountField("counter_amount", "จำนวนเงินที่ได้รับ")}
        </div>
      )}
      <Field
        label="บันทึกช่วยจำ"
        value={form.note}
        maxLength={500}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
      />
      <Notice>
        การบันทึกย้อนหลังจะคำนวณยอดหลังจากนั้นใหม่ทั้งหมด และระบบจะไม่บันทึก
        ถ้าทำให้เงินสดหรือจำนวนหุ้นติดลบ
      </Notice>
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_activity", {
        activity: {
          ...form,
          unit_price: form.unit_price ?? derivedPrice,
          // When the price was derived from the total, drop the total so the
          // backend re-derives it and the ledger always reconciles exactly.
          amount: form.unit_price || !derivedPrice ? form.amount : null,
          fee: form.fee || "0",
          tax: form.tax || "0",
        },
      });
    },
  );
}
function OpeningForm({
  entry,
  accountId,
  data,
  wrap,
  save,
}: FormProps & { entry?: OpeningPosition; accountId?: string; data: WealthData }) {
  const [form, setForm] = useState<OpeningPosition>(
    entry ?? {
      id: crypto.randomUUID(),
      account_id: accountId ?? data.accounts[0]?.id ?? "",
      date: today(),
      instrument_id: null,
      currency: "THB",
      quantity: "",
      cost_basis: null,
      cost_basis_base: null,
    },
  );
  return wrap(
    <>
      <Notice>
        ใช้เมื่อต้องการเริ่มจากยอดปัจจุบัน เลือกวันตั้งต้นเดียวกันภายในบัญชี
        และบันทึกรายการหลังจากวันนั้น ผลตอบแทนก่อนวันตั้งต้นจะไม่แสดง
      </Notice>
      <div className="form-grid">
        <Select
          label="บัญชี"
          required
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
        >
          <AccountsOptions data={data} />
        </Select>
        <Field
          label="วันตั้งต้น (ค.ศ.)"
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </div>
      <Select
        label="สินทรัพย์ตั้งต้น"
        value={form.instrument_id ?? ""}
        onChange={(e) => {
          const instrument = data.instruments.find((i) => i.id === e.target.value);
          setForm({
            ...form,
            instrument_id: instrument?.id ?? null,
            currency: instrument?.currency ?? "THB",
            cost_basis: null,
            cost_basis_base: null,
          });
        }}
      >
        <option value="">เงินสด</option>
        {data.instruments.map((i) => (
          <option key={i.id} value={i.id}>
            {i.symbol} · {i.currency}
          </option>
        ))}
      </Select>
      <div className="form-grid">
        <CurrencySelect
          label="สกุลเงิน"
          value={form.currency}
          disabled={Boolean(form.instrument_id)}
          onChange={(currency) => setForm({ ...form, currency })}
        />
        <Field
          {...moneyProps}
          label={form.instrument_id ? "จำนวนหน่วยตั้งต้น" : "เงินสดตั้งต้น"}
          required
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />
      </div>
      {form.instrument_id && (
        <div className="form-grid">
          <Field
            {...moneyProps}
            label={`ต้นทุนรวม (${form.currency}) · ถ้าทราบ`}
            value={form.cost_basis ?? ""}
            onChange={(e) => setForm({ ...form, cost_basis: e.target.value || null })}
          />
          <Field
            {...moneyProps}
            label={`ต้นทุนรวม (${data.preferences.reporting_currency}) · ถ้าทราบ`}
            hint="ต้นทุนที่แปลงด้วยอัตรา ณ วันที่ซื้อจริง ไม่ใช่อัตราวันนี้"
            value={form.cost_basis_base ?? ""}
            onChange={(e) => setForm({ ...form, cost_basis_base: e.target.value || null })}
          />
        </div>
      )}
      <p className="wealth-help">
        ถ้าไม่ทราบต้นทุน ยังดูมูลค่าได้ตามปกติ แต่กำไร/ขาดทุนจะแสดงเป็น — (ไม่มีข้อมูล)
      </p>
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_opening", { opening: form });
    },
  );
}
function PriceForm({ entry, data, wrap, save }: FormProps & { entry?: Price; data: WealthData }) {
  const [form, setForm] = useState(
    entry ?? {
      instrument_id: data.instruments[0]?.id ?? "",
      date: today(),
      close: "",
      source: "manual",
      fetched_at: "",
    },
  );
  return wrap(
    <>
      <Select
        label="หลักทรัพย์"
        required
        value={form.instrument_id}
        onChange={(e) => setForm({ ...form, instrument_id: e.target.value })}
      >
        <InstrumentsOptions data={data} />
      </Select>
      <div className="form-grid">
        <Field
          label="วันที่ราคา (ค.ศ.)"
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
        <Field
          {...moneyProps}
          label="ราคาปิดในสกุลหลักทรัพย์"
          required
          value={form.close}
          onChange={(e) => setForm({ ...form, close: e.target.value })}
        />
      </div>
      <p className="wealth-help">
        ราคาที่บันทึกเองจะถูกใช้ก่อนราคาที่ดึงมาในวันเดียวกัน และจะไม่ถูกทับเมื่อรีเฟรช
      </p>
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_price", {
        price: { ...form, source: "manual", fetched_at: new Date().toISOString() },
      });
    },
  );
}
function FxForm({ entry, wrap, save }: FormProps & { entry?: FxRate }) {
  const [form, setForm] = useState(
    entry ?? {
      from_currency: "USD",
      to_currency: "THB",
      date: today(),
      rate: "",
      source: "manual",
      fetched_at: "",
    },
  );
  return wrap(
    <>
      <div className="form-grid">
        <CurrencySelect
          label="จากสกุลเงิน"
          value={form.from_currency}
          onChange={(from_currency) => setForm({ ...form, from_currency })}
        />
        <CurrencySelect
          label="เป็นสกุลเงิน"
          value={form.to_currency}
          onChange={(to_currency) => setForm({ ...form, to_currency })}
        />
      </div>
      <div className="form-grid">
        <Field
          label="วันที่อัตรา (ค.ศ.)"
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
        <Field
          {...moneyProps}
          label={`1 ${form.from_currency} เท่ากับ (${form.to_currency})`}
          required
          value={form.rate}
          onChange={(e) => setForm({ ...form, rate: e.target.value })}
        />
      </div>
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_fx", {
        rate: { ...form, source: "manual", fetched_at: new Date().toISOString() },
      });
    },
  );
}
