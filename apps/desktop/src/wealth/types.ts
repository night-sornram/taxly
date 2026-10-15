export interface Account {
  id: string;
  name: string;
  /** Holdings-only account: buys/sells never move its cash. */
  track_cash: boolean;
}
export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  kind: string;
  currency: string;
  exchange: string;
  provider_symbol: string;
}
export interface Activity {
  id: string;
  account_id: string;
  date: string;
  kind: string;
  instrument_id: string | null;
  currency: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string | null;
  fee: string;
  tax: string;
  related_account_id: string | null;
  counter_currency: string | null;
  counter_amount: string | null;
  sequence: number;
  note: string;
}
export interface OpeningPosition {
  id: string;
  account_id: string;
  date: string;
  instrument_id: string | null;
  currency: string;
  quantity: string;
  cost_basis: string | null;
  cost_basis_base: string | null;
}
export interface Price {
  instrument_id: string;
  date: string;
  close: string;
  source: string;
  fetched_at: string;
}
export interface FxRate {
  from_currency: string;
  to_currency: string;
  date: string;
  rate: string;
  source: string;
  fetched_at: string;
}
export interface WealthPreferences {
  reporting_currency: string;
  market_data_enabled: boolean;
}
export interface ImportMapping {
  id: string;
  name: string;
  mode: string;
  date_format: string;
  columns: Record<string, string>;
}
export interface InstrumentSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  kind: string;
  currency: string;
}
export interface WealthData {
  revision: number;
  accounts: Account[];
  instruments: Instrument[];
  activities: Activity[];
  opening_positions: OpeningPosition[];
  prices: Price[];
  fx_rates: FxRate[];
  import_mappings: ImportMapping[];
  preferences: WealthPreferences;
}
export interface PortfolioFilter {
  account_ids: string[];
  start_date: string | null;
  end_date: string;
}
export interface Holding {
  account_id: string;
  instrument_id: string;
  quantity: string;
  cost_basis: string | null;
  cost_basis_base: string | null;
  market_price: string | null;
  market_value: string | null;
  market_value_base: string | null;
  unrealized_gain: string | null;
  realized_gain: string | null;
  allocation: string | null;
}
export interface CashBalance {
  account_id: string;
  currency: string;
  amount: string;
  value_base: string | null;
}
export interface Portfolio {
  reporting_currency: string;
  as_of: string;
  start_date: string | null;
  earliest_date: string | null;
  total_value: string | null;
  known_value: string;
  cash_value: string | null;
  period_gain: string | null;
  twr: string | null;
  holdings: Holding[];
  cash: CashBalance[];
  accounts: { id: string; value: string | null }[];
  series: { date: string; value: string | null; twr: string | null; net_flow: string | null }[];
  warnings: string[];
  quality: string;
}
export interface WealthWorkspace {
  data: WealthData;
  portfolio: Portfolio;
}
export interface ImportRequest {
  account_id: string;
  mode: string;
  date_format: string;
  mapping: Record<string, string>;
  mapping_name: string;
  csv: string | null;
  file_token: string | null;
  symbol_mappings: Record<string, string>;
}
export interface ImportRow {
  index: number;
  values: Record<string, string>;
  activity: Activity | null;
  opening: OpeningPosition | null;
  errors: string[];
  duplicate: boolean;
}
export interface ImportReview {
  token: string;
  revision: number;
  filename: string;
  headers: string[];
  mapping: Record<string, string>;
  rows: ImportRow[];
  mode: string;
  account_id: string;
  new_instruments: Instrument[];
}
export interface RefreshResult {
  updated_prices: number;
  updated_fx: number;
  failures: string[];
}
