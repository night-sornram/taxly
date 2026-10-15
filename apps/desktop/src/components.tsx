import { useEffect, useId, useRef } from "react";
import type { ReactNode, InputHTMLAttributes } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Info,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { formatMoney, months } from "./money";
import { useTheme } from "./theme";
import type { Basis } from "./types";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg width="25" height="25" viewBox="0 0 28 28" fill="none">
          <path
            d="M5 7h18M14 7v16M7 12v7a4 4 0 0 0 4 4M21 12v7a4 4 0 0 1-4 4"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path d="m14 1 1.5 3L19 5l-3.5 1L14 9l-1.5-3L9 5l3.5-1L14 1Z" fill="currentColor" />
        </svg>
      </span>
      <span>
        Tax<span className="brand-soft">ly</span>
        <i>เรื่องภาษี ค่อย ๆ เข้าใจ</i>
      </span>
    </div>
  );
}
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      className="icon-button"
      aria-label={dark ? "เปิดธีมสว่าง" : "เปิดธีมมืด"}
      aria-pressed={dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
export function MoneyValue({
  value,
  large = false,
  currency = true,
}: {
  value: string;
  large?: boolean;
  currency?: boolean;
}) {
  return (
    <span className={`money ${large ? "large" : ""}`}>
      {formatMoney(value)}
      {currency && <span className="currency">บาท</span>}
    </span>
  );
}
export function BasisBadge({ basis }: { basis: Basis }) {
  return (
    <span className={`badge ${basis === "actual" ? "actual" : "forecast"}`}>
      {basis === "actual" ? <Check size={12} /> : <span className="tiny-dot" />}
      {basis === "actual" ? "ยอดจริง" : "คาดการณ์"}
    </span>
  );
}
export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`button ${variant} ${className}`}
    >
      {children}
    </button>
  );
}
export function Loading({ label = "กำลังเปิดข้อมูลในเครื่อง…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={25} />
      <span>{label}</span>
    </div>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "success";
}) {
  return (
    <div className={`notice ${tone}`}>
      <Info size={17} />
      <div>{children}</div>
    </div>
  );
}
export function ErrorNotice({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <Info size={18} />
      <div>{message}</div>
      {onClose && (
        <button className="icon-button" aria-label="ปิดข้อความผิดพลาด" onClick={onClose}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export function SavedLabel() {
  return (
    <span className="saved-label">
      <CheckCheck size={15} /> บันทึกในเครื่องแล้ว
    </span>
  );
}
export function PrivacyNote() {
  return (
    <span className="privacy-note">
      <LockKeyhole size={13} /> ข้อมูลอยู่ในเครื่องของคุณ
    </span>
  );
}
export function Field({
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        {...props}
        aria-invalid={Boolean(error)}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
      />
      {(hint || error) && (
        <small id={`${id}-hint`} className={error ? "field-error" : ""}>
          {error || hint}
        </small>
      )}
    </div>
  );
}
export function MonthSelect({
  label,
  value,
  onChange,
  allowNone = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  allowNone?: boolean;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {allowNone && <option value={0}>ยังไม่ยืนยันเดือนใด</option>}
        {months.map((month, i) => (
          <option key={month} value={i + 1}>
            {month}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
export function Answer({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  hint?: string;
}) {
  return (
    <fieldset className="answer">
      <legend>{label}</legend>
      {hint && <p>{hint}</p>}
      <div className="answer-options">
        {[
          { label: "ใช่", value: true },
          { label: "ไม่ใช่", value: false },
          { label: "ยังไม่แน่ใจ", value: null },
        ].map((item) => (
          <label key={item.label} className={value === item.value ? "selected" : ""}>
            <input
              type="radio"
              checked={value === item.value}
              onChange={() => onChange(item.value)}
            />
            {value === item.value && <Check size={14} />} {item.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
    const element = ref.current;
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="modal"
    >
      <div className="modal-inner">
        <header>
          <h2 id={id}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง">
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function TextLink({
  children,
  onClick,
  external = false,
}: {
  children: ReactNode;
  onClick: () => void;
  external?: boolean;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      {external ? <ArrowUpRight size={15} /> : <ChevronRight size={15} />}
    </button>
  );
}
