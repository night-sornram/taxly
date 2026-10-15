export type Money = string;
export type Basis = "actual" | "forecast";
export interface Facts {
  single: boolean | null;
  under_65: boolean | null;
  domestic_salary_only: boolean | null;
  no_special_cases: boolean | null;
  no_other_deductions: boolean | null;
  social_security_confirmed: boolean;
}
export interface Profile {
  year: number;
  facts: Facts;
  income_complete: boolean;
  revision: number;
}
export interface Source {
  id: string;
  tax_year: number;
  label: string;
}
export interface Income {
  id: string;
  tax_year: number;
  source_id: string;
  month: number;
  kind: "salary" | "bonus" | "other";
  basis: Basis;
  gross: Money;
  withholding: Money | null;
  note: string;
}
export interface Deduction {
  id: string;
  tax_year: number;
  month: number;
  rule_code: string;
  basis: Basis;
  amount: Money;
}
export interface Workspace {
  year: number;
  profile: Profile | null;
  sources: Source[];
  income: Income[];
  deductions: Deduction[];
  draft: unknown | null;
}
export type Difference = { kind: "payable" | "overpaid"; amount: Money } | { kind: "balanced" };
export interface Calculation {
  year: number;
  rule_set_id: string;
  rules_status: string;
  rounding_verified: boolean;
  gross_income: Money;
  actual_income: Money;
  forecast_income: Money;
  expenses: Money;
  personal_allowance: Money;
  social_security: Money;
  social_security_savings: Money;
  taxable_income: Money;
  annual_tax: Money;
  known_withholding: Money;
  actual_withholding: Money;
  remaining_after_actual_withholding: Money;
  forecast_withholding: Money;
  unknown_withholding_count: number;
  filing: "required" | "not_required" | "undetermined";
  data_complete: boolean;
  scope_issues: string[];
  warnings: string[];
  difference_preview: Difference | null;
  settlement: Difference | null;
  bands: {
    lower: Money;
    upper: Money | null;
    rate: string;
    statutory_rate: string;
    exempt_amount: Money;
    taxable_amount: Money;
    tax: Money;
  }[];
  steps: {
    rule_id: string;
    label: string;
    formula: string;
    amount: Money;
    source_ids: string[];
  }[];
}
export interface RuleSource {
  id: string;
  authority: string;
  title: string;
  url: string;
  locator: string;
  published_on: string | null;
  checked_on: string;
}
export interface Guidance {
  code: string;
  title: string;
  status: string;
  explanation: string;
  conditions: string;
  documents: string[];
  limit: Money | null;
  savings: Money | null;
  source_ids: string[];
}
export interface Snapshot {
  id: string;
  tax_year: number;
  rule_set_id: string;
  engine_version: string;
  input_json: string;
  result_json: string;
  input_hash: string;
  data_revision: number;
  created_at: string;
}
export interface BackupSummary {
  format_version: number;
  account_count: number;
  activity_count: number;
  restore_scope: "all" | "tax_only";
  token: string;
  years: number[];
  income_count: number;
  deduction_count: number;
  snapshot_count: number;
  draft_count: number;
}
export interface OnboardingDraft {
  step: number;
  facts: Facts;
  source_label: string;
  monthly_salary: string;
  start_month: number;
  end_month: number;
  actual_through: number;
  monthly_withholding: string;
  forecast_withholding: boolean;
  monthly_sso: string;
  bonus: string;
  bonus_month: number;
  bonus_basis: Basis;
  bonus_withholding: string;
  income_complete: boolean;
}
export const emptyFacts: Facts = {
  single: null,
  under_65: null,
  domestic_salary_only: null,
  no_special_cases: null,
  no_other_deductions: null,
  social_security_confirmed: false,
};
