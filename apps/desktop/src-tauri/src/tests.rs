use crate::{backup, catalog::Catalog, models::*, services, storage};
use std::str::FromStr;
use taxly_core::*;

fn m(value: &str) -> Money {
    Money::from_str(value).unwrap()
}
fn setup_request(year: u16) -> OnboardingRequest {
    OnboardingRequest {
        year,
        facts: TaxpayerFacts {
            single: Some(true),
            under_65: Some(true),
            domestic_salary_only: Some(true),
            no_special_cases: Some(true),
            no_other_deductions: Some(true),
            social_security_confirmed: true,
        },
        source_label: "งานประจำของฉัน".into(),
        monthly_salary: m("30000"),
        start_month: 1,
        end_month: 12,
        actual_through: 12,
        monthly_withholding: Some(m("250")),
        forecast_withholding: false,
        monthly_sso: Some(m("750")),
        bonus: Some(m("0")),
        bonus_month: 12,
        bonus_basis: AmountBasis::Actual,
        bonus_withholding: Some(m("0")),
        income_complete: true,
    }
}
async fn database() -> (tempfile::TempDir, sqlx::SqlitePool, Catalog) {
    let directory = tempfile::tempdir().unwrap();
    let catalog = Catalog::bundled().unwrap();
    let pool = storage::connect(&directory.path().join("taxly.sqlite3"), &catalog)
        .await
        .unwrap();
    (directory, pool, catalog)
}

#[tokio::test]
async fn onboarding_persistence_forecast_replacement_and_history() {
    let (directory, pool, catalog) = database().await;
    let mut request = setup_request(2025);
    request.actual_through = 6;
    request.forecast_withholding = true;
    storage::onboarding(&pool, request).await.unwrap();
    let workspace = storage::workspace(&pool, 2025).await.unwrap();
    assert_eq!(workspace.income.len(), 12);
    let before = services::calculate_year(&pool, &catalog, 2025)
        .await
        .unwrap();
    assert_eq!(before.annual_tax, m("2050"));
    assert_eq!(before.actual_income, m("180000"));
    services::save_snapshot(&pool, &catalog, 2025)
        .await
        .unwrap();
    services::save_snapshot(&pool, &catalog, 2025)
        .await
        .unwrap();
    assert_eq!(storage::history(&pool, 2025).await.unwrap().len(), 1);
    let entry = workspace
        .income
        .iter()
        .find(|entry| entry.month == 7)
        .unwrap();
    storage::upsert_income(
        &pool,
        IncomeRequest {
            id: Some(entry.id.clone()),
            year: 2025,
            source_label: workspace.sources[0].label.clone(),
            month: 7,
            kind: "salary".into(),
            basis: AmountBasis::Actual,
            gross: entry.gross,
            withholding: entry.withholding,
        },
    )
    .await
    .unwrap();
    let workspace = storage::workspace(&pool, 2025).await.unwrap();
    assert_eq!(workspace.income.len(), 12);
    assert_eq!(workspace.profile.as_ref().unwrap().revision, 2);
    assert_eq!(
        services::calculate_year(&pool, &catalog, 2025)
            .await
            .unwrap()
            .annual_tax,
        before.annual_tax
    );
    assert!(
        storage::history(&pool, 2025).await.unwrap()[0].data_revision
            < workspace.profile.unwrap().revision
    );
    let duplicate = IncomeRequest {
        id: None,
        year: 2025,
        source_label: "งานประจำของฉัน".into(),
        month: 7,
        kind: "salary".into(),
        basis: AmountBasis::Actual,
        gross: m("30000"),
        withholding: None,
    };
    assert!(storage::upsert_income(&pool, duplicate).await.is_err());
    assert_eq!(
        storage::workspace(&pool, 2025).await.unwrap().income.len(),
        12
    );
    pool.close().await;
    let reopened = storage::connect(&directory.path().join("taxly.sqlite3"), &catalog)
        .await
        .unwrap();
    assert_eq!(
        storage::workspace(&reopened, 2025)
            .await
            .unwrap()
            .income
            .len(),
        12
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(directory.path().join("taxly.sqlite3"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    reopened.close().await;
}

#[tokio::test]
async fn backup_is_encrypted_versioned_and_roundtrips_all_history() {
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2025))
        .await
        .unwrap();
    services::save_snapshot(&pool, &catalog, 2025)
        .await
        .unwrap();
    let draft = serde_json::json!({"step":2,"facts":TaxpayerFacts::default(),"source_label":"แบบสอบถามที่ยังไม่เสร็จ","monthly_salary":"","start_month":1,"end_month":12,"actual_through":0,"monthly_withholding":"","forecast_withholding":false,"monthly_sso":"","bonus":"","bonus_month":12,"bonus_basis":"forecast","bonus_withholding":"","income_complete":false});
    sqlx::query("INSERT INTO app_settings(key,value_json) VALUES ('onboarding_2026',?)")
        .bind(draft.to_string())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO app_settings(key,value_json) VALUES ('active_tax_year','2025')")
        .execute(&pool)
        .await
        .unwrap();
    let backup = backup::collect(&pool, &catalog).await.unwrap();
    let expected = serde_json::to_value(&backup).unwrap();
    let encrypted = backup::encrypt(&backup, "a private test passphrase".into()).unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("งานประจำ"));
    assert!(backup::decrypt(&encrypted, "wrong passphrase".into(), &catalog).is_err());
    let mut corrupted = encrypted.clone();
    let end = corrupted.len() - 1;
    corrupted[end] ^= 1;
    assert!(backup::decrypt(&corrupted, "a private test passphrase".into(), &catalog).is_err());
    let mut restored =
        backup::decrypt(&encrypted, "a private test passphrase".into(), &catalog).unwrap();
    restored.backup_format_version = 3;
    assert!(restored.validate(&catalog).is_err());
    restored.backup_format_version = 2;
    storage::delete_all(&pool).await.unwrap();
    backup::restore(&pool, &catalog, restored).await.unwrap();
    let mut actual = serde_json::to_value(backup::collect(&pool, &catalog).await.unwrap()).unwrap();
    assert!(
        actual["wealth"]["revision"].as_i64().unwrap()
            > expected["wealth"]["revision"].as_i64().unwrap()
    );
    actual["wealth"]["revision"] = expected["wealth"]["revision"].clone();
    assert_eq!(actual, expected);
    assert_eq!(
        services::calculate_year(&pool, &catalog, 2025)
            .await
            .unwrap()
            .annual_tax,
        m("2050")
    );
    pool.close().await;
}

#[tokio::test]
async fn failed_restore_rolls_back_even_after_deleting_old_rows() {
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2025))
        .await
        .unwrap();
    let backup = backup::collect(&pool, &catalog).await.unwrap();
    sqlx::query("CREATE TRIGGER simulate_disk_failure BEFORE INSERT ON income_entries BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END").execute(&pool).await.unwrap();
    assert!(backup::restore(&pool, &catalog, backup).await.is_err());
    assert_eq!(
        storage::workspace(&pool, 2025).await.unwrap().income.len(),
        12
    );
    assert_eq!(
        services::calculate_year(&pool, &catalog, 2025)
            .await
            .unwrap()
            .annual_tax,
        m("2050")
    );
    pool.close().await;
}

#[tokio::test]
async fn invalid_backup_sources_and_cross_year_edits_are_rejected() {
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2025))
        .await
        .unwrap();
    storage::onboarding(&pool, setup_request(2026))
        .await
        .unwrap();
    let mut data = backup::collect(&pool, &catalog).await.unwrap();
    data.rules
        .insert("th-salary-2025-v1".into(), "changed".into());
    assert!(backup::restore(&pool, &catalog, data).await.is_err());
    let old = storage::workspace(&pool, 2025).await.unwrap();
    assert!(
        storage::delete_entry(&pool, 2026, &old.income[0].id, true)
            .await
            .is_err()
    );
    let invalid = IncomeRequest {
        id: Some(old.income[0].id.clone()),
        year: 2026,
        source_label: "งานอื่น".into(),
        month: 1,
        kind: "salary".into(),
        basis: AmountBasis::Actual,
        gross: m("1"),
        withholding: None,
    };
    assert!(storage::upsert_income(&pool, invalid).await.is_err());
    assert_eq!(
        storage::workspace(&pool, 2026).await.unwrap().sources.len(),
        1
    );
    pool.close().await;
}

#[tokio::test]
async fn deletion_invalidates_completion_and_guidance_does_not_claim_unimplemented_rights() {
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2025))
        .await
        .unwrap();
    let guidance = services::guidance(&pool, &catalog, 2025).await.unwrap();
    assert_eq!(
        guidance
            .iter()
            .find(|g| g.code == "sso_33")
            .unwrap()
            .savings,
        Some(m("450"))
    );
    assert!(
        guidance
            .iter()
            .filter(|g| g.status == "not_included")
            .all(|g| g.limit.is_none() && g.savings.is_none())
    );
    let first = storage::workspace(&pool, 2025).await.unwrap().income[0]
        .id
        .clone();
    storage::delete_entry(&pool, 2025, &first, true)
        .await
        .unwrap();
    assert!(
        !storage::workspace(&pool, 2025)
            .await
            .unwrap()
            .profile
            .unwrap()
            .income_complete
    );
    assert!(
        services::calculate_year(&pool, &catalog, 2025)
            .await
            .unwrap()
            .difference_preview
            .is_none()
    );
    pool.close().await;
}

#[tokio::test]
async fn export_contract_fixture_when_requested() {
    if std::env::var("TAXLY_EXPORT_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2025))
        .await
        .unwrap();
    services::save_snapshot(&pool, &catalog, 2025)
        .await
        .unwrap();
    let fixture = serde_json::json!({"workspace":storage::workspace(&pool,2025).await.unwrap(),"calculation":services::calculate_year(&pool,&catalog,2025).await.unwrap(),"guidance":services::guidance(&pool,&catalog,2025).await.unwrap(),"sources":catalog.get(2025).unwrap().sources,"history":storage::history(&pool,2025).await.unwrap()});
    std::fs::create_dir_all("../e2e/fixtures").unwrap();
    std::fs::write(
        "../e2e/fixtures/contract.json",
        serde_json::to_string_pretty(&fixture).unwrap(),
    )
    .unwrap();
    pool.close().await;
}

#[test]
fn frontend_contract_fixture_matches_current_engine() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../e2e/fixtures/contract.json")).unwrap();
    let input: AnnualTaxInput =
        serde_json::from_str(fixture["history"][0]["input_json"].as_str().unwrap()).unwrap();
    let catalog = Catalog::bundled().unwrap();
    let expected =
        serde_json::to_value(calculate(&input, catalog.get(input.year).unwrap()).unwrap()).unwrap();
    assert_eq!(
        fixture["calculation"], expected,
        "regenerate fixtures only after reviewing any rule/engine behavior change"
    );
}
