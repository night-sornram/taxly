use crate::{
    catalog::Catalog,
    error::{AppError, AppResult},
    models::*,
};
use sqlx::{
    Row, Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use std::{path::Path, str::FromStr, time::Duration};
use taxly_core::{AmountBasis, Money, TaxpayerFacts};
use uuid::Uuid;

pub async fn connect(path: &Path, catalog: &Catalog) -> AppResult<SqlitePool> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    // Pre-create with private permissions before SQLite can write sensitive data.
    let mut file = std::fs::OpenOptions::new();
    file.write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        file.mode(0o600);
    }
    file.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    let options = SqliteConnectOptions::from_str("sqlite://")?
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|_| AppError::invalid("อัปเกรดฐานข้อมูลไม่สำเร็จ ข้อมูลเดิมยังไม่ถูกลบ"))?;
    let mut tx = pool.begin().await?;
    crate::ledger::seed_categories(&mut tx).await?;
    tx.commit().await?;
    for (year, rule) in &catalog.rules {
        let expected = &catalog.hashes[&rule.rule_set_id];
        sqlx::query("INSERT INTO rule_sets (id,tax_year,version,schema_version,payload_json,sha256,review_state,verified_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
            .bind(&rule.rule_set_id).bind(i64::from(*year)).bind(&rule.version).bind(i64::from(rule.schema_version)).bind(catalog.payloads[year])
            .bind(expected).bind(&rule.review_state).bind(&rule.verified_at).execute(&pool).await?;
        let stored: String = sqlx::query_scalar("SELECT sha256 FROM rule_sets WHERE id=?")
            .bind(&rule.rule_set_id)
            .fetch_one(&pool)
            .await?;
        if &stored != expected {
            return Err(AppError::invalid("ชุดกฎที่จัดเก็บไม่ตรงกับชุดกฎของแอป"));
        }
    }
    Ok(pool)
}

pub fn validate_month(month: u8) -> AppResult<()> {
    if !(1..=12).contains(&month) {
        Err(AppError::invalid("เลือกเดือนให้ถูกต้อง"))
    } else {
        Ok(())
    }
}
pub fn validate_label(label: &str) -> AppResult<()> {
    if label.trim().is_empty() || label.chars().count() > 100 {
        Err(AppError::invalid("ชื่อนายจ้างต้องมี 1–100 ตัวอักษร"))
    } else {
        Ok(())
    }
}
fn decode_basis(value: String) -> AppResult<AmountBasis> {
    match value.as_str() {
        "actual" => Ok(AmountBasis::Actual),
        "forecast" => Ok(AmountBasis::Forecast),
        _ => Err(AppError::invalid("สถานะรายการไม่ถูกต้อง")),
    }
}

pub async fn workspace(pool: &SqlitePool, year: u16) -> AppResult<YearWorkspace> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query("SELECT * FROM tax_years WHERE year=?")
        .bind(i64::from(year))
        .fetch_optional(&mut *tx)
        .await?;
    let profile = row
        .map(|row| -> AppResult<YearProfile> {
            Ok(YearProfile {
                year,
                facts: serde_json::from_str(row.try_get("eligibility_json")?)?,
                income_complete: row.try_get::<String, _>("completion_state")? == "complete",
                revision: row.try_get("revision")?,
            })
        })
        .transpose()?;
    let sources = sqlx::query("SELECT * FROM income_sources WHERE tax_year=? ORDER BY label")
        .bind(i64::from(year))
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|row| -> AppResult<_> {
            Ok(IncomeSource {
                id: row.try_get("id")?,
                tax_year: year,
                label: row.try_get("label")?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let income =
        sqlx::query("SELECT * FROM income_entries WHERE tax_year=? ORDER BY month,kind,id")
            .bind(i64::from(year))
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|row| -> AppResult<_> {
                Ok(IncomeEntry {
                    id: row.try_get("id")?,
                    tax_year: year,
                    source_id: row.try_get("source_id")?,
                    month: row.try_get::<i64, _>("month")? as u8,
                    kind: row.try_get("kind")?,
                    basis: decode_basis(row.try_get("basis")?)?,
                    gross: Money::from_satang(row.try_get("gross_satang")?)?,
                    withholding: row
                        .try_get::<Option<i64>, _>("withholding_satang")?
                        .map(Money::from_satang)
                        .transpose()?,
                    note: row.try_get("note")?,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
    let deductions = sqlx::query("SELECT * FROM deduction_entries WHERE tax_year=? ORDER BY month")
        .bind(i64::from(year))
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .map(|row| -> AppResult<_> {
            Ok(DeductionEntry {
                id: row.try_get("id")?,
                tax_year: year,
                month: row.try_get::<i64, _>("month")? as u8,
                rule_code: row.try_get("rule_code")?,
                basis: decode_basis(row.try_get("basis")?)?,
                amount: Money::from_satang(row.try_get("amount_satang")?)?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let draft: Option<String> =
        sqlx::query_scalar("SELECT value_json FROM app_settings WHERE key=?")
            .bind(format!("onboarding_{year}"))
            .fetch_optional(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(YearWorkspace {
        year,
        profile,
        sources,
        income,
        deductions,
        draft: draft
            .map(|value| serde_json::from_str(&value))
            .transpose()?,
    })
}

async fn bump(tx: &mut Transaction<'_, Sqlite>, year: u16) -> AppResult<()> {
    let result=sqlx::query("UPDATE tax_years SET revision=revision+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE year=?").bind(i64::from(year)).execute(&mut **tx).await?;
    if result.rows_affected() != 1 {
        return Err(AppError::invalid("กรุณาเริ่มต้นข้อมูลปีภาษีก่อน"));
    }
    Ok(())
}

pub(crate) async fn source(
    tx: &mut Transaction<'_, Sqlite>,
    year: u16,
    label: &str,
) -> AppResult<String> {
    if let Some(id) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM income_sources WHERE tax_year=? AND label=?",
    )
    .bind(i64::from(year))
    .bind(label.trim())
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO income_sources(id,tax_year,label) VALUES (?,?,?)")
        .bind(&id)
        .bind(i64::from(year))
        .bind(label.trim())
        .execute(&mut **tx)
        .await?;
    Ok(id)
}

pub async fn onboarding(pool: &SqlitePool, request: OnboardingRequest) -> AppResult<()> {
    validate_month(request.start_month)?;
    validate_month(request.end_month)?;
    validate_month(request.bonus_month)?;
    validate_label(&request.source_label)?;
    if request.start_month > request.end_month || request.actual_through > 12 {
        return Err(AppError::invalid("ช่วงเดือนไม่ถูกต้อง"));
    }
    if request.facts.social_security_confirmed && request.monthly_sso.is_none() {
        return Err(AppError::invalid(
            "หากยืนยันประกันสังคม ต้องระบุจำนวนหรือ 0 เมื่อไม่ได้จ่าย",
        ));
    }
    if request.income_complete && request.bonus.is_none() {
        return Err(AppError::invalid("หากยืนยันรายได้ครบปี ต้องระบุโบนัสหรือ 0 เมื่อไม่มี"));
    }
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO tax_years(year,eligibility_json,completion_state,revision) VALUES (?,?,?,1)",
    )
    .bind(i64::from(request.year))
    .bind(serde_json::to_string(&request.facts)?)
    .bind(if request.income_complete {
        "complete"
    } else {
        "incomplete"
    })
    .execute(&mut *tx)
    .await?;
    let source = source(&mut tx, request.year, &request.source_label).await?;
    for month in request.start_month..=request.end_month {
        let actual = month <= request.actual_through;
        let basis = if actual { "actual" } else { "forecast" };
        let withholding = if actual || request.forecast_withholding {
            request.monthly_withholding
        } else {
            None
        };
        sqlx::query("INSERT INTO income_entries(id,tax_year,source_id,month,kind,basis,gross_satang,withholding_satang) VALUES (?,?,?,?,'salary',?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(i64::from(request.year)).bind(&source).bind(i64::from(month)).bind(basis).bind(request.monthly_salary.satang()?).bind(withholding.map(Money::satang).transpose()?).execute(&mut *tx).await?;
        if let Some(amount) = request.monthly_sso {
            sqlx::query("INSERT INTO deduction_entries(id,tax_year,month,rule_code,basis,amount_satang) VALUES (?,?,?,'sso_33',?,?)")
                .bind(Uuid::new_v4().to_string()).bind(i64::from(request.year)).bind(i64::from(month)).bind(basis).bind(amount.satang()?).execute(&mut *tx).await?;
        }
    }
    if let Some(bonus) = request.bonus.filter(|value| *value > Money::ZERO) {
        sqlx::query("INSERT INTO income_entries(id,tax_year,source_id,month,kind,basis,gross_satang,withholding_satang) VALUES (?,?,?,?,'bonus',?,?,?)")
            .bind(Uuid::new_v4().to_string()).bind(i64::from(request.year)).bind(&source).bind(i64::from(request.bonus_month)).bind(basis_text(request.bonus_basis)).bind(bonus.satang()?).bind(request.bonus_withholding.map(Money::satang).transpose()?).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM app_settings WHERE key=?")
        .bind(format!("onboarding_{}", request.year))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn save_profile(
    pool: &SqlitePool,
    year: u16,
    facts: TaxpayerFacts,
    income_complete: bool,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE tax_years SET eligibility_json=?,completion_state=? WHERE year=?")
        .bind(serde_json::to_string(&facts)?)
        .bind(if income_complete {
            "complete"
        } else {
            "incomplete"
        })
        .bind(i64::from(year))
        .execute(&mut *tx)
        .await?;
    bump(&mut tx, year).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_income(pool: &SqlitePool, request: IncomeRequest) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    upsert_income_in(&mut tx, request).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_income_in(
    tx: &mut Transaction<'_, Sqlite>,
    request: IncomeRequest,
) -> AppResult<String> {
    validate_month(request.month)?;
    validate_label(&request.source_label)?;
    if !["salary", "bonus", "other"].contains(&request.kind.as_str()) {
        return Err(AppError::invalid("รองรับเฉพาะเงินเดือน โบนัส และรายได้อื่น"));
    }
    let note = request.note.unwrap_or_default();
    if note.chars().count() > 500 {
        return Err(AppError::invalid("บันทึกช่วยจำยาวเกิน 500 ตัวอักษร"));
    }
    let source = source(tx, request.year, &request.source_label).await?;
    let id = match &request.id {
        Some(id) => {
            require_entry(tx, "income_entries", id, request.year).await?;
            id.clone()
        }
        None => Uuid::new_v4().to_string(),
    };
    sqlx::query("INSERT INTO income_entries(id,tax_year,source_id,month,kind,basis,gross_satang,withholding_satang,note) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,month=excluded.month,kind=excluded.kind,basis=excluded.basis,gross_satang=excluded.gross_satang,withholding_satang=excluded.withholding_satang,note=excluded.note")
        .bind(&id).bind(i64::from(request.year)).bind(source).bind(i64::from(request.month)).bind(request.kind).bind(basis_text(request.basis)).bind(request.gross.satang()?).bind(request.withholding.map(Money::satang).transpose()?).bind(note).execute(&mut **tx).await?;
    bump(tx, request.year).await?;
    Ok(id)
}

pub async fn upsert_deduction(pool: &SqlitePool, request: DeductionRequest) -> AppResult<()> {
    validate_month(request.month)?;
    let mut tx = pool.begin().await?;
    let id = match &request.id {
        Some(id) => {
            require_entry(&mut tx, "deduction_entries", id, request.year).await?;
            id.clone()
        }
        None => Uuid::new_v4().to_string(),
    };
    sqlx::query("INSERT INTO deduction_entries(id,tax_year,month,rule_code,basis,amount_satang) VALUES (?,?,?,'sso_33',?,?) ON CONFLICT(id) DO UPDATE SET month=excluded.month,basis=excluded.basis,amount_satang=excluded.amount_satang")
        .bind(id).bind(i64::from(request.year)).bind(i64::from(request.month)).bind(basis_text(request.basis)).bind(request.amount.satang()?).execute(&mut *tx).await?;
    bump(&mut tx, request.year).await?;
    tx.commit().await?;
    Ok(())
}

async fn require_entry(
    tx: &mut Transaction<'_, Sqlite>,
    table: &str,
    id: &str,
    year: u16,
) -> AppResult<()> {
    // Table names come exclusively from internal constants, never IPC arguments.
    let sql = match table {
        "income_entries" => "SELECT COUNT(*) FROM income_entries WHERE id=? AND tax_year=?",
        "deduction_entries" => "SELECT COUNT(*) FROM deduction_entries WHERE id=? AND tax_year=?",
        _ => return Err(AppError::invalid("ตารางไม่ถูกต้อง")),
    };
    let count: i64 = sqlx::query_scalar(sql)
        .bind(id)
        .bind(i64::from(year))
        .fetch_one(&mut **tx)
        .await?;
    if count != 1 {
        return Err(AppError::invalid("ไม่พบรายการในปีภาษีนี้ กรุณาโหลดข้อมูลใหม่"));
    }
    Ok(())
}

pub async fn delete_entry(pool: &SqlitePool, year: u16, id: &str, income: bool) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    delete_entry_in(&mut tx, year, id, income).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn delete_entry_in(
    tx: &mut Transaction<'_, Sqlite>,
    year: u16,
    id: &str,
    income: bool,
) -> AppResult<()> {
    require_entry(
        tx,
        if income {
            "income_entries"
        } else {
            "deduction_entries"
        },
        id,
        year,
    )
    .await?;
    sqlx::query(if income {
        "DELETE FROM income_entries WHERE id=? AND tax_year=?"
    } else {
        "DELETE FROM deduction_entries WHERE id=? AND tax_year=?"
    })
    .bind(id)
    .bind(i64::from(year))
    .execute(&mut **tx)
    .await?;
    // Deleting any annual fact invalidates the explicit completeness confirmation.
    sqlx::query(if income {"UPDATE tax_years SET completion_state='incomplete' WHERE year=?"} else {"UPDATE tax_years SET completion_state='incomplete', eligibility_json=json_set(eligibility_json,'$.social_security_confirmed',json('false')) WHERE year=?"})
        .bind(i64::from(year))
        .execute(&mut **tx)
        .await?;
    bump(tx, year).await?;
    Ok(())
}

pub async fn history(pool: &SqlitePool, year: u16) -> AppResult<Vec<Snapshot>> {
    sqlx::query(
        "SELECT * FROM calculation_snapshots WHERE tax_year=? ORDER BY created_at DESC,id DESC",
    )
    .bind(i64::from(year))
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| -> AppResult<_> {
        Ok(Snapshot {
            id: row.try_get("id")?,
            tax_year: year,
            rule_set_id: row.try_get("rule_set_id")?,
            engine_version: row.try_get("engine_version")?,
            input_json: row.try_get("input_json")?,
            result_json: row.try_get("result_json")?,
            input_hash: row.try_get("input_hash")?,
            data_revision: row.try_get("data_revision")?,
            created_at: row.try_get("created_at")?,
        })
    })
    .collect()
}

pub async fn delete_all(pool: &SqlitePool) -> AppResult<()> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    crate::ledger_sync::pause_for_restore(&mut tx).await?;
    sqlx::query("DELETE FROM tax_years")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM app_settings")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM ledger_entries")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM ledger_categories")
        .execute(&mut *tx)
        .await?;
    crate::ledger::seed_categories(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}
