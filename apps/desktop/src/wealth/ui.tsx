import { useId } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { Button } from "../components";
import type { WealthData } from "./types";
import { decimal } from "./format";

export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} {...props}>
        {children}
      </select>
    </div>
  );
}
export function AccountsOptions({ data, exclude }: { data: WealthData; exclude?: string }) {
  return data.accounts
    .filter((a) => a.id !== exclude)
    .map((a) => (
      <option key={a.id} value={a.id}>
        {a.name}
      </option>
    ));
}
export function InstrumentsOptions({ data }: { data: WealthData }) {
  return (
    <>
      <option value="">เลือกหลักทรัพย์</option>
      {data.instruments.map((a) => (
        <option key={a.id} value={a.id}>
          {a.symbol} · {a.name} ({a.currency})
        </option>
      ))}
    </>
  );
}
export function Value({
  value,
  currency,
  digits = 2,
}: {
  value: string | null | undefined;
  currency?: string;
  digits?: number;
}) {
  return (
    <span className="wealth-number">
      {decimal(value, digits)}
      {currency && value != null && <small> {currency}</small>}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
  onAction,
}: {
  title: string;
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="wealth-empty">
      <span className="wealth-empty-icon">
        <ArrowUpRight size={27} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action && (
        <Button onClick={onAction}>
          <Plus size={16} />
          {action}
        </Button>
      )}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="wealth-page-title">
      <div>
        <span className="wealth-eyebrow">{eyebrow}</span>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{children}</p>
      </div>
      <div className="wealth-actions">{actions}</div>
    </div>
  );
}
export function Table({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="wealth-table-wrap">
      <table className="wealth-table">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
