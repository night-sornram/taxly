import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { command, errorMessage } from "../api";
import { Button, ErrorNotice, Field, Modal, Notice } from "../components";
import { AccountsOptions, InstrumentsOptions, Select } from "./ui";
import { activityLabels, today } from "./format";
import type {
  Account,
  Activity,
  FxRate,
  Instrument,
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
        <InstrumentForm entry={editor.value} wrap={wrap} save={save} />
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
      <p className="wealth-help">
        ใช้ชื่อที่คุณจำได้ เช่น บัญชีหุ้นไทย หรือบัญชีต่างประเทศ เงินสดแยกตามสกุลเงินในแต่ละบัญชี
      </p>
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_account", {
        account: { id: entry?.id ?? crypto.randomUUID(), name: name.trim() },
      });
    },
  );
}
function InstrumentForm({ entry, wrap, save }: FormProps & { entry?: Instrument }) {
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
        {field("currency", "สกุลเงิน")}
      </div>
      {field(
        "provider_symbol",
        "สัญลักษณ์ Yahoo Finance",
        "หุ้นไทยใช้ .BK เช่น PTT.BK; เว้นว่างเพื่อใช้สัญลักษณ์ด้านบน",
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
        <Field
          {...currencyProps}
          label="สกุลเงิน"
          value={form.currency}
          readOnly={Boolean(instrument)}
          onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
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
        <div className="form-grid">
          {amountField("quantity", "จำนวนหน่วย")}
          {amountField("unit_price", "ราคาต่อหน่วย")}
        </div>
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
          {amountField(
            "amount",
            trade ? "เงินสดสุทธิ (ถ้ามี)" : "จำนวนเงิน",
            !trade,
            trade
              ? "เว้นว่างเพื่อคำนวณจากจำนวน × ราคา รวมค่าธรรมเนียมและภาษี ยอดสุทธิที่ระบุรวมค่าใช้จ่ายแล้ว"
              : undefined,
          )}
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
        รายการย้อนหลังจะคำนวณยอดที่ตามมาใหม่ ระบบจะไม่บันทึกรายการที่ทำให้เงินสดหรือจำนวนหน่วยติดลบ
      </Notice>
    </>,
    (e) => {
      e.preventDefault();
      void save("save_wealth_activity", {
        activity: { ...form, fee: form.fee || "0", tax: form.tax || "0" },
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
        <Field
          {...currencyProps}
          label="สกุลเงิน"
          readOnly={Boolean(form.instrument_id)}
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
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
        หากไม่ทราบต้นทุน จะยังดูมูลค่าได้ แต่กำไรที่ต้องใช้ต้นทุนจะแสดงเป็นข้อมูลไม่ครบ
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
        ราคาที่บันทึกเองมีลำดับก่อนราคาที่ดาวน์โหลดในวันเดียวกัน การรีเฟรชจะเก็บค่านี้ไว้
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
        <Field
          {...currencyProps}
          label="จากสกุลเงิน"
          value={form.from_currency}
          onChange={(e) => setForm({ ...form, from_currency: e.target.value.toUpperCase() })}
        />
        <Field
          {...currencyProps}
          label="เป็นสกุลเงิน"
          value={form.to_currency}
          onChange={(e) => setForm({ ...form, to_currency: e.target.value.toUpperCase() })}
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
