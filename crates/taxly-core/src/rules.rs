use crate::{Money, TaxError};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleSource {
    pub id: String,
    pub authority: String,
    pub title: String,
    pub url: String,
    pub locator: String,
    pub published_on: Option<String>,
    pub checked_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxBand {
    pub upper: Option<Money>,
    #[serde(with = "rust_decimal::serde::str")]
    pub rate: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetIncomeExemption {
    pub up_to: Money,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxRuleSet {
    pub rule_set_id: String,
    pub tax_year: u16,
    pub version: String,
    pub schema_version: u32,
    pub supported_scope: String,
    pub effective_from: String,
    pub effective_to: String,
    pub review_state: String,
    pub verified_at: String,
    pub rounding_policy: String,
    #[serde(with = "rust_decimal::serde::str")]
    pub expense_rate: Decimal,
    pub expense_cap: Money,
    pub personal_allowance: Money,
    pub filing_threshold: Money,
    pub social_security_monthly_cap: Money,
    pub social_security_annual_cap: Money,
    pub bands: Vec<TaxBand>,
    pub net_income_exemption: NetIncomeExemption,
    pub sources: Vec<RuleSource>,
    pub limitations: Vec<String>,
}

impl TaxRuleSet {
    pub fn from_json(json: &str) -> Result<Self, TaxError> {
        let rules: Self = serde_json::from_str(json).map_err(|_| TaxError::InvalidRules)?;
        rules.validate()?;
        Ok(rules)
    }

    pub fn validate(&self) -> Result<(), TaxError> {
        if self.schema_version != 1
            || !(2025..=2026).contains(&self.tax_year)
            || self.supported_scope != "single_domestic_salary_under65"
            || !["verified_scope", "provisional"].contains(&self.review_state.as_str())
            || !["unverified", "floor_annual_tax_baht"].contains(&self.rounding_policy.as_str())
            || self.expense_rate < Decimal::ZERO
            || self.expense_rate > Decimal::ONE
            || self.bands.is_empty()
            || self.bands.len() > 20
            || self.sources.is_empty()
        {
            return Err(TaxError::InvalidRules);
        }
        // The MVP splits the statutory 5% band at the exemption boundary.
        // Keep the exemption separate from the statutory rate, with its own source.
        if self.net_income_exemption.up_to == Money::ZERO
            || self.bands[0].upper != Some(self.net_income_exemption.up_to)
            || !self
                .sources
                .iter()
                .any(|source| source.id == self.net_income_exemption.source_id)
        {
            return Err(TaxError::InvalidRules);
        }
        let mut previous = Money::ZERO;
        let mut previous_rate = Decimal::ZERO;
        for (i, band) in self.bands.iter().enumerate() {
            if band.rate < previous_rate || band.rate > Decimal::ONE {
                return Err(TaxError::InvalidRules);
            }
            match band.upper {
                Some(upper) if upper > previous && i + 1 < self.bands.len() => previous = upper,
                None if i + 1 == self.bands.len() => (),
                _ => return Err(TaxError::InvalidRules),
            }
            previous_rate = band.rate;
        }
        Ok(())
    }
}
