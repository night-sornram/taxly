use crate::{backup, catalog::Catalog, error::AppError, storage, wealth_storage};
use wealth_core::*;

async fn database() -> (tempfile::TempDir, sqlx::SqlitePool, Catalog) {
    let dir = tempfile::tempdir().unwrap();
    let catalog = Catalog::bundled().unwrap();
    let pool = storage::connect(&dir.path().join("taxly.sqlite3"), &catalog)
        .await
        .unwrap();
    (dir, pool, catalog)
}

fn synthetic_wealth() -> WealthData {
    let mut data = WealthData::default();
    data.accounts.push(Account {
        track_cash: true,
        id: "account-thb".into(),
        name: "พอร์ตหุ้นไทย".into(),
    });
    data.instruments.push(Instrument {
        id: "ptt".into(),
        symbol: "PTT".into(),
        name: "ปตท.".into(),
        kind: "stock".into(),
        currency: "THB".into(),
        exchange: "XBKK".into(),
        provider_symbol: "PTT.BK".into(),
    });
    let activity = |id: &str,
                    kind: &str,
                    date: &str,
                    amount: Option<&str>,
                    quantity: Option<&str>,
                    price: Option<&str>,
                    fee: &str,
                    tax: &str,
                    sequence: i64| Activity {
        id: id.into(),
        account_id: "account-thb".into(),
        date: date.into(),
        kind: kind.into(),
        instrument_id: if ["buy", "sell", "dividend"].contains(&kind) {
            Some("ptt".into())
        } else {
            None
        },
        currency: "THB".into(),
        quantity: quantity.map(str::to_string),
        unit_price: price.map(str::to_string),
        amount: amount.map(str::to_string),
        fee: fee.into(),
        tax: tax.into(),
        related_account_id: None,
        counter_currency: None,
        counter_amount: None,
        sequence,
        note: String::new(),
    };
    data.activities = vec![
        activity(
            "fund",
            "deposit",
            "2026-01-01",
            Some("10000"),
            None,
            None,
            "0",
            "0",
            0,
        ),
        activity(
            "buy",
            "buy",
            "2026-01-01",
            Some("1010"),
            Some("10"),
            Some("100"),
            "10",
            "0",
            1,
        ),
        activity(
            "sell",
            "sell",
            "2026-01-02",
            Some("595"),
            Some("4"),
            Some("150"),
            "5",
            "0",
            2,
        ),
        activity(
            "dividend",
            "dividend",
            "2026-01-03",
            Some("90"),
            None,
            None,
            "0",
            "10",
            3,
        ),
    ];
    for (date, close) in [
        ("2026-01-01", "100"),
        ("2026-01-02", "150"),
        ("2026-01-03", "160"),
    ] {
        data.prices.push(Price {
            instrument_id: "ptt".into(),
            date: date.into(),
            close: close.into(),
            source: "manual".into(),
            fetched_at: String::new(),
        });
    }
    data
}

#[tokio::test]
async fn csv_review_and_saved_mapping_commit_atomically_against_real_sqlite() {
    use crate::wealth_import::{ImportRequest, apply_review, prepare_review};
    use std::collections::{BTreeMap, BTreeSet};
    let (_dir, pool, _catalog) = database().await;
    wealth_storage::mutate(&pool, None, |data| {
        data.accounts.push(Account {
            track_cash: true,
            id: "broker".into(),
            name: "Overseas".into(),
        });
        Ok(())
    })
    .await
    .unwrap();
    let request = ImportRequest {
        account_id: "broker".into(),
        mode: "activities".into(),
        date_format: "iso".into(),
        mapping: BTreeMap::new(),
        mapping_name: "Broker CSV".into(),
        csv: None,
        file_token: None,
        symbol_mappings: BTreeMap::new(),
    };
    let csv = "date,kind,symbol,exchange,instrument_kind,currency,quantity,unit_price,amount\n2026-01-01,deposit,,,,USD,,,1000\n2026-01-01,buy,VOO,ARCX,etf,USD,0.5,100,50\n";
    let before = wealth_storage::load(&pool).await.unwrap();
    let review = prepare_review(csv, "broker.csv".into(), &request, &before).unwrap();
    assert!(review.rows.iter().all(|r| r.errors.is_empty()));
    assert_eq!(wealth_storage::load(&pool).await.unwrap(), before);
    let selected = BTreeSet::from([1, 2]);
    wealth_storage::mutate(&pool, Some(review.revision), |data| {
        apply_review(data, &review, &request, &selected)
    })
    .await
    .unwrap();
    let after = wealth_storage::load(&pool).await.unwrap();
    assert_eq!(after.activities.len(), 2);
    assert_eq!(after.instruments[0].kind, "etf");
    assert_eq!(after.import_mappings[0].date_format, "iso");
    let repeated = prepare_review(csv, "broker.csv".into(), &request, &after).unwrap();
    assert!(repeated.rows.iter().all(|row| row.duplicate));
    let stale = wealth_storage::mutate(&pool, Some(review.revision), |data| {
        apply_review(data, &review, &request, &selected)
    })
    .await
    .unwrap_err();
    assert_eq!(stale.code, "StaleRevision");
    let impossible =
        "date,kind,currency,amount\n2026-01-02,deposit,USD,10\n2026-01-02,withdrawal,USD,99999\n";
    let invalid_review = prepare_review(impossible, "bad.csv".into(), &request, &after).unwrap();
    assert!(
        wealth_storage::mutate(&pool, Some(after.revision), |data| apply_review(
            data,
            &invalid_review,
            &request,
            &selected
        ))
        .await
        .is_err()
    );
    assert_eq!(wealth_storage::load(&pool).await.unwrap(), after);
    pool.close().await;
}

#[tokio::test]
async fn wealth_storage_reopens_and_rejects_invalid_backdated_edits_atomically() {
    let (dir, pool, catalog) = database().await;
    wealth_storage::mutate(&pool, Some(0), |data| {
        *data = synthetic_wealth();
        Ok(())
    })
    .await
    .unwrap();
    let before = wealth_storage::load(&pool).await.unwrap();
    let error = wealth_storage::mutate(&pool, None, |data| {
        data.activities.retain(|row| row.id != "fund");
        Ok(())
    })
    .await
    .unwrap_err();
    assert_eq!(error.code, "InvalidInput");
    assert_eq!(wealth_storage::load(&pool).await.unwrap(), before);
    assert_eq!(
        wealth_storage::mutate(&pool, Some(0), |_| Ok(()))
            .await
            .unwrap_err()
            .code,
        "StaleRevision"
    );
    pool.close().await;
    let reopened = storage::connect(&dir.path().join("taxly.sqlite3"), &catalog)
        .await
        .unwrap();
    assert_eq!(wealth_storage::load(&reopened).await.unwrap(), before);
    let report = portfolio(
        &before,
        &PortfolioFilter {
            account_ids: vec![],
            start_date: None,
            end_date: "2026-01-03".into(),
        },
    )
    .unwrap();
    assert_eq!(report.total_value.as_deref(), Some("10635"));
    assert_eq!(report.holdings[0].quantity, "6");
    reopened.close().await;
}

#[tokio::test]
async fn wealth_v2_backup_and_legacy_tax_restore_preserve_correct_modules() {
    let (_dir, pool, catalog) = database().await;
    wealth_storage::mutate(&pool, None, |data| {
        *data = synthetic_wealth();
        Ok(())
    })
    .await
    .unwrap();
    let exported = backup::collect(&pool, &catalog).await.unwrap();
    assert_eq!(exported.backup_format_version, 2);
    let encrypted = backup::encrypt(&exported, "wealth private passphrase".into()).unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("พอร์ตหุ้นไทย"));
    let restored =
        backup::decrypt(&encrypted, "wealth private passphrase".into(), &catalog).unwrap();
    storage::delete_all(&pool).await.unwrap();
    assert!(
        wealth_storage::load(&pool)
            .await
            .unwrap()
            .accounts
            .is_empty()
    );
    backup::restore(&pool, &catalog, restored).await.unwrap();
    let wealth = wealth_storage::load(&pool).await.unwrap();
    assert_eq!(wealth.accounts, exported.wealth.as_ref().unwrap().accounts);
    assert_eq!(
        wealth.activities,
        exported.wealth.as_ref().unwrap().activities
    );
    assert_eq!(wealth.prices, exported.wealth.as_ref().unwrap().prices);
    let mut legacy = backup::collect(&pool, &catalog).await.unwrap();
    legacy.backup_format_version = 1;
    legacy.wealth = None;
    let legacy_json = serde_json::to_value(&legacy).unwrap();
    assert!(legacy_json.get("wealth").is_none());
    let legacy = serde_json::from_value(legacy_json).unwrap();
    backup::restore(&pool, &catalog, legacy).await.unwrap();
    assert_eq!(wealth_storage::load(&pool).await.unwrap(), wealth);
    storage::delete_all(&pool).await.unwrap();
    let empty = wealth_storage::load(&pool).await.unwrap();
    assert!(empty.accounts.is_empty() && empty.activities.is_empty() && empty.prices.is_empty());
    assert_eq!(empty.preferences, WealthPreferences::default());
    assert!(empty.revision > wealth.revision);
    pool.close().await;
}

#[tokio::test]
async fn wealth_restore_failure_rolls_back_tax_and_wealth_together() {
    let (_dir, pool, catalog) = database().await;
    wealth_storage::mutate(&pool, None, |data| {
        *data = synthetic_wealth();
        Ok(())
    })
    .await
    .unwrap();
    sqlx::query("INSERT INTO app_settings(key,value_json) VALUES ('active_tax_year','2025')")
        .execute(&pool)
        .await
        .unwrap();
    let before = backup::collect(&pool, &catalog).await.unwrap();
    let restore = backup::collect(&pool, &catalog).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_wealth_restore BEFORE INSERT ON wealth_accounts BEGIN SELECT RAISE(FAIL,'test restore failure'); END").execute(&pool).await.unwrap();
    assert!(backup::restore(&pool, &catalog, restore).await.is_err());
    let after = backup::collect(&pool, &catalog).await.unwrap();
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(after).unwrap()
    );
    pool.close().await;
}

#[tokio::test]
async fn wealth_mutation_failure_does_not_partially_commit() {
    let (_dir, pool, _catalog) = database().await;
    let before = wealth_storage::load(&pool).await.unwrap();
    let result: crate::error::AppResult<()> = wealth_storage::mutate(&pool, None, |data| {
        data.accounts.push(Account {
            track_cash: true,
            id: "new".into(),
            name: "new".into(),
        });
        Err(AppError::invalid("synthetic failure"))
    })
    .await;
    assert!(result.is_err());
    assert_eq!(wealth_storage::load(&pool).await.unwrap(), before);
    pool.close().await;
}

#[tokio::test]
async fn existing_database_migrates_without_changing_tax_data() {
    let dir = tempfile::tempdir().unwrap();
    let old_migrations = tempfile::tempdir().unwrap();
    for file in ["0001_initial.sql", "0002_source_identity.sql"] {
        std::fs::copy(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("migrations")
                .join(file),
            old_migrations.path().join(file),
        )
        .unwrap();
    }
    let path = dir.path().join("taxly.sqlite3");
    let old = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .foreign_keys(true),
    )
    .await
    .unwrap();
    sqlx::migrate::Migrator::new(old_migrations.path())
        .await
        .unwrap()
        .run(&old)
        .await
        .unwrap();
    sqlx::query("INSERT INTO app_settings(key,value_json) VALUES ('active_tax_year','2025')")
        .execute(&old)
        .await
        .unwrap();
    old.close().await;
    let catalog = Catalog::bundled().unwrap();
    let pool = storage::connect(&path, &catalog).await.unwrap();
    let year: String =
        sqlx::query_scalar("SELECT value_json FROM app_settings WHERE key='active_tax_year'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(year, "2025");
    assert_eq!(
        wealth_storage::load(&pool).await.unwrap(),
        WealthData::default()
    );
    let errors = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(errors.is_empty());
    pool.close().await;
}

#[test]
fn wealth_frontend_contract_matches_rust() {
    let data = synthetic_wealth();
    let filter = PortfolioFilter {
        account_ids: vec![],
        start_date: None,
        end_date: "2026-01-03".into(),
    };
    let full = WealthWorkspace {
        portfolio: portfolio(&data, &filter).unwrap(),
        data,
    };
    let data = WealthData::default();
    let empty = WealthWorkspace {
        portfolio: portfolio(&data, &filter).unwrap(),
        data,
    };
    let expected = serde_json::json!({"full":full,"empty":empty});
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../e2e/fixtures/wealth-contract.json");
    if std::env::var_os("TAXLY_EXPORT_WEALTH_FIXTURE").is_some() {
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&expected).unwrap() + "\n",
        )
        .unwrap();
    }
    let actual: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(path).expect("export the reviewed Rust wealth fixture"),
    )
    .unwrap();
    assert_eq!(
        expected, actual,
        "wealth fixture must reflect current Rust calculation contracts"
    );
}

#[tokio::test]
async fn prepare_native_wealth_smoke_when_requested() {
    let Some(path) = std::env::var_os("TAXLY_NATIVE_SMOKE_DATA_DIR") else {
        return;
    };
    let path = std::path::PathBuf::from(path);
    // Only explicit isolated directories are accepted, never the OS app-data path.
    assert!(
        path.starts_with(std::env::temp_dir()),
        "native smoke data must be temporary"
    );
    assert!(
        !path.join("taxly.sqlite3").exists(),
        "do not replace an existing smoke database"
    );
    let catalog = Catalog::bundled().unwrap();
    let pool = storage::connect(&path.join("taxly.sqlite3"), &catalog)
        .await
        .unwrap();
    wealth_storage::mutate(&pool, None, |data| {
        *data = synthetic_wealth();
        Ok(())
    })
    .await
    .unwrap();
    pool.close().await;
}

#[tokio::test]
async fn changing_instrument_currency_syncs_its_activities_and_openings() {
    let (_dir, pool, _catalog) = database().await;
    wealth_storage::mutate(&pool, None, |data| {
        data.accounts.push(Account {
            track_cash: false,
            id: "acc".into(),
            name: "acc".into(),
        });
        data.instruments.push(Instrument {
            id: "schg".into(),
            symbol: "SCHG".into(),
            name: "Schwab US Growth ETF".into(),
            kind: "etf".into(),
            currency: "THB".into(),
            exchange: "NYSE Arca".into(),
            provider_symbol: "SCHG".into(),
        });
        data.activities.push(Activity {
            id: "buy1".into(),
            account_id: "acc".into(),
            date: "2026-01-02".into(),
            kind: "buy".into(),
            instrument_id: Some("schg".into()),
            currency: "THB".into(),
            quantity: Some("10".into()),
            unit_price: Some("35".into()),
            amount: Some("350".into()),
            fee: "0".into(),
            tax: "0".into(),
            related_account_id: None,
            counter_currency: None,
            counter_amount: None,
            sequence: 0,
            note: "".into(),
        });
        data.opening_positions.push(OpeningPosition {
            id: "op1".into(),
            account_id: "acc".into(),
            date: "2026-01-01".into(),
            instrument_id: Some("schg".into()),
            currency: "THB".into(),
            quantity: "5".into(),
            cost_basis: None,
            cost_basis_base: None,
        });
        Ok(())
    })
    .await
    .unwrap();

    let synced = wealth_storage::mutate(&pool, None, |data| {
        let mut corrected = data.instruments[0].clone();
        corrected.currency = "USD".into();
        let synced = wealth_storage::sync_instrument_currency(data, &corrected);
        data.instruments[0].currency = "USD".into();
        Ok(synced)
    })
    .await
    .unwrap();
    assert_eq!(synced, 2);

    let data = wealth_storage::load(&pool).await.unwrap();
    assert!(data.activities.iter().all(|a| a.currency == "USD"));
    assert!(data.opening_positions.iter().all(|o| o.currency == "USD"));
    assert_eq!(data.instruments[0].currency, "USD");
    // The whole graph still validates after the rewrite.
    wealth_core::validate(&data).unwrap();
    pool.close().await;
}
