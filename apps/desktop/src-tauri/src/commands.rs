use crate::{
    AppState,
    backup::{self, BackupSummary, PendingBackup},
    error::{AppError, AppResult},
    models::*,
    services, storage,
};
use std::{
    io::Write,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use taxly_core::{RuleSource, TaxCalculation, TaxpayerFacts};
use uuid::Uuid;

#[tauri::command]
pub async fn list_tax_years(state: State<'_, AppState>) -> AppResult<Vec<u16>> {
    Ok(state.catalog.rules.keys().rev().copied().collect())
}
#[tauri::command]
pub async fn get_active_tax_year(state: State<'_, AppState>) -> AppResult<u16> {
    let stored: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM app_settings WHERE key='active_tax_year'")
            .fetch_optional(&state.pool)
            .await?;
    let year = stored
        .map(|value| serde_json::from_str::<u16>(&value))
        .transpose()?
        .unwrap_or(2026);
    state.catalog.get(year)?;
    Ok(year)
}
#[tauri::command]
pub async fn set_active_tax_year(year: u16, state: State<'_, AppState>) -> AppResult<()> {
    state.catalog.get(year)?;
    sqlx::query("INSERT INTO app_settings(key,value_json) VALUES ('active_tax_year',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json")
        .bind(serde_json::to_string(&year)?).execute(&state.pool).await?;
    Ok(())
}
#[tauri::command]
pub async fn get_year_workspace(year: u16, state: State<'_, AppState>) -> AppResult<YearWorkspace> {
    state.catalog.get(year)?;
    storage::workspace(&state.pool, year).await
}
#[tauri::command]
pub async fn save_onboarding(
    request: OnboardingRequest,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.catalog.get(request.year)?;
    storage::onboarding(&state.pool, request).await
}
#[tauri::command]
pub async fn save_onboarding_draft(
    year: u16,
    draft: OnboardingDraft,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.catalog.get(year)?;
    draft.validate()?;
    let data = serde_json::to_string(&draft)?;
    sqlx::query("INSERT INTO app_settings(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").bind(format!("onboarding_{year}")).bind(data).execute(&state.pool).await?;
    Ok(())
}
#[tauri::command]
pub async fn save_profile(
    year: u16,
    facts: TaxpayerFacts,
    income_complete: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.catalog.get(year)?;
    storage::save_profile(&state.pool, year, facts, income_complete).await
}
#[tauri::command]
pub async fn upsert_income(request: IncomeRequest, state: State<'_, AppState>) -> AppResult<()> {
    state.catalog.get(request.year)?;
    storage::upsert_income(&state.pool, request).await
}
#[tauri::command]
pub async fn delete_income(year: u16, id: String, state: State<'_, AppState>) -> AppResult<()> {
    storage::delete_entry(&state.pool, year, &id, true).await
}
#[tauri::command]
pub async fn upsert_deduction(
    request: DeductionRequest,
    state: State<'_, AppState>,
) -> AppResult<()> {
    state.catalog.get(request.year)?;
    storage::upsert_deduction(&state.pool, request).await
}
#[tauri::command]
pub async fn delete_deduction(year: u16, id: String, state: State<'_, AppState>) -> AppResult<()> {
    storage::delete_entry(&state.pool, year, &id, false).await
}
#[tauri::command]
pub async fn calculate_year(year: u16, state: State<'_, AppState>) -> AppResult<TaxCalculation> {
    services::calculate_year(&state.pool, &state.catalog, year).await
}
#[tauri::command]
pub async fn save_snapshot(year: u16, state: State<'_, AppState>) -> AppResult<()> {
    services::save_snapshot(&state.pool, &state.catalog, year).await
}
#[tauri::command]
pub async fn get_history(year: u16, state: State<'_, AppState>) -> AppResult<Vec<Snapshot>> {
    storage::history(&state.pool, year).await
}
#[tauri::command]
pub async fn get_deduction_guidance(
    year: u16,
    state: State<'_, AppState>,
) -> AppResult<Vec<Guidance>> {
    services::guidance(&state.pool, &state.catalog, year).await
}
#[tauri::command]
pub async fn get_rule_sources(year: u16, state: State<'_, AppState>) -> AppResult<Vec<RuleSource>> {
    Ok(state.catalog.get(year)?.sources.clone())
}
#[tauri::command]
pub async fn open_source(
    year: u16,
    source_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let source = state
        .catalog
        .get(year)?
        .sources
        .iter()
        .find(|source| source.id == source_id)
        .ok_or_else(|| AppError::invalid("ไม่พบแหล่งอ้างอิง"))?;
    // Only compiled-in source URLs can reach the operating system opener.
    if !source.url.starts_with("https://") {
        return Err(AppError::invalid("แหล่งอ้างอิงไม่ปลอดภัย"));
    }
    app.opener()
        .open_url(&source.url, None::<&str>)
        .map_err(|_| AppError::invalid("เปิดแหล่งอ้างอิงไม่สำเร็จ"))?;
    Ok(())
}

#[tauri::command]
pub async fn open_ledger_mobile(url: String, app: AppHandle) -> AppResult<()> {
    let parsed = tauri::Url::parse(&url).map_err(|_| AppError::invalid("ที่อยู่เว็บมือถือไม่ถูกต้อง"))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || url.len() > 512
    {
        return Err(AppError::invalid(
            "ที่อยู่เว็บมือถือต้องเป็น HTTPS และไม่มีข้อมูลเข้าสู่ระบบ",
        ));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|_| AppError::invalid("เปิดเว็บมือถือไม่สำเร็จ"))?;
    Ok(())
}

#[tauri::command]
pub async fn export_backup(
    password: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let dialog_app = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("Taxly encrypted backup", &["age"])
            .set_file_name("Taxly-backup.taxly.age")
            .blocking_save_file()
    })
    .await
    .map_err(|_| AppError::invalid("เปิดหน้าต่างเลือกไฟล์ไม่สำเร็จ"))?
    .ok_or_else(AppError::cancelled)?;
    let path = file
        .into_path()
        .map_err(|_| AppError::invalid("เส้นทางไฟล์ไม่ถูกต้อง"))?;
    let data = backup::collect(&state.pool, &state.catalog).await?;
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        let encrypted = backup::encrypt(&data, password)?;
        let parent = path
            .parent()
            .ok_or_else(|| AppError::invalid("ไม่พบโฟลเดอร์ปลายทาง"))?;
        let temp = parent.join(format!(".taxly-{}.tmp", Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| -> AppResult<()> {
            let mut file = options.open(&temp)?;
            file.write_all(&encrypted)?;
            file.sync_all()?;
            std::fs::rename(&temp, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    })
    .await
    .map_err(|_| AppError::backup("สำรองข้อมูลไม่สำเร็จ"))?
}

#[tauri::command]
pub async fn inspect_backup(
    password: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<BackupSummary> {
    *state.pending_backup.lock().await = None;
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Taxly encrypted backup", &["age"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| AppError::invalid("เปิดหน้าต่างเลือกไฟล์ไม่สำเร็จ"))?
    .ok_or_else(AppError::cancelled)?;
    let path = file
        .into_path()
        .map_err(|_| AppError::invalid("เส้นทางไฟล์ไม่ถูกต้อง"))?;
    let catalog = Arc::clone(&state.catalog);
    let data = tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
        if std::fs::metadata(&path)?.len() > (backup::MAX_BACKUP_SIZE + 1024 * 1024) as u64 {
            return Err(AppError::backup("ไฟล์สำรองใหญ่เกินกว่าที่รองรับ"));
        }
        let encrypted = std::fs::read(path)?;
        backup::decrypt(&encrypted, password, &catalog)
    })
    .await
    .map_err(|_| AppError::backup("ตรวจไฟล์สำรองไม่สำเร็จ"))??;
    let token = Uuid::new_v4().to_string();
    let summary = BackupSummary {
        token: token.clone(),
        years: data.years.iter().map(|year| year.year).collect(),
        income_count: data.income.len(),
        deduction_count: data.deductions.len(),
        snapshot_count: data.snapshots.len(),
        draft_count: data
            .settings
            .keys()
            .filter(|key| key.starts_with("onboarding_"))
            .count(),
        format_version: data.backup_format_version,
        ledger_count: data
            .ledger
            .as_ref()
            .map_or(0, |ledger| ledger.entries.len()),
        restore_scope: if data.ledger.is_none() {
            "tax_only"
        } else {
            "all"
        },
    };
    *state.pending_backup.lock().await = Some(PendingBackup {
        token,
        backup: data,
        created_at: Instant::now(),
    });
    Ok(summary)
}

#[tauri::command]
pub async fn restore_backup(token: String, state: State<'_, AppState>) -> AppResult<()> {
    let pending = state
        .pending_backup
        .lock()
        .await
        .take()
        .ok_or_else(|| AppError::backup("กรุณาเลือกไฟล์และตรวจข้อมูลอีกครั้ง"))?;
    if pending.token != token || pending.created_at.elapsed() > Duration::from_secs(300) {
        return Err(AppError::backup("คำขอกู้คืนหมดอายุ กรุณาตรวจไฟล์อีกครั้ง"));
    }
    backup::restore(&state.pool, &state.catalog, pending.backup).await
}
#[tauri::command]
pub async fn delete_all_data(state: State<'_, AppState>) -> AppResult<()> {
    *state.pending_backup.lock().await = None;
    storage::delete_all(&state.pool).await
}

#[tauri::command]
pub async fn cancel_restore(state: State<'_, AppState>) -> AppResult<()> {
    *state.pending_backup.lock().await = None;
    Ok(())
}
