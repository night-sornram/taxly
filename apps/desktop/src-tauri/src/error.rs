use serde::Serialize;
use taxly_core::TaxError;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidInput",
            message: message.into(),
        }
    }
    pub fn backup(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidBackup",
            message: message.into(),
        }
    }
    pub fn cancelled() -> Self {
        Self {
            code: "Cancelled",
            message: "ยกเลิกแล้ว ข้อมูลเดิมยังอยู่ครบ".into(),
        }
    }
}

impl From<TaxError> for AppError {
    fn from(err: TaxError) -> Self {
        Self {
            code: match err {
                TaxError::InvalidAmount | TaxError::AmountOverflow => "InvalidAmount",
                TaxError::UnsupportedCategory => "UnsupportedCase",
                TaxError::YearMismatch | TaxError::InvalidRules => "MissingRules",
                _ => "InvalidInput",
            },
            message: err.to_string(),
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        if err
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            Self {
                code: "Conflict",
                message: "มีรายการของเดือนนี้แล้ว กรุณาแก้ไขรายการเดิมเพื่อไม่ให้นับซ้ำ".into(),
            }
        } else {
            Self {
                code: "StorageError",
                message: "บันทึกข้อมูลไม่สำเร็จ โปรดลองอีกครั้ง ข้อมูลที่ยังไม่บันทึกจะยังอยู่บนหน้าจอ".into(),
            }
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(_: std::io::Error) -> Self {
        Self {
            code: "FileError",
            message: "อ่านหรือเขียนไฟล์ไม่สำเร็จ กรุณาตรวจสิทธิ์และพื้นที่จัดเก็บ".into(),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self::invalid("รูปแบบข้อมูลไม่ถูกต้องหรือไม่ตรงกับรุ่นที่รองรับ")
    }
}
