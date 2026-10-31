use crate::{
    AppState,
    catalog::Catalog,
    error::{AppError, AppResult},
    models::IncomeRequest,
    storage,
};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use std::{collections::HashSet, io::Read};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use taxly_core::{AmountBasis, Money};
use uuid::Uuid;

const MAX_CSV_BYTES: u64 = 5 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 20_000;
const MAX_CSV_COLUMNS: usize = 64;
const MAX_IMPORT_ROWS: usize = 5_000;
const DEFAULT_CATEGORIES: [(&str, &str, &str); 14] = [
    ("income-salary", "income", "เงินเดือน"),
    ("income-bonus", "income", "โบนัส"),
    ("income-side", "income", "รายได้เสริม"),
    ("income-other", "income", "รายรับอื่น"),
    ("expense-food", "expense", "อาหารและเครื่องดื่ม"),
    ("expense-transport", "expense", "เดินทาง"),
    ("expense-housing", "expense", "ที่พักและค่าเช่า"),
    ("expense-utilities", "expense", "ค่าน้ำ ค่าไฟ ค่าโทรศัพท์"),
    ("expense-shopping", "expense", "ช้อปปิ้ง"),
    ("expense-health", "expense", "สุขภาพ"),
    ("expense-entertainment", "expense", "บันเทิง"),
    ("expense-education", "expense", "การศึกษา"),
    ("expense-insurance", "expense", "ประกัน"),
    ("expense-other", "expense", "รายจ่ายอื่น"),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LedgerCategory {
    pub id: String,
    pub kind: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LedgerEntry {
    pub id: String,
    pub date: String,
    pub category_id: String,
    pub amount: Money,
    pub note: String,
    pub tax_income_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LedgerData {
    pub categories: Vec<LedgerCategory>,
    pub entries: Vec<LedgerEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoryRequest {
    pub id: Option<String>,
    pub kind: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaxLink {
    pub source_label: String,
    pub kind: String,
    pub withholding: Option<Money>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntryRequest {
    pub id: Option<String>,
    pub date: String,
    pub category_id: String,
    pub amount: Money,
    pub note: String,
    pub tax: Option<TaxLink>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportRow {
    pub date: String,
    pub category_id: String,
    pub amount: Money,
    pub note: String,
}

#[derive(Debug, Serialize)]
pub struct CsvFile {
    pub file_name: String,
    pub rows: Vec<Vec<String>>,
}

pub fn validate_date(date: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .filter(|parsed| (2000..=2100).contains(&parsed.year()) && date.len() == 10)
        .ok_or_else(|| AppError::invalid("วันที่ไม่ถูกต้อง"))
}
fn validate_entry(date: &str, amount: Money, note: &str) -> AppResult<NaiveDate> {
    if amount.satang()? <= 0 {
        return Err(AppError::invalid("จำนวนเงินต้องมากกว่า 0"));
    }
    if note.chars().count() > 500 {
        return Err(AppError::invalid("บันทึกช่วยจำยาวเกิน 500 ตัวอักษร"));
    }
    validate_date(date)
}
fn validate_category(kind: &str, name: &str) -> AppResult<()> {
    if !["income", "expense"].contains(&kind) {
        return Err(AppError::invalid("ประเภทหมวดหมู่ไม่ถูกต้อง"));
    }
    if name.trim().is_empty() || name.chars().count() > 50 {
        return Err(AppError::invalid("ชื่อหมวดหมู่ต้องมี 1–50 ตัวอักษร"));
    }
    Ok(())
}

/// Inserts the starter categories only into an empty table, so deleted or
/// renamed defaults are not resurrected on the next launch.
pub async fn seed_categories(tx: &mut Transaction<'_, Sqlite>) -> AppResult<()> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ledger_categories")
        .fetch_one(&mut **tx)
        .await?;
    if count > 0 {
        return Ok(());
    }
    for (id, kind, name) in DEFAULT_CATEGORIES {
        sqlx::query("INSERT INTO ledger_categories(id,kind,name) VALUES (?,?,?)")
            .bind(id)
            .bind(kind)
            .bind(name)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

pub async fn load_in(tx: &mut Transaction<'_, Sqlite>) -> AppResult<LedgerData> {
    let categories = sqlx::query("SELECT * FROM ledger_categories ORDER BY kind DESC,name")
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| -> AppResult<_> {
            Ok(LedgerCategory {
                id: row.try_get("id")?,
                kind: row.try_get("kind")?,
                name: row.try_get("name")?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let entries = sqlx::query("SELECT * FROM ledger_entries ORDER BY date DESC,id")
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| -> AppResult<_> {
            Ok(LedgerEntry {
                id: row.try_get("id")?,
                date: row.try_get("date")?,
                category_id: row.try_get("category_id")?,
                amount: Money::from_satang(row.try_get("amount_satang")?)?,
                note: row.try_get("note")?,
                tax_income_id: row.try_get("tax_income_id")?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(LedgerData {
        categories,
        entries,
    })
}

async fn insert_entry(tx: &mut Transaction<'_, Sqlite>, entry: &LedgerEntry) -> AppResult<()> {
    sqlx::query("INSERT INTO ledger_entries(id,date,category_id,amount_satang,note,tax_income_id) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,category_id=excluded.category_id,amount_satang=excluded.amount_satang,note=excluded.note,tax_income_id=excluded.tax_income_id")
        .bind(&entry.id).bind(&entry.date).bind(&entry.category_id).bind(entry.amount.satang()?).bind(&entry.note).bind(&entry.tax_income_id)
        .execute(&mut **tx).await?;
    Ok(())
}

/// Replaces every ledger row; the caller validates and owns the transaction.
pub async fn replace_in(tx: &mut Transaction<'_, Sqlite>, data: &LedgerData) -> AppResult<()> {
    sqlx::query("DELETE FROM ledger_entries")
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM ledger_categories")
        .execute(&mut **tx)
        .await?;
    for category in &data.categories {
        sqlx::query("INSERT INTO ledger_categories(id,kind,name) VALUES (?,?,?)")
            .bind(&category.id)
            .bind(&category.kind)
            .bind(&category.name)
            .execute(&mut **tx)
            .await?;
    }
    for entry in &data.entries {
        insert_entry(tx, entry).await?;
    }
    Ok(())
}

/// Backup check; `income_ids` are the tax income rows restored alongside.
pub fn validate_data(data: &LedgerData, income_ids: &HashSet<&String>) -> AppResult<()> {
    let invalid = || AppError::backup("ข้อมูลรายรับรายจ่ายไม่ถูกต้อง");
    if data.categories.len() > 1_000 || data.entries.len() > 200_000 {
        return Err(AppError::backup("ไฟล์สำรองมีรายรับรายจ่ายมากเกินกว่ารุ่นนี้รองรับ"));
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for category in &data.categories {
        validate_category(&category.kind, &category.name).map_err(|_| invalid())?;
        if !ids.insert(&category.id) || !names.insert((&category.kind, &category.name)) {
            return Err(invalid());
        }
    }
    let categories = ids;
    let mut ids = HashSet::new();
    let mut links = HashSet::new();
    for entry in &data.entries {
        validate_entry(&entry.date, entry.amount, &entry.note).map_err(|_| invalid())?;
        if !ids.insert(&entry.id)
            || !categories.contains(&entry.category_id)
            || entry
                .tax_income_id
                .as_ref()
                .is_some_and(|id| !income_ids.contains(id) || !links.insert(id))
        {
            return Err(invalid());
        }
    }
    Ok(())
}

async fn category_kind(tx: &mut Transaction<'_, Sqlite>, id: &str) -> AppResult<String> {
    sqlx::query_scalar("SELECT kind FROM ledger_categories WHERE id=?")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::invalid("ไม่พบหมวดหมู่ กรุณาโหลดข้อมูลใหม่"))
}

async fn linked_income(
    tx: &mut Transaction<'_, Sqlite>,
    entry_id: &str,
) -> AppResult<Option<(String, u16)>> {
    let link: Option<String> =
        sqlx::query_scalar("SELECT tax_income_id FROM ledger_entries WHERE id=?")
            .bind(entry_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::invalid("ไม่พบรายการ กรุณาโหลดข้อมูลใหม่"))?;
    let Some(link) = link else { return Ok(None) };
    let year: i64 = sqlx::query_scalar("SELECT tax_year FROM income_entries WHERE id=?")
        .bind(&link)
        .fetch_one(&mut **tx)
        .await?;
    Ok(Some((link, year as u16)))
}

pub async fn save_entry(
    pool: &SqlitePool,
    catalog: &Catalog,
    request: EntryRequest,
    today: NaiveDate,
) -> AppResult<()> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    save_entry_in(&mut tx, catalog, request, today, None).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn save_entry_in(
    tx: &mut Transaction<'_, Sqlite>,
    catalog: &Catalog,
    request: EntryRequest,
    today: NaiveDate,
    new_id: Option<String>,
) -> AppResult<()> {
    let date = validate_entry(&request.date, request.amount, &request.note)?;
    let kind = category_kind(tx, &request.category_id).await?;
    let (id, old_link) = match request.id {
        Some(id) => {
            let link = linked_income(tx, &id).await?;
            (id, link)
        }
        None => (new_id.unwrap_or_else(|| Uuid::new_v4().to_string()), None),
    };
    let year = date.year() as u16;
    let tax_income_id = match request.tax {
        Some(tax) => {
            if kind != "income" {
                return Err(AppError::invalid("เชื่อมกับภาษีได้เฉพาะรายรับ"));
            }
            catalog.get(year)?;
            // A linked row stays the same tax income unless the entry moved to another tax year.
            let reuse = match old_link {
                Some((link, old_year)) if old_year == year => Some(link),
                Some((link, old_year)) => {
                    storage::delete_entry_in(tx, old_year, &link, true).await?;
                    None
                }
                None => None,
            };
            let income = IncomeRequest {
                id: reuse,
                year,
                source_label: tax.source_label,
                month: date.month() as u8,
                kind: tax.kind,
                basis: if date > today {
                    AmountBasis::Forecast
                } else {
                    AmountBasis::Actual
                },
                gross: request.amount,
                withholding: tax.withholding,
                note: Some(request.note.trim().to_owned()),
            };
            Some(storage::upsert_income_in(tx, income).await?)
        }
        None => {
            if let Some((link, old_year)) = old_link {
                storage::delete_entry_in(tx, old_year, &link, true).await?;
            }
            None
        }
    };
    let entry = LedgerEntry {
        id,
        date: request.date,
        category_id: request.category_id,
        amount: request.amount,
        note: request.note.trim().to_owned(),
        tax_income_id,
    };
    insert_entry(tx, &entry).await?;
    Ok(())
}

pub async fn delete_entry(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    if let Some((link, year)) = linked_income(&mut tx, id).await? {
        storage::delete_entry_in(&mut tx, year, &link, true).await?;
    }
    sqlx::query("DELETE FROM ledger_entries WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn import_entries(pool: &SqlitePool, rows: Vec<ImportRow>) -> AppResult<usize> {
    if rows.is_empty() || rows.len() > MAX_IMPORT_ROWS {
        return Err(AppError::invalid("นำเข้าได้ครั้งละ 1–5,000 รายการ"));
    }
    let mut tx = pool.begin().await?;
    for (index, row) in rows.iter().enumerate() {
        validate_entry(&row.date, row.amount, &row.note)
            .map_err(|e| AppError::invalid(format!("แถวที่ {}: {}", index + 1, e.message)))?;
        category_kind(&mut tx, &row.category_id).await?;
        let entry = LedgerEntry {
            id: Uuid::new_v4().to_string(),
            date: row.date.clone(),
            category_id: row.category_id.clone(),
            amount: row.amount,
            note: row.note.trim().to_owned(),
            tax_income_id: None,
        };
        insert_entry(&mut tx, &entry).await?;
    }
    tx.commit().await?;
    Ok(rows.len())
}

pub async fn save_category(pool: &SqlitePool, request: CategoryRequest) -> AppResult<()> {
    let name = request.name.trim();
    validate_category(&request.kind, name)?;
    let mut tx = pool.begin().await?;
    let taken: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ledger_categories WHERE kind=? AND name=? AND id IS NOT ?",
    )
    .bind(&request.kind)
    .bind(name)
    .bind(&request.id)
    .fetch_one(&mut *tx)
    .await?;
    if taken > 0 {
        return Err(AppError::invalid("มีหมวดหมู่ชื่อนี้แล้ว"));
    }
    match &request.id {
        // Kind is fixed after creation so existing entries never flip between income and expense.
        Some(id) => {
            let result = sqlx::query("UPDATE ledger_categories SET name=? WHERE id=? AND kind=?")
                .bind(name)
                .bind(id)
                .bind(&request.kind)
                .execute(&mut *tx)
                .await?;
            if result.rows_affected() != 1 {
                return Err(AppError::invalid("ไม่พบหมวดหมู่ กรุณาโหลดข้อมูลใหม่"));
            }
        }
        None => {
            sqlx::query("INSERT INTO ledger_categories(id,kind,name) VALUES (?,?,?)")
                .bind(Uuid::new_v4().to_string())
                .bind(&request.kind)
                .bind(name)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

pub async fn delete_category(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let used: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ledger_entries WHERE category_id=?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if used > 0 {
        return Err(AppError::invalid(
            "หมวดหมู่นี้ยังมีรายการอยู่ ย้ายรายการไปหมวดอื่นก่อนลบ",
        ));
    }
    sqlx::query("DELETE FROM ledger_categories WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Thai bank exports are often TIS-620 / Windows-874 rather than UTF-8.
fn decode_text(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => error
            .into_bytes()
            .into_iter()
            .map(|byte| match byte {
                0x00..=0x7f => byte as char,
                // TIS-620 maps 0xA1–0xFB onto the Thai block U+0E01–U+0E5B.
                0xa1..=0xfb => char::from_u32(u32::from(byte) + 0x0d60).unwrap_or('\u{fffd}'),
                0xa0 => ' ',
                _ => '\u{fffd}',
            })
            .collect(),
    }
}

pub fn parse_csv(bytes: Vec<u8>) -> AppResult<Vec<Vec<String>>> {
    let text = decode_text(bytes);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.trim_start_matches('\u{feff}').as_bytes());
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|_| AppError::invalid("อ่านไฟล์ CSV ไม่สำเร็จ"))?;
        if record.iter().all(str::is_empty) {
            continue;
        }
        if rows.len() >= MAX_CSV_ROWS || record.len() > MAX_CSV_COLUMNS {
            return Err(AppError::invalid(
                "ไฟล์ CSV ต้องมีไม่เกิน 20,000 แถวและ 64 คอลัมน์",
            ));
        }
        rows.push(record.iter().map(str::to_owned).collect());
    }
    if rows.is_empty() {
        return Err(AppError::invalid("ไฟล์ CSV ไม่มีข้อมูล"));
    }
    Ok(rows)
}

#[tauri::command]
pub async fn get_ledger(state: State<'_, AppState>) -> AppResult<LedgerData> {
    let mut tx = state.pool.begin().await?;
    let data = load_in(&mut tx).await?;
    tx.commit().await?;
    Ok(data)
}
#[tauri::command]
pub async fn save_ledger_category(
    request: CategoryRequest,
    state: State<'_, AppState>,
) -> AppResult<()> {
    save_category(&state.pool, request).await
}
#[tauri::command]
pub async fn delete_ledger_category(id: String, state: State<'_, AppState>) -> AppResult<()> {
    delete_category(&state.pool, &id).await
}
#[tauri::command]
pub async fn save_ledger_entry(request: EntryRequest, state: State<'_, AppState>) -> AppResult<()> {
    let today = chrono::Local::now().date_naive();
    save_entry(&state.pool, &state.catalog, request, today).await
}
#[tauri::command]
pub async fn delete_ledger_entry(id: String, state: State<'_, AppState>) -> AppResult<()> {
    delete_entry(&state.pool, &id).await
}
#[tauri::command]
pub async fn import_ledger_entries(
    rows: Vec<ImportRow>,
    state: State<'_, AppState>,
) -> AppResult<usize> {
    import_entries(&state.pool, rows).await
}
#[tauri::command]
pub async fn read_ledger_csv(app: AppHandle) -> AppResult<CsvFile> {
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("CSV", &["csv"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| AppError::invalid("เปิดหน้าต่างเลือกไฟล์ไม่สำเร็จ"))?
    .ok_or_else(AppError::cancelled)?;
    let path = file
        .into_path()
        .map_err(|_| AppError::invalid("เส้นทางไฟล์ไม่ถูกต้อง"))?;
    tauri::async_runtime::spawn_blocking(move || -> AppResult<CsvFile> {
        let file = std::fs::File::open(&path)?;
        if !file.metadata()?.is_file() || file.metadata()?.len() > MAX_CSV_BYTES {
            return Err(AppError::invalid("ไฟล์ CSV ต้องมีขนาดไม่เกิน 5 MiB"));
        }
        // Bound the actual read too, in case the file grows after metadata.
        let mut bytes = Vec::new();
        file.take(MAX_CSV_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_CSV_BYTES {
            return Err(AppError::invalid("ไฟล์ CSV ต้องมีขนาดไม่เกิน 5 MiB"));
        }
        Ok(CsvFile {
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("import.csv")
                .to_owned(),
            rows: parse_csv(bytes)?,
        })
    })
    .await
    .map_err(|_| AppError::invalid("อ่านไฟล์ CSV ไม่สำเร็จ"))?
}
