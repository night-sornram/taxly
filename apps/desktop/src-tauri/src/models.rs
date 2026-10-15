use serde::{Deserialize, Serialize};
use taxly_core::{AmountBasis, Money, TaxpayerFacts};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct YearProfile {
    pub year: u16,
    pub facts: TaxpayerFacts,
    pub income_complete: bool,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncomeSource {
    pub id: String,
    pub tax_year: u16,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncomeEntry {
    pub id: String,
    pub tax_year: u16,
    pub source_id: String,
    pub month: u8,
    pub kind: String,
    pub basis: AmountBasis,
    pub gross: Money,
    pub withholding: Option<Money>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeductionEntry {
    pub id: String,
    pub tax_year: u16,
    pub month: u8,
    pub rule_code: String,
    pub basis: AmountBasis,
    pub amount: Money,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub id: String,
    pub tax_year: u16,
    pub rule_set_id: String,
    pub engine_version: String,
    pub input_json: String,
    pub result_json: String,
    pub input_hash: String,
    pub data_revision: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct YearWorkspace {
    pub year: u16,
    pub profile: Option<YearProfile>,
    pub sources: Vec<IncomeSource>,
    pub income: Vec<IncomeEntry>,
    pub deductions: Vec<DeductionEntry>,
    pub draft: Option<OnboardingDraft>,
}

/// Unfinished questionnaire values are strings, not confirmed financial records.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OnboardingDraft {
    pub step: u8,
    pub facts: TaxpayerFacts,
    pub source_label: String,
    pub monthly_salary: String,
    pub start_month: u8,
    pub end_month: u8,
    pub actual_through: u8,
    pub monthly_withholding: String,
    pub forecast_withholding: bool,
    pub monthly_sso: String,
    pub bonus: String,
    pub bonus_month: u8,
    pub bonus_basis: AmountBasis,
    pub bonus_withholding: String,
    pub income_complete: bool,
}

impl OnboardingDraft {
    pub fn validate(&self) -> crate::error::AppResult<()> {
        if self.step > 7
            || self.actual_through > 12
            || !(1..=12).contains(&self.start_month)
            || !(1..=12).contains(&self.end_month)
            || !(1..=12).contains(&self.bonus_month)
            || self.source_label.chars().count() > 100
            || [
                &self.monthly_salary,
                &self.monthly_withholding,
                &self.monthly_sso,
                &self.bonus,
                &self.bonus_withholding,
            ]
            .iter()
            .any(|value| value.len() > 100)
        {
            return Err(crate::error::AppError::invalid("ข้อมูลแบบสอบถามไม่ถูกต้อง"));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncomeRequest {
    pub id: Option<String>,
    pub year: u16,
    pub source_label: String,
    pub month: u8,
    pub kind: String,
    pub basis: AmountBasis,
    pub gross: Money,
    pub withholding: Option<Money>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeductionRequest {
    pub id: Option<String>,
    pub year: u16,
    pub month: u8,
    pub basis: AmountBasis,
    pub amount: Money,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OnboardingRequest {
    pub year: u16,
    pub facts: TaxpayerFacts,
    pub source_label: String,
    pub monthly_salary: Money,
    pub start_month: u8,
    pub end_month: u8,
    pub actual_through: u8,
    pub monthly_withholding: Option<Money>,
    pub forecast_withholding: bool,
    pub monthly_sso: Option<Money>,
    pub bonus: Option<Money>,
    pub bonus_month: u8,
    pub bonus_basis: AmountBasis,
    pub bonus_withholding: Option<Money>,
    pub income_complete: bool,
}

#[derive(Debug, Serialize)]
pub struct Guidance {
    pub code: String,
    pub title: String,
    pub status: String,
    pub explanation: String,
    pub conditions: String,
    pub documents: Vec<String>,
    pub limit: Option<Money>,
    pub savings: Option<Money>,
    pub source_ids: Vec<String>,
}

pub fn basis_text(basis: AmountBasis) -> &'static str {
    match basis {
        AmountBasis::Actual => "actual",
        AmountBasis::Forecast => "forecast",
    }
}
