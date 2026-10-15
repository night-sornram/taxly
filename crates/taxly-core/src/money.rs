use std::{fmt, str::FromStr};

use rust_decimal::{Decimal, prelude::ToPrimitive};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

use crate::TaxError;

/// Exact, non-negative baht. Input is limited to two decimal places and i64 satang.
/// Derived calculation amounts may retain sub-satang precision until rules specify rounding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Money(Decimal);

impl Money {
    pub const ZERO: Self = Self(Decimal::ZERO);

    pub fn from_satang(value: i64) -> Result<Self, TaxError> {
        if value < 0 {
            return Err(TaxError::InvalidAmount);
        }
        Ok(Self(Decimal::new(value, 2)))
    }

    pub fn satang(self) -> Result<i64, TaxError> {
        let scaled = self
            .0
            .checked_mul(Decimal::from(100))
            .ok_or(TaxError::AmountOverflow)?;
        if !scaled.fract().is_zero() {
            return Err(TaxError::InvalidAmount);
        }
        scaled.to_i64().ok_or(TaxError::AmountOverflow)
    }

    pub fn decimal(self) -> Decimal {
        self.0
    }

    pub fn checked_add(self, other: Self) -> Result<Self, TaxError> {
        Self::derived(
            self.0
                .checked_add(other.0)
                .ok_or(TaxError::AmountOverflow)?,
        )
    }

    pub fn saturating_sub(self, other: Self) -> Self {
        Self((self.0 - other.0).max(Decimal::ZERO))
    }

    pub fn checked_mul(self, rate: Decimal) -> Result<Self, TaxError> {
        Self::derived(self.0.checked_mul(rate).ok_or(TaxError::AmountOverflow)?)
    }

    pub(crate) fn derived(value: Decimal) -> Result<Self, TaxError> {
        if value < Decimal::ZERO {
            return Err(TaxError::InvalidAmount);
        }
        if value > Decimal::new(i64::MAX, 2) {
            return Err(TaxError::AmountOverflow);
        }
        Ok(Self(value))
    }
}

impl FromStr for Money {
    type Err = TaxError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        // No exponent notation, separators, signs or implicit whitespace coercion.
        let mut dots = 0;
        if value.is_empty() || value.starts_with('.') || value.ends_with('.') {
            return Err(TaxError::InvalidAmount);
        }
        for byte in value.bytes() {
            if byte == b'.' {
                dots += 1;
            } else if !byte.is_ascii_digit() {
                return Err(TaxError::InvalidAmount);
            }
        }
        if dots > 1 {
            return Err(TaxError::InvalidAmount);
        }
        let parsed = Decimal::from_str_exact(value).map_err(|_| TaxError::InvalidAmount)?;
        if parsed.scale() > 2 {
            return Err(TaxError::InvalidAmount);
        }
        Self::derived(parsed)
    }
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0.normalize())
    }
}

impl Serialize for Money {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Money {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(de::Error::custom)
    }
}
