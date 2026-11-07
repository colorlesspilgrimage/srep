use serde::Serialize;
use srep_study::day_clock::study_window;
use srep_study::types::StudySettings;

pub const DAY_MS: i64 = 86_400_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayStats {
    pub reviews: u32,
    pub elapsed_ms: u64,
    pub again: u32,
    pub hard: u32,
    pub good: u32,
    pub easy: u32,
}

#[derive(Debug, Clone)]
pub struct ReviewRow {
    pub reviewed_at: i64,
    pub rating: i32,
    pub state_before: String,
    pub elapsed_ms: i64,
    pub preset_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CardDueRow {
    pub due: i64,
    pub sched_state: String,
    pub state: String,
    pub stability: f64,
    pub last_review: Option<i64>,
}

pub fn reviews_in_window(rows: &[ReviewRow], start_ms: i64, end_ms: i64) -> Vec<&ReviewRow> {
    rows.iter()
        .filter(|r| r.reviewed_at >= start_ms && r.reviewed_at < end_ms)
        .collect()
}

pub fn summarize_today(rows: &[ReviewRow]) -> TodayStats {
    let mut again = 0u32;
    let mut hard = 0u32;
    let mut good = 0u32;
    let mut easy = 0u32;
    let mut elapsed_ms = 0u64;
    for row in rows {
        elapsed_ms += row.elapsed_ms as u64;
        match row.rating {
            1 => again += 1,
            2 => hard += 1,
            3 => good += 1,
            4 => easy += 1,
            _ => {}
        }
    }
    TodayStats {
        reviews: rows.len() as u32,
        elapsed_ms,
        again,
        hard,
        good,
        easy,
    }
}

pub fn build_heatmap(
    rows: &[ReviewRow],
    settings: &StudySettings,
    min_day: i64,
    max_day: i64,
) -> Vec<serde_json::Value> {
    let mut counts = std::collections::HashMap::new();
    for row in rows {
        let day = study_window(row.reviewed_at, settings).day_number;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionStats {
    pub mature_reviews: u32,
    pub passed: u32,
    pub true_retention: Option<f64>,
    pub desired_retention: f64,
}

pub fn compute_retention(
    rows: &[ReviewRow],
    desired_retention: f64,
    preset_filter: Option<&str>,
) -> RetentionStats {
    let mut mature_reviews = 0u32;
    let mut passed = 0u32;
    for row in rows {
        if row.state_before != "review" {
            continue;
        }
        if let Some(pid) = preset_filter {
            if row.preset_id.as_deref() != Some(pid) {
                continue;
            }
        }
        mature_reviews += 1;
        if row.rating >= 3 {
            passed += 1;
        }
    }
    let true_retention = if mature_reviews > 0 {
        Some(passed as f64 / mature_reviews as f64)
    } else {
        None
    };
    RetentionStats {
        mature_reviews,
        passed,
        true_retention,
        desired_retention,
    }
}

const BUCKETS: &[(&str, f64)] = &[
    ("<1d", 1.0),
    ("1–7d", 7.0),
    ("8–30d", 30.0),
    ("31–90d", 90.0),
    ("90d+", f64::INFINITY),
];

fn interval_days(card: &CardDueRow, now_ms: i64) -> f64 {
    if card.last_review.is_some() && card.sched_state == "review" {
        let last = card.last_review.unwrap_or(0);
        return ((card.due - last) as f64 / DAY_MS as f64).max(0.0);
    }
    if card.stability > 0.0 {
        return card.stability;
    }
    if card.due > now_ms {
        return (card.due - now_ms) as f64 / DAY_MS as f64;
    }
    0.0
}

pub fn card_distribution(
    cards: &[CardDueRow],
    now_ms: i64,
) -> serde_json::Value {
    let mut by_state = serde_json::Map::new();
    let mut bucket_counts: Vec<serde_json::Value> = BUCKETS
        .iter()
        .map(|(label, _)| serde_json::json!({ "label": label, "count": 0 }))
        .collect();
    for card in cards {
        if card.state == "suspended" || card.state == "buried" {
            continue;
        }
        let key = card.sched_state.clone();
        let entry = by_state.entry(key).or_insert(serde_json::json!(0));
        if let Some(n) = entry.as_u64() {
            *entry = serde_json::json!(n + 1);
        }
        let days = interval_days(card, now_ms);
        for (i, (_, max_days)) in BUCKETS.iter().enumerate() {
            if days <= *max_days {
                if let Some(obj) = bucket_counts[i].as_object_mut() {
                    let c = obj.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
                    obj.insert("count".into(), serde_json::json!(c + 1));
                }
                break;
            }
        }
    }
    serde_json::json!({
        "byState": by_state,
        "intervalBuckets": bucket_counts
    })
}

pub fn forecast_due(
    cards: &[CardDueRow],
    settings: &StudySettings,
    now_ms: i64,
    horizon_days: i64,
) -> Vec<serde_json::Value> {
    let today = study_window(now_ms, settings).day_number;
    let end_day = today + horizon_days;
    let mut counts: std::collections::BTreeMap<i64, u32> = (today..=end_day).map(|d| (d, 0)).collect();
    for card in cards {
        if card.state == "suspended" || card.state == "buried" {
            continue;
        }
        if card.due > now_ms + horizon_days * DAY_MS + DAY_MS {
            continue;
        }
        let day = study_window(card.due, settings).day_number;
        if day < today || day > end_day {
            continue;
        }
        if let Some(c) = counts.get_mut(&day) {
            *c += 1;
        }
    }
    counts
        .into_iter()
        .map(|(day_number, due)| serde_json::json!({ "dayNumber": day_number, "due": due }))
        .collect()
}

pub fn study_streak(
    rows: &[ReviewRow],
    settings: &StudySettings,
    now_ms: i64,
) -> serde_json::Value {
    let mut days = std::collections::HashSet::new();
    for row in rows {
        days.insert(study_window(row.reviewed_at, settings).day_number);
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
