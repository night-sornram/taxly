//! Opt-in, best-effort market data. Provider data never overwrites manual data.
use crate::error::{AppError, AppResult};
use crate::{AppState, wealth_storage};
use chrono::{DateTime, Datelike, Duration as Days, FixedOffset, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;
use std::time::Duration;
use tauri::State;
use wealth_core::{FxRate, Instrument, Price, WealthData};

const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_HISTORY_POINTS: usize = 50_000;
const MAX_INSTRUMENTS_PER_REFRESH: usize = 100;
const MAX_CURRENCIES_PER_REFRESH: usize = 32;

#[derive(Debug, Default, Serialize)]
pub struct RefreshResult {
    pub updated_prices: usize,
    pub updated_fx: usize,
    pub failures: Vec<String>,
}

/// This provider boundary deliberately contains no ledger/storage operations.
/// Alternate providers can return the same daily major-unit, as-traded prices.
trait MarketDataProvider {
    async fn history(
        &self,
        symbol: &str,
        currency: &str,
        start: NaiveDate,
        end: NaiveDate,
    ) -> AppResult<Vec<DailyPrice>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DailyPrice {
    date: String,
    close: String,
}

struct YahooProvider {
    client: reqwest::Client,
}

impl YahooProvider {
    fn new() -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Taxly/0.1 (desktop portfolio tracker)")
            .build()
            .map_err(|_| market_error("เตรียมการเชื่อมต่อข้อมูลตลาดไม่สำเร็จ"))?;
        Ok(Self { client })
    }
}

fn yahoo_chart_endpoint(symbol: &str) -> AppResult<reqwest::Url> {
    if !valid_provider_symbol(symbol) {
        return Err(market_error("สัญลักษณ์สำหรับผู้ให้ข้อมูลไม่ถูกต้อง"));
    }
    let mut url = reqwest::Url::parse("https://query1.finance.yahoo.com/v8/finance/chart/")
        .map_err(|_| market_error("เตรียมการเชื่อมต่อข้อมูลตลาดไม่สำเร็จ"))?;
    url.path_segments_mut()
        .map_err(|_| market_error("เตรียมการเชื่อมต่อข้อมูลตลาดไม่สำเร็จ"))?
        .pop_if_empty()
        .push(symbol);
    Ok(url)
}

impl MarketDataProvider for YahooProvider {
    async fn history(
        &self,
        symbol: &str,
        currency: &str,
        start: NaiveDate,
        end: NaiveDate,
    ) -> AppResult<Vec<DailyPrice>> {
        let mut url = yahoo_chart_endpoint(symbol)?;
        let period1 = start
            .checked_sub_signed(Days::days(1))
            .unwrap_or(start)
            .and_hms_opt(0, 0, 0)
            .expect("valid midnight")
            .and_utc()
            .timestamp();
        // Yahoo adjusts historical closes for later splits, including splits
        // after the requested end date. Fetch through today to reverse all of
        // those factors, then retain only the requested interval.
        let fetch_end = end
            .max(Utc::now().date_naive())
            .checked_add_signed(Days::days(2))
            .ok_or_else(|| market_error("ช่วงวันที่อยู่นอกขอบเขต"))?;
        let period2 = fetch_end
            .and_hms_opt(0, 0, 0)
            .expect("valid midnight")
            .and_utc()
            .timestamp();
        url.query_pairs_mut()
            .append_pair("period1", &period1.to_string())
            .append_pair("period2", &period2.to_string())
            .append_pair("interval", "1d")
            .append_pair("events", "splits")
            .append_pair("includeAdjustedClose", "false");
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| market_error("เชื่อมต่อ Yahoo Finance ไม่สำเร็จหรือหมดเวลา"))?;
        if !response.status().is_success() {
            return Err(provider_http_error(response.status().as_u16()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(market_error("ข้อมูลตลาดมีขนาดเกินขอบเขตที่รองรับ"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| market_error("รับข้อมูลตลาดไม่สำเร็จ"))?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(market_error("ข้อมูลตลาดมีขนาดเกินขอบเขตที่รองรับ"));
            }
            bytes.extend_from_slice(&chunk);
        }
        parse_yahoo_chart(&bytes, currency, start, end)
    }
}

#[tauri::command]
pub async fn refresh_wealth_market_data(
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> AppResult<RefreshResult> {
    let data = wealth_storage::load(&state.pool).await?;
    if !data.preferences.market_data_enabled {
        return Err(AppError::invalid("เปิดใช้ข้อมูลตลาดในตั้งค่าการลงทุนก่อนรีเฟรช"));
    }
    let start = iso_date(&start_date)?;
    let end = iso_date(&end_date)?;
    if start > end || (end - start).num_days() > 36_600 || end > Utc::now().date_naive() {
        return Err(AppError::invalid(
            "ช่วงวันที่ต้องเรียงจากอดีตถึงปัจจุบันและไม่เกิน 100 ปี",
        ));
    }
    if data.instruments.len() > MAX_INSTRUMENTS_PER_REFRESH {
        return Err(AppError::invalid("รีเฟรชได้สูงสุด 100 หลักทรัพย์ต่อพอร์ต"));
    }
    let provider = YahooProvider::new()?;
    let (prices, rates, mut result) = collect_market_data(&provider, &data, start, end).await?;
    // A concurrent edit may change currency/split history. Do not attach a
    // response to a different reviewed ledger; the user can safely retry.
    if !prices.is_empty() || !rates.is_empty() {
        let revision = data.revision;
        let mut updated_prices = 0;
        let mut updated_fx = 0;
        wealth_storage::mutate(&state.pool, Some(revision), |current| {
            (updated_prices, updated_fx) = apply_market_data(current, prices, rates);
            Ok(())
        })
        .await?;
        result.updated_prices = updated_prices;
        result.updated_fx = updated_fx;
    }
    Ok(result)
}

async fn collect_market_data<P: MarketDataProvider>(
    provider: &P,
    data: &WealthData,
    start: NaiveDate,
    end: NaiveDate,
) -> AppResult<(Vec<Price>, Vec<FxRate>, RefreshResult)> {
    let mut result = RefreshResult::default();
    let mut prices = Vec::new();
    let mut rates = Vec::new();
    let fetched_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    for instrument in &data.instruments {
        let symbol = match yahoo_symbol(instrument) {
            Ok(symbol) => symbol,
            Err(error) => {
                result
                    .failures
                    .push(format!("{}: {}", instrument.symbol, error.message));
                continue;
            }
        };
        match provider
            .history(&symbol, &instrument.currency, start, end)
            .await
        {
            Ok(history) => prices.extend(history.into_iter().map(|point| Price {
                instrument_id: instrument.id.clone(),
                date: point.date,
                close: point.close,
                source: "yahoo".into(),
                fetched_at: fetched_at.clone(),
            })),
            Err(error) => result
                .failures
                .push(format!("{}: {}", instrument.symbol, error.message)),
        }
    }
    let base = &data.preferences.reporting_currency;
    let currencies: BTreeSet<String> = data
        .instruments
        .iter()
        .map(|i| i.currency.clone())
        .chain(data.activities.iter().map(|a| a.currency.clone()))
        .chain(
            data.activities
                .iter()
                .filter_map(|a| a.counter_currency.clone()),
        )
        .chain(data.opening_positions.iter().map(|o| o.currency.clone()))
        .filter(|currency| currency != base)
        .collect();
    if currencies.len() > MAX_CURRENCIES_PER_REFRESH {
        return Err(AppError::invalid("รีเฟรชได้สูงสุด 32 สกุลเงินต่อพอร์ต"));
    }
    for currency in currencies {
        let symbol = format!("{currency}{base}=X");
        match provider.history(&symbol, base, start, end).await {
            Ok(history) => rates.extend(history.into_iter().map(|point| FxRate {
                from_currency: currency.clone(),
                to_currency: base.clone(),
                date: point.date,
                rate: point.close,
                source: "yahoo".into(),
                fetched_at: fetched_at.clone(),
            })),
            Err(error) => result
                .failures
                .push(format!("{currency}/{base}: {}", error.message)),
        }
    }
    Ok((prices, rates, result))
}

fn apply_market_data(
    data: &mut WealthData,
    prices: Vec<Price>,
    rates: Vec<FxRate>,
) -> (usize, usize) {
    let mut updated_prices = 0;
    let mut updated_fx = 0;
    // Index once: historical refreshes can contain tens of thousands of rows.
    let mut price_indices: BTreeMap<(String, String), usize> = data
        .prices
        .iter()
        .enumerate()
        .map(|(index, p)| ((p.instrument_id.clone(), p.date.clone()), index))
        .collect();
    for price in prices {
        let key = (price.instrument_id.clone(), price.date.clone());
        if let Some(index) = price_indices.get(&key) {
            if data.prices[*index].source == "manual" {
                continue;
            }
            if data.prices[*index] != price {
                data.prices[*index] = price;
                updated_prices += 1;
            }
        } else {
            price_indices.insert(key, data.prices.len());
            data.prices.push(price);
            updated_prices += 1;
        }
    }
    let mut rate_indices: BTreeMap<(String, String, String), usize> = data
        .fx_rates
        .iter()
        .enumerate()
        .map(|(index, r)| {
            (
                (
                    r.from_currency.clone(),
                    r.to_currency.clone(),
                    r.date.clone(),
                ),
                index,
            )
        })
        .collect();
    for rate in rates {
        let key = (
            rate.from_currency.clone(),
            rate.to_currency.clone(),
            rate.date.clone(),
        );
        // Preserve the inverse of a manual pair too: a provider quote must not
        // silently take precedence over a manually entered inverse rate.
        let inverse = (
            rate.to_currency.clone(),
            rate.from_currency.clone(),
            rate.date.clone(),
        );
        if rate_indices
            .get(&inverse)
            .is_some_and(|index| data.fx_rates[*index].source == "manual")
        {
            continue;
        }
        if let Some(index) = rate_indices.get(&key) {
            if data.fx_rates[*index].source == "manual" {
                continue;
            }
            if data.fx_rates[*index] != rate {
                data.fx_rates[*index] = rate;
                updated_fx += 1;
            }
        } else {
            rate_indices.insert(key, data.fx_rates.len());
            data.fx_rates.push(rate);
            updated_fx += 1;
        }
    }
    (updated_prices, updated_fx)
}

fn iso_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .filter(|date| value.len() == 10 && (1900..=2200).contains(&date.year()))
        .ok_or_else(|| AppError::invalid("วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD"))
}

fn yahoo_symbol(instrument: &Instrument) -> AppResult<String> {
    if !instrument.provider_symbol.trim().is_empty() {
        let symbol = instrument.provider_symbol.trim().to_ascii_uppercase();
        return if valid_provider_symbol(&symbol) {
            Ok(symbol)
        } else {
            Err(market_error("สัญลักษณ์ผู้ให้ข้อมูลไม่ถูกต้อง"))
        };
    }
    let ticker = instrument.symbol.trim().to_ascii_uppercase();
    let exchange = instrument.exchange.trim().to_ascii_uppercase();
    let suffix = match exchange.as_str() {
        "" | "XNAS" | "XNYS" | "XASE" | "ARCX" | "NASDAQ" | "NYSE" => "",
        "XBKK" | "SET" | "BK" => ".BK",
        "XTSE" => ".TO",
        "XTSX" => ".V",
        "XLON" => ".L",
        "XHKG" => ".HK",
        "XTKS" | "XJPX" => ".T",
        "XASX" => ".AX",
        "XETR" => ".DE",
        "XPAR" => ".PA",
        "XAMS" => ".AS",
        "XBRU" => ".BR",
        "XSWX" => ".SW",
        "XMIL" => ".MI",
        "XMAD" => ".MC",
        "XSHG" => ".SS",
        "XSHE" => ".SZ",
        "XNZE" => ".NZ",
        _ => return Err(market_error("ตลาดนี้ต้องระบุ Yahoo symbol ในข้อมูลหลักทรัพย์")),
    };
    let symbol = if suffix.is_empty() || ticker.ends_with(suffix) {
        ticker
    } else {
        format!("{ticker}{suffix}")
    };
    if valid_provider_symbol(&symbol) {
        Ok(symbol)
    } else {
        Err(market_error("สัญลักษณ์ผู้ให้ข้อมูลไม่ถูกต้อง"))
    }
}

fn valid_provider_symbol(symbol: &str) -> bool {
    !symbol.is_empty()
        && symbol.len() <= 64
        && symbol
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'^' | b'='))
}

fn market_error(message: &str) -> AppError {
    AppError {
        code: "MarketDataError",
        message: message.into(),
    }
}

fn provider_http_error(status: u16) -> AppError {
    let message = if status == 429 {
        "Yahoo Finance จำกัดจำนวนคำขอ โปรดลองภายหลัง"
    } else {
        "Yahoo Finance ไม่สามารถส่งข้อมูลสัญลักษณ์นี้ได้"
    };
    market_error(&format!("{message} (HTTP {status})"))
}

fn provider_decimal(value: &Value) -> AppResult<Decimal> {
    let text = match value {
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        _ => return Err(market_error("ข้อมูลตัวเลขจากผู้ให้ข้อมูลไม่ถูกต้อง")),
    };
    let number = Decimal::from_str(&text)
        .or_else(|_| Decimal::from_scientific(&text))
        .map_err(|_| market_error("ข้อมูลตัวเลขจากผู้ให้ข้อมูลไม่ถูกต้อง"))?;
    if number <= Decimal::ZERO || number > Decimal::from(1_000_000_000_000_000_000u64) {
        return Err(market_error("ราคาหรืออัตราแลกเปลี่ยนจากผู้ให้ข้อมูลอยู่นอกขอบเขต"));
    }
    Ok(number)
}

fn currency_unit(provider_currency: &str, expected: &str) -> AppResult<Decimal> {
    let (major, divisor) = match provider_currency {
        "GBp" | "GBX" => ("GBP", 100),
        "ZAc" | "ZAC" => ("ZAR", 100),
        "ILA" => ("ILS", 100),
        "KWF" => ("KWD", 100),
        other => (other, 1),
    };
    if !major.eq_ignore_ascii_case(expected) {
        return Err(market_error("สกุลเงินราคาจากผู้ให้ข้อมูลไม่ตรงกับหลักทรัพย์"));
    }
    Ok(Decimal::ONE / Decimal::from(divisor))
}

fn parse_yahoo_chart(
    bytes: &[u8],
    expected_currency: &str,
    start: NaiveDate,
    end: NaiveDate,
) -> AppResult<Vec<DailyPrice>> {
    let json: Value = serde_json::from_slice(bytes)
        .map_err(|_| market_error("รูปแบบข้อมูลจาก Yahoo Finance ไม่ถูกต้อง"))?;
    let chart = json
        .get("chart")
        .ok_or_else(|| market_error("ไม่พบข้อมูลราคา"))?;
    if chart.get("error").is_some_and(|error| !error.is_null()) {
        return Err(market_error("Yahoo Finance ไม่พบข้อมูลสัญลักษณ์นี้"));
    }
    let result = chart
        .get("result")
        .and_then(Value::as_array)
        .and_then(|r| r.first())
        .ok_or_else(|| market_error("ไม่พบข้อมูลราคา"))?;
    let meta = result
        .get("meta")
        .ok_or_else(|| market_error("ไม่พบรายละเอียดสกุลเงินราคา"))?;
    let unit = currency_unit(
        meta.get("currency").and_then(Value::as_str).unwrap_or(""),
        expected_currency,
    )?;
    let offset = meta.get("gmtoffset").and_then(Value::as_i64).unwrap_or(0);
    let timezone = i32::try_from(offset)
        .ok()
        .and_then(FixedOffset::east_opt)
        .ok_or_else(|| market_error("เขตเวลาจากผู้ให้ข้อมูลไม่ถูกต้อง"))?;
    let date_for = |timestamp: i64| {
        DateTime::from_timestamp(timestamp, 0)
            .map(|time| time.with_timezone(&timezone).date_naive())
            .ok_or_else(|| market_error("วันที่จากผู้ให้ข้อมูลไม่ถูกต้อง"))
    };
    let timestamps = result
        .get("timestamp")
        .and_then(Value::as_array)
        .ok_or_else(|| market_error("ไม่พบประวัติราคาในช่วงวันที่เลือก"))?;
    let closes = result
        .pointer("/indicators/quote/0/close")
        .and_then(Value::as_array)
        .ok_or_else(|| market_error("ไม่พบประวัติราคาปิด"))?;
    if timestamps.len() > MAX_HISTORY_POINTS || timestamps.len() != closes.len() {
        return Err(market_error("ประวัติราคามีขนาดหรือจำนวนแถวไม่ถูกต้อง"));
    }
    let mut splits = Vec::new();
    if let Some(events) = result.pointer("/events/splits") {
        let events = events
            .as_object()
            .ok_or_else(|| market_error("ข้อมูลปรับจำนวนหุ้นไม่ถูกต้อง"))?;
        for event in events.values() {
            let date = event
                .get("date")
                .and_then(Value::as_i64)
                .ok_or_else(|| market_error("วันที่ปรับจำนวนหุ้นไม่ถูกต้อง"))?;
            let numerator = provider_decimal(
                event
                    .get("numerator")
                    .ok_or_else(|| market_error("อัตราปรับจำนวนหุ้นไม่ถูกต้อง"))?,
            )?;
            let denominator = provider_decimal(
                event
                    .get("denominator")
                    .ok_or_else(|| market_error("อัตราปรับจำนวนหุ้นไม่ถูกต้อง"))?,
            )?;
            let ratio = numerator
                .checked_div(denominator)
                .ok_or_else(|| market_error("อัตราปรับจำนวนหุ้นเกินขอบเขต"))?;
            splits.push((date_for(date)?, ratio));
        }
    }
    if splits.len() > 1_000 {
        return Err(market_error("จำนวนรายการปรับหุ้นเกินขอบเขต"));
    }
    let mut daily = BTreeMap::new();
    for (timestamp, close) in timestamps.iter().zip(closes) {
        // Nulls are trading gaps. Never manufacture a zero quote for them.
        if close.is_null() {
            continue;
        }
        let timestamp = timestamp
            .as_i64()
            .ok_or_else(|| market_error("วันที่ราคาปิดไม่ถูกต้อง"))?;
        let date = date_for(timestamp)?;
        if date < start || date > end {
            continue;
        }
        let mut value = provider_decimal(close)?;
        for (split_date, ratio) in &splits {
            if *split_date > date {
                value = value
                    .checked_mul(*ratio)
                    .ok_or_else(|| market_error("ราคาหลังปรับจำนวนหุ้นเกินขอบเขต"))?;
            }
        }
        value = value
            .checked_mul(unit)
            .ok_or_else(|| market_error("ราคาเกินขอบเขต"))?
            .round_dp(12);
        if value <= Decimal::ZERO || value > Decimal::from(1_000_000_000_000_000_000u64) {
            return Err(market_error("ราคาหลังปรับหน่วยอยู่นอกขอบเขต"));
        }
        daily.insert(
            date.format("%Y-%m-%d").to_string(),
            value.normalize().to_string(),
        );
    }
    if daily.is_empty() {
        return Err(market_error("ไม่พบราคาปิดในช่วงวันที่เลือก ข้อมูลเดิมยังอยู่ครบ"));
    }
    Ok(daily
        .into_iter()
        .map(|(date, close)| DailyPrice { date, close })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn yahoo_endpoint_has_one_symbol_path_segment() {
        assert_eq!(
            yahoo_chart_endpoint("PTT.BK").unwrap().as_str(),
            "https://query1.finance.yahoo.com/v8/finance/chart/PTT.BK"
        );
        assert_eq!(
            yahoo_chart_endpoint("USDTHB=X").unwrap().as_str(),
            "https://query1.finance.yahoo.com/v8/finance/chart/USDTHB=X"
        );
        assert!(yahoo_chart_endpoint("PTT.BK/other").is_err());
    }

    #[test]
    fn provider_http_errors_include_only_safe_status_and_fixed_message() {
        assert_eq!(provider_http_error(404).code, "MarketDataError");
        assert!(provider_http_error(404).message.ends_with("(HTTP 404)"));
        let limited = provider_http_error(429).message;
        assert!(limited.contains("จำกัดจำนวนคำขอ"));
        assert!(limited.ends_with("(HTTP 429)"));
    }

    fn fixture(currency: &str, closes: Value, splits: Value) -> Vec<u8> {
        serde_json::to_vec(&json!({ "chart": { "error":null,"result":[{
            "meta":{"currency":currency,"gmtoffset":0},
            "timestamp":[1704153600,1704240000,1704326400],
            "indicators":{"quote":[{"close":closes}],"adjclose":[{"adjclose":[0.1,0.1,0.1]}]},
            "events":{"splits":splits}
        }]}}))
        .unwrap()
    }
    #[test]
    fn yahoo_history_reverses_splits_and_ignores_dividend_adjusted_close() {
        let bytes = fixture(
            "USD",
            json!([50, 52, 53]),
            json!({"split":{"date":1704240000,"numerator":2,"denominator":1}}),
        );
        let history = parse_yahoo_chart(
            &bytes,
            "USD",
            iso_date("2024-01-02").unwrap(),
            iso_date("2024-01-04").unwrap(),
        )
        .unwrap();
        assert_eq!(
            history.iter().map(|p| p.close.as_str()).collect::<Vec<_>>(),
            vec!["100", "52", "53"]
        );
        // A split after the user's requested end still restores the pre-split quote.
        let first = parse_yahoo_chart(
            &bytes,
            "USD",
            iso_date("2024-01-02").unwrap(),
            iso_date("2024-01-02").unwrap(),
        )
        .unwrap();
        assert_eq!(first[0].close, "100");
    }
    #[test]
    fn currency_units_null_quotes_and_currency_mismatch() {
        let bytes = fixture("GBp", json!([1234.5, null, 1250]), json!({}));
        let history = parse_yahoo_chart(
            &bytes,
            "GBP",
            iso_date("2024-01-02").unwrap(),
            iso_date("2024-01-04").unwrap(),
        )
        .unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].close, "12.345");
        assert!(
            parse_yahoo_chart(
                &bytes,
                "THB",
                iso_date("2024-01-02").unwrap(),
                iso_date("2024-01-04").unwrap()
            )
            .is_err()
        );
    }
    #[test]
    fn thai_symbols_are_provider_specific_and_overrides_are_bounded() {
        let mut instrument = Instrument {
            id: "i".into(),
            symbol: "PTT".into(),
            name: "PTT".into(),
            kind: "stock".into(),
            currency: "THB".into(),
            exchange: "XBKK".into(),
            provider_symbol: "".into(),
        };
        assert_eq!(yahoo_symbol(&instrument).unwrap(), "PTT.BK");
        instrument.provider_symbol = "https://other.example/private".into();
        assert!(yahoo_symbol(&instrument).is_err());
        assert!(valid_provider_symbol("USDTHB=X"));
        assert!(valid_provider_symbol("^GSPC"));
    }
    #[test]
    fn provider_failures_and_bad_numbers_are_errors_without_raw_response() {
        let error = parse_yahoo_chart(
            br#"{"chart":{"error":{"description":"sensitive upstream content"},"result":null}}"#,
            "USD",
            iso_date("2024-01-01").unwrap(),
            iso_date("2024-01-04").unwrap(),
        )
        .unwrap_err();
        assert!(!error.message.contains("sensitive"));
        for close in [json!([-1, 1, 2]), json!([0, 1, 2]), json!(["NaN", 1, 2])] {
            assert!(
                parse_yahoo_chart(
                    &fixture("USD", close, json!({})),
                    "USD",
                    iso_date("2024-01-01").unwrap(),
                    iso_date("2024-01-04").unwrap()
                )
                .is_err()
            );
        }
    }
    #[test]
    fn upserts_preserve_manual_quotes_and_both_directions_of_manual_fx() {
        let manual_price = Price {
            instrument_id: "i".into(),
            date: "2024-01-02".into(),
            close: "10".into(),
            source: "manual".into(),
            fetched_at: "".into(),
        };
        let manual_fx = FxRate {
            from_currency: "THB".into(),
            to_currency: "USD".into(),
            date: "2024-01-02".into(),
            rate: "0.03".into(),
            source: "manual".into(),
            fetched_at: "".into(),
        };
        let mut data = WealthData {
            prices: vec![manual_price.clone()],
            fx_rates: vec![manual_fx.clone()],
            ..Default::default()
        };
        let yahoo_price = Price {
            close: "99".into(),
            source: "yahoo".into(),
            ..manual_price.clone()
        };
        let yahoo_fx = FxRate {
            from_currency: "USD".into(),
            to_currency: "THB".into(),
            rate: "35".into(),
            source: "yahoo".into(),
            ..manual_fx.clone()
        };
        assert_eq!(
            apply_market_data(&mut data, vec![yahoo_price], vec![yahoo_fx]),
            (0, 0)
        );
        assert_eq!(data.prices, vec![manual_price]);
        assert_eq!(data.fx_rates, vec![manual_fx]);
    }
    struct FixtureProvider;
    impl MarketDataProvider for FixtureProvider {
        async fn history(
            &self,
            symbol: &str,
            _currency: &str,
            _start: NaiveDate,
            _end: NaiveDate,
        ) -> AppResult<Vec<DailyPrice>> {
            if symbol == "FAIL" {
                Err(market_error("ไม่พบข้อมูล"))
            } else {
                Ok(vec![DailyPrice {
                    date: "2024-01-02".into(),
                    close: if symbol == "USDTHB=X" { "35" } else { "100" }.into(),
                }])
            }
        }
    }
    #[tokio::test]
    async fn provider_is_replaceable_and_partial_failures_retain_other_results() {
        let instrument = |id: &str, symbol: &str| Instrument {
            id: id.into(),
            symbol: symbol.into(),
            name: symbol.into(),
            kind: "stock".into(),
            currency: "USD".into(),
            exchange: "XNAS".into(),
            provider_symbol: "".into(),
        };
        let data = WealthData {
            instruments: vec![instrument("good", "AAPL"), instrument("bad", "FAIL")],
            ..Default::default()
        };
        let (prices, rates, result) = collect_market_data(
            &FixtureProvider,
            &data,
            iso_date("2024-01-01").unwrap(),
            iso_date("2024-01-04").unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(prices.len(), 1);
        assert_eq!(rates.len(), 1);
        assert_eq!(rates[0].rate, "35");
        assert_eq!(result.failures.len(), 1);
        assert!(result.failures[0].starts_with("FAIL:"));
    }
    #[test]
    fn chart_dates_use_the_exchange_day() {
        let bytes = serde_json::to_vec(&json!({"chart":{"error":null,"result":[{"meta":{"currency":"THB","gmtoffset":25200},"timestamp":[1704128400],"indicators":{"quote":[{"close":[30]}]}}]}})).unwrap();
        let history = parse_yahoo_chart(
            &bytes,
            "THB",
            iso_date("2024-01-02").unwrap(),
            iso_date("2024-01-02").unwrap(),
        )
        .unwrap();
        assert_eq!(history[0].date, "2024-01-02");
    }
}
