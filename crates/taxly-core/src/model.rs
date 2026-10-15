use crate::Money;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncomeCategory {
    Section40_1,
    Section40_2,
    Section40_3,
    Section40_4,
    Section40_5,
    Section40_6,
    Section40_7,
    Section40_8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmountBasis {
    Actual,
    Forecast,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaxpayerFacts {
    pub single: Option<bool>,
    pub under_65: Option<bool>,
    pub domestic_salary_only: Option<bool>,
    pub no_special_cases: Option<bool>,
    pub no_other_deductions: Option<bool>,
    pub social_security_confirmed: bool,
}

impl TaxpayerFacts {
    pub fn scope_issues(&self) -> Vec<String> {
        [
            (self.single, "รองรับการคำนวณเต็มรูปแบบสำหรับผู้โสดเท่านั้น"),
            (self.under_65, "กรณีอายุ 65 ปีขึ้นไปหรือไม่แน่ใจ ต้องตรวจสิทธิ์ยกเว้นเพิ่ม"),
            (
                self.domestic_salary_only,
                "รายได้ประเภทอื่นหรือรายได้ต่างประเทศยังไม่รวมในการคำนวณ",
            ),
            (
                self.no_special_cases,
                "สิทธิพิเศษ เงินก้อนออกจากงาน และผลประโยชน์จากนายจ้างต้องตรวจเพิ่มเติม",
            ),
            (
                self.no_other_deductions,
                "สิทธิ์ลดหย่อนอื่นยังไม่รวม เช่น ประกัน กองทุน ครอบครัว หรือเงินบริจาค",
            ),
        ]
        .into_iter()
        .filter(|(answer, _)| *answer != Some(true))
        .map(|(_, text)| text.to_owned())
        .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeItem {
    pub category: IncomeCategory,
    pub amount: Money,
    pub withholding: Option<Money>,
    pub basis: AmountBasis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contribution {
    pub month: u8,
    pub amount: Money,
    pub basis: AmountBasis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnualTaxInput {
    pub year: u16,
    pub facts: TaxpayerFacts,
    pub income: Vec<IncomeItem>,
    pub social_security: Vec<Contribution>,
    /// User has accounted for all annual income, including any explicitly planned income.
    pub income_complete: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilingAssessment {
    Required,
    NotRequired,
    Undetermined,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "amount", rename_all = "snake_case")]
pub enum SettlementEstimate {
    Payable(Money),
    Overpaid(Money),
    Balanced,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalculationStep {
    pub rule_id: String,
    pub label: String,
    pub formula: String,
    pub amount: Money,
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaxBandResult {
    pub lower: Money,
    pub upper: Option<Money>,
    pub rate: String,
    pub statutory_rate: String,
    pub exempt_amount: Money,
    pub taxable_amount: Money,
    pub tax: Money,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaxCalculation {
    pub year: u16,
    pub rule_set_id: String,
    pub rules_status: String,
    pub rounding_verified: bool,
    pub gross_income: Money,
    pub actual_income: Money,
    pub forecast_income: Money,
    pub expenses: Money,
    pub personal_allowance: Money,
    pub social_security: Money,
    pub social_security_savings: Money,
    pub taxable_income: Money,
    pub annual_tax: Money,
    pub known_withholding: Money,
    pub actual_withholding: Money,
    pub remaining_after_actual_withholding: Money,
    pub forecast_withholding: Money,
    pub unknown_withholding_count: usize,
    pub filing: FilingAssessment,
    pub data_complete: bool,
    pub scope_issues: Vec<String>,
    pub warnings: Vec<String>,
    /// Mathematical difference only; never a filing/payment instruction.
    pub difference_preview: Option<SettlementEstimate>,
    /// Suppressed until the rule pack's rounding policy has been verified.
    pub settlement: Option<SettlementEstimate>,
    pub bands: Vec<TaxBandResult>,
    pub steps: Vec<CalculationStep>,
}
