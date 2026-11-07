//! Study day window / rollover clock (`core/day-clock.ts`).

use crate::types::{StudySettings, StudyWindow};
use crate::validation::is_valid_timezone;
use chrono::{Datelike, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use std::collections::HashMap;
use std::sync::Mutex;

const DAY_MS: i64 = 86_400_000;
pub const MAX_CACHED_TIMEZONES: usize = 64;

static TZ_CACHE: Mutex<Option<HashMap<String, ()>>> = Mutex::new(None);

pub fn cached_timezone_count() -> usize {
    TZ_CACHE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|m| m.len()))
        .unwrap_or(0)
}

fn touch_timezone(timezone: &str) {
    let mut guard = TZ_CACHE.lock().expect("tz cache");
    let map = guard.get_or_insert_with(HashMap::new);
    if map.len() >= MAX_CACHED_TIMEZONES {
        map.clear();
    }
    map.entry(timezone.to_string()).or_insert(());
}

struct LocalParts {
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
}

fn local_parts(utc_ms: i64, tz: &Tz) -> LocalParts {
    let dt = Utc
        .timestamp_millis_opt(utc_ms)
        .single()
        .expect("valid ms")
        .with_timezone(tz);
    LocalParts {
        year: dt.year(),
        month: dt.month(),
        day: dt.day(),
        hour: dt.hour(),
        minute: dt.minute(),
        second: dt.second(),
    }
}

fn offset_at(utc_ms: i64, tz: &Tz) -> i64 {
    let p = local_parts(utc_ms, tz);
    let wall_as_utc = Utc
        .with_ymd_and_hms(p.year, p.month, p.day, p.hour, p.minute, p.second)
        .single()
        .expect("wall")
        .timestamp_millis();
    wall_as_utc - utc_ms
}

fn same_wall_hour(utc_ms: i64, tz: &Tz, target: &LocalParts) -> bool {
    let p = local_parts(utc_ms, tz);
    p.year == target.year
        && p.month == target.month
        && p.day == target.day
        && p.hour == target.hour
        && p.minute == target.minute
}

fn local_wall_to_utc(date_utc_ms: i64, hour: u32, tz: &Tz) -> i64 {
    let wall_as_utc = date_utc_ms + i64::from(hour) * 3_600_000;
    let date = Utc.timestamp_millis_opt(date_utc_ms).single().unwrap();
    let target = LocalParts {
        year: date.year(),
        month: date.month(),
        day: date.day(),
        hour,
        minute: 0,
        second: 0,
    };
    let before = wall_as_utc - offset_at(wall_as_utc - DAY_MS, tz);
    let after = wall_as_utc - offset_at(wall_as_utc + DAY_MS, tz);
    let valid: Vec<i64> = [before, after]
        .into_iter()
        .filter(|&t| same_wall_hour(t, tz, &target))
        .collect();
    if let Some(&min) = valid.iter().min() {
        min
    } else {
        before
    }
}

pub fn study_window(now_ms: i64, settings: &StudySettings) -> StudyWindow {
    touch_timezone(&settings.timezone);
    let tz: Tz = settings.timezone.parse().expect("validated tz");
    let local = local_parts(now_ms, &tz);
    let calendar_day = Utc
        .with_ymd_and_hms(local.year, local.month, local.day, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let study_date = if local.hour < settings.rollover_hour as u32 {
        calendar_day - DAY_MS
    } else {
        calendar_day
    };
    StudyWindow {
        day_number: study_date / DAY_MS,
        start_ms: local_wall_to_utc(study_date, settings.rollover_hour as u32, &tz),
        end_ms: local_wall_to_utc(study_date + DAY_MS, settings.rollover_hour as u32, &tz),
    }
}

pub fn is_valid_timezone_public(name: &str) -> bool {
    is_valid_timezone(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::default_study_settings;

    const HOUR: i64 = 3_600_000;
    const DAY: i64 = 24 * HOUR;

    fn at(iso_ms: i64) -> i64 {
        iso_ms
    }

    #[test]
    fn utc_rollover_at_four() {
        let settings = StudySettings {
            rollover_hour: 4,
            timezone: "UTC".into(),
        };
        let before = study_window(1_767_326_399_999, &settings); // 2026-01-02T03:59:59.999Z
        assert_eq!(before.start_ms, 1_767_240_000_000); // 2026-01-01T04:00:00Z
        assert_eq!(before.end_ms, 1_767_326_400_000); // 2026-01-02T04:00:00Z
        let after = study_window(1_767_326_400_000, &settings);
        assert_eq!(after.start_ms, before.end_ms);
        assert_eq!(after.day_number, before.day_number + 1);
        assert_eq!(after.end_ms - after.start_ms, DAY);
    }

    #[test]
    fn default_settings_valid() {
        let s = default_study_settings();
        assert!(is_valid_timezone_public(&s.timezone));
    }
}
