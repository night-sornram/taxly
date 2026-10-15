//! Deterministic, offline Thai salary tax calculations. No platform or storage dependencies.
mod calculation;
mod model;
mod money;
mod rules;

pub use calculation::calculate;
pub use model::*;
pub use money::Money;
pub use rules::*;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TaxError {
    #[error("จำนวนเงินต้องเป็นเลขไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง")]
    InvalidAmount,
    #[error("จำนวนเงินเกินช่วงที่รองรับ")]
    AmountOverflow,
    #[error("ยังไม่รองรับเงินได้ประเภทนี้")]
    UnsupportedCategory,
    #[error("ชุดกฎไม่ตรงกับปีภาษี")]
    YearMismatch,
    #[error("ชุดกฎภาษีไม่สมบูรณ์")]
    InvalidRules,
    #[error("ข้อมูลไม่ถูกต้อง: {0}")]
    InvalidInput(&'static str),
}
