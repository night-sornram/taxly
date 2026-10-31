use crate::{backup, catalog::Catalog, ledger, ledger_sync as sync, models::*, services, storage};
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

const SYNC_OWNER: &str = "11111111-1111-4111-8111-111111111111";
const SYNC_PROJECT: &str = "https://taxly-test.supabase.co";
fn sync_request(
    state: &sync::SyncState,
    snapshot: sync::SyncSnapshot,
    revision: i64,
) -> sync::ApplyRequest {
    sync::ApplyRequest {
        owner_id: SYNC_OWNER.into(),
        project_url: SYNC_PROJECT.into(),
        expected_revision: state.revision,
        cloud_revision: revision,
        base_snapshot: snapshot.clone(),
        snapshot,
    }
}

#[tokio::test]
async fn sync_preserves_local_tax_identity_and_rolls_back_invalid_incoming_data() {
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2026))
        .await
        .unwrap();
    ledger::save_entry(
        &pool,
        &catalog,
        entry("2026-02-01", "income-side", Some(link())),
        today(),
    )
    .await
    .unwrap();
    sync::bind(&pool, SYNC_OWNER, SYNC_PROJECT, true)
        .await
        .unwrap();
    let saved = ledger_rows(&pool).await.entries.remove(0);
    let tax_id = saved.tax_income_id.unwrap();
    let before = sync::read(&pool).await.unwrap();
    let json = serde_json::to_string(&before.snapshot).unwrap();
    assert!(!json.contains(&tax_id));
    assert!(before.snapshot.entries[0].tax.is_some());
    let mut next = before.snapshot.clone();
    next.entries[0].amount = m("15000");
    next.entries[0].note = "แก้ไขบนโทรศัพท์".into();
    assert!(
        sync::apply(&pool, &catalog, sync_request(&before, next, 1), today())
            .await
            .unwrap()
    );
    let after = ledger_rows(&pool).await.entries.remove(0);
    assert_eq!(after.tax_income_id.as_deref(), Some(tax_id.as_str()));
    let workspace = storage::workspace(&pool, 2026).await.unwrap();
    let income = workspace.income.iter().find(|i| i.id == tax_id).unwrap();
    assert_eq!(income.gross, m("15000"));
    assert_eq!(income.note, "แก้ไขบนโทรศัพท์");

    // Failing tax setup after category edits must roll back the entire snapshot.
    let current = sync::read(&pool).await.unwrap();
    let mut invalid = current.snapshot.clone();
    invalid.categories[0].name = "เปลี่ยนชื่อก่อนเกิดข้อผิดพลาด".into();
    invalid.entries[0].date = "2025-01-01".into();
    assert!(
        sync::apply(&pool, &catalog, sync_request(&current, invalid, 2), today())
            .await
            .is_err()
    );
    let unchanged = sync::read(&pool).await.unwrap();
    assert_eq!(unchanged.snapshot, current.snapshot);
    assert_eq!(unchanged.revision, current.revision);

    // An explicit unlink from the phone removes the owned tax row as local editing does.
    let mut unlinked = current.snapshot.clone();
    unlinked.entries[0].tax = None;
    sync::apply(
        &pool,
        &catalog,
        sync_request(&current, unlinked, 2),
        today(),
    )
    .await
    .unwrap();
    assert!(
        storage::workspace(&pool, 2026)
            .await
            .unwrap()
            .income
            .iter()
            .all(|i| i.id != tax_id)
    );
    pool.close().await;
}

#[tokio::test]
async fn sync_upload_intent_cas_account_binding_and_reset_are_atomic() {
    let (directory, pool, catalog) = database().await;
    sync::bind(&pool, SYNC_OWNER, SYNC_PROJECT, true)
        .await
        .unwrap();
    let before = sync::read(&pool).await.unwrap();
    let upload = sync::Upload {
        id: uuid::Uuid::new_v4().to_string(),
        expected_revision: 0,
        local_snapshot: before.snapshot.clone(),
        snapshot: before.snapshot.clone(),
    };
    let id = upload.id.clone();
    sync::stage(
        &pool,
        SYNC_OWNER,
        SYNC_PROJECT,
        before.revision,
        upload.clone(),
    )
    .await
    .unwrap();
    let staged = sync::read(&pool).await.unwrap();
    assert!(staged.revision > before.revision);
    assert_eq!(staged.upload.as_ref().unwrap().id, id);
    assert!(
        sync::stage(&pool, SYNC_OWNER, SYNC_PROJECT, staged.revision, upload)
            .await
            .is_err()
    );
    assert!(
        sync::apply(
            &pool,
            &catalog,
            sync_request(&before, before.snapshot.clone(), 1),
            today()
        )
        .await
        .is_err()
    );
    assert!(
        sync::bind(
            &pool,
            "22222222-2222-4222-8222-222222222222",
            SYNC_PROJECT,
            true
        )
        .await
        .is_err()
    );
    assert!(
        sync::bind(&pool, SYNC_OWNER, "https://other.supabase.co", true)
            .await
            .is_err()
    );
    // Closing the database retains the exact operation ID for safe replay.
    pool.close().await;
    let pool = storage::connect(&directory.path().join("taxly.sqlite3"), &catalog)
        .await
        .unwrap();
    let reopened = sync::read(&pool).await.unwrap();
    assert_eq!(reopened.upload.as_ref().unwrap().id, id);
    sync::apply(
        &pool,
        &catalog,
        sync_request(&reopened, reopened.snapshot.clone(), 5),
        today(),
    )
    .await
    .unwrap();
    let accepted = sync::read(&pool).await.unwrap();
    assert!(accepted.upload.is_none());
    assert!(
        sync::apply(
            &pool,
            &catalog,
            sync_request(&accepted, accepted.snapshot.clone(), 4),
            today()
        )
        .await
        .is_err()
    );
    let upload = sync::Upload {
        id: uuid::Uuid::new_v4().to_string(),
        expected_revision: 5,
        local_snapshot: accepted.snapshot.clone(),
        snapshot: accepted.snapshot.clone(),
    };
    sync::stage(&pool, SYNC_OWNER, SYNC_PROJECT, accepted.revision, upload)
        .await
        .unwrap();
    storage::delete_all(&pool).await.unwrap();
    let reset = sync::read(&pool).await.unwrap();
    assert!(!reset.enabled);
    assert!(reset.upload.is_none());
    assert_eq!(reset.cloud_revision, 0);
    assert!(reset.base_snapshot.categories.is_empty());
    assert_eq!(reset.owner_id.as_deref(), Some(SYNC_OWNER));
    assert!(reset.snapshot.entries.is_empty());
    assert_eq!(reset.snapshot.categories.len(), 14);
    pool.close().await;
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
            note: Some("ปรับเงินเดือนใหม่".into()),
        },
    )
    .await
    .unwrap();
    let workspace = storage::workspace(&pool, 2025).await.unwrap();
    assert_eq!(workspace.income.len(), 12);
    assert_eq!(
        workspace
            .income
            .iter()
            .find(|entry| entry.month == 7)
            .unwrap()
            .note,
        "ปรับเงินเดือนใหม่"
    );
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
        note: None,
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
    ledger::save_entry(
        &pool,
        &catalog,
        entry("2025-03-25", "income-salary", Some(link())),
        today(),
    )
    .await
    .unwrap();
    let backup = backup::collect(&pool, &catalog).await.unwrap();
    assert_eq!(backup.ledger.as_ref().unwrap().entries.len(), 1);
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
    restored.backup_format_version = 2;
    assert!(restored.validate(&catalog).is_err());
    restored.backup_format_version = 3;
    storage::delete_all(&pool).await.unwrap();
    backup::restore(&pool, &catalog, restored).await.unwrap();
    let actual = serde_json::to_value(backup::collect(&pool, &catalog).await.unwrap()).unwrap();
    assert_eq!(actual, expected);
    assert_eq!(
        services::calculate_year(&pool, &catalog, 2025)
            .await
            .unwrap()
            .annual_tax,
        // The linked 10,000 ledger income is taxed at the 5% band.
        m("2550")
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
        note: None,
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

#[tokio::test]
async fn other_income_persists_and_joins_the_calculation() {
    let (directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2025))
        .await
        .unwrap();
    let before = services::calculate_year(&pool, &catalog, 2025)
        .await
        .unwrap();
    storage::upsert_income(
        &pool,
        IncomeRequest {
            id: None,
            year: 2025,
            source_label: "งานเสริมครั้งเดียว".into(),
            month: 5,
            kind: "other".into(),
            basis: AmountBasis::Actual,
            gross: m("50000"),
            withholding: Some(m("1500")),
            note: Some("ขายของออนไลน์".into()),
        },
    )
    .await
    .unwrap();
    let workspace = storage::workspace(&pool, 2025).await.unwrap();
    let other = workspace
        .income
        .iter()
        .find(|entry| entry.kind == "other")
        .unwrap();
    assert_eq!(other.note, "ขายของออนไลน์");
    let after = services::calculate_year(&pool, &catalog, 2025)
        .await
        .unwrap();
    assert_eq!(
        after.gross_income,
        before.gross_income.checked_add(m("50000")).unwrap()
    );
    assert_eq!(after.expenses, before.expenses);
    assert!(
        after
            .scope_issues
            .iter()
            .any(|issue| issue.contains("รายได้อื่นถูกนำรวมเต็มจำนวน"))
    );
    pool.close().await;
    drop(directory);
}

fn today() -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(2026, 6, 15).unwrap()
}
fn link() -> ledger::TaxLink {
    ledger::TaxLink {
        source_label: "งานประจำของฉัน".into(),
        kind: "other".into(),
        withholding: Some(m("300")),
    }
}
fn entry(date: &str, category: &str, tax: Option<ledger::TaxLink>) -> ledger::EntryRequest {
    ledger::EntryRequest {
        id: None,
        date: date.into(),
        category_id: category.into(),
        amount: m("10000"),
        note: " ค่าที่ปรึกษา ".into(),
        tax,
    }
}
async fn ledger_rows(pool: &sqlx::SqlitePool) -> ledger::LedgerData {
    let mut tx = pool.begin().await.unwrap();
    let data = ledger::load_in(&mut tx).await.unwrap();
    tx.commit().await.unwrap();
    data
}

#[tokio::test]
async fn ledger_income_keeps_its_linked_tax_income_in_sync() {
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2025))
        .await
        .unwrap();
    storage::onboarding(&pool, setup_request(2026))
        .await
        .unwrap();
    let base = storage::workspace(&pool, 2026).await.unwrap().income.len();
    // A future-dated linked income is a forecast; the note is trimmed on both sides.
    ledger::save_entry(
        &pool,
        &catalog,
        entry("2026-07-10", "income-side", Some(link())),
        today(),
    )
    .await
    .unwrap();
    let saved = ledger_rows(&pool).await.entries.remove(0);
    let tax_id = saved.tax_income_id.clone().unwrap();
    let workspace = storage::workspace(&pool, 2026).await.unwrap();
    let income = workspace.income.iter().find(|i| i.id == tax_id).unwrap();
    assert_eq!(
        (income.month, income.gross, income.kind.as_str()),
        (7, m("10000"), "other")
    );
    assert_eq!(income.basis, AmountBasis::Forecast);
    assert_eq!(
        (income.withholding, income.note.as_str()),
        (Some(m("300")), "ค่าที่ปรึกษา")
    );

    // Editing within the same tax year updates the same tax row.
    let mut edit = entry("2026-05-01", "income-side", Some(link()));
    edit.id = Some(saved.id.clone());
    edit.amount = m("12000");
    ledger::save_entry(&pool, &catalog, edit, today())
        .await
        .unwrap();
    let workspace = storage::workspace(&pool, 2026).await.unwrap();
    let income = workspace.income.iter().find(|i| i.id == tax_id).unwrap();
    assert_eq!(
        (income.month, income.gross, income.basis),
        (5, m("12000"), AmountBasis::Actual)
    );

    // Moving to another tax year moves the tax row with it.
    let mut moved = entry("2025-12-31", "income-side", Some(link()));
    moved.id = Some(saved.id.clone());
    ledger::save_entry(&pool, &catalog, moved, today())
        .await
        .unwrap();
    assert_eq!(
        storage::workspace(&pool, 2026).await.unwrap().income.len(),
        base
    );
    let new_id = ledger_rows(&pool).await.entries[0]
        .tax_income_id
        .clone()
        .unwrap();
    assert!(
        storage::workspace(&pool, 2025)
            .await
            .unwrap()
            .income
            .iter()
            .any(|i| i.id == new_id)
    );

    // Unlinking removes the tax row; relinking then deleting the entry removes it too.
    let mut unlinked = entry("2025-12-31", "income-side", None);
    unlinked.id = Some(saved.id.clone());
    ledger::save_entry(&pool, &catalog, unlinked, today())
        .await
        .unwrap();
    assert!(
        storage::workspace(&pool, 2025)
            .await
            .unwrap()
            .income
            .iter()
            .all(|i| i.id != new_id)
    );
    let mut relinked = entry("2025-12-31", "income-side", Some(link()));
    relinked.id = Some(saved.id.clone());
    ledger::save_entry(&pool, &catalog, relinked, today())
        .await
        .unwrap();
    let before = storage::workspace(&pool, 2025).await.unwrap().income.len();
    ledger::delete_entry(&pool, &saved.id).await.unwrap();
    assert_eq!(
        storage::workspace(&pool, 2025).await.unwrap().income.len(),
        before - 1
    );
    assert!(ledger_rows(&pool).await.entries.is_empty());

    // Deleting on the tax side only clears the link.
    ledger::save_entry(
        &pool,
        &catalog,
        entry("2026-02-01", "income-side", Some(link())),
        today(),
    )
    .await
    .unwrap();
    let linked = ledger_rows(&pool).await.entries.remove(0);
    storage::delete_entry(&pool, 2026, linked.tax_income_id.as_ref().unwrap(), true)
        .await
        .unwrap();
    assert_eq!(ledger_rows(&pool).await.entries[0].tax_income_id, None);
    pool.close().await;
}

#[tokio::test]
async fn ledger_rejects_invalid_links_categories_and_rows() {
    let (_directory, pool, catalog) = database().await;
    // Expenses never feed tax; years without tax setup or rules fail without partial writes.
    for (date, category) in [
        ("2026-01-05", "expense-food"),
        ("2026-01-05", "income-salary"),
        ("2024-01-05", "income-salary"),
    ] {
        assert!(
            ledger::save_entry(
                &pool,
                &catalog,
                entry(date, category, Some(link())),
                today()
            )
            .await
            .is_err()
        );
    }
    for date in ["2026-02-30", "26-01-01", "2026-1-5"] {
        assert!(
            ledger::save_entry(&pool, &catalog, entry(date, "expense-food", None), today())
                .await
                .is_err()
        );
    }
    let mut zero = entry("2026-01-05", "expense-food", None);
    zero.amount = m("0");
    assert!(
        ledger::save_entry(&pool, &catalog, zero, today())
            .await
            .is_err()
    );
    assert!(ledger_rows(&pool).await.entries.is_empty());

    ledger::save_entry(
        &pool,
        &catalog,
        entry("2026-01-05", "expense-food", None),
        today(),
    )
    .await
    .unwrap();
    assert!(
        ledger::delete_category(&pool, "expense-food")
            .await
            .is_err()
    );
    ledger::delete_category(&pool, "expense-education")
        .await
        .unwrap();
    let duplicate = ledger::CategoryRequest {
        id: None,
        kind: "expense".into(),
        name: "เดินทาง".into(),
    };
    assert!(ledger::save_category(&pool, duplicate).await.is_err());
    // Kind cannot be flipped on an existing category.
    let flip = ledger::CategoryRequest {
        id: Some("expense-food".into()),
        kind: "income".into(),
        name: "อาหาร".into(),
    };
    assert!(ledger::save_category(&pool, flip).await.is_err());

    let row = |date: &str| ledger::ImportRow {
        date: date.into(),
        category_id: "expense-transport".into(),
        amount: m("45.50"),
        note: "BTS".into(),
    };
    assert!(
        ledger::import_entries(&pool, vec![row("2026-01-06"), row("bad")])
            .await
            .is_err()
    );
    assert_eq!(ledger_rows(&pool).await.entries.len(), 1);
    assert_eq!(
        ledger::import_entries(&pool, vec![row("2026-01-06"), row("2026-01-07")])
            .await
            .unwrap(),
        2
    );

    // Reset restores the starter categories and clears entries.
    storage::delete_all(&pool).await.unwrap();
    let data = ledger_rows(&pool).await;
    assert!(data.entries.is_empty());
    assert!(data.categories.iter().any(|c| c.id == "expense-education"));
    pool.close().await;
}

#[test]
fn csv_reader_accepts_utf8_bom_and_thai_legacy_encoding() {
    let rows = ledger::parse_csv(
        "\u{feff}วันที่,จำนวน\n\n01/02/2569,\"1,250.00\"\n"
            .as_bytes()
            .to_vec(),
    )
    .unwrap();
    assert_eq!(
        rows,
        vec![vec!["วันที่", "จำนวน"], vec!["01/02/2569", "1,250.00"]]
    );
    // "กาแฟ,45" encoded as TIS-620.
    let rows = ledger::parse_csv(vec![0xa1, 0xd2, 0xe1, 0xbf, b',', b'4', b'5']).unwrap();
    assert_eq!(rows, vec![vec!["กาแฟ", "45"]]);
    assert!(ledger::parse_csv(b"\n , \n".to_vec()).is_err());
}

#[tokio::test]
async fn upgrade_drops_investment_tables_and_seeds_ledger() {
    let directory = tempfile::tempdir().unwrap();
    let old = directory.path().join("migrations");
    std::fs::create_dir(&old).unwrap();
    for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")).unwrap() {
        let path = entry.unwrap().path();
        if path.file_name().unwrap().to_str().unwrap() < "0006" {
            std::fs::copy(&path, old.join(path.file_name().unwrap())).unwrap();
        }
    }
    let path = directory.path().join("taxly.sqlite3");
    {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = sqlx::SqlitePool::connect_with(options).await.unwrap();
        sqlx::migrate::Migrator::new(old.as_path())
            .await
            .unwrap()
            .run(&pool)
            .await
            .unwrap();
        for sql in [
            "INSERT INTO wealth_accounts VALUES ('a','{}')",
            "INSERT INTO wealth_instruments VALUES ('i','VOO','NYSE','USD','{}')",
            "INSERT INTO wealth_activities VALUES ('x','a','i',NULL,'{}')",
            "INSERT INTO wealth_opening_positions VALUES ('o','a','i','{}')",
            "INSERT INTO wealth_prices VALUES ('i','2026-01-01','{}')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        pool.close().await;
    }
    let catalog = Catalog::bundled().unwrap();
    let pool = storage::connect(&path, &catalog).await.unwrap();
    let left: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'wealth_%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(left, 0);
    assert_eq!(ledger_rows(&pool).await.categories.len(), 14);
    pool.close().await;
}

#[tokio::test]
async fn sync_carries_tax_rows_and_applies_them_without_side_effects() {
    let (_directory, pool, catalog) = database().await;
    storage::onboarding(&pool, setup_request(2026))
        .await
        .unwrap();
    ledger::save_entry(
        &pool,
        &catalog,
        entry("2026-02-01", "income-side", Some(link())),
        today(),
    )
    .await
    .unwrap();
    sync::bind(&pool, SYNC_OWNER, SYNC_PROJECT, true)
        .await
        .unwrap();
    let before = sync::read(&pool).await.unwrap();
    let tax = &before.snapshot.tax;
    assert_eq!(tax.years.len(), 1);
    assert!(tax.years[0].income_complete);
    // 12 onboarding salaries (a zero bonus is not stored); the ledger-linked income stays out.
    assert_eq!(tax.incomes.len(), 12);
    assert!(tax.incomes.iter().all(|i| i.kind != "other"));
    assert_eq!(tax.deductions.len(), 12);

    let mut next = before.snapshot.clone();
    let removed = next.tax.incomes.remove(0);
    next.tax.incomes[0].gross = m("32000");
    let edited = next.tax.incomes[0].id.clone();
    let removed_deduction = next.tax.deductions.remove(0);
    next.tax.deductions.push(sync_deduction(&removed_deduction));
    let revision = storage::workspace(&pool, 2026)
        .await
        .unwrap()
        .profile
        .unwrap()
        .revision;
    assert!(
        sync::apply(
            &pool,
            &catalog,
            sync_request(&before, next.clone(), 1),
            today()
        )
        .await
        .unwrap()
    );
    let workspace = storage::workspace(&pool, 2026).await.unwrap();
    let profile = workspace.profile.unwrap();
    assert!(
        profile.income_complete,
        "synced deletes keep the confirmation"
    );
    assert!(profile.revision > revision);
    assert!(workspace.income.iter().all(|i| i.id != removed.id));
    assert_eq!(
        workspace
            .income
            .iter()
            .find(|i| i.id == edited)
            .unwrap()
            .gross,
        m("32000")
    );
    assert!(workspace.deductions.iter().any(|d| d.id == "phone-sso"));
    let after = sync::read(&pool).await.unwrap();
    assert_eq!(after.snapshot.tax, next.tax.sorted());

    // Two salaries for one employer and month are rejected before any write.
    let mut duplicate = after.snapshot.clone();
    let mut copy = duplicate.tax.incomes[1].clone();
    copy.id = "copy".into();
    duplicate.tax.incomes.push(copy);
    assert!(
        sync::apply(&pool, &catalog, sync_request(&after, duplicate, 2), today())
            .await
            .is_err()
    );
    pool.close().await;
}

fn sync_deduction(removed: &crate::tax_sync::TaxDeductionRow) -> crate::tax_sync::TaxDeductionRow {
    crate::tax_sync::TaxDeductionRow {
        id: "phone-sso".into(),
        amount: m("600"),
        ..removed.clone()
    }
}
