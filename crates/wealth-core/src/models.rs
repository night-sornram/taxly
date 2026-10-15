use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Instrument {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub exchange: String,
    pub provider_symbol: String,
}

/// All numeric fields cross IPC as decimal strings. `amount` is the FINAL
/// cash paid/received, including fee/tax. Null derives it for a buy/sell.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Activity {
    pub id: String,
    pub account_id: String,
    pub date: String,
    pub kind: String,
    pub instrument_id: Option<String>,
    pub currency: String,
    pub quantity: Option<String>,
    pub unit_price: Option<String>,
    pub amount: Option<String>,
    pub fee: String,
    pub tax: String,
    pub related_account_id: Option<String>,
    pub counter_currency: Option<String>,
    pub counter_amount: Option<String>,
    pub sequence: i64,
    pub note: String,
}

/// Instrument None represents opening cash (`quantity` is the cash amount).
/// All opening records for an account share a single baseline date.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OpeningPosition {
    pub id: String,
    pub account_id: String,
    pub date: String,
    pub instrument_id: Option<String>,
    pub currency: String,
    pub quantity: String,
    pub cost_basis: Option<String>,
    pub cost_basis_base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Price {
    pub instrument_id: String,
    pub date: String,
    pub close: String,
    pub source: String,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FxRate {
    pub from_currency: String,
    pub to_currency: String,
    pub date: String,
    pub rate: String,
    pub source: String,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WealthPreferences {
    pub reporting_currency: String,
    pub market_data_enabled: bool,
}
impl Default for WealthPreferences {
    fn default() -> Self {
        Self {
            reporting_currency: "THB".into(),
            market_data_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImportMapping {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub date_format: String,
    pub columns: BTreeMap<String, String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WealthData {
    pub revision: i64,
    pub accounts: Vec<Account>,
    pub instruments: Vec<Instrument>,
    pub activities: Vec<Activity>,
    pub opening_positions: Vec<OpeningPosition>,
    pub prices: Vec<Price>,
    pub fx_rates: Vec<FxRate>,
    pub import_mappings: Vec<ImportMapping>,
    pub preferences: WealthPreferences,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioFilter {
    #[serde(default)]
    pub account_ids: Vec<String>,
    pub start_date: Option<String>,
    pub end_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Holding {
    pub account_id: String,
    pub instrument_id: String,
    pub quantity: String,
    pub cost_basis: Option<String>,
    pub cost_basis_base: Option<String>,
    pub market_price: Option<String>,
    pub market_value: Option<String>,
    pub market_value_base: Option<String>,
    pub unrealized_gain: Option<String>,
    pub realized_gain: Option<String>,
    pub allocation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashBalance {
    pub account_id: String,
    pub currency: String,
    pub amount: String,
    pub value_base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSummary {
    pub id: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValuationPoint {
    pub date: String,
    pub value: Option<String>,
    pub twr: Option<String>,
    pub net_flow: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Portfolio {
    pub reporting_currency: String,
    pub as_of: String,
    pub start_date: Option<String>,
    pub earliest_date: Option<String>,
    pub total_value: Option<String>,
    pub known_value: String,
    pub cash_value: Option<String>,
    pub period_gain: Option<String>,
    pub twr: Option<String>,
    pub holdings: Vec<Holding>,
    pub cash: Vec<CashBalance>,
    pub accounts: Vec<AccountSummary>,
    pub series: Vec<ValuationPoint>,
    pub warnings: Vec<String>,
    pub quality: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WealthWorkspace {
    pub data: WealthData,
    pub portfolio: Portfolio,
}
