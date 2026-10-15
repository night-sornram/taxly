//! Native CSV review is deliberately separate from commit: neither parsing nor
//! column/symbol remapping changes the ledger.
use crate::error::{AppError, AppResult};
use crate::{AppState, wealth_storage};
use chrono::{Datelike, NaiveDate};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::str::FromStr;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use wealth_core::{Activity, ImportMapping, Instrument, OpeningPosition, WealthData};

const MAX_CSV_BYTES: usize = 10 * 1024 * 1024;
const MAX_ROWS: usize = 20_000;
const MAX_COLUMNS: usize = 64;
const REVIEW_LIFETIME: Duration = Duration::from_secs(300);
const FIELDS: &[&str] = &[
    "date",
    "kind",
    "symbol",
    "exchange",
    "instrument_id",
    "instrument_kind",
    "currency",
    "quantity",
    "unit_price",
    "amount",
    "fee",
    "tax",
    "note",
    "related_account_id",
    "counter_currency",
    "counter_amount",
    "cost_basis",
    "cost_basis_base",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportRequest {
    pub account_id: String,
    pub mode: String,
    pub date_format: String,
    pub mapping: BTreeMap<String, String>,
    pub mapping_name: String,
    pub csv: Option<String>,
    pub file_token: Option<String>,
    pub symbol_mappings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRow {
    /// One-based record number, excluding the header.
    pub index: usize,
    pub values: BTreeMap<String, String>,
    pub activity: Option<Activity>,
    pub opening: Option<OpeningPosition>,
    pub errors: Vec<String>,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportReview {
    pub token: String,
    pub revision: i64,
    pub filename: String,
    pub headers: Vec<String>,
    pub mapping: BTreeMap<String, String>,
    pub rows: Vec<ImportRow>,
    pub mode: String,
    pub account_id: String,
    pub new_instruments: Vec<Instrument>,
}

#[derive(Debug, Serialize)]
pub struct CommitResult {
    pub imported: usize,
    pub skipped: usize,
}

#[derive(Debug)]
pub struct PendingImport {
    token: String,
    csv: String,
    filename: String,
    review: ImportReview,
    request: ImportRequest,
    created_at: Instant,
}

fn consume_pending(pending: &mut Option<PendingImport>, token: &str) -> AppResult<PendingImport> {
    if pending
        .as_ref()
        .is_some_and(|p| p.created_at.elapsed() > REVIEW_LIFETIME)
    {
        *pending = None;
    }
    if pending.as_ref().is_none_or(|p| p.token != token) {
        return Err(AppError::invalid("ตัวอย่างนำเข้าหมดอายุ กรุณาตรวจข้อมูลอีกครั้ง"));
    }
    Ok(pending.take().expect("checked pending import"))
}

#[tauri::command]
pub async fn preview_wealth_import(
    request: ImportRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ImportReview> {
    let (csv, filename) = match (&request.csv, &request.file_token) {
        (Some(csv), None) => (csv.clone(), "ข้อมูล CSV".into()),
        (None, Some(token)) => {
            let mut guard = state.pending_import.lock().await;
            if guard
                .as_ref()
                .is_some_and(|p| p.created_at.elapsed() > REVIEW_LIFETIME)
            {
                *guard = None;
            }
            let pending = guard
                .as_ref()
                .filter(|p| p.token == *token)
                .ok_or_else(|| AppError::invalid("ตัวอย่างนำเข้าหมดอายุ กรุณาเลือกไฟล์อีกครั้ง"))?;
            (pending.csv.clone(), pending.filename.clone())
        }
        (None, None) => {
            *state.pending_import.lock().await = None;
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
            tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
                let file = std::fs::File::open(&path)?;
                if !file.metadata()?.is_file() || file.metadata()?.len() > MAX_CSV_BYTES as u64 {
                    return Err(AppError::invalid("ไฟล์ CSV ต้องมีขนาดไม่เกิน 10 MiB"));
                }
                // Bound the actual read too, in case the file changes after metadata.
                let mut bytes = Vec::new();
                file.take((MAX_CSV_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)?;
                if bytes.len() > MAX_CSV_BYTES {
                    return Err(AppError::invalid("ไฟล์ CSV ต้องมีขนาดไม่เกิน 10 MiB"));
                }
                let csv = String::from_utf8(bytes)
                    .map_err(|_| AppError::invalid("กรุณาบันทึก CSV เป็น UTF-8"))?;
                let filename = path
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or("import.csv")
                    .to_owned();
                Ok((csv, filename))
            })
            .await
            .map_err(|_| AppError::invalid("อ่านไฟล์ CSV ไม่สำเร็จ"))??
        }
        _ => return Err(AppError::invalid("เลือกไฟล์ต้นทางเพียงหนึ่งแบบ")),
    };
    let data = wealth_storage::load(&state.pool).await?;
    let review = prepare_review(&csv, filename.clone(), &request, &data)?;
    let mut saved_request = request;
    saved_request.csv = None;
    saved_request.file_token = None;
    *state.pending_import.lock().await = Some(PendingImport {
        token: review.token.clone(),
        csv,
        filename,
        review: review.clone(),
        request: saved_request,
        created_at: Instant::now(),
    });
    Ok(review)
}

#[tauri::command]
pub async fn commit_wealth_import(
    token: String,
    include_rows: Vec<usize>,
    state: State<'_, AppState>,
) -> AppResult<CommitResult> {
    let pending = {
        let mut guard = state.pending_import.lock().await;
        // Every commit attempt consumes its token, including a stale revision.
        consume_pending(&mut guard, &token)?
    };
    let selected: BTreeSet<usize> = include_rows.iter().copied().collect();
    if selected.is_empty() || selected.len() != include_rows.len() {
        return Err(AppError::invalid(
            "กรุณาเลือกรายการนำเข้าที่ไม่ซ้ำกันอย่างน้อยหนึ่งรายการ",
        ));
    }
    if selected.iter().any(|index| {
        !pending
            .review
            .rows
            .iter()
            .any(|r| r.index == *index && r.errors.is_empty())
    }) {
        return Err(AppError::invalid(
            "รายการที่เลือกมีข้อผิดพลาด กรุณาตรวจตัวอย่างอีกครั้ง",
        ));
    }
    let imported = selected.len();
    let skipped = pending.review.rows.len() - imported;
    let revision = pending.review.revision;
    wealth_storage::mutate(&state.pool, Some(revision), move |data| {
        apply_review(data, &pending.review, &pending.request, &selected)
    })
    .await?;
    Ok(CommitResult { imported, skipped })
}

#[tauri::command]
pub async fn cancel_wealth_import(state: State<'_, AppState>) -> AppResult<()> {
    *state.pending_import.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn save_wealth_template(mode: String, app: AppHandle) -> AppResult<()> {
    let contents = template(&mode)?;
    let filename = format!("Taxly-{mode}-template.csv");
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("CSV", &["csv"])
            .set_file_name(filename)
            .blocking_save_file()
    })
    .await
    .map_err(|_| AppError::invalid("เปิดหน้าต่างเลือกไฟล์ไม่สำเร็จ"))?
    .ok_or_else(AppError::cancelled)?;
    let path = file
        .into_path()
        .map_err(|_| AppError::invalid("เส้นทางไฟล์ไม่ถูกต้อง"))?;
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        // Write into a private sibling, then replace only after a complete write.
        let parent = path
            .parent()
            .ok_or_else(|| AppError::invalid("ไม่พบโฟลเดอร์ปลายทาง"))?;
        let temporary = parent.join(format!(".taxly-{}.tmp", Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| -> AppResult<()> {
            let mut output = options.open(&temporary)?;
            output.write_all(contents.as_bytes())?;
            output.sync_all()?;
            std::fs::rename(&temporary, path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result
    })
    .await
    .map_err(|_| AppError::invalid("บันทึกไฟล์แม่แบบไม่สำเร็จ"))?
}

fn template(mode: &str) -> AppResult<String> {
    match mode {
        "activities" => Ok(concat!(
            "date,kind,symbol,exchange,instrument_kind,currency,quantity,unit_price,amount,fee,tax,note,related_account_id,counter_currency,counter_amount\n",
            "2026-01-02,deposit,,,,THB,,,10000,0,0,เงินฝากเริ่มต้น,,,\n",
            "2026-01-05,buy,PTT,XBKK,stock,THB,10,30,301,1,0,ยอดจ่ายรวมค่าธรรมเนียมแล้ว,,,\n"
        ).into()),
        "opening_positions" => Ok(concat!(
            "date,symbol,exchange,instrument_kind,currency,quantity,cost_basis,cost_basis_base\n",
            "2026-01-01,,,,THB,10000,,\n",
            "2026-01-01,PTT,XBKK,stock,THB,10,300,300\n"
        ).into()),
        _ => Err(AppError::invalid("ประเภทการนำเข้าไม่ถูกต้อง")),
    }
}

pub(crate) fn prepare_review(
    csv: &str,
    filename: String,
    request: &ImportRequest,
    data: &WealthData,
) -> AppResult<ImportReview> {
    if csv.len() > MAX_CSV_BYTES {
        return Err(AppError::invalid("ไฟล์ CSV ต้องมีขนาดไม่เกิน 10 MiB"));
    }
    if !matches!(request.mode.as_str(), "activities" | "opening_positions") {
        return Err(AppError::invalid("ประเภทการนำเข้าไม่ถูกต้อง"));
    }
    if !matches!(request.date_format.as_str(), "iso" | "dmy" | "buddhist") {
        return Err(AppError::invalid("รูปแบบวันที่ไม่ถูกต้อง"));
    }
    if !data.accounts.iter().any(|a| a.id == request.account_id) {
        return Err(AppError::invalid("ไม่พบบัญชีสำหรับนำเข้า"));
    }
    if request.mapping_name.chars().count() > 80 || request.symbol_mappings.len() > MAX_ROWS {
        return Err(AppError::invalid("ข้อมูลการจับคู่ยาวเกินกว่าที่รองรับ"));
    }
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .flexible(true)
        .from_reader(csv.trim_start_matches('\u{feff}').as_bytes());
    let headers: Vec<String> = reader
        .headers()
        .map_err(|_| AppError::invalid("อ่านหัวตาราง CSV ไม่สำเร็จ"))?
        .iter()
        .map(str::to_owned)
        .collect();
    if headers.is_empty()
        || headers.len() > MAX_COLUMNS
        || headers.iter().any(|h| h.is_empty() || h.len() > 256)
        || headers.iter().collect::<BTreeSet<_>>().len() != headers.len()
    {
        return Err(AppError::invalid(
            "หัวตาราง CSV ต้องไม่ว่าง ไม่ซ้ำ และมีไม่เกิน 64 คอลัมน์",
        ));
    }
    let mapping: BTreeMap<String, String> = if request.mapping.is_empty() {
        FIELDS
            .iter()
            .filter_map(|field| {
                headers
                    .iter()
                    .find(|h| h.eq_ignore_ascii_case(field))
                    .map(|header| ((*field).to_owned(), header.clone()))
            })
            .collect()
    } else {
        request
            .mapping
            .iter()
            .filter(|(_, header)| !header.is_empty())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    };
    if mapping
        .iter()
        .any(|(field, header)| !FIELDS.contains(&field.as_str()) || !headers.contains(header))
    {
        return Err(AppError::invalid("คอลัมน์ที่จับคู่ไม่ตรงกับหัวตาราง CSV"));
    }
    let mut seen: BTreeSet<String> = if request.mode == "activities" {
        data.activities.iter().map(activity_key).collect()
    } else {
        data.opening_positions.iter().map(opening_key).collect()
    };
    let mut new_instruments = Vec::new();
    let mut rows = Vec::new();
    for (offset, record) in reader.records().enumerate() {
        if offset >= MAX_ROWS {
            return Err(AppError::invalid("CSV ต้องมีไม่เกิน 20,000 รายการ"));
        }
        let index = offset + 1;
        let mut row = ImportRow {
            index,
            values: BTreeMap::new(),
            activity: None,
            opening: None,
            errors: Vec::new(),
            duplicate: false,
        };
        let record = match record {
            Ok(record) => record,
            Err(_) => {
                row.errors
                    .push("อ่านแถว CSV ไม่สำเร็จ ตรวจเครื่องหมายคำพูดและจำนวนคอลัมน์".into());
                rows.push(row);
                continue;
            }
        };
        row.values = headers
            .iter()
            .cloned()
            .zip(record.iter().map(str::to_owned))
            .collect();
        if record.len() != headers.len() {
            row.errors.push("จำนวนคอลัมน์ไม่ตรงกับหัวตาราง".into());
            rows.push(row);
            continue;
        }
        if record
            .iter()
            .any(|cell| cell.len() > 4096 || cell.contains('\0'))
        {
            row.errors.push("ค่าในคอลัมน์ยาวเกินไปหรือมีอักขระที่ไม่รองรับ".into());
            rows.push(row);
            continue;
        }
        let values: BTreeMap<String, String> = mapping
            .iter()
            .map(|(field, header)| {
                (
                    field.clone(),
                    row.values.get(header).cloned().unwrap_or_default(),
                )
            })
            .collect();
        let previous_instruments = new_instruments.len();
        let parsed = parse_row(&values, index, request, data, &mut new_instruments);
        match parsed {
            Ok(ParsedRow::Activity(activity)) => {
                row.duplicate = !seen.insert(activity_key(&activity));
                row.activity = Some(activity);
            }
            Ok(ParsedRow::Opening(opening)) => {
                row.duplicate = !seen.insert(opening_key(&opening));
                row.opening = Some(opening);
            }
            Err(message) => {
                new_instruments.truncate(previous_instruments);
                row.errors.push(message);
            }
        }
        rows.push(row);
    }
    if rows.is_empty() {
        return Err(AppError::invalid("CSV ไม่มีรายการข้อมูล"));
    }
    Ok(ImportReview {
        token: Uuid::new_v4().to_string(),
        revision: data.revision,
        filename,
        headers,
        mapping,
        rows,
        mode: request.mode.clone(),
        account_id: request.account_id.clone(),
        new_instruments,
    })
}

enum ParsedRow {
    Activity(Activity),
    Opening(OpeningPosition),
}

fn parse_row(
    values: &BTreeMap<String, String>,
    index: usize,
    request: &ImportRequest,
    data: &WealthData,
    new_instruments: &mut Vec<Instrument>,
) -> Result<ParsedRow, String> {
    let get = |key: &str| values.get(key).map(String::as_str).unwrap_or("").trim();
    let date = parse_date(get("date"), &request.date_format)?;
    let currency = get("currency").to_ascii_uppercase();
    if !is_currency(&currency) {
        return Err("ระบุสกุลเงิน 3 ตัวอักษร เช่น THB หรือ USD".into());
    }
    let instrument = resolve_instrument(
        values,
        &currency,
        &request.symbol_mappings,
        data,
        new_instruments,
    )?;
    if let Some(ref instrument) = instrument
        && instrument.currency != currency
    {
        return Err("สกุลเงินต้องตรงกับสกุลเงินของหลักทรัพย์".into());
    }
    let number = |key: &str, required: bool, positive: bool| -> Result<Option<String>, String> {
        let value = get(key);
        if value.is_empty() && !required {
            return Ok(None);
        }
        let number =
            parse_number(value).map_err(|_| format!("{key}: ระบุเลขฐานสิบไม่ติดลบ ไม่เกิน 12 ตำแหน่ง"))?;
        if positive && number <= Decimal::ZERO {
            return Err(format!("{key}: ต้องมากกว่าศูนย์"));
        }
        Ok(Some(number.normalize().to_string()))
    };
    if request.mode == "opening_positions" {
        let quantity = number("quantity", true, true)?.expect("required quantity");
        let cost_basis = number("cost_basis", false, false)?;
        let cost_basis_base = number("cost_basis_base", false, false)?;
        if instrument.is_none() && (cost_basis.is_some() || cost_basis_base.is_some()) {
            return Err("ยอดเงินสดเริ่มต้นต้องไม่ระบุ cost_basis หรือ cost_basis_base".into());
        }
        if cost_basis_base.is_some() && cost_basis.is_none() {
            return Err("cost_basis_base ต้องมี cost_basis ด้วย".into());
        }
        return Ok(ParsedRow::Opening(OpeningPosition {
            id: Uuid::new_v4().to_string(),
            account_id: request.account_id.clone(),
            date,
            instrument_id: instrument.map(|i| i.id),
            currency,
            quantity,
            cost_basis,
            cost_basis_base,
        }));
    }
    let kind = get("kind").to_ascii_lowercase();
    let kind = if kind == "withholding" {
        "tax".to_owned()
    } else {
        kind
    };
    if !matches!(
        kind.as_str(),
        "deposit"
            | "withdrawal"
            | "buy"
            | "sell"
            | "dividend"
            | "interest"
            | "fee"
            | "tax"
            | "split"
            | "transfer"
            | "fx"
    ) {
        return Err("ชนิดรายการไม่ถูกต้อง ใช้ deposit, withdrawal, buy, sell, dividend, interest, fee, tax, split, transfer หรือ fx".into());
    }
    let security = matches!(kind.as_str(), "buy" | "sell" | "split");
    if security && instrument.is_none() {
        return Err("ระบุ symbol หรือจับคู่หลักทรัพย์สำหรับรายการนี้".into());
    }
    if !matches!(kind.as_str(), "buy" | "sell" | "dividend" | "tax" | "split")
        && instrument.is_some()
    {
        return Err("รายการเงินสดชนิดนี้ต้องไม่ระบุหลักทรัพย์".into());
    }
    let quantity = number("quantity", security, security)?;
    let unit_price = number("unit_price", matches!(kind.as_str(), "buy" | "sell"), true)?;
    let amount = number(
        "amount",
        !matches!(kind.as_str(), "buy" | "sell" | "split"),
        true,
    )?;
    let fee = number("fee", false, false)?.unwrap_or_else(|| "0".into());
    let tax = number("tax", false, false)?.unwrap_or_else(|| "0".into());
    if kind == "split" && (amount.is_some() || unit_price.is_some() || fee != "0" || tax != "0") {
        return Err("split ใช้ quantity เป็นอัตราส่วนหุ้นใหม่ต่อหุ้นเดิม และต้องไม่มีเงินหรือค่าธรรมเนียม".into());
    }
    if matches!(kind.as_str(), "buy" | "sell") {
        // Final cash totals already contain charges. Verify rather than adding
        // them again; leave omitted totals for the core's decimal calculation.
        let gross = parse_number(quantity.as_deref().unwrap_or(""))?
            .checked_mul(parse_number(unit_price.as_deref().unwrap_or(""))?)
            .ok_or("ยอดซื้อขายเกินขอบเขตที่รองรับ")?;
        let charges = parse_number(&fee)?
            .checked_add(parse_number(&tax)?)
            .ok_or("ค่าธรรมเนียมเกินขอบเขตที่รองรับ")?;
        let expected = if kind == "buy" {
            gross.checked_add(charges)
        } else {
            gross.checked_sub(charges)
        }
        .ok_or("ยอดซื้อขายเกินขอบเขตที่รองรับ")?;
        if expected <= Decimal::ZERO {
            return Err("ยอดซื้อขายสุทธิต้องมากกว่าศูนย์".into());
        }
        if let Some(ref actual) = amount
            && parse_number(actual)?
                .checked_sub(expected)
                .is_none_or(|difference| difference.abs() > Decimal::new(1, 2))
        {
            return Err(
                "amount ต้องเป็นยอดสุทธิรวม fee และ tax แล้ว และตรงกับ quantity × unit_price".into(),
            );
        }
    }
    let related_account_id = if kind == "transfer" {
        let account = get("related_account_id");
        if account == request.account_id || !data.accounts.iter().any(|a| a.id == account) {
            return Err("transfer ต้องระบุ related_account_id ของบัญชีปลายทางที่ต่างกัน".into());
        }
        Some(account.to_owned())
    } else if get("related_account_id").is_empty() {
        None
    } else {
        return Err("related_account_id ใช้ได้เฉพาะ transfer".into());
    };
    let (counter_currency, counter_amount) = if kind == "fx" {
        let other = get("counter_currency").to_ascii_uppercase();
        if !is_currency(&other) || other == currency {
            return Err("fx ต้องระบุ counter_currency ที่ต่างจาก currency".into());
        }
        (Some(other), number("counter_amount", true, true)?)
    } else if get("counter_currency").is_empty() && get("counter_amount").is_empty() {
        (None, None)
    } else {
        return Err("counter_currency และ counter_amount ใช้ได้เฉพาะ fx".into());
    };
    Ok(ParsedRow::Activity(Activity {
        id: Uuid::new_v4().to_string(),
        account_id: request.account_id.clone(),
        date,
        kind,
        instrument_id: instrument.map(|i| i.id),
        currency,
        quantity,
        unit_price,
        amount,
        fee,
        tax,
        related_account_id,
        counter_currency,
        counter_amount,
        sequence: index as i64,
        note: get("note").to_owned(),
    }))
}

fn resolve_instrument(
    values: &BTreeMap<String, String>,
    currency: &str,
    mappings: &BTreeMap<String, String>,
    data: &WealthData,
    new: &mut Vec<Instrument>,
) -> Result<Option<Instrument>, String> {
    let get = |key: &str| values.get(key).map(String::as_str).unwrap_or("").trim();
    let (id, symbol, exchange, kind) = (
        get("instrument_id"),
        get("symbol"),
        get("exchange"),
        get("instrument_kind"),
    );
    let selected = if !id.is_empty() {
        Some(id)
    } else {
        mappings.get(symbol).map(String::as_str)
    };
    if let Some(id) = selected {
        return data
            .instruments
            .iter()
            .find(|i| i.id == id)
            .cloned()
            .map(Some)
            .ok_or_else(|| "ไม่พบหลักทรัพย์ที่เลือกจับคู่".into());
    }
    if symbol.is_empty() {
        return Ok(None);
    }
    let (symbol, exchange, provider_symbol) = canonical_symbol(symbol, exchange)?;
    let matches: Vec<&Instrument> = data
        .instruments
        .iter()
        .chain(new.iter())
        .filter(|i| {
            i.symbol.eq_ignore_ascii_case(&symbol)
                && (exchange.is_empty() || i.exchange.eq_ignore_ascii_case(&exchange))
        })
        .collect();
    if matches.len() > 1 {
        return Err("symbol ตรงกับหลายตลาด กรุณาระบุ exchange หรือเลือกจับคู่หลักทรัพย์".into());
    }
    if let Some(instrument) = matches.first() {
        return Ok(Some((*instrument).clone()));
    }
    let kind = if kind.trim().is_empty() {
        "stock".to_owned()
    } else {
        kind.trim().to_ascii_lowercase()
    };
    if !matches!(kind.as_str(), "stock" | "etf") {
        return Err("instrument_kind ต้องเป็น stock หรือ etf".into());
    }
    let instrument = Instrument {
        id: Uuid::new_v4().to_string(),
        name: symbol.clone(),
        symbol,
        kind,
        currency: currency.to_owned(),
        exchange,
        provider_symbol,
    };
    new.push(instrument.clone());
    Ok(Some(instrument))
}

fn canonical_symbol(symbol: &str, exchange: &str) -> Result<(String, String, String), String> {
    let symbol = symbol.trim().to_ascii_uppercase();
    let exchange = exchange.trim().to_ascii_uppercase();
    let (mut ticker, qualified_exchange) = symbol
        .split_once('@')
        .map_or((symbol.as_str(), ""), |(a, b)| (a.trim(), b.trim()));
    if !exchange.is_empty() && !qualified_exchange.is_empty() && exchange != qualified_exchange {
        return Err("exchange ไม่ตรงกับตลาดที่ระบุใน symbol".into());
    }
    let mut market = if !qualified_exchange.is_empty() {
        qualified_exchange.to_owned()
    } else {
        exchange
    };
    if ticker.ends_with(".BK") {
        if !market.is_empty() && !matches!(market.as_str(), "XBKK" | "SET" | "BK") {
            return Err("symbol .BK ต้องใช้ตลาด XBKK".into());
        }
        ticker = ticker.trim_end_matches(".BK");
        market = "XBKK".into();
    }
    if matches!(market.as_str(), "SET" | "BK") {
        market = "XBKK".into();
    }
    if ticker.is_empty()
        || ticker.len() > 32
        || !ticker
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '^'))
        || market.len() > 16
        || !market.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("symbol หรือ exchange มีรูปแบบไม่ถูกต้อง".into());
    }
    let provider = if market == "XBKK" {
        format!("{ticker}.BK")
    } else {
        String::new()
    };
    Ok((ticker.into(), market, provider))
}

fn is_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|c| c.is_ascii_uppercase())
}

fn parse_number(value: &str) -> Result<Decimal, String> {
    let value = value.trim();
    let decimal = value.split_once('.');
    if value.is_empty()
        || value.starts_with('.')
        || value.ends_with('.')
        || !value.chars().all(|c| c.is_ascii_digit() || c == '.')
        || value.chars().filter(|c| *c == '.').count() > 1
        || decimal.is_some_and(|(_, fractional)| fractional.len() > 12)
    {
        return Err("จำนวนเงินหรือจำนวนหน่วยไม่ถูกต้อง".into());
    }
    let number = Decimal::from_str(value).map_err(|_| "จำนวนเงินหรือจำนวนหน่วยไม่ถูกต้อง")?;
    if number > Decimal::from(1_000_000_000_000_000_000u64) {
        return Err("จำนวนเงินหรือจำนวนหน่วยเกินขอบเขตที่รองรับ".into());
    }
    Ok(number)
}

fn parse_date(value: &str, format: &str) -> Result<String, String> {
    let parsed = match format {
        "iso" if value.len() == 10 => NaiveDate::parse_from_str(value, "%Y-%m-%d").ok(),
        "dmy" => NaiveDate::parse_from_str(value, "%d/%m/%Y").ok(),
        "buddhist" => {
            let parts: Vec<&str> = value.split('/').collect();
            if parts.len() == 3 {
                parts[2]
                    .parse::<i32>()
                    .ok()
                    .and_then(|year| year.checked_sub(543))
                    .and_then(|year| {
                        NaiveDate::from_ymd_opt(
                            year,
                            parts[1].parse().ok()?,
                            parts[0].parse().ok()?,
                        )
                    })
            } else {
                None
            }
        }
        _ => None,
    }
    .filter(|date| (1900..=2200).contains(&date.year()));
    parsed
        .map(|date| date.format("%Y-%m-%d").to_string())
        .ok_or_else(|| "วันที่ไม่ถูกต้อง ใช้ ค.ศ. YYYY-MM-DD หรือ DD/MM/YYYY ตามรูปแบบที่เลือก".into())
}

fn activity_key(activity: &Activity) -> String {
    let mut value = activity.clone();
    value.id.clear();
    value.sequence = 0;
    // A missing final cash amount means the same ledger operation as a supplied
    // reconciled total; normalize it before detecting repeated imports.
    if matches!(value.kind.as_str(), "buy" | "sell")
        && value.amount.is_none()
        && let (Some(q), Some(p), Ok(f), Ok(t)) = (
            &value.quantity,
            &value.unit_price,
            parse_number(&value.fee),
            parse_number(&value.tax),
        )
        && let (Ok(q), Ok(p)) = (parse_number(q), parse_number(p))
    {
        value.amount = q
            .checked_mul(p)
            .and_then(|gross| {
                f.checked_add(t).and_then(|charges| {
                    if value.kind == "buy" {
                        gross.checked_add(charges)
                    } else {
                        gross.checked_sub(charges)
                    }
                })
            })
            .map(|amount| amount.round_dp(12).normalize().to_string());
    }
    for number in [
        &mut value.quantity,
        &mut value.unit_price,
        &mut value.amount,
        &mut value.counter_amount,
    ]
    .into_iter()
    .flatten()
    {
        if let Ok(value) = parse_number(number) {
            *number = value.normalize().to_string();
        }
    }
    if let Ok(number) = parse_number(&value.fee) {
        value.fee = number.normalize().to_string();
    }
    if let Ok(number) = parse_number(&value.tax) {
        value.tax = number.normalize().to_string();
    }
    serde_json::to_string(&value).expect("serializable activity")
}

fn opening_key(opening: &OpeningPosition) -> String {
    let mut value = opening.clone();
    value.id.clear();
    if let Ok(number) = parse_number(&value.quantity) {
        value.quantity = number.normalize().to_string();
    }
    for number in [&mut value.cost_basis, &mut value.cost_basis_base]
        .into_iter()
        .flatten()
    {
        if let Ok(value) = parse_number(number) {
            *number = value.normalize().to_string();
        }
    }
    serde_json::to_string(&value).expect("serializable opening position")
}

pub(crate) fn apply_review(
    data: &mut WealthData,
    review: &ImportReview,
    request: &ImportRequest,
    selected: &BTreeSet<usize>,
) -> AppResult<()> {
    if data.revision != review.revision {
        return Err(AppError {
            code: "Conflict",
            message: "ข้อมูลเปลี่ยนหลังตรวจตัวอย่าง กรุณาตรวจข้อมูลอีกครั้ง".into(),
        });
    }
    let mut used_instruments = BTreeSet::new();
    let mut sequence = data
        .activities
        .iter()
        .map(|activity| activity.sequence)
        .max()
        .unwrap_or(-1);
    let selected_rows: Vec<_> = review
        .rows
        .iter()
        .filter(|row| selected.contains(&row.index))
        .collect();
    if selected_rows.len() != selected.len()
        || selected_rows
            .iter()
            .any(|row| !row.errors.is_empty() || (row.activity.is_some() == row.opening.is_some()))
    {
        return Err(AppError::invalid("รายการที่เลือกมีข้อผิดพลาด"));
    }
    sequence
        .checked_add(
            selected_rows
                .iter()
                .filter(|row| row.activity.is_some())
                .count() as i64,
        )
        .ok_or_else(|| AppError::invalid("ลำดับรายการเกินขอบเขตที่รองรับ"))?;
    for row in selected_rows {
        if let Some(activity) = &row.activity {
            if let Some(id) = &activity.instrument_id {
                used_instruments.insert(id.clone());
            }
            sequence += 1;
            let mut activity = activity.clone();
            activity.sequence = sequence;
            data.activities.push(activity);
        } else if let Some(opening) = &row.opening {
            if let Some(id) = &opening.instrument_id {
                used_instruments.insert(id.clone());
            }
            data.opening_positions.push(opening.clone());
        } else {
            return Err(AppError::invalid("รายการที่เลือกไม่มีข้อมูลสำหรับนำเข้า"));
        }
    }
    data.instruments.extend(
        review
            .new_instruments
            .iter()
            .filter(|i| used_instruments.contains(&i.id))
            .cloned(),
    );
    let name = request.mapping_name.trim();
    if !name.is_empty() {
        let existing = data
            .import_mappings
            .iter_mut()
            .find(|m| m.mode == request.mode && m.name == name);
        if let Some(mapping) = existing {
            mapping.columns = review.mapping.clone();
            mapping.date_format = request.date_format.clone();
        } else {
            data.import_mappings.push(ImportMapping {
                id: Uuid::new_v4().to_string(),
                name: name.into(),
                mode: request.mode.clone(),
                date_format: request.date_format.clone(),
                columns: review.mapping.clone(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wealth_core::Account;

    fn data() -> WealthData {
        WealthData {
            accounts: vec![
                Account {
                    id: "a".into(),
                    name: "Broker".into(),
                },
                Account {
                    id: "b".into(),
                    name: "Other".into(),
                },
            ],
            ..Default::default()
        }
    }
    fn request(mode: &str) -> ImportRequest {
        ImportRequest {
            account_id: "a".into(),
            mode: mode.into(),
            date_format: "iso".into(),
            mapping: BTreeMap::new(),
            mapping_name: "Broker".into(),
            csv: None,
            file_token: None,
            symbol_mappings: BTreeMap::new(),
        }
    }
    #[test]
    fn preview_is_read_only_and_maps_final_amount_once() {
        let data = data();
        let original = data.clone();
        let csv = "date,kind,symbol,exchange,currency,quantity,unit_price,amount,fee,tax\n2026-01-02,buy,PTT,XBKK,THB,1.5,30,46,1,0\n2026-01-03,sell,PTT.BK,,THB,0.5,32,15,1,0\n";
        let review = prepare_review(csv, "test.csv".into(), &request("activities"), &data).unwrap();
        assert_eq!(data, original);
        assert!(review.rows.iter().all(|row| row.errors.is_empty()));
        assert_eq!(review.new_instruments.len(), 1);
        assert_eq!(review.new_instruments[0].provider_symbol, "PTT.BK");
        assert_eq!(
            review.rows[0].activity.as_ref().unwrap().amount.as_deref(),
            Some("46")
        );
        assert_eq!(
            review.rows[1].activity.as_ref().unwrap().amount.as_deref(),
            Some("15")
        );
    }
    #[test]
    fn duplicate_preview_normalizes_decimal_and_derived_trade_amounts() {
        let mut data = data();
        let request = request("activities");
        let csv = "date,kind,currency,amount\n2026-01-02,deposit,THB,100.00\n2026-01-02,deposit,THB,100\n";
        let review = prepare_review(csv, "test.csv".into(), &request, &data).unwrap();
        assert!(!review.rows[0].duplicate);
        assert!(review.rows[1].duplicate);
        apply_review(&mut data, &review, &request, &BTreeSet::from([1])).unwrap();
        let again = prepare_review(csv, "test.csv".into(), &request, &data).unwrap();
        assert!(again.rows.iter().all(|r| r.duplicate));
        assert_eq!(data.import_mappings.len(), 1);
        let mut with_amount = Activity {
            id: "one".into(),
            account_id: "a".into(),
            date: "2026-01-01".into(),
            kind: "buy".into(),
            instrument_id: Some("i".into()),
            currency: "USD".into(),
            quantity: Some("1.00".into()),
            unit_price: Some("2.0".into()),
            amount: Some("3.00".into()),
            fee: "1.0".into(),
            tax: "0.0".into(),
            related_account_id: None,
            counter_currency: None,
            counter_amount: None,
            sequence: 0,
            note: "".into(),
        };
        let key = activity_key(&with_amount);
        with_amount.amount = None;
        assert_eq!(key, activity_key(&with_amount));
    }
    #[test]
    fn date_formats_and_explicit_column_mappings() {
        assert_eq!(parse_date("15/10/2569", "buddhist").unwrap(), "2026-10-15");
        assert_eq!(parse_date("29/02/2024", "dmy").unwrap(), "2024-02-29");
        assert!(parse_date("29/02/2025", "dmy").is_err());
        assert!(parse_date("2026-1-2", "iso").is_err());
        let mut request = request("opening_positions");
        request.date_format = "buddhist".into();
        request.mapping = BTreeMap::from([
            ("date".into(), "วันที่".into()),
            ("currency".into(), "เงิน".into()),
            ("quantity".into(), "ยอด".into()),
        ]);
        let review = prepare_review(
            "วันที่,เงิน,ยอด\n01/01/2569,THB,100\n",
            "ไทย.csv".into(),
            &request,
            &data(),
        )
        .unwrap();
        let opening = review.rows[0].opening.as_ref().unwrap();
        assert_eq!(opening.date, "2026-01-01");
        assert!(opening.instrument_id.is_none());
        assert!(opening.cost_basis.is_none());
    }
    #[test]
    fn errors_remain_reviewable_and_stale_review_cannot_apply() {
        let request = request("activities");
        let mut data = data();
        let csv = "date,kind,currency,amount\nnot-a-date,deposit,THB,100\n2026-01-02,deposit,THB,-100\n2026-01-02,deposit,THB,100\n";
        let review = prepare_review(csv, "test.csv".into(), &request, &data).unwrap();
        assert!(review.rows[0].activity.is_none());
        assert!(!review.rows[1].errors.is_empty());
        data.revision += 1;
        let original = data.clone();
        assert_eq!(
            apply_review(&mut data, &review, &request, &BTreeSet::from([3]))
                .unwrap_err()
                .code,
            "Conflict"
        );
        assert_eq!(data, original);
    }
    #[test]
    fn symbols_require_disambiguation_and_can_be_explicitly_selected() {
        let mut data = data();
        data.instruments = vec![
            Instrument {
                id: "us".into(),
                symbol: "ABC".into(),
                name: "US".into(),
                kind: "stock".into(),
                currency: "USD".into(),
                exchange: "XNAS".into(),
                provider_symbol: "".into(),
            },
            Instrument {
                id: "ca".into(),
                symbol: "ABC".into(),
                name: "CA".into(),
                kind: "stock".into(),
                currency: "CAD".into(),
                exchange: "XTSE".into(),
                provider_symbol: "".into(),
            },
        ];
        let csv = "date,kind,symbol,currency,quantity,unit_price\n2026-01-01,buy,ABC,USD,1,2\n";
        let mut request = request("activities");
        let review = prepare_review(csv, "test.csv".into(), &request, &data).unwrap();
        assert!(!review.rows[0].errors.is_empty());
        request.symbol_mappings.insert("ABC".into(), "us".into());
        let review = prepare_review(csv, "test.csv".into(), &request, &data).unwrap();
        assert_eq!(
            review.rows[0]
                .activity
                .as_ref()
                .unwrap()
                .instrument_id
                .as_deref(),
            Some("us")
        );
    }
    #[test]
    fn malformed_headers_bad_totals_and_excess_precision_are_rejected() {
        assert!(
            prepare_review(
                "date,date\n1,2\n",
                "test.csv".into(),
                &request("activities"),
                &data()
            )
            .is_err()
        );
        let csv = "date,kind,symbol,currency,quantity,unit_price,amount,fee\n2026-01-01,buy,AAPL,USD,1,2,2,1\n";
        let review =
            prepare_review(csv, "test.csv".into(), &request("activities"), &data()).unwrap();
        assert!(!review.rows[0].errors.is_empty());
        for invalid in [
            "-1",
            "1e2",
            "NaN",
            "1.0000000000001",
            "1000000000000000001",
            ".1",
        ] {
            assert!(parse_number(invalid).is_err(), "{invalid}");
        }
    }
    #[test]
    fn templates_contain_only_static_formula_safe_cells() {
        for mode in ["activities", "opening_positions"] {
            let template = template(mode).unwrap();
            let mut reader = csv::Reader::from_reader(template.as_bytes());
            for record in reader.records() {
                for cell in &record.unwrap() {
                    assert!(!cell.starts_with(['=', '+', '-', '@']));
                }
            }
        }
        assert!(template("bad").is_err());
    }

    #[test]
    fn selected_rows_append_in_csv_order_and_reconcile_broker_rounding() {
        let mut data = data();
        let request = request("activities");
        let initial = prepare_review(
            "date,kind,currency,amount\n2026-01-02,deposit,USD,100\n",
            "initial.csv".into(),
            &request,
            &data,
        )
        .unwrap();
        apply_review(&mut data, &initial, &request, &BTreeSet::from([1])).unwrap();
        data.activities[0].sequence = 50;
        let review = prepare_review(
            concat!(
                "date,kind,symbol,currency,quantity,unit_price,amount,fee\n",
                "2026-01-02,buy,VTI,USD,3,10.111,30.43,0.1\n",
                "2026-01-02,sell,VTI,USD,1,11,10.9,0.1\n"
            ),
            "trades.csv".into(),
            &request,
            &data,
        )
        .unwrap();
        assert!(review.rows.iter().all(|row| row.errors.is_empty()));
        apply_review(&mut data, &review, &request, &BTreeSet::from([2, 1])).unwrap();
        assert_eq!(
            data.activities
                .iter()
                .map(|a| a.sequence)
                .collect::<Vec<_>>(),
            vec![50, 51, 52]
        );
        assert_eq!(data.activities[1].kind, "buy");
        assert_eq!(data.activities[2].kind, "sell");
        wealth_core::validate(&data).unwrap();
    }

    #[test]
    fn invalid_rows_cannot_create_instruments_and_etf_kind_is_reviewed() {
        let data = data();
        let review = prepare_review(
            concat!(
                "date,kind,symbol,instrument_kind,currency,quantity,unit_price,amount\n",
                "2026-01-02,buy,VTI,stock,USD,1,10,999\n",
                "2026-01-02,buy,VTI,etf,USD,1,10,10\n"
            ),
            "etf.csv".into(),
            &request("activities"),
            &data,
        )
        .unwrap();
        assert!(!review.rows[0].errors.is_empty());
        assert!(review.rows[1].errors.is_empty());
        assert_eq!(review.new_instruments.len(), 1);
        assert_eq!(review.new_instruments[0].kind, "etf");
    }

    #[test]
    fn reviewed_duplicates_can_be_deliberately_included() {
        let mut data = data();
        let request = request("activities");
        let review = prepare_review(
            "date,kind,currency,amount\n2026-01-02,deposit,THB,100\n2026-01-02,deposit,THB,100\n",
            "duplicate.csv".into(),
            &request,
            &data,
        )
        .unwrap();
        assert!(review.rows[1].duplicate);
        apply_review(&mut data, &review, &request, &BTreeSet::from([1, 2])).unwrap();
        assert_eq!(data.activities.len(), 2);
        assert_ne!(data.activities[0].id, data.activities[1].id);
        wealth_core::validate(&data).unwrap();
    }

    #[test]
    fn review_tokens_are_single_use_and_expire_without_exposing_file_paths() {
        let request = request("activities");
        let csv = "date,kind,currency,amount\n2026-01-02,deposit,THB,100\n";
        let review = prepare_review(csv, "private.csv".into(), &request, &data()).unwrap();
        let token = review.token.clone();
        let mut pending = Some(PendingImport {
            token: token.clone(),
            csv: csv.into(),
            filename: "private.csv".into(),
            review,
            request,
            created_at: Instant::now(),
        });
        assert!(consume_pending(&mut pending, "wrong token").is_err());
        assert!(pending.is_some());
        let consumed = consume_pending(&mut pending, &token).unwrap();
        assert!(pending.is_none());
        assert!(consume_pending(&mut pending, &token).is_err());
        pending = Some(PendingImport {
            created_at: Instant::now()
                .checked_sub(REVIEW_LIFETIME + Duration::from_secs(1))
                .unwrap(),
            ..consumed
        });
        let error = consume_pending(&mut pending, &token).unwrap_err();
        assert!(pending.is_none());
        assert!(!error.message.contains("private.csv"));
    }
}
