//! Tax rows that travel with the ledger snapshot. Incomes owned by a ledger
//! entry are left out: every device rebuilds those from the entry's tax link.
use crate::{
    error::{AppError, AppResult},
    models::basis_text,
    storage,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};
use taxly_core::{AmountBasis, Money, TaxpayerFacts};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaxYearRow {
    pub id: String,
    pub year: u16,
    pub facts: TaxpayerFacts,
    pub income_complete: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaxIncomeRow {
    pub id: String,
    pub year: u16,
    pub source_label: String,
    pub month: u8,
    pub kind: String,
    pub basis: AmountBasis,
    pub gross: Money,
    pub withholding: Option<Money>,
    pub note: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaxDeductionRow {
    pub id: String,
    pub year: u16,
    pub month: u8,
    pub basis: AmountBasis,
    pub amount: Money,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TaxSnapshot {
    pub years: Vec<TaxYearRow>,
    pub incomes: Vec<TaxIncomeRow>,
    pub deductions: Vec<TaxDeductionRow>,
}
impl TaxSnapshot {
    /// Row order carries no meaning; sort so snapshots compare by content.
    pub fn sorted(mut self) -> Self {
        self.years.sort_by(|a, b| a.id.cmp(&b.id));
        self.incomes.sort_by(|a, b| a.id.cmp(&b.id));
        self.deductions.sort_by(|a, b| a.id.cmp(&b.id));
        self
    }
}

fn basis(value: &str) -> AppResult<AmountBasis> {
    match value {
        "actual" => Ok(AmountBasis::Actual),
        "forecast" => Ok(AmountBasis::Forecast),
        _ => Err(AppError::invalid("สถานะรายการไม่ถูกต้อง")),
    }
}

pub async fn load(tx: &mut Transaction<'_, Sqlite>) -> AppResult<TaxSnapshot> {
    let mut tax = TaxSnapshot::default();
    for row in sqlx::query("SELECT year,eligibility_json,completion_state FROM tax_years")
        .fetch_all(&mut **tx)
        .await?
    {
        let year = row.try_get::<i64, _>("year")? as u16;
        tax.years.push(TaxYearRow {
            id: year.to_string(),
            year,
            facts: serde_json::from_str(row.try_get("eligibility_json")?)?,
            income_complete: row.try_get::<String, _>("completion_state")? == "complete",
        });
    }
    for row in sqlx::query("SELECT i.*,s.label FROM income_entries i JOIN income_sources s ON s.id=i.source_id WHERE i.id NOT IN (SELECT tax_income_id FROM ledger_entries WHERE tax_income_id IS NOT NULL)")
        .fetch_all(&mut **tx)
        .await?
    {
        tax.incomes.push(TaxIncomeRow {
            id: row.try_get("id")?,
            year: row.try_get::<i64, _>("tax_year")? as u16,
            source_label: row.try_get("label")?,
            month: row.try_get::<i64, _>("month")? as u8,
            kind: row.try_get("kind")?,
            basis: basis(row.try_get("basis")?)?,
            gross: Money::from_satang(row.try_get("gross_satang")?)?,
            withholding: row
                .try_get::<Option<i64>, _>("withholding_satang")?
                .map(Money::from_satang)
                .transpose()?,
            note: row.try_get("note")?,
        });
    }
    for row in sqlx::query("SELECT * FROM deduction_entries WHERE rule_code='sso_33'")
        .fetch_all(&mut **tx)
        .await?
    {
        tax.deductions.push(TaxDeductionRow {
            id: row.try_get("id")?,
            year: row.try_get::<i64, _>("tax_year")? as u16,
            month: row.try_get::<i64, _>("month")? as u8,
            basis: basis(row.try_get("basis")?)?,
            amount: Money::from_satang(row.try_get("amount_satang")?)?,
        });
    }
    Ok(tax.sorted())
}

pub fn validate(tax: &TaxSnapshot) -> AppResult<()> {
    let bad = || AppError::invalid("ข้อมูลภาษีที่ซิงก์ไม่ถูกต้อง");
    let id_ok =
        |id: &str| !id.trim().is_empty() && id.len() <= 128 && !id.chars().any(char::is_control);
    let money_ok = |m: Money| m.satang().is_ok_and(|n| n >= 0);
    let month_ok = |m: u8| (1..=12).contains(&m);
    if tax.years.len() > 20 || tax.incomes.len() > 50_000 || tax.deductions.len() > 1_000 {
        return Err(bad());
    }
    let mut years = HashSet::new();
    for y in &tax.years {
        if !(2025..=2026).contains(&y.year) || y.id != y.year.to_string() || !years.insert(y.year) {
            return Err(bad());
        }
    }
    let mut ids = HashSet::new();
    let mut salaries = HashSet::new();
    for i in &tax.incomes {
        let label = i.source_label.trim();
        if !id_ok(&i.id)
            || !ids.insert(i.id.as_str())
            || !years.contains(&i.year)
            || label.is_empty()
            || label.chars().count() > 100
            || !month_ok(i.month)
            || !["salary", "bonus", "other"].contains(&i.kind.as_str())
            || !money_ok(i.gross)
            || i.withholding.is_some_and(|w| !money_ok(w))
            || i.note.chars().count() > 500
            || (i.kind == "salary" && !salaries.insert((i.year, label, i.month)))
        {
            return Err(bad());
        }
    }
    let mut ids = HashSet::new();
    let mut months = HashSet::new();
    for d in &tax.deductions {
        if !id_ok(&d.id)
            || !ids.insert(d.id.as_str())
            || !years.contains(&d.year)
            || !month_ok(d.month)
            || !money_ok(d.amount)
            || !months.insert((d.year, d.month))
        {
            return Err(bad());
        }
    }
    Ok(())
}

/// Writes the merged tax rows with plain SQL: unlike interactive deletes, a
/// synced change must not reset the year's completeness confirmation.
pub async fn apply(
    tx: &mut Transaction<'_, Sqlite>,
    old: &TaxSnapshot,
    next: &TaxSnapshot,
) -> AppResult<()> {
    if old == next {
        return Ok(());
    }
    let mut touched = HashSet::new();
    let old_years: HashMap<_, _> = old.years.iter().map(|y| (y.year, y)).collect();
    for y in &next.years {
        if old_years.get(&y.year) != Some(&y) {
            sqlx::query("INSERT INTO tax_years(year,eligibility_json,completion_state) VALUES (?,?,?) ON CONFLICT(year) DO UPDATE SET eligibility_json=excluded.eligibility_json,completion_state=excluded.completion_state")
                .bind(i64::from(y.year))
                .bind(serde_json::to_string(&y.facts)?)
                .bind(if y.income_complete { "complete" } else { "incomplete" })
                .execute(&mut **tx)
                .await?;
            touched.insert(y.year);
        }
    }
    let next_incomes: HashSet<_> = next.incomes.iter().map(|i| i.id.as_str()).collect();
    for i in old
        .incomes
        .iter()
        .filter(|i| !next_incomes.contains(i.id.as_str()))
    {
        sqlx::query("DELETE FROM income_entries WHERE id=?")
            .bind(&i.id)
            .execute(&mut **tx)
            .await?;
        touched.insert(i.year);
    }
    let next_deductions: HashSet<_> = next.deductions.iter().map(|d| d.id.as_str()).collect();
    for d in old
        .deductions
        .iter()
        .filter(|d| !next_deductions.contains(d.id.as_str()))
    {
        sqlx::query("DELETE FROM deduction_entries WHERE id=?")
            .bind(&d.id)
            .execute(&mut **tx)
            .await?;
        touched.insert(d.year);
    }
    let old_incomes: HashMap<_, _> = old.incomes.iter().map(|i| (i.id.as_str(), i)).collect();
    for i in &next.incomes {
        if old_incomes.get(i.id.as_str()) == Some(&i) {
            continue;
        }
        let source = storage::source(tx, i.year, &i.source_label).await?;
        // A salary this device already records through a ledger entry wins
        // locally; leaving the copy out removes it from the cloud next upload.
        if i.kind == "salary" {
            let linked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM income_entries e JOIN ledger_entries l ON l.tax_income_id=e.id WHERE e.source_id=? AND e.month=? AND e.kind='salary' AND e.id<>?)")
                .bind(&source)
                .bind(i64::from(i.month))
                .bind(&i.id)
                .fetch_one(&mut **tx)
                .await?;
            if linked {
                continue;
            }
        }
        sqlx::query("INSERT INTO income_entries(id,tax_year,source_id,month,kind,basis,gross_satang,withholding_satang,note) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tax_year=excluded.tax_year,source_id=excluded.source_id,month=excluded.month,kind=excluded.kind,basis=excluded.basis,gross_satang=excluded.gross_satang,withholding_satang=excluded.withholding_satang,note=excluded.note")
            .bind(&i.id)
            .bind(i64::from(i.year))
            .bind(&source)
            .bind(i64::from(i.month))
            .bind(&i.kind)
            .bind(basis_text(i.basis))
            .bind(i.gross.satang()?)
            .bind(i.withholding.map(Money::satang).transpose()?)
            .bind(i.note.trim())
            .execute(&mut **tx)
            .await?;
        touched.insert(i.year);
        if let Some(old) = old_incomes.get(i.id.as_str()) {
            touched.insert(old.year);
        }
    }
    let old_deductions: HashMap<_, _> = old.deductions.iter().map(|d| (d.id.as_str(), d)).collect();
    for d in &next.deductions {
        if old_deductions.get(d.id.as_str()) == Some(&d) {
            continue;
        }
        sqlx::query("INSERT INTO deduction_entries(id,tax_year,month,rule_code,basis,amount_satang) VALUES (?,?,?,'sso_33',?,?) ON CONFLICT(id) DO UPDATE SET tax_year=excluded.tax_year,month=excluded.month,basis=excluded.basis,amount_satang=excluded.amount_satang")
            .bind(&d.id)
            .bind(i64::from(d.year))
            .bind(i64::from(d.month))
            .bind(basis_text(d.basis))
            .bind(d.amount.satang()?)
            .execute(&mut **tx)
            .await?;
        touched.insert(d.year);
        if let Some(old) = old_deductions.get(d.id.as_str()) {
            touched.insert(old.year);
        }
    }
    // A new revision marks saved summaries of these years as outdated.
    for year in touched {
        sqlx::query("UPDATE tax_years SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE year=?")
            .bind(i64::from(year))
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
