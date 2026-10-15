use crate::{
    catalog::{Catalog, hash},
    error::{AppError, AppResult},
    models::*,
    storage, wealth_storage,
};
use age::secrecy::SecretString;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{Read, Write},
    time::Instant,
};

pub const MAX_BACKUP_SIZE: usize = 50 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Backup {
    pub backup_format_version: u32,
    pub app_version: String,
    pub rules: BTreeMap<String, String>,
    pub years: Vec<YearProfile>,
    pub sources: Vec<IncomeSource>,
    pub income: Vec<IncomeEntry>,
    pub deductions: Vec<DeductionEntry>,
    pub snapshots: Vec<Snapshot>,
    pub settings: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wealth: Option<wealth_core::WealthData>,
}

#[derive(Serialize)]
pub struct BackupSummary {
    pub token: String,
    pub years: Vec<u16>,
    pub income_count: usize,
    pub deduction_count: usize,
    pub snapshot_count: usize,
    pub draft_count: usize,
    pub format_version: u32,
    pub account_count: usize,
    pub activity_count: usize,
    pub restore_scope: &'static str,
}

pub struct PendingBackup {
    pub token: String,
    pub backup: Backup,
    pub created_at: Instant,
}

pub async fn collect(pool: &SqlitePool, catalog: &Catalog) -> AppResult<Backup> {
    // Hold a write transaction to prevent interleaving modifications across all export reads.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let mut backup = Backup {
        backup_format_version: 2,
        app_version: env!("CARGO_PKG_VERSION").into(),
        rules: catalog.hashes.clone(),
        years: Vec::new(),
        sources: Vec::new(),
        income: Vec::new(),
        deductions: Vec::new(),
        snapshots: Vec::new(),
        settings: BTreeMap::new(),
        wealth: Some(wealth_storage::load_in(&mut tx).await?),
    };
    for row in sqlx::query("SELECT * FROM tax_years ORDER BY year")
        .fetch_all(&mut *tx)
        .await?
    {
        backup.years.push(YearProfile {
            year: row.try_get::<i64, _>("year")? as u16,
            facts: serde_json::from_str(row.try_get("eligibility_json")?)?,
            income_complete: row.try_get::<String, _>("completion_state")? == "complete",
            revision: row.try_get("revision")?,
        });
    }
    for row in sqlx::query("SELECT * FROM income_sources ORDER BY id")
        .fetch_all(&mut *tx)
        .await?
    {
        backup.sources.push(IncomeSource {
            id: row.try_get("id")?,
            tax_year: row.try_get::<i64, _>("tax_year")? as u16,
            label: row.try_get("label")?,
        });
    }
    for row in sqlx::query("SELECT * FROM income_entries ORDER BY id")
        .fetch_all(&mut *tx)
        .await?
    {
        backup.income.push(IncomeEntry {
            id: row.try_get("id")?,
            tax_year: row.try_get::<i64, _>("tax_year")? as u16,
            source_id: row.try_get("source_id")?,
            month: row.try_get::<i64, _>("month")? as u8,
            kind: row.try_get("kind")?,
            basis: serde_json::from_value(serde_json::Value::String(row.try_get("basis")?))?,
            gross: taxly_core::Money::from_satang(row.try_get("gross_satang")?)?,
            withholding: row
                .try_get::<Option<i64>, _>("withholding_satang")?
                .map(taxly_core::Money::from_satang)
                .transpose()?,
            note: row.try_get("note")?,
        });
    }
    for row in sqlx::query("SELECT * FROM deduction_entries ORDER BY id")
        .fetch_all(&mut *tx)
        .await?
    {
        backup.deductions.push(DeductionEntry {
            id: row.try_get("id")?,
            tax_year: row.try_get::<i64, _>("tax_year")? as u16,
            month: row.try_get::<i64, _>("month")? as u8,
            rule_code: row.try_get("rule_code")?,
            basis: serde_json::from_value(serde_json::Value::String(row.try_get("basis")?))?,
            amount: taxly_core::Money::from_satang(row.try_get("amount_satang")?)?,
        });
    }
    for row in sqlx::query("SELECT * FROM calculation_snapshots ORDER BY id")
        .fetch_all(&mut *tx)
        .await?
    {
        backup.snapshots.push(Snapshot {
            id: row.try_get("id")?,
            tax_year: row.try_get::<i64, _>("tax_year")? as u16,
            rule_set_id: row.try_get("rule_set_id")?,
            engine_version: row.try_get("engine_version")?,
            input_json: row.try_get("input_json")?,
            result_json: row.try_get("result_json")?,
            input_hash: row.try_get("input_hash")?,
            data_revision: row.try_get("data_revision")?,
            created_at: row.try_get("created_at")?,
        });
    }
    for row in sqlx::query("SELECT * FROM app_settings ORDER BY key")
        .fetch_all(&mut *tx)
        .await?
    {
        backup.settings.insert(
            row.try_get("key")?,
            serde_json::from_str(row.try_get("value_json")?)?,
        );
    }
    tx.commit().await?;
    backup.validate(catalog)?;
    Ok(backup)
}

impl Backup {
    pub fn validate(&self, catalog: &Catalog) -> AppResult<()> {
        if ![1, 2].contains(&self.backup_format_version) {
            return Err(AppError::backup("ไฟล์สำรองเป็นรุ่นที่แอปนี้ยังไม่รองรับ"));
        }
        match (self.backup_format_version, &self.wealth) {
            (2, Some(data)) => wealth_storage::validate_data(data)?,
            (1, None) => {}
            _ => return Err(AppError::backup("ข้อมูลการลงทุนไม่ตรงกับรุ่นไฟล์สำรอง")),
        }
        for (key, value) in &self.settings {
            if key == "active_tax_year" {
                let year: u16 = serde_json::from_value(value.clone())?;
                catalog.get(year)?;
                continue;
            }
            if !["onboarding_2025", "onboarding_2026"].contains(&key.as_str()) {
                return Err(AppError::backup("ไฟล์มีการตั้งค่าที่รุ่นนี้ไม่รองรับ"));
            }
            let draft: OnboardingDraft = serde_json::from_value(value.clone())?;
            draft.validate()?;
        }
        if self.years.len() > 2
            || self.sources.len() + self.income.len() + self.deductions.len() + self.snapshots.len()
                > 100_000
        {
            return Err(AppError::backup("ไฟล์สำรองมีจำนวนรายการมากเกินกว่ารุ่นนี้รองรับ"));
        }
        for (id, checksum) in &self.rules {
            if catalog.hashes.get(id) != Some(checksum) {
                return Err(AppError::backup("ไฟล์อ้างอิงชุดกฎที่ไม่ตรงกับแอปรุ่นนี้"));
            }
        }
        let mut years = HashSet::new();
        let revisions: HashMap<_, _> = self
            .years
            .iter()
            .map(|profile| (profile.year, profile.revision))
            .collect();
        for year in &self.years {
            catalog.get(year.year)?;
            if year.revision < 0 || !years.insert(year.year) {
                return Err(AppError::backup("ข้อมูลปีภาษีซ้ำหรือไม่ถูกต้อง"));
            }
        }
        let mut ids = HashSet::new();
        let mut sources = HashMap::new();
        for source in &self.sources {
            storage::validate_label(&source.label)?;
            if !years.contains(&source.tax_year) || !ids.insert(&source.id) {
                return Err(AppError::backup("ข้อมูลนายจ้างไม่ถูกต้อง"));
            }
            sources.insert(&source.id, source.tax_year);
        }
        let mut salary_slots = HashSet::new();
        ids.clear();
        for entry in &self.income {
            storage::validate_month(entry.month)?;
            entry.gross.satang()?;
            entry
                .withholding
                .map(taxly_core::Money::satang)
                .transpose()?;
            if !ids.insert(&entry.id)
                || sources.get(&entry.source_id) != Some(&entry.tax_year)
                || !["salary", "bonus"].contains(&entry.kind.as_str())
                || (entry.kind == "salary" && !salary_slots.insert((&entry.source_id, entry.month)))
            {
                return Err(AppError::backup("รายได้ซ้ำหรืออ้างอิงนายจ้างไม่ถูกต้อง"));
            }
        }
        let mut slots = HashSet::new();
        ids.clear();
        for entry in &self.deductions {
            storage::validate_month(entry.month)?;
            entry.amount.satang()?;
            if !ids.insert(&entry.id)
                || !years.contains(&entry.tax_year)
                || entry.rule_code != "sso_33"
                || !slots.insert((entry.tax_year, entry.month))
            {
                return Err(AppError::backup("รายการประกันสังคมไม่ถูกต้อง"));
            }
        }
        ids.clear();
        let mut snapshot_slots = HashSet::new();
        for snapshot in &self.snapshots {
            let rules = catalog.get(snapshot.tax_year)?;
            let input: taxly_core::AnnualTaxInput = serde_json::from_str(&snapshot.input_json)?;
            let output: serde_json::Value = serde_json::from_str(&snapshot.result_json)?;
            if !years.contains(&snapshot.tax_year)
                || !ids.insert(&snapshot.id)
                || !snapshot_slots.insert((
                    snapshot.tax_year,
                    snapshot.data_revision,
                    &snapshot.rule_set_id,
                    &snapshot.engine_version,
                ))
                || self.rules.get(&snapshot.rule_set_id)
                    != catalog.hashes.get(&snapshot.rule_set_id)
                || snapshot.rule_set_id != rules.rule_set_id
                || input.year != snapshot.tax_year
                || hash(&snapshot.input_json) != snapshot.input_hash
                || snapshot.data_revision < 0
                || revisions
                    .get(&snapshot.tax_year)
                    .is_none_or(|revision| snapshot.data_revision > *revision)
                || !output.is_object()
            {
                return Err(AppError::backup("ประวัติผลคำนวณหรือแหล่งกฎไม่ถูกต้อง"));
            }
            if snapshot.engine_version == env!("CARGO_PKG_VERSION")
                && serde_json::to_value(taxly_core::calculate(&input, rules)?)? != output
            {
                return Err(AppError::backup("ประวัติผลคำนวณไม่ตรงกับข้อมูลและชุดกฎที่ระบุ"));
            }
        }
        Ok(())
    }
}

pub fn encrypt(backup: &Backup, password: String) -> AppResult<Vec<u8>> {
    if password.chars().count() < 12 {
        return Err(AppError::invalid("ตั้งรหัสผ่านสำรองข้อมูลอย่างน้อย 12 ตัวอักษร"));
    }
    let json = serde_json::to_vec(backup)?;
    if json.len() > MAX_BACKUP_SIZE {
        return Err(AppError::backup("ข้อมูลสำรองมีขนาดเกิน 50 MiB"));
    }
    let encryptor = age::Encryptor::with_user_passphrase(SecretString::from(password));
    let mut encrypted = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|_| AppError::backup("เข้ารหัสข้อมูลไม่สำเร็จ"))?;
    writer.write_all(&json)?;
    writer.finish()?;
    Ok(encrypted)
}

pub fn decrypt(encrypted: &[u8], password: String, catalog: &Catalog) -> AppResult<Backup> {
    if encrypted.len() > MAX_BACKUP_SIZE + 1024 * 1024 {
        return Err(AppError::backup("ไฟล์สำรองใหญ่เกินกว่าที่รองรับ"));
    }
    let decryptor =
        age::Decryptor::new(encrypted).map_err(|_| AppError::backup("ไฟล์นี้ไม่ใช่ไฟล์สำรองที่รองรับ"))?;
    let identity = age::scrypt::Identity::new(SecretString::from(password));
    let reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| AppError::backup("รหัสผ่านไม่ถูกต้องหรือไฟล์สำรองเสียหาย"))?;
    let mut bytes = Vec::new();
    reader
        .take((MAX_BACKUP_SIZE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::backup("รหัสผ่านไม่ถูกต้องหรือไฟล์สำรองเสียหาย"))?;
    if bytes.len() > MAX_BACKUP_SIZE {
        return Err(AppError::backup("ข้อมูลที่ถอดรหัสมีขนาดเกิน 50 MiB"));
    }
    let backup: Backup =
        serde_json::from_slice(&bytes).map_err(|_| AppError::backup("โครงสร้างข้อมูลสำรองไม่ถูกต้อง"))?;
    backup.validate(catalog)?;
    Ok(backup)
}

pub async fn restore(pool: &SqlitePool, catalog: &Catalog, backup: Backup) -> AppResult<()> {
    backup.validate(catalog)?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("DELETE FROM tax_years")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM app_settings")
        .execute(&mut *tx)
        .await?;
    for year in backup.years {
        sqlx::query("INSERT INTO tax_years(year,eligibility_json,completion_state,revision) VALUES (?,?,?,?)").bind(i64::from(year.year)).bind(serde_json::to_string(&year.facts)?).bind(if year.income_complete {"complete"}else{"incomplete"}).bind(year.revision).execute(&mut *tx).await?;
    }
    for source in backup.sources {
        sqlx::query("INSERT INTO income_sources(id,tax_year,label) VALUES (?,?,?)")
            .bind(source.id)
            .bind(i64::from(source.tax_year))
            .bind(source.label)
            .execute(&mut *tx)
            .await?;
    }
    for entry in backup.income {
        sqlx::query("INSERT INTO income_entries(id,tax_year,source_id,month,kind,basis,gross_satang,withholding_satang,note) VALUES (?,?,?,?,?,?,?,?,?)").bind(entry.id).bind(i64::from(entry.tax_year)).bind(entry.source_id).bind(i64::from(entry.month)).bind(entry.kind).bind(basis_text(entry.basis)).bind(entry.gross.satang()?).bind(entry.withholding.map(taxly_core::Money::satang).transpose()?).bind(entry.note).execute(&mut *tx).await?;
    }
    for entry in backup.deductions {
        sqlx::query("INSERT INTO deduction_entries(id,tax_year,month,rule_code,basis,amount_satang) VALUES (?,?,?,?,?,?)").bind(entry.id).bind(i64::from(entry.tax_year)).bind(i64::from(entry.month)).bind(entry.rule_code).bind(basis_text(entry.basis)).bind(entry.amount.satang()?).execute(&mut *tx).await?;
    }
    for snapshot in backup.snapshots {
        sqlx::query("INSERT INTO calculation_snapshots(id,tax_year,rule_set_id,engine_version,input_json,result_json,input_hash,data_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(snapshot.id).bind(i64::from(snapshot.tax_year)).bind(snapshot.rule_set_id).bind(snapshot.engine_version).bind(snapshot.input_json).bind(snapshot.result_json).bind(snapshot.input_hash).bind(snapshot.data_revision).bind(snapshot.created_at).execute(&mut *tx).await?;
    }
    for (key, value) in backup.settings {
        sqlx::query("INSERT INTO app_settings(key,value_json) VALUES (?,?)")
            .bind(key)
            .bind(serde_json::to_string(&value)?)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(mut wealth) = backup.wealth {
        // Invalidate every pre-restore import/refresh even if the backup happens
        // to contain the same revision as the current database.
        let current: i64 = sqlx::query_scalar("SELECT revision FROM wealth_meta WHERE id=1")
            .fetch_one(&mut *tx)
            .await?;
        wealth.revision = current
            .max(wealth.revision)
            .checked_add(1)
            .ok_or_else(|| AppError::backup("รุ่นข้อมูลเกินขอบเขตที่รองรับ"))?;
        wealth_storage::replace_in(&mut tx, &wealth).await?;
    }
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *tx)
        .await?;
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut *tx)
        .await?;
    if !violations.is_empty() || integrity != "ok" {
        return Err(AppError::backup("ข้อมูลกู้คืนไม่ผ่านการตรวจสอบ ข้อมูลเดิมยังอยู่ครบ"));
    }
    tx.commit().await?;
    Ok(())
}
