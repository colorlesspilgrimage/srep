use chrono::{TimeZone, Utc};

use super::params::ParamError;

pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max)
}

pub fn round_to(num: f64, decimals: u32) -> f64 {
    let factor = 10_f64.powi(decimals as i32);
    (num * factor).round() / factor
}

pub fn date_scheduler(now_ms: i64, t: i32, is_day: bool) -> i64 {
    if is_day {
        now_ms + i64::from(t) * 86_400_000
    } else {
        now_ms + i64::from(t) * 60_000
    }
}

pub fn date_diff_in_days(last_ms: i64, cur_ms: i64) -> i32 {
    let last = Utc.timestamp_millis_opt(last_ms).single().unwrap();
    let cur = Utc.timestamp_millis_opt(cur_ms).single().unwrap();
    let utc1 = last.date_naive().and_hms_opt(0, 0, 0).unwrap();
    let utc2 = cur.date_naive().and_hms_opt(0, 0, 0).unwrap();
    (utc2 - utc1).num_days() as i32
}

pub fn step_to_minutes(step: &str) -> Result<u32, ParamError> {
    let unit = step
        .chars()
        .last()
        .ok_or_else(|| ParamError(format!("Invalid step value: {step}")))?;
    let value: u32 = step[..step.len() - 1]
        .parse()
        .map_err(|_| ParamError(format!("Invalid step value: {step}")))?;
    Ok(match unit {
        'm' => value,
        'h' => value * 60,
        'd' => value * 1440,
        _ => return Err(ParamError(format!("Invalid step unit: {step}, expected m/h/d"))),
    })
}
