//! SQLite boundary for validated wealth records. A financial mutation is always
//! replayed against the complete ledger before its transaction can commit.
use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use sqlx::{Row, SqliteConnection, SqlitePool};
use wealth_core::*;

async fn records<T: DeserializeOwned>(
    conn: &mut SqliteConnection,
    table: &str,
) -> AppResult<Vec<T>> {
    // Table names are compile-time constants at every call site, never IPC input.
    let rows: Vec<String> =
        sqlx::query_scalar(&format!("SELECT payload FROM {table} ORDER BY rowid"))
            .fetch_all(&mut *conn)
            .await?;
    rows.into_iter()
        .map(|json| Ok(serde_json::from_str(&json)?))
        .collect()
}

pub async fn load_in(conn: &mut SqliteConnection) -> AppResult<WealthData> {
    let meta = sqlx::query("SELECT revision,preferences_json FROM wealth_meta WHERE id=1")
        .fetch_one(&mut *conn)
        .await?;
    Ok(WealthData {
        revision: meta.try_get("revision")?,
        preferences: serde_json::from_str(meta.try_get("preferences_json")?)?,
        accounts: records(conn, "wealth_accounts").await?,
        instruments: records(conn, "wealth_instruments").await?,
        activities: records(conn, "wealth_activities").await?,
        opening_positions: records(conn, "wealth_opening_positions").await?,
        prices: records(conn, "wealth_prices").await?,
        fx_rates: records(conn, "wealth_fx_rates").await?,
        import_mappings: records(conn, "wealth_import_mappings").await?,
    })
}

pub async fn load(pool: &SqlitePool) -> AppResult<WealthData> {
    let mut tx = pool.begin().await?;
    let data = load_in(&mut tx).await?;
    tx.commit().await?;
    Ok(data)
}

pub fn validate_data(data: &WealthData) -> AppResult<()> {
    if data.accounts.len() > 1_000
        || data.instruments.len() > 20_000
        || data.activities.len() + data.opening_positions.len() > 100_000
        || data.prices.len() + data.fx_rates.len() > 500_000
        || data.import_mappings.len() > 100
    {
        return Err(AppError::invalid("จำนวนข้อมูลการลงทุนเกินขอบเขตที่รองรับ"));
    }
    wealth_core::validate(data).map_err(|e| AppError::invalid(e.to_string()))
}

pub async fn clear_in(conn: &mut SqliteConnection) -> AppResult<()> {
    for table in [
        "wealth_activities",
        "wealth_opening_positions",
        "wealth_prices",
        "wealth_fx_rates",
        "wealth_import_mappings",
        "wealth_instruments",
        "wealth_accounts",
    ] {
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

pub async fn replace_in(conn: &mut SqliteConnection, data: &WealthData) -> AppResult<()> {
    validate_data(data)?;
    clear_in(conn).await?;
    for row in &data.accounts {
        sqlx::query("INSERT INTO wealth_accounts(id,payload) VALUES (?,?)")
            .bind(&row.id)
            .bind(serde_json::to_string(row)?)
            .execute(&mut *conn)
            .await?;
    }
    for row in &data.instruments {
        sqlx::query("INSERT INTO wealth_instruments(id,symbol,exchange,currency,payload) VALUES (?,?,?,?,?)")
            .bind(&row.id).bind(&row.symbol).bind(&row.exchange).bind(&row.currency)
            .bind(serde_json::to_string(row)?).execute(&mut *conn).await?;
    }
    for row in &data.opening_positions {
        sqlx::query("INSERT INTO wealth_opening_positions(id,account_id,instrument_id,payload) VALUES (?,?,?,?)")
            .bind(&row.id).bind(&row.account_id).bind(&row.instrument_id)
            .bind(serde_json::to_string(row)?).execute(&mut *conn).await?;
    }
    for row in &data.activities {
        sqlx::query("INSERT INTO wealth_activities(id,account_id,instrument_id,related_account_id,payload) VALUES (?,?,?,?,?)")
            .bind(&row.id).bind(&row.account_id).bind(&row.instrument_id).bind(&row.related_account_id)
            .bind(serde_json::to_string(row)?).execute(&mut *conn).await?;
    }
    for row in &data.prices {
        sqlx::query("INSERT INTO wealth_prices(instrument_id,date,payload) VALUES (?,?,?)")
            .bind(&row.instrument_id)
            .bind(&row.date)
            .bind(serde_json::to_string(row)?)
            .execute(&mut *conn)
            .await?;
    }
    for row in &data.fx_rates {
        sqlx::query(
            "INSERT INTO wealth_fx_rates(from_currency,to_currency,date,payload) VALUES (?,?,?,?)",
        )
        .bind(&row.from_currency)
        .bind(&row.to_currency)
        .bind(&row.date)
        .bind(serde_json::to_string(row)?)
        .execute(&mut *conn)
        .await?;
    }
    for row in &data.import_mappings {
        sqlx::query("INSERT INTO wealth_import_mappings(id,payload) VALUES (?,?)")
            .bind(&row.id)
            .bind(serde_json::to_string(row)?)
            .execute(&mut *conn)
            .await?;
    }
    sqlx::query("UPDATE wealth_meta SET revision=?,preferences_json=? WHERE id=1")
        .bind(data.revision)
        .bind(serde_json::to_string(&data.preferences)?)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// When an instrument's currency changes, every activity and opening tied to
/// it was entered under the old (wrong) currency and must follow along.
pub fn sync_instrument_currency(data: &mut WealthData, instrument: &Instrument) -> usize {
    let Some(previous) = data
        .instruments
        .iter()
        .find(|row| row.id == instrument.id)
        .map(|row| row.currency.clone())
    else {
        return 0;
    };
    if previous == instrument.currency {
        return 0;
    }
    let id = instrument.id.as_str();
    let currency = instrument.currency.clone();
    let mut synced = 0;
    for activity in &mut data.activities {
        if activity.instrument_id.as_deref() == Some(id) && activity.currency == previous {
            activity.currency = currency.clone();
            synced += 1;
        }
    }
    for opening in &mut data.opening_positions {
        if opening.instrument_id.as_deref() == Some(id) && opening.currency == previous {
            opening.currency = currency.clone();
            synced += 1;
        }
    }
    synced
}

pub async fn mutate<T, F>(
    pool: &SqlitePool,
    expected_revision: Option<i64>,
    change: F,
) -> AppResult<T>
where
    F: FnOnce(&mut WealthData) -> AppResult<T>,
{
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let mut data = load_in(&mut tx).await?;
    if expected_revision.is_some_and(|expected| expected != data.revision) {
        return Err(AppError {
            code: "StaleRevision",
            message: "ข้อมูลเปลี่ยนหลังการตรวจ กรุณาตรวจรายการอีกครั้ง".into(),
        });
    }
    let result = change(&mut data)?;
    data.revision = data
        .revision
        .checked_add(1)
        .ok_or_else(|| AppError::invalid("รุ่นข้อมูลเกินขอบเขตที่รองรับ"))?;
    replace_in(&mut tx, &data).await?;
    tx.commit().await?;
    Ok(result)
}
