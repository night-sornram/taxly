use crate::error::{AppError, AppResult};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use taxly_core::TaxRuleSet;

#[derive(Deserialize)]
struct Manifest {
    schema_version: u32,
    rule_sets: Vec<ManifestEntry>,
}
#[derive(Deserialize)]
struct ManifestEntry {
    year: u16,
    id: String,
    sha256: String,
}

pub struct Catalog {
    pub rules: BTreeMap<u16, TaxRuleSet>,
    pub payloads: BTreeMap<u16, &'static str>,
    pub hashes: BTreeMap<String, String>,
}

pub fn hash(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl Catalog {
    pub fn bundled() -> AppResult<Self> {
        let manifest: Manifest =
            serde_json::from_str(include_str!("../../../../rules/manifest.json"))?;
        if manifest.schema_version != 1 {
            return Err(AppError::invalid("รุ่น manifest ไม่รองรับ"));
        }
        let mut catalog = Self {
            rules: BTreeMap::new(),
            payloads: BTreeMap::new(),
            hashes: BTreeMap::new(),
        };
        for (year, payload) in [
            (2025, include_str!("../../../../rules/2025/salary-v1.json")),
            (2026, include_str!("../../../../rules/2026/salary-v1.json")),
        ] {
            let rule = TaxRuleSet::from_json(payload)?;
            let entry = manifest
                .rule_sets
                .iter()
                .find(|entry| entry.year == year && entry.id == rule.rule_set_id)
                .ok_or_else(|| AppError::invalid("ไม่มีชุดกฎใน manifest"))?;
            if hash(payload) != entry.sha256 || rule.tax_year != year {
                return Err(AppError::invalid("ชุดกฎไม่ตรงกับ manifest"));
            }
            catalog
                .hashes
                .insert(rule.rule_set_id.clone(), entry.sha256.clone());
            catalog.rules.insert(year, rule);
            catalog.payloads.insert(year, payload);
        }
        Ok(catalog)
    }

    pub fn get(&self, year: u16) -> AppResult<&TaxRuleSet> {
        self.rules.get(&year).ok_or(AppError {
            code: "MissingRules",
            message: "ยังไม่มีชุดกฎของปีภาษีนี้ แอปจะไม่ใช้กฎปีอื่นแทน".into(),
        })
    }
}
