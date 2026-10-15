use proptest::prelude::*;
use std::str::FromStr;
use taxly_core::*;

fn m(s: &str) -> Money {
    Money::from_str(s).unwrap()
}
fn rules() -> TaxRuleSet {
    TaxRuleSet::from_json(include_str!("../../../rules/2025/salary-v1.json")).unwrap()
}
fn input(gross: &str, sso: &str, withheld: Option<&str>) -> AnnualTaxInput {
    AnnualTaxInput {
        year: 2025,
        facts: TaxpayerFacts {
            single: Some(true),
            under_65: Some(true),
            domestic_salary_only: Some(true),
            no_special_cases: Some(true),
            no_other_deductions: Some(true),
            social_security_confirmed: true,
        },
        income: vec![IncomeItem {
            category: IncomeCategory::Section40_1,
            amount: m(gross),
            withholding: withheld.map(m),
            basis: AmountBasis::Actual,
        }],
        social_security: (1..=12)
            .map(|month| Contribution {
                month,
                amount: m(sso)
                    .checked_mul(
                        rust_decimal::Decimal::from_str("0.0833333333333333333333333333").unwrap(),
                    )
                    .unwrap(),
                basis: AmountBasis::Actual,
            })
            .collect(),
        income_complete: true,
    }
}
fn annual_input(gross: &str, sso_month: &str, withheld: Option<&str>) -> AnnualTaxInput {
    let mut data = input(gross, "0", withheld);
    for item in &mut data.social_security {
        item.amount = m(sso_month);
    }
    data
}

#[test]
fn official_salary_examples() {
    for (gross, monthly, base, tax, paid, preview) in [
        ("120000", "0", "0", "0", "0", SettlementEstimate::Balanced),
        (
            "120001",
            "0",
            "0.50",
            "0",
            "0",
            SettlementEstimate::Balanced,
        ),
        (
            "180000",
            "0",
            "30000",
            "0",
            "0",
            SettlementEstimate::Balanced,
        ),
        (
            "319000",
            "750",
            "150000",
            "0",
            "3000",
            SettlementEstimate::Overpaid(m("3000")),
        ),
        (
            "360000",
            "750",
            "191000",
            "2050",
            "3000",
            SettlementEstimate::Overpaid(m("950")),
        ),
        (
            "600000",
            "750",
            "431000",
            "20600",
            "18000",
            SettlementEstimate::Payable(m("2600")),
        ),
    ] {
        let out = calculate(&annual_input(gross, monthly, Some(paid)), &rules()).unwrap();
        assert_eq!(out.taxable_income, m(base));
        assert_eq!(out.annual_tax, m(tax));
        assert_eq!(out.difference_preview, Some(preview));
        assert!(out.settlement.is_none(), "rounding gate must stay closed");
    }
}

#[test]
fn all_bracket_boundaries_and_neighbors() {
    let rules = rules();
    for (base, tax, rate_before, rate_after) in [
        (150000, 0, "0", "0.05"),
        (300000, 7500, "0.05", "0.10"),
        (500000, 27500, "0.10", "0.15"),
        (750000, 65000, "0.15", "0.20"),
        (1000000, 115000, "0.20", "0.25"),
        (2000000, 365000, "0.25", "0.30"),
        (5000000, 1265000, "0.30", "0.35"),
    ] {
        let boundary = calculate(
            &annual_input(&(base + 160000).to_string(), "0", Some("0")),
            &rules,
        )
        .unwrap();
        let lower = calculate(
            &annual_input(&format!("{}.99", base + 159999), "0", Some("0")),
            &rules,
        )
        .unwrap();
        let upper = calculate(
            &annual_input(&format!("{}.01", base + 160000), "0", Some("0")),
            &rules,
        )
        .unwrap();
        assert_eq!(boundary.annual_tax, m(&tax.to_string()));
        assert_eq!(
            boundary.annual_tax.decimal() - lower.annual_tax.decimal(),
            rust_decimal::Decimal::from_str(rate_before).unwrap()
                / rust_decimal::Decimal::from(100)
        );
        assert_eq!(
            upper.annual_tax.decimal() - boundary.annual_tax.decimal(),
            rust_decimal::Decimal::from_str(rate_after).unwrap() / rust_decimal::Decimal::from(100)
        );
    }
}

#[test]
fn filing_is_separate_from_tax() {
    assert_eq!(
        calculate(&annual_input("120000", "0", Some("0")), &rules())
            .unwrap()
            .filing,
        FilingAssessment::NotRequired
    );
    assert_eq!(
        calculate(&annual_input("120001", "0", Some("0")), &rules())
            .unwrap()
            .filing,
        FilingAssessment::Required
    );
    let mut data = annual_input("120000", "0", Some("0"));
    data.income_complete = false;
    assert_eq!(
        calculate(&data, &rules()).unwrap().filing,
        FilingAssessment::Undetermined
    );
}

#[test]
fn unknown_credits_and_unsupported_facts_suppress_difference() {
    let data = annual_input("360000", "750", None);
    let out = calculate(&data, &rules()).unwrap();
    assert!(out.difference_preview.is_none());
    assert_eq!(out.unknown_withholding_count, 1);
    let mut data = annual_input("360000", "750", Some("3000"));
    data.facts.single = Some(false);
    let out = calculate(&data, &rules()).unwrap();
    assert!(out.difference_preview.is_none());
    assert!(!out.scope_issues.is_empty());
}

#[test]
fn supported_years_and_social_security_are_distinct() {
    let rules26 =
        TaxRuleSet::from_json(include_str!("../../../rules/2026/salary-v1.json")).unwrap();
    let mut data = annual_input("360000", "875", Some("3000"));
    data.year = 2026;
    let out = calculate(&data, &rules26).unwrap();
    assert_eq!(out.annual_tax, m("1975"));
    assert!(out.settlement.is_none());
    assert_eq!(
        calculate(&data, &rules()).unwrap_err(),
        TaxError::YearMismatch
    );
    data.income[0].category = IncomeCategory::Section40_2;
    assert_eq!(
        calculate(&data, &rules26).unwrap_err(),
        TaxError::UnsupportedCategory
    );
}

#[test]
fn contribution_duplicates_and_excess_require_review() {
    let mut data = annual_input("360000", "750", Some("0"));
    data.social_security.push(data.social_security[0].clone());
    assert!(matches!(
        calculate(&data, &rules()),
        Err(TaxError::InvalidInput(_))
    ));
    data.social_security.pop();
    data.social_security[0].amount = m("751");
    assert!(
        calculate(&data, &rules())
            .unwrap()
            .difference_preview
            .is_none()
    );
}

#[test]
fn inputs_are_exact_and_checked() {
    for invalid in [
        "-1", "1.001", "1e3", "NaN", "", ".5", "1.", "1,000", " 2", "+1",
    ] {
        assert!(invalid.parse::<Money>().is_err(), "{invalid}");
    }
    assert_eq!(m("0.01").satang().unwrap(), 1);
    assert_eq!(
        serde_json::to_string(&m("90071992547409.91")).unwrap(),
        "\"90071992547409.91\""
    );
    assert!(
        Money::from_satang(i64::MAX)
            .unwrap()
            .checked_add(m("0.01"))
            .is_err()
    );
    assert!(serde_json::from_str::<Money>("10.25").is_err());
}

#[test]
fn malformed_rules_rejected() {
    let mut r = rules();
    r.bands[0].upper = Some(m("0"));
    assert_eq!(r.validate(), Err(TaxError::InvalidRules));
    let mut r = rules();
    r.rounding_policy = "guess".into();
    assert_eq!(r.validate(), Err(TaxError::InvalidRules));
    let mut r = rules();
    r.net_income_exemption.source_id = "missing-source".into();
    assert_eq!(r.validate(), Err(TaxError::InvalidRules));
    let mut r = rules();
    r.net_income_exemption.up_to = m("150001");
    assert_eq!(r.validate(), Err(TaxError::InvalidRules));
}

#[test]
fn statutory_rate_and_first_net_income_exemption_are_distinct() {
    let r = rules();
    assert_eq!(r.bands[0].rate.to_string(), "0.05");
    let out = calculate(&annual_input("310000", "0", Some("0")), &r).unwrap();
    assert_eq!(out.taxable_income, m("150000"));
    assert_eq!(out.bands[0].statutory_rate, "0.05");
    assert_eq!(out.bands[0].rate, "0");
    assert_eq!(out.bands[0].exempt_amount, m("150000"));
    assert_eq!(out.annual_tax, Money::ZERO);
    let above = calculate(&annual_input("310000.01", "0", Some("0")), &r).unwrap();
    assert_eq!(above.annual_tax.decimal().to_string(), "0.0005");
}

proptest! {
    #[test]
    fn splitting_salary_and_credit_changes_are_consistent(gross in 200000i64..100000000, credit in 0i64..100000) {
        let data=annual_input(&gross.to_string(),"0",Some("0"));
        let first=calculate(&data,&rules()).unwrap();
        let mut split=data.clone(); split.income[0].amount=m(&(gross/2).to_string());
        split.income.push(IncomeItem{amount:m(&(gross-gross/2).to_string()),..data.income[0].clone()});
        let split_out=calculate(&split,&rules()).unwrap();
        prop_assert_eq!(first.annual_tax,split_out.annual_tax); prop_assert_eq!(first.expenses,split_out.expenses);
        split.income.reverse(); prop_assert_eq!(calculate(&split,&rules()).unwrap().annual_tax,first.annual_tax);
        let mut paid=data.clone(); paid.income[0].withholding=Some(m(&credit.to_string()));
        prop_assert_eq!(calculate(&paid,&rules()).unwrap().annual_tax,first.annual_tax);
        let mut more=data; more.income[0].amount=m(&(gross+1).to_string());
        prop_assert!(calculate(&more,&rules()).unwrap().annual_tax>=first.annual_tax);
    }
}

#[test]
fn other_income_is_included_in_full_without_expense_deduction() {
    let mut data = annual_input("300000", "0", Some("0"));
    data.income.push(IncomeItem {
        category: IncomeCategory::Section40_8,
        amount: m("100000"),
        withholding: Some(m("3000")),
        basis: AmountBasis::Actual,
    });
    let out = calculate(&data, &rules()).unwrap();
    assert_eq!(out.gross_income, m("400000"));
    // Expense stays computed from the 40(1) salary alone (cap reached).
    assert_eq!(out.expenses, m("100000"));
    assert!(out
        .scope_issues
        .iter()
        .any(|issue| issue.contains("รายได้อื่นถูกนำรวมเต็มจำนวน")));
}

#[test]
fn section_other_than_40_1_and_40_8_is_still_rejected() {
    let mut data = annual_input("300000", "0", None);
    data.income[0].category = IncomeCategory::Section40_2;
    assert!(calculate(&data, &rules()).is_err());
}
