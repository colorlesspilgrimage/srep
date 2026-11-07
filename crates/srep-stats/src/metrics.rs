use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayStats {
    pub reviews: u32,
    pub minutes: u32,
    pub new: u32,
    pub again: u32,
}

use srep_study::day_clock::study_window;
use srep_study::types::StudySettings;

pub const DAY_MS: i64 = 86_400_000;

pub fn build_heatmap(
    rows: &[(i64, i32, String)],
    settings: &StudySettings,
    min_day: i64,
    max_day: i64,
) -> Vec<serde_json::Value> {
    let mut counts = std::collections::HashMap::new();
    for (reviewed_at, _, _) in rows {
        let day = study_window(*reviewed_at, settings).day_number;
        if day < min_day || day > max_day {
            continue;
        }
        *counts.entry(day).or_insert(0) += 1;
    }
    (min_day..=max_day)
        .map(|day| {
            serde_json::json!({
                "dayNumber": day,
                "count": counts.get(&day).copied().unwrap_or(0)
            })
        })
        .collect()
}

pub fn study_streak(
    rows: &[(i64, i32, String)],
    settings: &StudySettings,
    now_ms: i64,
) -> serde_json::Value {
    let mut days = std::collections::HashSet::new();
    for (reviewed_at, _, _) in rows {
        days.insert(study_window(*reviewed_at, settings).day_number);
    }
    let today = study_window(now_ms, settings).day_number;
    let mut current = 0i64;
    let mut day = today;
    while days.contains(&day) {
        current += 1;
        day -= 1;
    }
    let mut sorted: Vec<_> = days.into_iter().collect();
    sorted.sort_unstable();
    let mut longest = 0i64;
    let mut run = 0i64;
    let mut prev: Option<i64> = None;
    for d in sorted {
        if prev == Some(d - 1) {
            run += 1;
        } else {
            run = 1;
        }
        longest = longest.max(run);
        prev = Some(d);
    }
    serde_json::json!({ "current": current, "longest": longest })
}

pub fn summarize_today(rows: &[(i64, i32, String)]) -> TodayStats {
    let mut reviews = 0u32;
    let minutes = 0u32;
    let mut new = 0u32;
    let mut again = 0u32;
    for (_, rating, state_before) in rows {
        reviews += 1;
        if *rating == 1 {
            again += 1;
        }
        if state_before == "new" {
            new += 1;
        }
    }
    TodayStats {
        reviews,
        minutes,
        new,
        again,
    }
}
