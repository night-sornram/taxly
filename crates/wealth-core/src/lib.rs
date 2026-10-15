//! Deterministic, decimal-only investment accounting. This crate has no IO or clock.
pub mod models;
pub use models::*;

use chrono::{Datelike, Duration, NaiveDate};
use rust_decimal::Decimal;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::str::FromStr;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WealthError {
    #[error("{0}")]
    Validation(String),
    #[error("ตัวเลขเกินขอบเขตที่รองรับ")]
    Overflow,
}

type Result<T> = std::result::Result<T, WealthError>;
type Key = (String, String);
fn invalid(message: impl Into<String>) -> WealthError {
    WealthError::Validation(message.into())
}
fn add(a: Decimal, b: Decimal) -> Result<Decimal> {
    a.checked_add(b).ok_or(WealthError::Overflow)
}
fn sub(a: Decimal, b: Decimal) -> Result<Decimal> {
    a.checked_sub(b).ok_or(WealthError::Overflow)
}
fn mul(a: Decimal, b: Decimal) -> Result<Decimal> {
    let value = a.checked_mul(b).ok_or(WealthError::Overflow)?;
    if value.is_zero() && !a.is_zero() && !b.is_zero() {
        return Err(WealthError::Overflow);
    }
    Ok(value)
}
fn div(a: Decimal, b: Decimal) -> Result<Decimal> {
    let value = a.checked_div(b).ok_or(WealthError::Overflow)?;
    if value.is_zero() && !a.is_zero() {
        return Err(WealthError::Overflow);
    }
    Ok(value)
}
fn out(value: Decimal) -> String {
    value.normalize().to_string()
}
fn optional(value: Option<Decimal>) -> Option<String> {
    value.map(out)
}
fn combine(a: Option<Decimal>, b: Option<Decimal>) -> Result<Option<Decimal>> {
    match (a, b) {
        (Some(a), Some(b)) => Ok(Some(add(a, b)?)),
        _ => Ok(None),
    }
}
fn date(value: &str) -> Result<NaiveDate> {
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| invalid(format!("รูปแบบวันที่ไม่ถูกต้อง: {value}")))?;
    if parsed.format("%Y-%m-%d").to_string() != value || !(1900..=2200).contains(&parsed.year()) {
        return Err(invalid(format!(
            "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD ระหว่างปี 1900–2200: {value}"
        )));
    }
    Ok(parsed)
}
fn decimal(value: &str) -> Result<Decimal> {
    let mut dots = 0;
    if value.is_empty()
        || value.len() > 40
        || !value.bytes().all(|c| {
            if c == b'.' {
                dots += 1;
                true
            } else {
                c.is_ascii_digit()
            }
        })
        || dots > 1
        || value.starts_with('.')
        || value.ends_with('.')
    {
        return Err(invalid(format!(
            "จำนวนไม่ถูกต้อง (ต้องเป็นตัวเลขไม่ติดลบ): {value}"
        )));
    }
    let parsed =
        Decimal::from_str(value).map_err(|_| invalid(format!("จำนวนทศนิยมไม่ถูกต้อง: {value}")))?;
    if parsed.scale() > 12 || parsed > Decimal::from(1_000_000_000_000_000_000_u64) {
        return Err(invalid("รองรับทศนิยมไม่เกิน 12 ตำแหน่ง และค่าไม่เกิน 10^18"));
    }
    Ok(parsed)
}
fn positive(value: &str) -> Result<Decimal> {
    let n = decimal(value)?;
    if n <= Decimal::ZERO {
        return Err(invalid("ค่าต้องมากกว่าศูนย์"));
    }
    Ok(n)
}
fn text(value: &str, label: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > max || value.chars().any(char::is_control) {
        Err(invalid(format!("ข้อมูล{label}ไม่ถูกต้อง")))
    } else {
        Ok(())
    }
}
fn id(value: &str) -> Result<()> {
    text(value, "รหัส", 128)
}
fn currency(value: &str) -> Result<()> {
    if value.len() != 3 || !value.bytes().all(|c| c.is_ascii_uppercase()) {
        Err(invalid(format!(
            "สกุลเงินต้องเป็นตัวอักษรภาษาอังกฤษพิมพ์ใหญ่ 3 ตัว: {value}"
        )))
    } else {
        Ok(())
    }
}
fn timestamp(value: &str) -> Result<()> {
    if !value.is_empty() && chrono::DateTime::parse_from_rfc3339(value).is_err() {
        Err(invalid("รูปแบบเวลาที่ดึงข้อมูลไม่ถูกต้อง"))
    } else {
        Ok(())
    }
}
fn unique<'a>(values: impl Iterator<Item = &'a str>, label: &str) -> Result<BTreeSet<String>> {
    let mut seen = BTreeSet::new();
    for value in values {
        id(value)?;
        if !seen.insert(value.to_owned()) {
            return Err(invalid(format!("{label}ซ้ำ: {value}")));
        }
    }
    Ok(seen)
}

#[derive(Clone)]
struct ParsedActivity<'a> {
    row: &'a Activity,
    date: NaiveDate,
    quantity: Option<Decimal>,
    amount: Decimal,
    counter: Option<Decimal>,
}
#[derive(Clone)]
struct ParsedOpening<'a> {
    row: &'a OpeningPosition,
    date: NaiveDate,
    quantity: Decimal,
    cost: Option<Decimal>,
    base: Option<Decimal>,
}
struct FxQuote {
    rate: Decimal,
    manual: bool,
    fetched_at: Option<chrono::DateTime<chrono::FixedOffset>>,
}
struct Prepared<'a> {
    data: &'a WealthData,
    activities: Vec<ParsedActivity<'a>>,
    openings: Vec<ParsedOpening<'a>>,
    prices: BTreeMap<(String, NaiveDate), Decimal>,
    fx: BTreeMap<(String, String, NaiveDate), FxQuote>,
    instruments: BTreeMap<String, &'a Instrument>,
    splits: BTreeMap<Key, Vec<(NaiveDate, Decimal)>>,
    untracked_cash: BTreeSet<String>,
}
impl<'a> Prepared<'a> {
    fn new(data: &'a WealthData) -> Result<Self> {
        if data.revision < 0 {
            return Err(invalid("เลขรุ่นข้อมูลต้องไม่ติดลบ"));
        }
        currency(&data.preferences.reporting_currency)?;
        let accounts = unique(data.accounts.iter().map(|r| r.id.as_str()), "รหัสบัญชี")?;
        let untracked_cash = data
            .accounts
            .iter()
            .filter(|a| !a.track_cash)
            .map(|a| a.id.clone())
            .collect::<BTreeSet<_>>();
        let instrument_ids = unique(data.instruments.iter().map(|r| r.id.as_str()), "รหัสหลักทรัพย์")?;
        unique(data.activities.iter().map(|r| r.id.as_str()), "รหัสรายการ")?;
        unique(
            data.opening_positions.iter().map(|r| r.id.as_str()),
            "รหัสยอดตั้งต้น",
        )?;
        unique(
            data.import_mappings.iter().map(|r| r.id.as_str()),
            "mapping id",
        )?;
        for r in &data.accounts {
            text(&r.name, "ชื่อบัญชี", 200)?;
        }
        let mut instruments = BTreeMap::new();
        let mut instrument_keys = BTreeSet::new();
        for r in &data.instruments {
            text(&r.symbol, "สัญลักษณ์", 64)?;
            text(&r.name, "ชื่อหลักทรัพย์", 200)?;
            currency(&r.currency)?;
            let canonical = (
                r.symbol.trim().to_ascii_uppercase(),
                r.exchange.trim().to_ascii_uppercase(),
                r.currency.clone(),
            );
            if !instrument_keys.insert(canonical) {
                return Err(invalid("มีหลักทรัพย์นี้ในทะเบียนแล้ว (สัญลักษณ์ ตลาด และสกุลเงินซ้ำ)"));
            }
            if !matches!(r.kind.as_str(), "stock" | "etf") {
                return Err(invalid("รองรับเฉพาะหุ้นและ ETF"));
            }
            if r.exchange.len() > 100 || r.provider_symbol.len() > 100 {
                return Err(invalid("ชื่อตลาดหรือสัญลักษณ์ผู้ให้ข้อมูลยาวเกินไป"));
            }
            instruments.insert(r.id.clone(), r);
        }
        let mut baselines = BTreeMap::new();
        let mut opening_slots = BTreeSet::new();
        let mut openings = Vec::new();
        for r in &data.opening_positions {
            if !accounts.contains(&r.account_id) {
                return Err(invalid("ยอดตั้งต้นอ้างถึงบัญชีที่ยังไม่มีอยู่"));
            }
            let day = date(&r.date)?;
            currency(&r.currency)?;
            if !opening_slots.insert((
                r.account_id.clone(),
                r.instrument_id.clone(),
                r.currency.clone(),
            )) {
                return Err(invalid(
                    "มีข้อมูลยอดเริ่มต้นซ้ำในบัญชีและสินทรัพย์เดียวกัน กรุณาแก้ไขหรือรวมยอดในรายการเดิม",
                ));
            }
            let quantity = positive(&r.quantity)?;
            let cost = r.cost_basis.as_deref().map(decimal).transpose()?;
            let base = r.cost_basis_base.as_deref().map(decimal).transpose()?;
            if base.is_some() && cost.is_none() {
                return Err(invalid(
                    "ต้องกรอกต้นทุนในสกุลเงินของหลักทรัพย์ก่อนจะกรอกต้นทุนในสกุลรายงาน",
                ));
            }
            if let Some(instrument) = &r.instrument_id {
                let instrument = instruments
                    .get(instrument)
                    .ok_or_else(|| invalid("ยอดตั้งต้นอ้างถึงหลักทรัพย์ที่ยังไม่มีอยู่"))?;
                if instrument.currency != r.currency {
                    return Err(invalid("สกุลเงินของยอดตั้งต้นต้องตรงกับหลักทรัพย์"));
                }
            } else if cost.is_some() || base.is_some() {
                return Err(invalid("ยอดตั้งต้นเงินสดไม่ต้องกรอกต้นทุน"));
            }
            if let Some(previous) = baselines.insert(r.account_id.clone(), day)
                && previous != day
            {
                return Err(invalid("ยอดตั้งต้นทั้งหมดในบัญชีเดียวกันต้องใช้วันเดียวกัน"));
            }
            openings.push(ParsedOpening {
                row: r,
                date: day,
                quantity,
                cost,
                base,
            });
        }
        let mut activities = Vec::new();
        let tolerance = Decimal::new(1, 2);
        for r in &data.activities {
            if !accounts.contains(&r.account_id) {
                return Err(invalid("รายการอ้างถึงบัญชีที่ยังไม่มีอยู่"));
            }
            let day = date(&r.date)?;
            currency(&r.currency)?;
            if r.sequence < 0 || r.note.len() > 4000 {
                return Err(invalid("ลำดับรายการหรือบันทึกช่วยจำไม่ถูกต้อง"));
            }
            if baselines
                .get(&r.account_id)
                .is_some_and(|baseline| day < *baseline)
            {
                return Err(invalid("รายการต้องไม่อยู่ก่อนวันตั้งต้นของบัญชี"));
            }
            if let Some(related) = &r.related_account_id {
                if !accounts.contains(related) || related == &r.account_id {
                    return Err(invalid("บัญชีปลายทางต้องเป็นบัญชีอื่นที่มีอยู่แล้ว"));
                }
                if baselines
                    .get(related)
                    .is_some_and(|baseline| day < *baseline)
                {
                    return Err(invalid("การโอนต้องไม่อยู่ก่อนวันตั้งต้นของบัญชีปลายทาง"));
                }
            }
            let fee = decimal(&r.fee)?;
            let tax = decimal(&r.tax)?;
            let quantity = r.quantity.as_deref().map(positive).transpose()?;
            let unit = r.unit_price.as_deref().map(positive).transpose()?;
            let supplied = r.amount.as_deref().map(positive).transpose()?;
            let counter = r.counter_amount.as_deref().map(positive).transpose()?;
            if let Some(c) = &r.counter_currency {
                currency(c)?;
            }
            if let Some(i) = &r.instrument_id {
                if !instrument_ids.contains(i) {
                    return Err(invalid("รายการอ้างถึงหลักทรัพย์ที่ยังไม่มีอยู่"));
                }
                if instruments[i].currency != r.currency {
                    return Err(invalid("สกุลเงินของรายการต้องตรงกับหลักทรัพย์"));
                }
            }
            let amount = match r.kind.as_str() {
                "buy" | "sell" => {
                    if r.instrument_id.is_none() {
                        return Err(invalid("การซื้อขายต้องเลือกหลักทรัพย์"));
                    }
                    let gross = mul(
                        quantity.ok_or_else(|| invalid("การซื้อขายต้องกรอกจำนวนหุ้น"))?,
                        unit.ok_or_else(|| {
                            invalid("การซื้อขายต้องกรอกราคาต่อหน่วย หรือกรอกยอดเงินเพื่อให้คำนวณราคาให้")
                        })?,
                    )?;
                    let charges = add(fee, tax)?;
                    let expected = if r.kind == "buy" {
                        add(gross, charges)?
                    } else {
                        sub(gross, charges)?
                    };
                    if expected <= Decimal::ZERO {
                        return Err(invalid("ยอดเงินสดสุทธิของการซื้อขายต้องมากกว่าศูนย์"));
                    }
                    if supplied.is_some_and(|value| {
                        sub(value, expected)
                            .map(|difference| difference.abs() > tolerance)
                            .unwrap_or(true)
                    }) {
                        return Err(invalid(
                            "ยอดเงินสุทธิไม่ตรงกับ จำนวน × ราคา บวกลบค่าธรรมเนียมและภาษี",
                        ));
                    }
                    supplied.unwrap_or(expected)
                }
                "split" => {
                    if r.instrument_id.is_none()
                        || quantity.is_none()
                        || supplied.is_some()
                        || unit.is_some()
                        || fee != Decimal::ZERO
                        || tax != Decimal::ZERO
                    {
                        return Err(invalid(
                            "Split requires only an instrument and positive quantity factor",
                        ));
                    }
                    Decimal::ZERO
                }
                "transfer" => {
                    if r.related_account_id.is_none() || r.instrument_id.is_some() {
                        return Err(invalid(
                            "Transfer requires destination account and no instrument",
                        ));
                    }
                    supplied.ok_or_else(|| invalid("การโอนต้องกรอกยอดเงิน"))?
                }
                "fx" => {
                    if r.instrument_id.is_some()
                        || r.counter_currency
                            .as_deref()
                            .is_none_or(|c| c == r.currency)
                        || counter.is_none()
                    {
                        return Err(invalid(
                            "FX requires distinct currencies and both cash amounts",
                        ));
                    }
                    supplied.ok_or_else(|| invalid("การแลกสกุลเงินต้องกรอกยอดเงินต้นทาง"))?
                }
                "deposit" | "withdrawal" | "dividend" | "interest" | "fee" | "tax" => {
                    supplied.ok_or_else(|| invalid("รายการนี้ต้องกรอกยอดเงินสุทธิ"))?
                }
                _ => return Err(invalid(format!("ไม่รองรับประเภทรายการ: {}", r.kind))),
            };
            if r.kind != "fx" && (counter.is_some() || r.counter_currency.is_some()) {
                return Err(invalid("สกุลเงินและยอดที่ได้รับ ใช้เฉพาะรายการแลกสกุลเงิน"));
            }
            if !matches!(r.kind.as_str(), "transfer" | "fx") && r.related_account_id.is_some() {
                return Err(invalid(
                    "Related account is only valid for transfers and FX",
                ));
            }
            activities.push(ParsedActivity {
                row: r,
                date: day,
                quantity,
                amount,
                counter,
            });
        }
        activities.sort_by(|a, b| {
            (a.date, a.row.sequence, &a.row.id).cmp(&(b.date, b.row.sequence, &b.row.id))
        });
        openings.sort_by(|a, b| (a.date, &a.row.id).cmp(&(b.date, &b.row.id)));
        let mut prices = BTreeMap::new();
        for r in &data.prices {
            if !instrument_ids.contains(&r.instrument_id) {
                return Err(invalid("ราคาอ้างถึงหลักทรัพย์ที่ยังไม่มีอยู่"));
            }
            let day = date(&r.date)?;
            let close = positive(&r.close)?;
            text(&r.source, "แหล่งราคา", 100)?;
            timestamp(&r.fetched_at)?;
            if prices
                .insert((r.instrument_id.clone(), day), close)
                .is_some()
            {
                return Err(invalid("มีราคาของหลักทรัพย์และวันที่นี้อยู่แล้ว"));
            }
        }
        let mut fx = BTreeMap::new();
        for r in &data.fx_rates {
            currency(&r.from_currency)?;
            currency(&r.to_currency)?;
            if r.from_currency == r.to_currency {
                return Err(invalid("สกุลเงินต้นทางและปลายทางต้องไม่ซ้ำกัน"));
            }
            let day = date(&r.date)?;
            let rate = positive(&r.rate)?;
            text(&r.source, "FX source", 100)?;
            timestamp(&r.fetched_at)?;
            if fx
                .insert(
                    (r.from_currency.clone(), r.to_currency.clone(), day),
                    FxQuote {
                        rate,
                        manual: r.source.eq_ignore_ascii_case("manual"),
                        fetched_at: chrono::DateTime::parse_from_rfc3339(&r.fetched_at).ok(),
                    },
                )
                .is_some()
            {
                return Err(invalid("มีอัตราแลกเปลี่ยนของคู่สกุลเงินและวันที่นี้อยู่แล้ว"));
            }
        }
        for r in &data.import_mappings {
            text(&r.name, "mapping name", 200)?;
            if !matches!(
                r.mode.as_str(),
                "activities" | "opening_positions" | "activity" | "opening"
            ) || !matches!(
                r.date_format.as_str(),
                "iso"
                    | "dmy"
                    | "buddhist"
                    | "%Y-%m-%d"
                    | "%d/%m/%Y"
                    | "%m/%d/%Y"
                    | "YYYY-MM-DD"
                    | "DD/MM/YYYY"
                    | "MM/DD/YYYY"
            ) {
                return Err(invalid("รูปแบบการนำเข้าหรือรูปแบบวันที่ไม่รองรับ"));
            }
            for (key, value) in &r.columns {
                text(key, "mapping field", 100)?;
                text(value, "mapping column", 200)?;
            }
        }
        let mut splits: BTreeMap<Key, Vec<(NaiveDate, Decimal)>> = BTreeMap::new();
        for a in &activities {
            if a.row.kind == "split" {
                splits
                    .entry((
                        a.row.account_id.clone(),
                        a.row
                            .instrument_id
                            .clone()
                            .ok_or_else(|| invalid("การแตกหุ้นต้องเลือกหลักทรัพย์"))?,
                    ))
                    .or_default()
                    .push((
                        a.date,
                        a.quantity
                            .ok_or_else(|| invalid("การแตกหุ้นต้องกรอกอัตราส่วน"))?,
                    ));
            }
        }
        Ok(Self {
            data,
            untracked_cash,
            activities,
            openings,
            prices,
            fx,
            instruments,
            splits,
        })
    }
    fn rate(&self, from: &str, day: NaiveDate) -> Result<Option<(Decimal, NaiveDate)>> {
        let to = &self.data.preferences.reporting_currency;
        if from == to {
            return Ok(Some((Decimal::ONE, day)));
        }
        let direct = self
            .fx
            .range(
                (from.to_owned(), to.clone(), NaiveDate::MIN)..=(from.to_owned(), to.clone(), day),
            )
            .next_back();
        let inverse = self
            .fx
            .range(
                (to.clone(), from.to_owned(), NaiveDate::MIN)..=(to.clone(), from.to_owned(), day),
            )
            .next_back();
        match (direct, inverse) {
            (Some(((_, _, d), v)), Some(((_, _, i), w))) => {
                let direct_priority = (v.manual, &v.fetched_at);
                let inverse_priority = (w.manual, &w.fetched_at);
                // Date wins first. On a shared date preserve explicit manual
                // overrides, then the most recent fetch. Exact ties prefer the
                // canonical pair direction so reverse conversion is reciprocal.
                let prefer_inverse = i > d
                    || (i == d
                        && (inverse_priority > direct_priority
                            || (inverse_priority == direct_priority && to.as_str() < from)));
                if prefer_inverse {
                    Ok(Some((div(Decimal::ONE, w.rate)?, *i)))
                } else {
                    Ok(Some((v.rate, *d)))
                }
            }
            (Some(((_, _, d), v)), _) => Ok(Some((v.rate, *d))),
            (_, Some(((_, _, d), v))) => Ok(Some((div(Decimal::ONE, v.rate)?, *d))),
            _ => Ok(None),
        }
    }
    fn base(&self, value: Decimal, currency: &str, day: NaiveDate) -> Result<Option<Decimal>> {
        self.rate(currency, day)?
            .map(|(rate, _)| mul(value, rate))
            .transpose()
    }
    fn price(
        &self,
        account: &str,
        instrument: &str,
        day: NaiveDate,
    ) -> Result<Option<(Decimal, NaiveDate)>> {
        let Some(((.., quoted), price)) = self
            .prices
            .range((instrument.to_owned(), NaiveDate::MIN)..=(instrument.to_owned(), day))
            .next_back()
        else {
            return Ok(None);
        };
        let mut price = *price;
        // A carried quote before a recorded split is still on the old share scale.
        if let Some(splits) = self
            .splits
            .get(&(account.to_owned(), instrument.to_owned()))
        {
            for (split_date, factor) in splits {
                if *split_date > *quoted && *split_date <= day {
                    price = div(price, *factor)?;
                }
            }
        }
        Ok(Some((price, *quoted)))
    }
}

#[derive(Clone)]
struct Lot {
    quantity: Decimal,
    cost: Option<Decimal>,
    base: Option<Decimal>,
}
#[derive(Default, Clone)]
struct Ledger {
    cash: BTreeMap<Key, Decimal>,
    lots: BTreeMap<Key, VecDeque<Lot>>,
    realized: BTreeMap<Key, Option<Decimal>>,
}
impl Ledger {
    fn cash_change(&mut self, account: &str, currency: &str, change: Decimal) -> Result<()> {
        let entry = self
            .cash
            .entry((account.to_owned(), currency.to_owned()))
            .or_default();
        *entry = add(*entry, change)?;
        if *entry < Decimal::ZERO {
            return Err(invalid(format!(
                "เงินสด {currency} ในบัญชีไม่พอสำหรับรายการนี้ ให้ปิดการติดตามเงินสดในหน้าบัญชี บันทึกรายการฝากเงินก่อน หรือลดยอดรายการลง"
            )));
        }
        Ok(())
    }
    fn opening(&mut self, p: &Prepared<'_>, opening: &ParsedOpening<'_>) -> Result<()> {
        let r = opening.row;
        if let Some(instrument) = &r.instrument_id {
            let base = match (opening.base, opening.cost) {
                (Some(base), _) => Some(base),
                (_, Some(cost)) if r.currency == p.data.preferences.reporting_currency => {
                    Some(cost)
                }
                _ => None,
            };
            self.lots
                .entry((r.account_id.clone(), instrument.clone()))
                .or_default()
                .push_back(Lot {
                    quantity: opening.quantity,
                    cost: opening.cost,
                    base,
                });
        } else {
            self.cash_change(&r.account_id, &r.currency, opening.quantity)?;
        }
        Ok(())
    }
    fn activity(&mut self, p: &Prepared<'_>, a: &ParsedActivity<'_>) -> Result<()> {
        let r = a.row;
        let key = (
            r.account_id.clone(),
            r.instrument_id.clone().unwrap_or_default(),
        );
        let tracked = !p.untracked_cash.contains(&r.account_id);
        match r.kind.as_str() {
            // Cash records always update cash, even on holdings-only accounts:
            // they are how the user records "how much money I have".
            "deposit" => self.cash_change(&r.account_id, &r.currency, a.amount)?,
            "withdrawal" => self.cash_change(&r.account_id, &r.currency, -a.amount)?,
            // Holdings income/charges move cash only on tracked accounts; on
            // holdings-only accounts the cash never leaves the wallet.
            "dividend" | "interest" => {
                if tracked {
                    self.cash_change(&r.account_id, &r.currency, a.amount)?
                }
            }
            "fee" | "tax" => {
                if tracked {
                    self.cash_change(&r.account_id, &r.currency, -a.amount)?
                }
            }
            "buy" => {
                if tracked {
                    self.cash_change(&r.account_id, &r.currency, -a.amount)?;
                }
                self.lots.entry(key).or_default().push_back(Lot {
                    quantity: a.quantity.ok_or_else(|| invalid("ต้องกรอกจำนวนหุ้น"))?,
                    cost: Some(a.amount),
                    base: p.base(a.amount, &r.currency, a.date)?,
                });
            }
            "sell" => {
                let mut remaining = a.quantity.ok_or_else(|| invalid("ต้องกรอกจำนวนหุ้น"))?;
                let lots = self.lots.entry(key.clone()).or_default();
                let mut removed = Some(Decimal::ZERO);
                while remaining > Decimal::ZERO {
                    let lot = lots
                        .front_mut()
                        .ok_or_else(|| invalid("จำนวนหุ้นไม่พอสำหรับการขายนี้"))?;
                    let take = remaining.min(lot.quantity);
                    let ratio = div(take, lot.quantity)?;
                    let cost = lot.cost.map(|c| mul(c, ratio)).transpose()?;
                    let base = lot.base.map(|c| mul(c, ratio)).transpose()?;
                    removed = combine(removed, cost)?;
                    lot.quantity = sub(lot.quantity, take)?;
                    lot.cost = match (lot.cost, cost) {
                        (Some(total), Some(used)) => Some(sub(total, used)?),
                        _ => None,
                    };
                    lot.base = match (lot.base, base) {
                        (Some(total), Some(used)) => Some(sub(total, used)?),
                        _ => None,
                    };
                    remaining = sub(remaining, take)?;
                    if lot.quantity == Decimal::ZERO {
                        lots.pop_front();
                    }
                }
                let gain = removed.map(|cost| sub(a.amount, cost)).transpose()?;
                let realized = self.realized.entry(key).or_insert(Some(Decimal::ZERO));
                *realized = combine(*realized, gain)?;
                if tracked {
                    self.cash_change(&r.account_id, &r.currency, a.amount)?;
                }
            }
            "split" => {
                let lots = self
                    .lots
                    .get_mut(&key)
                    .ok_or_else(|| invalid("การแตกหุ้นต้องมีหุ้นของหลักทรัพย์นี้ในพอร์ตก่อน"))?;
                if lots.is_empty() {
                    return Err(invalid("การแตกหุ้นต้องมีหุ้นของหลักทรัพย์นี้ในพอร์ตก่อน"));
                }
                for lot in lots {
                    lot.quantity = mul(
                        lot.quantity,
                        a.quantity
                            .ok_or_else(|| invalid("การแตกหุ้นต้องกรอกอัตราส่วน"))?,
                    )?;
                }
            }
            "transfer" => {
                self.cash_change(&r.account_id, &r.currency, -a.amount)?;
                self.cash_change(
                    r.related_account_id
                        .as_deref()
                        .ok_or_else(|| invalid("การโอนต้องเลือกบัญชีปลายทาง"))?,
                    &r.currency,
                    a.amount,
                )?;
            }
            "fx" => {
                self.cash_change(&r.account_id, &r.currency, -a.amount)?;
                self.cash_change(
                    r.related_account_id.as_deref().unwrap_or(&r.account_id),
                    r.counter_currency
                        .as_deref()
                        .ok_or_else(|| invalid("ต้องกรอกสกุลเงินที่ได้รับ"))?,
                    a.counter.ok_or_else(|| invalid("ต้องกรอกยอดเงินที่ได้รับ"))?,
                )?;
            }
            _ => return Err(invalid("ไม่รู้จักประเภทรายการนี้")),
        }
        Ok(())
    }
}

/// Validates the entire history, including future and backdated balance effects.
pub fn validate(data: &WealthData) -> Result<()> {
    let p = Prepared::new(data)?;
    let mut ledger = Ledger::default();
    let mut oi = 0;
    for a in &p.activities {
        while oi < p.openings.len() && p.openings[oi].date <= a.date {
            ledger.opening(&p, &p.openings[oi])?;
            oi += 1;
        }
        ledger.activity(&p, a)?;
    }
    while oi < p.openings.len() {
        ledger.opening(&p, &p.openings[oi])?;
        oi += 1;
    }
    Ok(())
}

struct Valuation {
    total: Option<Decimal>,
    known: Decimal,
    cash: Option<Decimal>,
    accounts: BTreeMap<String, Option<Decimal>>,
}
fn valuation(
    p: &Prepared<'_>,
    ledger: &Ledger,
    selected: &BTreeSet<String>,
    day: NaiveDate,
    mut warnings: Option<&mut BTreeSet<String>>,
) -> Result<Valuation> {
    let mut total = Some(Decimal::ZERO);
    let mut known = Decimal::ZERO;
    let mut cash_total = Some(Decimal::ZERO);
    let mut accounts: BTreeMap<_, _> = selected
        .iter()
        .map(|a| (a.clone(), Some(Decimal::ZERO)))
        .collect();
    for ((account, currency), amount) in &ledger.cash {
        if !selected.contains(account) {
            continue;
        }
        let value = if amount.is_zero() {
            Some(Decimal::ZERO)
        } else {
            p.base(*amount, currency, day)?
        };
        if let Some(v) = value {
            known = add(known, v)?;
        }
        total = combine(total, value)?;
        cash_total = combine(cash_total, value)?;
        accounts.insert(account.clone(), combine(accounts[account], value)?);
        if !amount.is_zero() {
            fx_warning(p, currency, day, &mut warnings)?;
        }
    }
    for ((account, instrument), lots) in &ledger.lots {
        if !selected.contains(account) {
            continue;
        }
        let quantity = lots
            .iter()
            .try_fold(Decimal::ZERO, |sum, l| add(sum, l.quantity))?;
        if quantity.is_zero() {
            continue;
        }
        let quote = p.price(account, instrument, day)?;
        let value = match quote {
            Some((price, _)) => p.base(
                mul(quantity, price)?,
                &p.instruments[instrument].currency,
                day,
            )?,
            None => None,
        };
        if let Some(v) = value {
            known = add(known, v)?;
        }
        total = combine(total, value)?;
        accounts.insert(account.clone(), combine(accounts[account], value)?);
        if let Some(warnings) = warnings.as_deref_mut() {
            match quote {
                None => {
                    warnings.insert(format!("ไม่มีราคาของ {}", p.instruments[instrument].symbol));
                }
                Some((_, quoted)) if (day - quoted).num_days() > 7 => {
                    warnings.insert(format!(
                        "ราคาของ {} เก่ากว่า 7 วัน ({quoted})",
                        p.instruments[instrument].symbol
                    ));
                }
                _ => {}
            }
        }
        fx_warning(p, &p.instruments[instrument].currency, day, &mut warnings)?;
    }
    Ok(Valuation {
        total,
        known,
        cash: cash_total,
        accounts,
    })
}
fn fx_warning(
    p: &Prepared<'_>,
    currency: &str,
    day: NaiveDate,
    warnings: &mut Option<&mut BTreeSet<String>>,
) -> Result<()> {
    if let Some(warnings) = warnings.as_deref_mut() {
        match p.rate(currency, day)? {
            None => {
                warnings.insert(format!(
                    "ไม่มีอัตราแลกเปลี่ยน {currency}/{}",
                    p.data.preferences.reporting_currency
                ));
            }
            Some((_, quoted)) if (day - quoted).num_days() > 7 => {
                warnings.insert(format!(
                    "อัตราแลกเปลี่ยน {currency}/{} เก่ากว่า 7 วัน ({quoted})",
                    p.data.preferences.reporting_currency
                ));
            }
            _ => {}
        }
    }
    Ok(())
}
#[derive(Default)]
struct Flows {
    incoming: Option<Decimal>,
    outgoing: Option<Decimal>,
}
impl Flows {
    fn zero() -> Self {
        Self {
            incoming: Some(Decimal::ZERO),
            outgoing: Some(Decimal::ZERO),
        }
    }
    fn incoming(&mut self, value: Option<Decimal>) -> Result<()> {
        self.incoming = combine(self.incoming, value)?;
        Ok(())
    }
    fn outgoing(&mut self, value: Option<Decimal>) -> Result<()> {
        self.outgoing = combine(self.outgoing, value)?;
        Ok(())
    }
    fn net(&self) -> Result<Option<Decimal>> {
        match (self.incoming, self.outgoing) {
            (Some(a), Some(b)) => Ok(Some(sub(a, b)?)),
            _ => Ok(None),
        }
    }
}
fn opening_flow(p: &Prepared<'_>, opening: &ParsedOpening<'_>) -> Result<Option<Decimal>> {
    let r = opening.row;
    if let Some(instrument) = &r.instrument_id {
        match p.price(&r.account_id, instrument, opening.date)? {
            Some((price, _)) => {
                // An opening is recorded before the day's activities, while a
                // close is expressed in the share units after that day's splits.
                let mut closing_quantity = opening.quantity;
                if let Some(splits) = p.splits.get(&(r.account_id.clone(), instrument.clone())) {
                    for (day, factor) in splits {
                        if *day == opening.date {
                            closing_quantity = mul(closing_quantity, *factor)?;
                        }
                    }
                }
                p.base(mul(closing_quantity, price)?, &r.currency, opening.date)
            }
            None => Ok(None),
        }
    } else {
        p.base(opening.quantity, &r.currency, opening.date)
    }
}
fn activity_flow(
    p: &Prepared<'_>,
    a: &ParsedActivity<'_>,
    selected: &BTreeSet<String>,
    flows: &mut Flows,
) -> Result<()> {
    let r = a.row;
    let source = selected.contains(&r.account_id);
    let destination = r
        .related_account_id
        .as_ref()
        .is_some_and(|a| selected.contains(a));
    let tracked = !p.untracked_cash.contains(&r.account_id);
    if !tracked && source {
        match r.kind.as_str() {
            // Money for the purchase came from outside the valued portfolio.
            "buy" => {
                flows.incoming(p.base(a.amount, &r.currency, a.date)?)?;
                return Ok(());
            }
            // Holdings value left, or income was withdrawn: still return.
            "sell" | "dividend" | "interest" | "fee" | "tax" => {
                flows.outgoing(p.base(a.amount, &r.currency, a.date)?)?;
                return Ok(());
            }
            // Cash records fall through to the shared cash-flow mapping.
            _ => {}
        }
    }
    match r.kind.as_str() {
        "deposit" if source => flows.incoming(p.base(a.amount, &r.currency, a.date)?)?,
        "withdrawal" if source => flows.outgoing(p.base(a.amount, &r.currency, a.date)?)?,
        "transfer" if source && !destination => {
            flows.outgoing(p.base(a.amount, &r.currency, a.date)?)?
        }
        "transfer" if !source && destination => {
            flows.incoming(p.base(a.amount, &r.currency, a.date)?)?
        }
        "fx" if r.related_account_id.is_some() && source && !destination => {
            flows.outgoing(p.base(a.amount, &r.currency, a.date)?)?
        }
        "fx" if r.related_account_id.is_some() && !source && destination => flows.incoming(
            p.base(
                a.counter.ok_or_else(|| invalid("ต้องกรอกยอดเงินที่ได้รับ"))?,
                r.counter_currency
                    .as_deref()
                    .ok_or_else(|| invalid("ต้องกรอกสกุลเงินที่ได้รับ"))?,
                a.date,
            )?,
        )?,
        _ => {}
    }
    Ok(())
}

/// Values the selected portfolio daily. Returns and allocations are fractions, not percentages.
/// Realized/unrealized holding gains are in the instrument's native currency.
pub fn portfolio(data: &WealthData, filter: &PortfolioFilter) -> Result<Portfolio> {
    validate(data)?;
    let p = Prepared::new(data)?;
    let end = date(&filter.end_date)?;
    let account_ids: BTreeSet<_> = data.accounts.iter().map(|a| a.id.clone()).collect();
    let selected = if filter.account_ids.is_empty() {
        account_ids.clone()
    } else {
        let chosen: BTreeSet<_> = filter.account_ids.iter().cloned().collect();
        if chosen.len() != filter.account_ids.len() || !chosen.is_subset(&account_ids) {
            return Err(invalid("ตัวกรองบัญชีไม่ถูกต้องหรือซ้ำกัน"));
        }
        chosen
    };
    let earliest = p
        .openings
        .iter()
        .filter(|o| selected.contains(&o.row.account_id))
        .map(|o| o.date)
        .chain(
            p.activities
                .iter()
                .filter(|a| {
                    selected.contains(&a.row.account_id)
                        || a.row
                            .related_account_id
                            .as_ref()
                            .is_some_and(|id| selected.contains(id))
                })
                .map(|a| a.date),
        )
        .min();
    let requested = filter.start_date.as_deref().map(date).transpose()?;
    if requested.is_some_and(|start| start > end) {
        return Err(invalid("วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด"));
    }
    let start = match (requested, earliest) {
        (Some(s), Some(e)) => s.max(e),
        (_, Some(e)) => e,
        (Some(s), _) => s,
        _ => end,
    };
    let mut ledger = Ledger::default();
    let mut oi = 0;
    let mut ai = 0;
    // Replay every account: selected-account transfers depend on the full ledger.
    while oi < p.openings.len() || ai < p.activities.len() {
        let next_open = p.openings.get(oi).filter(|o| o.date < start);
        let next_activity = p.activities.get(ai).filter(|a| a.date < start);
        match (next_open, next_activity) {
            (Some(o), Some(a)) if o.date <= a.date => {
                ledger.opening(&p, o)?;
                oi += 1;
            }
            (_, Some(a)) => {
                ledger.activity(&p, a)?;
                ai += 1;
            }
            (Some(o), _) => {
                ledger.opening(&p, o)?;
                oi += 1;
            }
            _ => break,
        }
    }
    let previous_day = start
        .checked_sub_signed(Duration::days(1))
        .ok_or(WealthError::Overflow)?;
    let initial = valuation(&p, &ledger, &selected, previous_day, None)?.total;
    let mut previous = initial;
    let mut growth = Some(Decimal::ONE);
    let mut net_flows = Some(Decimal::ZERO);
    let mut series = Vec::new();
    let mut day = start;
    while day <= end {
        let mut flows = Flows::zero();
        while oi < p.openings.len() && p.openings[oi].date == day {
            let opening = &p.openings[oi];
            if selected.contains(&opening.row.account_id) {
                flows.incoming(opening_flow(&p, opening)?)?;
            }
            ledger.opening(&p, opening)?;
            oi += 1;
        }
        while ai < p.activities.len() && p.activities[ai].date == day {
            let a = &p.activities[ai];
            activity_flow(&p, a, &selected, &mut flows)?;
            ledger.activity(&p, a)?;
            ai += 1;
        }
        let value = valuation(&p, &ledger, &selected, day, None)?.total;
        let net = flows.net()?;
        net_flows = combine(net_flows, net)?;
        growth = match (growth, previous, value, flows.incoming, flows.outgoing) {
            (Some(g), Some(before), Some(after), Some(incoming), Some(outgoing)) => {
                let denominator = add(before, incoming)?;
                let numerator = add(after, outgoing)?;
                if denominator > Decimal::ZERO {
                    Some(mul(g, div(numerator, denominator)?)?)
                } else if numerator == Decimal::ZERO {
                    Some(g)
                } else {
                    None
                }
            }
            _ => None,
        };
        series.push(ValuationPoint {
            date: day.to_string(),
            value: optional(value),
            twr: optional(growth.map(|g| sub(g, Decimal::ONE)).transpose()?),
            net_flow: optional(net),
        });
        previous = value;
        day = day
            .checked_add_signed(Duration::days(1))
            .ok_or(WealthError::Overflow)?;
    }
    // No history at/before end: do not include future openings in current balances.
    let mut warnings = BTreeSet::new();
    let valuation = valuation(&p, &ledger, &selected, end, Some(&mut warnings))?;
    let mut holdings = Vec::new();
    let keys: BTreeSet<_> = ledger
        .lots
        .keys()
        .chain(ledger.realized.keys())
        .cloned()
        .collect();
    for key in keys {
        let (account, instrument) = &key;
        if !selected.contains(account) {
            continue;
        }
        let mut quantity = Decimal::ZERO;
        let mut cost = Some(Decimal::ZERO);
        let mut base = Some(Decimal::ZERO);
        if let Some(lots) = ledger.lots.get(&key) {
            for lot in lots {
                quantity = add(quantity, lot.quantity)?;
                cost = combine(cost, lot.cost)?;
                base = combine(base, lot.base)?;
            }
        }
        let quote = p.price(account, instrument, end)?;
        let market = if quantity.is_zero() {
            Some(Decimal::ZERO)
        } else {
            quote.map(|(price, _)| mul(quantity, price)).transpose()?
        };
        let market_base = match market {
            Some(m) => {
                if m.is_zero() {
                    Some(Decimal::ZERO)
                } else {
                    p.base(m, &p.instruments[instrument].currency, end)?
                }
            }
            _ => None,
        };
        let unrealized = match (market, cost) {
            (Some(m), Some(c)) => Some(sub(m, c)?),
            _ => None,
        };
        let allocation = match (market_base, valuation.total) {
            (Some(m), Some(total)) if total > Decimal::ZERO => Some(div(m, total)?),
            _ => None,
        };
        if cost.is_none() && quantity > Decimal::ZERO {
            warnings.insert(format!(
                "ไม่ทราบต้นทุนของ {} ({account})",
                p.instruments[instrument].symbol
            ));
        }
        if base.is_none() && cost.is_some() && quantity > Decimal::ZERO {
            warnings.insert(format!(
                "ไม่ทราบต้นทุนในสกุลเงินรายงานของ {} ({account})",
                p.instruments[instrument].symbol
            ));
        }
        holdings.push(Holding {
            account_id: account.clone(),
            instrument_id: instrument.clone(),
            quantity: out(quantity),
            cost_basis: optional(cost),
            cost_basis_base: optional(base),
            market_price: quote.map(|(price, _)| out(price)),
            market_value: optional(market),
            market_value_base: optional(market_base),
            unrealized_gain: optional(unrealized),
            realized_gain: optional(
                ledger
                    .realized
                    .get(&key)
                    .copied()
                    .unwrap_or(Some(Decimal::ZERO)),
            ),
            allocation: optional(allocation),
        });
    }
    let mut cash = Vec::new();
    for ((account, currency), amount) in &ledger.cash {
        if selected.contains(account) {
            cash.push(CashBalance {
                account_id: account.clone(),
                currency: currency.clone(),
                amount: out(*amount),
                value_base: optional(if amount.is_zero() {
                    Some(Decimal::ZERO)
                } else {
                    p.base(*amount, currency, end)?
                }),
            });
        }
    }
    let gain = match (valuation.total, initial, net_flows) {
        (Some(end), Some(begin), Some(flows)) => Some(sub(sub(end, begin)?, flows)?),
        _ => None,
    };
    let twr = growth.map(|g| sub(g, Decimal::ONE)).transpose()?;
    if series
        .iter()
        .any(|point| point.value.is_none() || point.net_flow.is_none())
    {
        warnings.insert("ผลตอบแทนไม่ครบถ้วน เนื่องจากขาดราคาหรืออัตราแลกเปลี่ยนในอดีต".into());
    }
    let quality = if valuation.total.is_none() || twr.is_none() {
        "incomplete"
    } else if !warnings.is_empty() {
        "partial"
    } else {
        "complete"
    };
    Ok(Portfolio {
        reporting_currency: data.preferences.reporting_currency.clone(),
        as_of: end.to_string(),
        start_date: if start <= end && earliest.is_some() {
            Some(start.to_string())
        } else {
            None
        },
        earliest_date: earliest.map(|d| d.to_string()),
        total_value: optional(valuation.total),
        known_value: out(valuation.known),
        cash_value: optional(valuation.cash),
        period_gain: optional(gain),
        twr: optional(twr),
        holdings,
        cash,
        accounts: valuation
            .accounts
            .into_iter()
            .map(|(id, value)| AccountSummary {
                id,
                value: optional(value),
            })
            .collect(),
        series,
        warnings: warnings.into_iter().collect(),
        quality: quality.into(),
    })
}
