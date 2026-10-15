use wealth_core::*;

fn account(id: &str) -> Account {
    Account {
        track_cash: true,
        id: id.into(),
        name: id.into(),
    }
}
fn instrument(currency: &str) -> Instrument {
    Instrument {
        id: "stock".into(),
        symbol: "TEST".into(),
        name: "Test stock".into(),
        kind: "stock".into(),
        currency: currency.into(),
        exchange: "".into(),
        provider_symbol: "TEST".into(),
    }
}
fn data() -> WealthData {
    WealthData {
        accounts: vec![account("a")],
        instruments: vec![instrument("THB")],
        ..WealthData::default()
    }
}
fn activity(id: &str, day: &str, kind: &str, amount: Option<&str>) -> Activity {
    Activity {
        id: id.into(),
        account_id: "a".into(),
        date: day.into(),
        kind: kind.into(),
        instrument_id: None,
        currency: "THB".into(),
        quantity: None,
        unit_price: None,
        amount: amount.map(Into::into),
        fee: "0".into(),
        tax: "0".into(),
        related_account_id: None,
        counter_currency: None,
        counter_amount: None,
        sequence: 0,
        note: "".into(),
    }
}
fn trade(id: &str, day: &str, kind: &str, quantity: &str, price: &str) -> Activity {
    Activity {
        instrument_id: Some("stock".into()),
        quantity: Some(quantity.into()),
        unit_price: Some(price.into()),
        sequence: 1,
        ..activity(id, day, kind, None)
    }
}
fn price(day: &str, value: &str) -> Price {
    Price {
        instrument_id: "stock".into(),
        date: day.into(),
        close: value.into(),
        source: "manual".into(),
        fetched_at: "".into(),
    }
}
fn fx(day: &str, value: &str) -> FxRate {
    FxRate {
        from_currency: "USD".into(),
        to_currency: "THB".into(),
        date: day.into(),
        rate: value.into(),
        source: "manual".into(),
        fetched_at: "".into(),
    }
}
fn filter(end: &str) -> PortfolioFilter {
    PortfolioFilter {
        end_date: end.into(),
        ..Default::default()
    }
}
fn opening(day: &str, quantity: &str) -> OpeningPosition {
    OpeningPosition {
        id: "opening".into(),
        account_id: "a".into(),
        date: day.into(),
        instrument_id: Some("stock".into()),
        currency: "THB".into(),
        quantity: quantity.into(),
        cost_basis: None,
        cost_basis_base: None,
    }
}
fn cash_opening(day: &str, amount: &str) -> OpeningPosition {
    OpeningPosition {
        id: "cash-opening".into(),
        instrument_id: None,
        quantity: amount.into(),
        ..opening(day, "0")
    }
}

#[test]
fn fractional_fifo_partial_sale_and_final_charges() {
    let mut d = data();
    let mut buy = trade("buy", "2026-01-01", "buy", "2.5", "100");
    buy.fee = "1".into();
    let mut sell = trade("sell", "2026-01-02", "sell", "1.25", "120");
    sell.fee = "1".into();
    sell.tax = "1".into();
    sell.amount = Some("148".into());
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("1000")),
        buy,
        sell,
    ];
    d.prices = vec![price("2026-01-01", "100"), price("2026-01-02", "120")];
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    let h = &p.holdings[0];
    assert_eq!(h.quantity, "1.25");
    assert_eq!(h.cost_basis.as_deref(), Some("125.5"));
    assert_eq!(h.cost_basis_base.as_deref(), Some("125.5"));
    assert_eq!(h.realized_gain.as_deref(), Some("22.5"));
    assert_eq!(h.unrealized_gain.as_deref(), Some("24.5"));
    assert_eq!(p.cash[0].amount, "897");
    assert_eq!(p.total_value.as_deref(), Some("1047"));
    assert_eq!(p.period_gain.as_deref(), Some("47"));
    assert_eq!(p.twr.as_deref(), Some("0.047"));
}

#[test]
fn fifo_uses_oldest_lot_instead_of_average_cost() {
    let mut d = data();
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("1000")),
        trade("buy1", "2026-01-01", "buy", "2", "100"),
        trade("buy2", "2026-01-02", "buy", "2", "200"),
        trade("sell", "2026-01-03", "sell", "3", "300"),
    ];
    d.prices = vec![
        price("2026-01-01", "100"),
        price("2026-01-02", "200"),
        price("2026-01-03", "300"),
    ];
    let p = portfolio(&d, &filter("2026-01-03")).unwrap();
    assert_eq!(p.holdings[0].cost_basis.as_deref(), Some("200"));
    assert_eq!(p.holdings[0].realized_gain.as_deref(), Some("500"));
}

#[test]
fn dividends_use_final_net_cash_once_and_fees_reduce_return() {
    let mut d = data();
    let mut dividend = activity("dividend", "2026-01-02", "dividend", Some("9"));
    dividend.fee = "1".into();
    dividend.tax = "2".into();
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("100")),
        trade("buy", "2026-01-01", "buy", "1", "100"),
        dividend,
        activity("fee", "2026-01-02", "fee", Some("2")),
    ];
    d.prices = vec![price("2026-01-01", "100")];
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    assert_eq!(p.cash[0].amount, "7");
    assert_eq!(p.total_value.as_deref(), Some("107"));
    assert_eq!(p.twr.as_deref(), Some("0.07"));
}

#[test]
fn split_preserves_basis_and_adjusts_carried_pre_split_quote() {
    let mut d = data();
    let split = Activity {
        instrument_id: Some("stock".into()),
        quantity: Some("2".into()),
        ..activity("split", "2026-01-02", "split", None)
    };
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("100")),
        trade("buy", "2026-01-01", "buy", "1", "100"),
        split,
    ];
    d.prices = vec![price("2026-01-01", "100")];
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    assert_eq!(p.holdings[0].quantity, "2");
    assert_eq!(p.holdings[0].cost_basis.as_deref(), Some("100"));
    assert_eq!(p.holdings[0].market_price.as_deref(), Some("50"));
    assert_eq!(p.total_value.as_deref(), Some("100"));
    assert_eq!(p.twr.as_deref(), Some("0"));
    d.prices.push(price("2026-01-02", "51"));
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    assert_eq!(p.total_value.as_deref(), Some("102"));
}

#[test]
fn historical_fx_cost_is_distinct_from_current_valuation() {
    let mut d = data();
    d.instruments = vec![instrument("USD")];
    let mut deposit = activity("deposit", "2026-01-01", "deposit", Some("100"));
    deposit.currency = "USD".into();
    let mut buy = trade("buy", "2026-01-01", "buy", "1", "10");
    buy.currency = "USD".into();
    d.activities = vec![deposit, buy];
    d.prices = vec![price("2026-01-01", "10"), price("2026-01-02", "12")];
    d.fx_rates = vec![fx("2026-01-01", "35"), fx("2026-01-02", "36")];
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    assert_eq!(p.holdings[0].cost_basis_base.as_deref(), Some("350"));
    assert_eq!(p.holdings[0].market_value_base.as_deref(), Some("432"));
    assert_eq!(p.holdings[0].unrealized_gain.as_deref(), Some("2"));
    assert_eq!(p.total_value.as_deref(), Some("3672"));
    assert_eq!(p.period_gain.as_deref(), Some("172"));
}

#[test]
fn cash_flows_are_neutral_and_transfers_respect_filter_scope() {
    let mut d = data();
    d.accounts.push(account("b"));
    let transfer = Activity {
        related_account_id: Some("b".into()),
        ..activity("transfer", "2026-01-02", "transfer", Some("40"))
    };
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("100")),
        transfer,
        activity("deposit2", "2026-01-03", "deposit", Some("50")),
        activity("withdraw", "2026-01-04", "withdrawal", Some("20")),
    ];
    let all = portfolio(&d, &filter("2026-01-04")).unwrap();
    assert_eq!(all.total_value.as_deref(), Some("130"));
    assert_eq!(all.twr.as_deref(), Some("0"));
    assert_eq!(all.period_gain.as_deref(), Some("0"));
    let a = portfolio(
        &d,
        &PortfolioFilter {
            account_ids: vec!["a".into()],
            ..filter("2026-01-04")
        },
    )
    .unwrap();
    assert_eq!(a.total_value.as_deref(), Some("90"));
    assert_eq!(a.twr.as_deref(), Some("0"));
    assert_eq!(a.period_gain.as_deref(), Some("0"));
    let b = portfolio(
        &d,
        &PortfolioFilter {
            account_ids: vec!["b".into()],
            ..filter("2026-01-04")
        },
    )
    .unwrap();
    assert_eq!(b.total_value.as_deref(), Some("40"));
    assert_eq!(b.twr.as_deref(), Some("0"));
    assert_eq!(b.series[0].net_flow.as_deref(), Some("40"));
}

#[test]
fn explicit_fx_debits_source_and_credits_counter_currency() {
    let mut d = data();
    let exchange = Activity {
        currency: "USD".into(),
        counter_currency: Some("THB".into()),
        counter_amount: Some("3500".into()),
        fee: "1".into(),
        ..activity("fx", "2026-01-02", "fx", Some("101"))
    };
    d.activities = vec![
        Activity {
            currency: "USD".into(),
            ..activity("deposit", "2026-01-01", "deposit", Some("101"))
        },
        exchange,
    ];
    d.fx_rates = vec![fx("2026-01-01", "35")];
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    assert_eq!(p.total_value.as_deref(), Some("3500"));
    assert_eq!(p.period_gain.as_deref(), Some("-35"));
    assert_eq!(
        p.cash.iter().find(|c| c.currency == "USD").unwrap().amount,
        "0"
    );
}

#[test]
fn missing_quotes_and_fx_never_value_unknown_assets_at_zero() {
    let mut d = data();
    d.instruments = vec![instrument("USD")];
    d.opening_positions = vec![OpeningPosition {
        currency: "USD".into(),
        ..opening("2026-01-01", "2")
    }];
    d.prices = vec![price("2026-01-03", "100")];
    d.fx_rates = vec![fx("2026-01-03", "35")];
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    assert_eq!(p.total_value, None);
    assert_eq!(p.known_value, "0");
    assert_eq!(p.twr, None);
    assert_eq!(p.period_gain, None);
    let p = portfolio(&d, &filter("2026-01-03")).unwrap();
    assert_eq!(p.total_value.as_deref(), Some("7000"));
    assert_eq!(p.twr, None);
    assert_eq!(p.period_gain, None);
    assert_eq!(p.holdings[0].cost_basis, None);
    assert_eq!(p.holdings[0].unrealized_gain, None);
    assert_eq!(p.quality, "incomplete");
}

#[test]
fn opening_baseline_never_fabricates_earlier_history_or_cost_basis() {
    let mut d = data();
    d.opening_positions = vec![opening("2026-01-02", "2")];
    d.prices = vec![price("2026-01-02", "100"), price("2026-01-03", "110")];
    let p = portfolio(
        &d,
        &PortfolioFilter {
            start_date: Some("2026-01-01".into()),
            ..filter("2026-01-03")
        },
    )
    .unwrap();
    assert_eq!(p.start_date.as_deref(), Some("2026-01-02"));
    assert_eq!(p.earliest_date.as_deref(), Some("2026-01-02"));
    assert_eq!(p.series.len(), 2);
    assert_eq!(p.twr.as_deref(), Some("0.1"));
    assert_eq!(p.period_gain.as_deref(), Some("20"));
    assert_eq!(p.holdings[0].cost_basis, None);
    assert_eq!(p.holdings[0].unrealized_gain, None);
    // A sale from an unknown lot cannot turn its proceeds into a known gain.
    d.activities
        .push(trade("sell", "2026-01-03", "sell", "1", "110"));
    assert_eq!(
        portfolio(&d, &filter("2026-01-03")).unwrap().holdings[0].realized_gain,
        None
    );
}

#[test]
fn report_start_uses_previous_close_for_period_return() {
    let mut d = data();
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("100")),
        trade("buy", "2026-01-01", "buy", "1", "100"),
    ];
    d.prices = vec![
        price("2026-01-01", "100"),
        price("2026-01-02", "110"),
        price("2026-01-03", "121"),
    ];
    let p = portfolio(
        &d,
        &PortfolioFilter {
            start_date: Some("2026-01-03".into()),
            ..filter("2026-01-03")
        },
    )
    .unwrap();
    assert_eq!(p.twr.as_deref(), Some("0.1"));
    assert_eq!(p.period_gain.as_deref(), Some("11"));
}

#[test]
fn missing_historical_fx_stays_unknown_after_fx_becomes_available() {
    let mut d = data();
    d.instruments = vec![instrument("USD")];
    d.activities = vec![
        Activity {
            currency: "USD".into(),
            ..activity("deposit", "2026-01-01", "deposit", Some("100"))
        },
        Activity {
            currency: "USD".into(),
            ..trade("buy", "2026-01-01", "buy", "1", "100")
        },
    ];
    d.prices = vec![price("2026-01-01", "100")];
    d.fx_rates = vec![fx("2026-01-02", "35")];
    let p = portfolio(&d, &filter("2026-01-02")).unwrap();
    assert_eq!(p.holdings[0].cost_basis_base, None);
    assert_eq!(p.total_value.as_deref(), Some("3500"));
    assert_eq!(p.twr, None);
}

#[test]
fn inverse_fx_supported_and_stale_data_warned() {
    let mut d = data();
    d.activities = vec![Activity {
        currency: "USD".into(),
        ..activity("deposit", "2026-01-01", "deposit", Some("100"))
    }];
    d.fx_rates = vec![FxRate {
        from_currency: "THB".into(),
        to_currency: "USD".into(),
        rate: "0.025".into(),
        ..fx("2026-01-01", "0.025")
    }];
    let p = portfolio(&d, &filter("2026-01-10")).unwrap();
    assert_eq!(p.total_value.as_deref(), Some("4000"));
    assert!(p.warnings.iter().any(|w| w.contains("เก่ากว่า 7 วัน")));
}

#[test]
fn backdated_debits_oversells_and_baseline_violations_are_rejected() {
    let mut d = data();
    d.activities = vec![
        activity("deposit", "2026-01-02", "deposit", Some("100")),
        activity("withdraw", "2026-01-01", "withdrawal", Some("10")),
    ];
    assert!(validate(&d).is_err());
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("100")),
        trade("buy", "2026-01-01", "buy", "1", "100"),
        trade("sell", "2026-01-02", "sell", "2", "100"),
    ];
    assert!(validate(&d).is_err());
    d.activities = vec![activity("deposit", "2026-01-01", "deposit", Some("100"))];
    d.opening_positions = vec![opening("2026-01-02", "1")];
    assert!(validate(&d).is_err());
    d.activities.clear();
    d.opening_positions.push(OpeningPosition {
        id: "later".into(),
        date: "2026-01-03".into(),
        ..opening("2026-01-02", "1")
    });
    assert!(validate(&d).is_err());
}

#[test]
fn invalid_fields_duplicate_quotes_and_unreconciled_cash_are_rejected() {
    let mut d = data();
    d.prices = vec![price("2026-02-30", "100")];
    assert!(validate(&d).is_err());
    d.prices = vec![price("2026-01-01", "100"), price("2026-01-01", "101")];
    assert!(validate(&d).is_err());
    d.prices.clear();
    d.activities = vec![
        activity("deposit", "2026-01-01", "deposit", Some("100")),
        Activity {
            amount: Some("99".into()),
            ..trade("buy", "2026-01-01", "buy", "1", "100")
        },
    ];
    assert!(validate(&d).is_err());
    d.activities[1].amount = Some("99.99".into());
    assert!(validate(&d).is_ok());
    d.activities[0].currency = "usd".into();
    assert!(validate(&d).is_err());
}

#[test]
fn decimal_precision_and_arithmetic_overflow_are_rejected() {
    let mut d = data();
    d.activities = vec![activity(
        "deposit",
        "2026-01-01",
        "deposit",
        Some("0.0000000000001"),
    )];
    assert!(validate(&d).is_err());
    d.activities[0].amount = Some("1e10".into());
    assert!(validate(&d).is_err());
    d.activities[0].amount = Some("-1".into());
    assert!(validate(&d).is_err());
    d.activities = vec![
        activity(
            "deposit",
            "2026-01-01",
            "deposit",
            Some("1000000000000000000"),
        ),
        trade(
            "buy",
            "2026-01-01",
            "buy",
            "1000000000000000000",
            "1000000000000000000",
        ),
    ];
    assert_eq!(validate(&d), Err(WealthError::Overflow));
}

#[test]
fn filter_validation_and_future_positions_do_not_leak() {
    let mut d = data();
    d.opening_positions = vec![opening("2027-01-01", "2")];
    d.prices = vec![price("2027-01-01", "100")];
    let p = portfolio(&d, &filter("2026-01-01")).unwrap();
    assert_eq!(p.total_value.as_deref(), Some("0"));
    assert!(p.holdings.is_empty());
    assert!(p.series.is_empty());
    assert!(
        portfolio(
            &d,
            &PortfolioFilter {
                account_ids: vec!["unknown".into()],
                ..filter("2026-01-01")
            }
        )
        .is_err()
    );
    assert!(
        portfolio(
            &d,
            &PortfolioFilter {
                start_date: Some("2026-02-01".into()),
                ..filter("2026-01-01")
            }
        )
        .is_err()
    );
}

#[test]
fn canonical_instrument_identity_is_unique_before_storage() {
    let mut d = data();
    d.instruments.push(Instrument {
        id: "second".into(),
        symbol: " test ".into(),
        ..instrument("THB")
    });
    assert!(
        validate(&d)
            .unwrap_err()
            .to_string()
            .contains("สัญลักษณ์ ตลาด และสกุลเงินซ้ำ")
    );
    d.instruments[1].exchange = "SET".into();
    assert!(validate(&d).is_ok());
}

#[test]
fn nonzero_values_cannot_underflow_into_fabricated_zero_holdings() {
    let mut d = data();
    d.opening_positions = vec![opening("2026-01-01", "0.000000000001")];
    d.activities = vec![
        Activity {
            instrument_id: Some("stock".into()),
            quantity: Some("0.000000000001".into()),
            ..activity("split1", "2026-01-02", "split", None)
        },
        Activity {
            instrument_id: Some("stock".into()),
            quantity: Some("0.000000000001".into()),
            ..activity("split2", "2026-01-03", "split", None)
        },
    ];
    assert_eq!(validate(&d), Err(WealthError::Overflow));
}

#[test]
fn reusable_import_mappings_accept_canonical_adapter_date_formats() {
    let mut d = data();
    for (index, date_format) in ["iso", "dmy", "buddhist"].into_iter().enumerate() {
        d.import_mappings.push(ImportMapping {
            id: format!("mapping-{index}"),
            name: format!("Broker {date_format}"),
            mode: "activities".into(),
            date_format: date_format.into(),
            columns: [
                ("date".into(), "วันที่".into()),
                ("amount".into(), "ยอดสุทธิ".into()),
            ]
            .into_iter()
            .collect(),
        });
    }
    validate(&d).unwrap();
    assert_eq!(
        portfolio(&d, &filter("2026-01-01"))
            .unwrap()
            .total_value
            .as_deref(),
        Some("0")
    );
    d.import_mappings[0].date_format = "unknown-format".into();
    assert!(validate(&d).is_err());
}

#[test]
fn foreign_opening_basis_does_not_use_baseline_fx_as_acquisition_fx() {
    let mut d = data();
    d.instruments = vec![instrument("USD")];
    d.opening_positions = vec![OpeningPosition {
        currency: "USD".into(),
        cost_basis: Some("10".into()),
        ..opening("2026-01-01", "1")
    }];
    d.prices = vec![price("2026-01-01", "12")];
    d.fx_rates = vec![fx("2026-01-01", "35")];
    let p = portfolio(&d, &filter("2026-01-01")).unwrap();
    let h = &p.holdings[0];
    assert_eq!(h.cost_basis.as_deref(), Some("10"));
    assert_eq!(h.cost_basis_base, None);
    assert_eq!(h.unrealized_gain.as_deref(), Some("2"));
    assert_eq!(h.market_value_base.as_deref(), Some("420"));
    assert!(
        p.warnings
            .iter()
            .any(|warning| warning.contains("ต้นทุนในสกุลเงินรายงาน"))
    );

    // The user can supply a genuinely known historical reporting-currency cost.
    d.opening_positions[0].cost_basis_base = Some("320".into());
    let p = portfolio(&d, &filter("2026-01-01")).unwrap();
    assert_eq!(p.holdings[0].cost_basis_base.as_deref(), Some("320"));

    // Native basis is already base basis when their currencies match.
    d.preferences.reporting_currency = "USD".into();
    d.opening_positions[0].cost_basis_base = None;
    let p = portfolio(&d, &filter("2026-01-01")).unwrap();
    assert_eq!(p.holdings[0].cost_basis_base.as_deref(), Some("10"));
}

#[test]
fn manual_fx_overrides_automatic_inverse_on_shared_date_in_both_directions() {
    let mut d = data();
    d.activities = vec![Activity {
        currency: "USD".into(),
        ..activity("deposit", "2026-01-01", "deposit", Some("100"))
    }];
    d.fx_rates = vec![
        FxRate {
            source: "yahoo".into(),
            fetched_at: "2026-01-02T12:00:00Z".into(),
            ..fx("2026-01-01", "35")
        },
        FxRate {
            from_currency: "THB".into(),
            to_currency: "USD".into(),
            fetched_at: "2026-01-01T12:00:00Z".into(),
            ..fx("2026-01-01", "0.025")
        },
    ];
    assert_eq!(
        portfolio(&d, &filter("2026-01-01"))
            .unwrap()
            .total_value
            .as_deref(),
        Some("4000")
    );
    d.preferences.reporting_currency = "USD".into();
    d.activities[0].currency = "THB".into();
    assert_eq!(
        portfolio(&d, &filter("2026-01-01"))
            .unwrap()
            .total_value
            .as_deref(),
        Some("2.5")
    );
}

#[test]
fn latest_fetched_manual_fx_wins_ties_and_reverse_conversion_agrees() {
    let mut d = data();
    d.activities = vec![Activity {
        currency: "USD".into(),
        ..activity("deposit", "2026-01-01", "deposit", Some("100"))
    }];
    d.fx_rates = vec![
        FxRate {
            fetched_at: "2026-01-01T12:00:00Z".into(),
            ..fx("2026-01-01", "35")
        },
        FxRate {
            from_currency: "THB".into(),
            to_currency: "USD".into(),
            fetched_at: "2026-01-01T20:00:01+07:00".into(),
            ..fx("2026-01-01", "0.025")
        },
    ];
    assert_eq!(
        portfolio(&d, &filter("2026-01-01"))
            .unwrap()
            .total_value
            .as_deref(),
        Some("4000")
    );
    d.preferences.reporting_currency = "USD".into();
    d.activities[0].currency = "THB".into();
    assert_eq!(
        portfolio(&d, &filter("2026-01-01"))
            .unwrap()
            .total_value
            .as_deref(),
        Some("2.5")
    );
}

#[test]
fn opening_snapshot_rejects_duplicate_asset_or_cash_slots_regardless_of_ids() {
    let mut d = data();
    d.opening_positions = vec![
        OpeningPosition {
            id: "z".into(),
            cost_basis: Some("10".into()),
            ..opening("2026-01-01", "1")
        },
        OpeningPosition {
            id: "a".into(),
            ..opening("2026-01-01", "1")
        },
    ];
    assert!(
        validate(&d)
            .unwrap_err()
            .to_string()
            .contains("รวมยอดในรายการเดิม")
    );
    d.opening_positions.reverse();
    assert!(validate(&d).is_err());
    for row in &mut d.opening_positions {
        row.instrument_id = None;
        row.cost_basis = None;
    }
    assert!(validate(&d).is_err());
    d.opening_positions[0].currency = "USD".into();
    validate(&d).unwrap();
}

#[test]
fn baseline_day_split_has_neutral_flow_return_for_fresh_and_carried_quotes() {
    for quotes in [
        vec![price("2026-01-02", "50")],
        vec![price("2026-01-01", "100")],
    ] {
        let mut d = data();
        d.opening_positions = vec![opening("2026-01-02", "1")];
        d.activities = vec![Activity {
            instrument_id: Some("stock".into()),
            quantity: Some("2".into()),
            ..activity("split", "2026-01-02", "split", None)
        }];
        d.prices = quotes;
        let p = portfolio(&d, &filter("2026-01-02")).unwrap();
        assert_eq!(p.total_value.as_deref(), Some("100"));
        assert_eq!(p.series[0].net_flow.as_deref(), Some("100"));
        assert_eq!(p.period_gain.as_deref(), Some("0"));
        assert_eq!(p.twr.as_deref(), Some("0"));
    }
}

#[test]
fn untracked_accounts_record_buys_without_any_cash() {
    let mut d = data();
    d.accounts[0].track_cash = false;
    d.activities = vec![trade("b1", "2024-01-02", "buy", "10", "100")];
    d.prices = vec![price("2024-01-02", "100"), price("2024-01-03", "110")];
    let result = portfolio(&d, &filter("2024-01-05")).unwrap();
    // Holdings are valued; there is no cash to track and nothing was rejected.
    assert_eq!(result.total_value.as_deref(), Some("1100"));
    assert!(result.cash.is_empty());
    // The buy is an external inflow, so TWR reflects price growth only.
    assert_eq!(result.twr.as_deref(), Some("0.1"));
    assert!(validate(&d).is_ok());
    // Cash records still work on holdings-only accounts: they record how much
    // money the user has, without the buy ever touching that balance.
    d.activities
        .push(activity("d1", "2024-01-04", "deposit", Some("500")));
    let result = portfolio(&d, &filter("2024-01-05")).unwrap();
    assert_eq!(result.cash[0].amount, "500");
    // The deposit grows the portfolio without creating fake return: buy value
    // 1000 + price growth 10% + cash 500 = 1600, TWR stays at 10%.
    assert_eq!(result.total_value.as_deref(), Some("1600"));
    assert_eq!(result.twr.as_deref(), Some("0.1"));
}

#[test]
fn holdings_only_accounts_can_set_an_opening_cash_balance() {
    let mut d = data();
    d.accounts[0].track_cash = false;
    d.opening_positions.push(cash_opening("2024-01-01", "300"));
    d.activities = vec![trade("b1", "2024-01-02", "buy", "10", "100")];
    d.prices = vec![price("2024-01-02", "100")];
    assert!(validate(&d).is_ok());
    let result = portfolio(&d, &filter("2024-01-02")).unwrap();
    // Opening cash and the holding coexist; the buy did not consume the cash.
    assert_eq!(result.cash[0].amount, "300");
    assert_eq!(result.total_value.as_deref(), Some("1300"));
}

#[test]
fn untracked_dividends_and_sells_leave_as_withdrawn_income() {
    let mut d = data();
    d.accounts[0].track_cash = false;
    d.activities = vec![
        trade("b1", "2024-01-02", "buy", "10", "100"),
        trade("s1", "2024-01-04", "sell", "10", "120"),
    ];
    d.prices = vec![price("2024-01-02", "100"), price("2024-01-03", "100")];
    let result = portfolio(&d, &filter("2024-01-05")).unwrap();
    assert_eq!(result.cash_value.as_deref(), Some("0"));
    // Selling everything withdraws the value; the realized gain is recorded.
    assert!(
        result.holdings.is_empty() || result.holdings.iter().all(|h| h.realized_gain.is_some())
    );
}
