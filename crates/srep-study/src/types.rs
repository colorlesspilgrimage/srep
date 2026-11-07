//! Study scheduling types (parity: `core/types.ts`).

use serde::{Deserialize, Serialize};

pub const RATINGS: [Rating; 4] = [1, 2, 3, 4];

pub type Rating = u8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SchedState {
    New,
    Learning,
    Review,
    Relearning,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SchedFields {
    pub sched_state: SchedState,
    pub due: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub last_review: Option<i64>,
    pub reps: u32,
    pub lapses: u32,
    pub learning_step: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySettings {
    pub rollover_hour: u8,
    pub timezone: String,
}

impl Default for StudySettings {
    fn default() -> Self {
        Self {
            rollover_hour: 4,
            timezone: "UTC".to_string(),
        }
    }
}

pub fn default_study_settings() -> StudySettings {
    StudySettings::default()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyWindow {
    pub day_number: i64,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReviewLogRow {
    pub id: String,
    pub card_id: String,
    pub reviewed_at: i64,
    pub rating: u32,
    pub state_before: SchedState,
    pub due_before: i64,
    pub stability_before: f64,
    pub difficulty_before: f64,
    pub last_review_before: Option<i64>,
    pub reps_before: u32,
    pub lapses_before: u32,
    pub step_before: u32,
    pub elapsed_ms: u64,
    pub interval_after: u32,
    pub buried_sibling_ids: Vec<String>,
}
