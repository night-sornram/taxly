use crate::*;

fn sum(mut values: impl Iterator<Item = Money>) -> Result<Money, TaxError> {
    values.try_fold(Money::ZERO, Money::checked_add)
}

fn progressive(base: Money, rules: &TaxRuleSet) -> Result<(Money, Vec<TaxBandResult>), TaxError> {
    let mut lower = Money::ZERO;
    let mut total = Money::ZERO;
    let mut bands = Vec::new();
    for band in &rules.bands {
        let end = band.upper.unwrap_or(base).min(base);
        let amount = end.saturating_sub(lower);
        let exempt_amount = amount.min(rules.net_income_exemption.up_to.saturating_sub(lower));
        let tax = amount
            .saturating_sub(exempt_amount)
            .checked_mul(band.rate)?;
        total = total.checked_add(tax)?;
        bands.push(TaxBandResult {
            lower,
            upper: band.upper,
            rate: if band
                .upper
                .is_some_and(|upper| upper <= rules.net_income_exemption.up_to)
            {
                "0".into()
            } else {
                band.rate.to_string()
            },
            statutory_rate: band.rate.to_string(),
            exempt_amount,
            taxable_amount: amount,
            tax,
        });
        if let Some(upper) = band.upper {
            lower = upper;
        }
    }
    Ok((total, bands))
}

fn difference(tax: Money, paid: Money) -> SettlementEstimate {
    if tax > paid {
        SettlementEstimate::Payable(tax.saturating_sub(paid))
    } else if paid > tax {
        SettlementEstimate::Overpaid(paid.saturating_sub(tax))
    } else {
        SettlementEstimate::Balanced
    }
}

pub fn calculate(input: &AnnualTaxInput, rules: &TaxRuleSet) -> Result<TaxCalculation, TaxError> {
    rules.validate()?;
    if input.year != rules.tax_year {
        return Err(TaxError::YearMismatch);
    }
    if input
        .income
        .iter()
        .any(|item| item.category != IncomeCategory::Section40_1)
    {
        return Err(TaxError::UnsupportedCategory);
    }
    if input
        .social_security
        .iter()
        .any(|item| !(1..=12).contains(&item.month))
    {
        return Err(TaxError::InvalidInput("เดือนต้องอยู่ระหว่าง 1–12"));
    }
    let mut months = [false; 12];
    for item in &input.social_security {
        if months[usize::from(item.month - 1)] {
            return Err(TaxError::InvalidInput("ประกันสังคมซ้ำเดือน"));
        }
        months[usize::from(item.month - 1)] = true;
    }
    let gross = sum(input.income.iter().map(|item| item.amount))?;
    let actual = sum(input
        .income
        .iter()
        .filter(|item| item.basis == AmountBasis::Actual)
        .map(|item| item.amount))?;
    let forecast = sum(input
        .income
        .iter()
        .filter(|item| item.basis == AmountBasis::Forecast)
        .map(|item| item.amount))?;
    let expense = gross
        .checked_mul(rules.expense_rate)?
        .min(rules.expense_cap);
    let after_personal = gross
        .saturating_sub(expense)
        .saturating_sub(rules.personal_allowance);
    // Record actual payments, but do not silently treat legally questionable contributions as eligible.
    let contribution = sum(input.social_security.iter().map(|item| item.amount))?;
    let questionable_sso = input
        .social_security
        .iter()
        .any(|item| item.amount > rules.social_security_monthly_cap)
        || contribution > rules.social_security_annual_cap;
    let allowed_sso = contribution.min(rules.social_security_annual_cap);
    let taxable = after_personal.saturating_sub(allowed_sso);
    let (raw_tax, bands) = progressive(taxable, rules)?;
    let (tax_without_sso, _) = progressive(after_personal, rules)?;
    let rounding_verified = rules.rounding_policy == "floor_annual_tax_baht";
    let tax = if rounding_verified {
        Money::derived(raw_tax.decimal().floor())?
    } else {
        raw_tax
    };
    let actual_withholding = sum(input
        .income
        .iter()
        .filter(|item| item.basis == AmountBasis::Actual)
        .filter_map(|item| item.withholding))?;
    let forecast_withholding = sum(input
        .income
        .iter()
        .filter(|item| item.basis == AmountBasis::Forecast)
        .filter_map(|item| item.withholding))?;
    let known_withholding = actual_withholding.checked_add(forecast_withholding)?;
    let unknown_withholding_count = input
        .income
        .iter()
        .filter(|item| item.withholding.is_none())
        .count();
    let mut scope_issues = input.facts.scope_issues();
    if questionable_sso {
        scope_issues.push("ยอดประกันสังคมเกินกรอบปกติ ต้องตรวจยอดที่มีสิทธิ์ก่อนสรุป".into());
    }
    if !input.facts.social_security_confirmed {
        scope_issues.push("ยังไม่ได้ยืนยันยอดประกันสังคมที่เข้าเงื่อนไข รวมถึงกรณีลดอัตราหรือคืนเงินสมทบ".into());
    }
    let data_complete =
        input.income_complete && unknown_withholding_count == 0 && scope_issues.is_empty();
    let filing = if !scope_issues.is_empty() {
        FilingAssessment::Undetermined
    } else if actual > rules.filing_threshold {
        FilingAssessment::Required
    } else if input.income_complete && forecast == Money::ZERO {
        if gross > rules.filing_threshold {
            FilingAssessment::Required
        } else {
            FilingAssessment::NotRequired
        }
    } else {
        FilingAssessment::Undetermined
    };
    let difference_preview = data_complete.then(|| difference(tax, known_withholding));
    let settlement = if rounding_verified && rules.review_state == "verified_scope" {
        difference_preview.clone()
    } else {
        None
    };
    let mut warnings = rules.limitations.clone();
    if !input.income_complete {
        warnings.push("ยังไม่ได้ยืนยันว่าบันทึกหรือประมาณรายได้ทั้งปีครบแล้ว".into());
    }
    if unknown_withholding_count > 0 {
        warnings.push("ยังมีรายการที่ไม่ทราบภาษีหัก ณ ที่จ่าย จึงยังสรุปส่วนต่างทั้งปีไม่ได้".into());
    }
    if input
        .income
        .iter()
        .any(|item| item.withholding.is_some_and(|paid| paid > item.amount))
    {
        warnings.push("พบภาษีหัก ณ ที่จ่ายสูงกว่ารายได้ในบางรายการ โปรดตรวจเอกสาร".into());
    }
    let steps = vec![
        CalculationStep {
            rule_id: "salary_gross".into(),
            label: "รวมรายได้ก่อนหักจากทุกนายจ้าง".into(),
            formula: "เงินเดือน + โบนัส (ยอดจริงและคาดการณ์)".into(),
            amount: gross,
            source_ids: vec!["rd91".into()],
        },
        CalculationStep {
            rule_id: "salary_expense".into(),
            label: "หักค่าใช้จ่ายตามกฎหมาย".into(),
            formula: format!(
                "รายได้ × {} ไม่เกิน {} บาท รวมทุกนายจ้าง",
                rules.expense_rate, rules.expense_cap
            ),
            amount: expense,
            source_ids: vec!["rd_expense".into()],
        },
        CalculationStep {
            rule_id: "personal_allowance".into(),
            label: "หักลดหย่อนส่วนตัว".into(),
            formula: "ใช้สิทธิ์ครั้งเดียวต่อปี".into(),
            amount: rules.personal_allowance,
            source_ids: vec!["rd_code".into()],
        },
        CalculationStep {
            rule_id: "social_security".into(),
            label: "หักประกันสังคมที่บันทึก".into(),
            formula: "ยอดจ่ายที่เข้าเงื่อนไข ภายใต้กรอบของปีภาษี".into(),
            amount: allowed_sso,
            source_ids: vec!["rd91".into(), "sso".into()],
        },
        CalculationStep {
            rule_id: "taxable_income".into(),
            label: "เงินได้สุทธิที่ใช้คำนวณ".into(),
            formula: "รายได้ − ค่าใช้จ่าย − ส่วนตัว − ประกันสังคม (ขั้นต่ำ 0)".into(),
            amount: taxable,
            source_ids: vec!["rd91".into()],
        },
        CalculationStep {
            rule_id: "first_net_income_exemption".into(),
            label: "ยกเว้นเงินได้สุทธิช่วงแรก".into(),
            formula: format!(
                "เงินได้สุทธิส่วนแรกไม่เกิน {} บาทได้รับยกเว้นภาษี แยกจากอัตราตามกฎหมาย",
                rules.net_income_exemption.up_to
            ),
            amount: taxable.min(rules.net_income_exemption.up_to),
            source_ids: vec![rules.net_income_exemption.source_id.clone()],
        },
        CalculationStep {
            rule_id: "progressive_tax".into(),
            label: "ภาษีตามขั้นบันได".into(),
            formula: "รวมภาษีของเงินได้แต่ละช่วง ไม่ใช่อัตราสูงสุดคูณรายได้ทั้งหมด".into(),
            amount: tax,
            source_ids: vec!["rd_rates".into(), "rd91".into(), "rd_rounding".into()],
        },
        CalculationStep {
            rule_id: "withholding_credit".into(),
            label: "ภาษีที่หักไว้และที่คาดว่าจะถูกหัก".into(),
            formula: "เป็นเครดิตหลังคำนวณภาษี ไม่ใช่ค่าลดหย่อน".into(),
            amount: known_withholding,
            source_ids: vec!["rd_code".into()],
        },
    ];
    Ok(TaxCalculation {
        year: input.year,
        rule_set_id: rules.rule_set_id.clone(),
        rules_status: rules.review_state.clone(),
        rounding_verified,
        gross_income: gross,
        actual_income: actual,
        forecast_income: forecast,
        expenses: expense,
        personal_allowance: rules.personal_allowance,
        social_security: allowed_sso,
        social_security_savings: tax_without_sso.saturating_sub(raw_tax),
        taxable_income: taxable,
        annual_tax: tax,
        known_withholding,
        actual_withholding,
        remaining_after_actual_withholding: tax.saturating_sub(actual_withholding),
        forecast_withholding,
        unknown_withholding_count,
        filing,
        data_complete,
        scope_issues,
        warnings,
        difference_preview,
        settlement,
        bands,
        steps,
    })
}
