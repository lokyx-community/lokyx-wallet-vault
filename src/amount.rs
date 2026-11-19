//! Parse/format LYX amounts. Integer math only.
#![deny(clippy::float_arithmetic)]

use crate::params::{COIN, DECIMALS};

pub fn format_lyx(base: u128) -> String {
    let whole = base / COIN;
    let frac = base % COIN;
    if frac == 0 {
        return whole.to_string();
    }
    let f = format!("{:0width$}", frac, width = DECIMALS as usize);
    format!("{whole}.{}", f.trim_end_matches('0'))
}

pub fn parse_lyx(s: &str) -> Result<u128, String> {
    let s = s.trim();
    if s.is_empty() || s.starts_with('-') || s.starts_with('+') {
        return Err("amount must be a positive decimal number".into());
    }
    let (w, f) = match s.split_once('.') {
        Some((w, f)) => (w, f),
        None => (s, ""),
    };
    if f.len() > DECIMALS as usize {
        return Err(format!("at most {DECIMALS} decimal places"));
    }
    if !w.chars().all(|c| c.is_ascii_digit())
        || !f.chars().all(|c| c.is_ascii_digit())
        || (w.is_empty() && f.is_empty())
    {
        return Err("amount must be a decimal number like 1.25".into());
    }
    let whole: u128 = if w.is_empty() { 0 } else { w.parse().map_err(|_| "amount too large")? };
    let frac: u128 = if f.is_empty() {
        0
    } else {
        format!("{:0<width$}", f, width = DECIMALS as usize).parse().map_err(|_| "bad fraction")?
    };
    whole.checked_mul(COIN).and_then(|v| v.checked_add(frac)).ok_or_else(|| "amount too large".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        for s in ["0", "1", "10", "0.5", "1.000000000000000001", "123.456"] {
            assert_eq!(format_lyx(parse_lyx(s).unwrap()), s);
        }
        assert_eq!(parse_lyx(".5").unwrap(), COIN / 2);
        assert!(parse_lyx("1.0000000000000000001").is_err());
        assert!(parse_lyx("-1").is_err());
        assert!(parse_lyx("1e5").is_err());
        assert!(parse_lyx("").is_err());
        assert!(parse_lyx(".").is_err());
    }
}
