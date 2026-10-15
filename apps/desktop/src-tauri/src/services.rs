use crate::{
    catalog::{Catalog, hash},
    error::{AppError, AppResult},
    models::*,
    storage,
};
use sqlx::SqlitePool;
use taxly_core::*;
use uuid::Uuid;

pub fn annual_input(workspace: &YearWorkspace) -> AppResult<AnnualTaxInput> {
    let profile = workspace
        .profile
        .as_ref()
        .ok_or_else(|| AppError::invalid("กรุณาเริ่มต้นปีภาษีก่อน"))?;
    Ok(AnnualTaxInput {
        year: workspace.year,
        facts: profile.facts.clone(),
        income_complete: profile.income_complete,
        income: workspace
            .income
            .iter()
            .map(|entry| IncomeItem {
                category: IncomeCategory::Section40_1,
                amount: entry.gross,
                withholding: entry.withholding,
                basis: entry.basis,
            })
            .collect(),
        social_security: workspace
            .deductions
            .iter()
            .map(|entry| Contribution {
                month: entry.month,
                amount: entry.amount,
                basis: entry.basis,
            })
            .collect(),
    })
}

pub async fn calculate_year(
    pool: &SqlitePool,
    catalog: &Catalog,
    year: u16,
) -> AppResult<TaxCalculation> {
    let workspace = storage::workspace(pool, year).await?;
    Ok(calculate(&annual_input(&workspace)?, catalog.get(year)?)?)
}

pub async fn save_snapshot(pool: &SqlitePool, catalog: &Catalog, year: u16) -> AppResult<()> {
    let workspace = storage::workspace(pool, year).await?;
    let profile = workspace
        .profile
        .as_ref()
        .ok_or_else(|| AppError::invalid("ยังไม่มีข้อมูลปีนี้"))?;
    let input = annual_input(&workspace)?;
    let rules = catalog.get(year)?;
    let result = calculate(&input, rules)?;
    let input_json = serde_json::to_string(&input)?;
    let mut tx = pool.begin().await?;
    // Refuse a result if a simultaneous edit changed the data after reading it.
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM tax_years WHERE year=?")
        .bind(i64::from(year))
        .fetch_one(&mut *tx)
        .await?;
    if revision != profile.revision {
        return Err(AppError::invalid("ข้อมูลเพิ่งเปลี่ยน กรุณาคำนวณใหม่ก่อนบันทึกผล"));
    }
    sqlx::query("INSERT INTO calculation_snapshots(id,tax_year,rule_set_id,engine_version,input_json,result_json,input_hash,data_revision) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tax_year,data_revision,rule_set_id,engine_version) DO NOTHING")
        .bind(Uuid::new_v4().to_string()).bind(i64::from(year)).bind(&rules.rule_set_id).bind(env!("CARGO_PKG_VERSION")).bind(&input_json).bind(serde_json::to_string(&result)?).bind(hash(&input_json)).bind(profile.revision).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn guidance(pool: &SqlitePool, catalog: &Catalog, year: u16) -> AppResult<Vec<Guidance>> {
    let rules = catalog.get(year)?;
    let workspace = storage::workspace(pool, year).await?;
    let savings = if workspace.profile.is_some() {
        Some(calculate(&annual_input(&workspace)?, rules)?.social_security_savings)
    } else {
        None
    };
    let mut cards = vec![
        Guidance {
            code: "personal".into(),
            title: "สิทธิ์ส่วนตัวของคุณ".into(),
            status: "included".into(),
            explanation: "แอปรวมสิทธิ์ส่วนตัวไว้ให้ครั้งเดียวต่อปีแล้ว ไม่ต้องซื้อหรือจ่ายอะไรเพิ่ม".into(),
            conditions: "สำหรับขอบเขตผู้โสดที่แอปรองรับ ไม่ใช้แทนสิทธิ์ยกเว้นพิเศษ".into(),
            documents: vec!["ไม่ต้องแนบเอกสารในแอป".into()],
            limit: Some(rules.personal_allowance),
            savings: None,
            source_ids: vec!["rd_code".into()],
        },
        Guidance {
            code: "sso_33".into(),
            title: "ประกันสังคมที่จ่ายไปแล้ว".into(),
            status: if workspace
                .profile
                .as_ref()
                .is_some_and(|p| p.facts.social_security_confirmed)
            {
                "supported"
            } else {
                "check"
            }
            .into(),
            explanation: "ใช้ยอดเงินสมทบฝ่ายลูกจ้างที่เข้าเงื่อนไขตามที่จ่ายจริง ไม่ใช่ยอดสมทบของนายจ้าง".into(),
            conditions: "ตรวจจำนวนเดือน อัตราที่ลดลงเฉพาะกรณี ยอดส่งเกิน และเงินสมทบที่ได้รับคืนก่อนยืนยัน".into(),
            documents: vec![
                "สลิปเงินเดือน".into(),
                "หนังสือรับรอง 50 ทวิหรือหลักฐานเงินสมทบ".into(),
            ],
            limit: Some(rules.social_security_annual_cap),
            savings,
            source_ids: vec!["rd91".into(), "sso".into()],
        },
    ];
    for (code, title, explanation, documents) in [
        (
            "insurance",
            "ประกันชีวิตและสุขภาพ",
            "อาจมีสิทธิ์ตามประเภทกรมธรรม์ เงื่อนไข และวงเงินร่วมของปีนั้น",
            vec!["หนังสือรับรองเบี้ยประกันเพื่อใช้สิทธิ์ภาษี"],
        ),
        (
            "family",
            "ดูแลคนในครอบครัว",
            "สิทธิ์เกี่ยวกับบุตร คู่สมรส บิดามารดา และผู้พิการมีเงื่อนไขเฉพาะ",
            vec!["เอกสารยืนยันความสัมพันธ์และสิทธิ์ตามกรณี"],
        ),
        (
            "retirement",
            "กองทุนและการออมเพื่อเกษียณ",
            "ต้องตรวจประเภทกองทุน ระยะเวลาถือครอง และเพดานร่วม ไม่ควรลงทุนเพียงเพื่อภาษี",
            vec!["หนังสือรับรองเงินสะสมหรือการลงทุน"],
        ),
        (
            "home",
            "ดอกเบี้ยบ้าน",
            "ต้องตรวจผู้กู้ ประเภทเงินกู้ และการแบ่งสิทธิ์ผู้กู้ร่วม",
            vec!["หนังสือรับรองดอกเบี้ยจากผู้ให้กู้"],
        ),
        (
            "donation",
            "เงินบริจาค",
            "สิทธิ์ขึ้นกับผู้รับบริจาค หลักฐาน และลำดับการหักในปีนั้น",
            vec!["หลักฐานบริจาคหรือข้อมูล e-Donation"],
        ),
    ] {
        cards.push(Guidance {
            code: code.into(),
            title: title.into(),
            status: "not_included".into(),
            explanation: explanation.into(),
            conditions: "รุ่นนี้ยังไม่รวมสิทธิ์นี้ในผลคำนวณ กรุณาตรวจหลักเกณฑ์ของปีภาษีจากกรมสรรพากร".into(),
            documents: documents.into_iter().map(str::to_owned).collect(),
            limit: None,
            savings: None,
            source_ids: vec!["rd_year".into()],
        });
    }
    Ok(cards)
}
