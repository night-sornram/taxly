import type { Money } from "../types";
import type { TaxLink } from "../sync/model";

export type LedgerKind = "income" | "expense";
export interface LedgerCategory {
  id: string;
  kind: LedgerKind;
  name: string;
}
export interface LedgerEntry {
  id: string;
  date: string;
  category_id: string;
  amount: Money;
  note: string;
  tax_income_id: string | null;
  tax?: TaxLink | null;
}
export interface Ledger {
  categories: LedgerCategory[];
  entries: LedgerEntry[];
}
export interface CsvFile {
  file_name: string;
  rows: string[][];
}
