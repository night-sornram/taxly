//! Portable ledger snapshots never contain another device's SQLite tax IDs.
use crate::{
    AppState,
    catalog::Catalog,
    error::{AppError, AppResult},
    ledger::{self, TaxLink},
    storage,
    tax_sync::{self, TaxSnapshot},
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};
use tauri::State;
use taxly_core::Money;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SyncEntry {
    pub id: String,
    pub date: String,
    pub category_id: String,
    pub amount: Money,
    pub note: String,
    pub tax: Option<TaxLink>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SyncSnapshot {
    pub categories: Vec<ledger::LedgerCategory>,
    pub entries: Vec<SyncEntry>,
    /// Absent in snapshots saved before tax sync.
    #[serde(default)]
    pub tax: TaxSnapshot,
}
#[derive(Serialize)]
pub struct SyncState {
    pub revision: i64,
    pub owner_id: Option<String>,
    pub project_url: Option<String>,
    pub enabled: bool,
    pub cloud_revision: i64,
    pub base_snapshot: SyncSnapshot,
    pub snapshot: SyncSnapshot,
    pub upload: Option<Upload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Upload {
    pub id: String,
    pub expected_revision: i64,
    pub local_snapshot: SyncSnapshot,
    pub snapshot: SyncSnapshot,
}

pub async fn state_in(tx: &mut Transaction<'_, Sqlite>) -> AppResult<SyncState> {
    let data = ledger::load_in(tx).await?;
    let mut links = HashMap::new();
    for row in sqlx::query("SELECT l.id,s.label,i.kind,i.withholding_satang FROM ledger_entries l JOIN income_entries i ON i.id=l.tax_income_id JOIN income_sources s ON s.id=i.source_id")
        .fetch_all(&mut **tx).await? {
        let withholding: Option<i64> = row.try_get("withholding_satang")?;
        links.insert(row.try_get::<String,_>("id")?, TaxLink { source_label: row.try_get("label")?, kind: row.try_get("kind")?,
            withholding: withholding.map(Money::from_satang).transpose()? });
    }
    let meta = sqlx::query("SELECT * FROM ledger_sync_state WHERE id=1")
        .fetch_one(&mut **tx)
        .await?;
    let mut state = SyncState {
        revision: meta.try_get("revision")?,
        owner_id: meta.try_get("owner_id")?,
        project_url: meta.try_get("project_url")?,
        enabled: meta.try_get::<i64, _>("enabled")? == 1,
        cloud_revision: meta.try_get("cloud_revision")?,
        base_snapshot: serde_json::from_str(meta.try_get("base_snapshot")?)?,
        upload: meta
            .try_get::<Option<String>, _>("upload_json")?
            .map(|json| serde_json::from_str(&json))
            .transpose()?,
        snapshot: SyncSnapshot {
            categories: data.categories,
            entries: data
                .entries
                .into_iter()
                .map(|e| SyncEntry {
                    tax: links.remove(&e.id),
                    id: e.id,
                    date: e.date,
                    category_id: e.category_id,
                    amount: e.amount,
                    note: e.note,
                })
                .collect(),
            tax: tax_sync::load(tx).await?,
        },
    };
    state.snapshot.categories.sort_by(|a, b| a.id.cmp(&b.id));
    state.snapshot.entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(state)
}

pub async fn read(pool: &SqlitePool) -> AppResult<SyncState> {
    let mut tx = pool.begin().await?;
    let state = state_in(&mut tx).await?;
    tx.commit().await?;
    Ok(state)
}

fn stale() -> AppError {
    AppError {
        code: "StaleRevision",
        message: "ข้อมูลในเครื่องเปลี่ยน กำลังตรวจการซิงก์ใหม่".into(),
    }
}
fn identity(owner: &str, project: &str) -> AppResult<()> {
    if uuid::Uuid::parse_str(owner).is_err()
        || !project.starts_with("https://")
        || project.len() > 250
    {
        return Err(AppError::invalid("บัญชีหรือที่อยู่บริการซิงก์ไม่ถูกต้อง"));
    }
    Ok(())
}

pub async fn bind(pool: &SqlitePool, owner: &str, project: &str, enabled: bool) -> AppResult<()> {
    identity(owner, project)?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let old = state_in(&mut tx).await?;
    if old.owner_id.as_deref().is_some_and(|id| id != owner)
        || old.project_url.as_deref().is_some_and(|url| url != project)
    {
        return Err(AppError {
            code: "SyncAccountMismatch",
            message: "ข้อมูลในเครื่องเชื่อมกับบัญชีอื่นอยู่ กรุณาใช้บัญชีเดิมเพื่อป้องกันข้อมูลปะปน".into(),
        });
    }
    sqlx::query("UPDATE ledger_sync_state SET owner_id=?,project_url=?,enabled=?,revision=revision+1 WHERE id=1")
        .bind(owner)
        .bind(project)
        .bind(enabled)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub fn validate(snapshot: &SyncSnapshot) -> AppResult<()> {
    let id_ok =
        |id: &str| !id.trim().is_empty() && id.len() <= 128 && !id.chars().any(char::is_control);
    if snapshot.categories.iter().any(|c| !id_ok(&c.id))
        || snapshot.entries.iter().any(|e| !id_ok(&e.id))
    {
        return Err(AppError::invalid("รหัสข้อมูลซิงก์ไม่ถูกต้อง"));
    }
    let data = ledger::LedgerData {
        categories: snapshot.categories.clone(),
        entries: snapshot
            .entries
            .iter()
            .map(|e| ledger::LedgerEntry {
                id: e.id.clone(),
                date: e.date.clone(),
                category_id: e.category_id.clone(),
                amount: e.amount,
                note: e.note.clone(),
                tax_income_id: None,
            })
            .collect(),
    };
    ledger::validate_data(&data, &HashSet::new())?;
    tax_sync::validate(&snapshot.tax)?;
    for entry in &snapshot.entries {
        if let Some(tax) = &entry.tax
            && (snapshot
                .categories
                .iter()
                .find(|c| c.id == entry.category_id)
                .is_none_or(|c| c.kind != "income")
                || !["salary", "bonus", "other"].contains(&tax.kind.as_str())
                || tax.source_label.trim().is_empty()
                || tax.source_label.chars().count() > 100
                || tax
                    .withholding
                    .is_some_and(|m| m.satang().map_or(true, |n| n < 0)))
        {
            return Err(AppError::invalid("ข้อมูลเชื่อมภาษีของรายการซิงก์ไม่ถูกต้อง"));
        }
    }
    Ok(())
}

/// Backup/reset are local actions: pause upload and require explicit reconnection.
pub async fn pause_for_restore(tx: &mut Transaction<'_, Sqlite>) -> AppResult<()> {
    sqlx::query("UPDATE ledger_sync_state SET enabled=0,cloud_revision=0,base_snapshot='{\"categories\":[],\"entries\":[]}',upload_json=NULL,revision=revision+1 WHERE id=1")
        .execute(&mut **tx).await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyRequest {
    pub owner_id: String,
    pub project_url: String,
    pub expected_revision: i64,
    pub cloud_revision: i64,
    pub snapshot: SyncSnapshot,
    pub base_snapshot: SyncSnapshot,
}

pub async fn apply(
    pool: &SqlitePool,
    catalog: &Catalog,
    mut request: ApplyRequest,
    today: NaiveDate,
) -> AppResult<bool> {
    request.snapshot.tax = std::mem::take(&mut request.snapshot.tax).sorted();
    identity(&request.owner_id, &request.project_url)?;
    validate(&request.snapshot)?;
    validate(&request.base_snapshot)?;
    if request.cloud_revision < 0 {
        return Err(AppError::invalid("รุ่นข้อมูลซิงก์ไม่ถูกต้อง"));
    }
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let old = state_in(&mut tx).await?;
    if old.revision != request.expected_revision
        || request.cloud_revision < old.cloud_revision
        || !old.enabled
        || old.owner_id.as_deref() != Some(&request.owner_id)
        || old.project_url.as_deref() != Some(&request.project_url)
    {
        return Err(stale());
    }
    let changed = old.snapshot != request.snapshot;
    if changed {
        // Tax years first: linked ledger incomes need their year to exist.
        tax_sync::apply(&mut tx, &old.snapshot.tax, &request.snapshot.tax).await?;
        let old_entries: HashMap<_, _> = old
            .snapshot
            .entries
            .iter()
            .map(|e| (e.id.as_str(), e))
            .collect();
        let next_ids: HashSet<_> = request
            .snapshot
            .entries
            .iter()
            .map(|e| e.id.as_str())
            .collect();
        for entry in &old.snapshot.entries {
            if !next_ids.contains(entry.id.as_str()) {
                let link: Option<String> =
                    sqlx::query_scalar("SELECT tax_income_id FROM ledger_entries WHERE id=?")
                        .bind(&entry.id)
                        .fetch_one(&mut *tx)
                        .await?;
                if let Some(id) = link {
                    let year: i64 =
                        sqlx::query_scalar("SELECT tax_year FROM income_entries WHERE id=?")
                            .bind(&id)
                            .fetch_one(&mut *tx)
                            .await?;
                    storage::delete_entry_in(&mut tx, year as u16, &id, true).await?;
                }
                sqlx::query("DELETE FROM ledger_entries WHERE id=?")
                    .bind(&entry.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        // Reserve names temporarily so valid simultaneous renames can swap names.
        for category in &old.snapshot.categories {
            if let Some(next) = request
                .snapshot
                .categories
                .iter()
                .find(|c| c.id == category.id)
                && next.kind != category.kind
            {
                return Err(AppError::invalid("ประเภทหมวดหมู่ที่มีอยู่แล้วเปลี่ยนไม่ได้"));
            }
            sqlx::query("UPDATE ledger_categories SET name=? WHERE id=?")
                .bind(format!("sync-{}", uuid::Uuid::new_v4()))
                .bind(&category.id)
                .execute(&mut *tx)
                .await?;
        }
        for category in &request.snapshot.categories {
            sqlx::query("INSERT INTO ledger_categories(id,kind,name) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name")
                .bind(&category.id).bind(&category.kind).bind(&category.name).execute(&mut *tx).await?;
        }
        for entry in &request.snapshot.entries {
            if old_entries
                .get(entry.id.as_str())
                .is_some_and(|old| *old == entry)
            {
                continue;
            }
            ledger::save_entry_in(
                &mut tx,
                catalog,
                ledger::EntryRequest {
                    id: old_entries
                        .contains_key(entry.id.as_str())
                        .then(|| entry.id.clone()),
                    date: entry.date.clone(),
                    category_id: entry.category_id.clone(),
                    amount: entry.amount,
                    note: entry.note.clone(),
                    tax: entry.tax.clone(),
                },
                today,
                Some(entry.id.clone()),
            )
            .await?;
        }
        let next_categories: HashSet<_> = request
            .snapshot
            .categories
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        for category in &old.snapshot.categories {
            if !next_categories.contains(category.id.as_str()) {
                sqlx::query("DELETE FROM ledger_categories WHERE id=?")
                    .bind(&category.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    sqlx::query("UPDATE ledger_sync_state SET base_snapshot=?,cloud_revision=?,upload_json=NULL,revision=revision+1 WHERE id=1")
        .bind(serde_json::to_string(&request.base_snapshot)?)
        .bind(request.cloud_revision)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(changed)
}

#[tauri::command]
pub async fn get_ledger_sync_state(state: State<'_, AppState>) -> AppResult<SyncState> {
    read(&state.pool).await
}
#[tauri::command]
pub async fn stage_ledger_sync(
    owner_id: String,
    project_url: String,
    expected_revision: i64,
    upload: Upload,
    state: State<'_, AppState>,
) -> AppResult<()> {
    stage(
        &state.pool,
        &owner_id,
        &project_url,
        expected_revision,
        upload,
    )
    .await
}
pub async fn stage(
    pool: &SqlitePool,
    owner_id: &str,
    project_url: &str,
    expected_revision: i64,
    upload: Upload,
) -> AppResult<()> {
    identity(owner_id, project_url)?;
    validate(&upload.snapshot)?;
    validate(&upload.local_snapshot)?;
    if uuid::Uuid::parse_str(&upload.id).is_err() || upload.expected_revision < 0 {
        return Err(AppError::invalid("รายการส่งข้อมูลไม่ถูกต้อง"));
    }
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let old = state_in(&mut tx).await?;
    if old.revision != expected_revision
        || old.upload.is_some()
        || !old.enabled
        || old.owner_id.as_deref() != Some(owner_id)
        || old.project_url.as_deref() != Some(project_url)
    {
        return Err(stale());
    }
    sqlx::query("UPDATE ledger_sync_state SET upload_json=?,revision=revision+1 WHERE id=1")
        .bind(serde_json::to_string(&upload)?)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
#[tauri::command]
pub async fn bind_ledger_sync_account(
    owner_id: String,
    project_url: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    bind(&state.pool, &owner_id, &project_url, enabled).await
}
#[tauri::command]
pub async fn apply_ledger_sync(
    request: ApplyRequest,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    apply(
        &state.pool,
        &state.catalog,
        request,
        chrono::Local::now().date_naive(),
    )
    .await
}
