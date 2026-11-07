//! Schedule replay / verify (`core/replay.ts`).

use crate::answer_plan::sched_fields_of;
use crate::answer_plan::CardRow;
use crate::fsrs_adapter::{
    build_fsrs, new_card_fields, schedule_fsrs_card, to_fsrs_card, SchedulerPreset,
};
use crate::types::{ReviewLogRow, SchedFields};

pub struct ReplayResult {
    pub fields: SchedFields,
    pub chain_mismatches: Vec<usize>,
}

const SCHED_FIELD_NAMES: &[&str] = &[
    "schedState",
    "due",
    "stability",
    "difficulty",
    "lastReview",
    "reps",
    "lapses",
    "learningStep",
];

pub fn compare_sched(cached: &SchedFields, replayed: &SchedFields) -> Vec<&'static str> {
    let mut out = Vec::new();
    if cached.reps == 0 && replayed.reps == 0 {
        // skip due
    } else if cached.due != replayed.due {
        out.push(SCHED_FIELD_NAMES[1]);
    }
    if cached.sched_state != replayed.sched_state {
        out.push(SCHED_FIELD_NAMES[0]);
    }
    if (cached.stability - replayed.stability).abs() > f64::EPSILON {
        out.push(SCHED_FIELD_NAMES[2]);
    }
    if (cached.difficulty - replayed.difficulty).abs() > f64::EPSILON {
        out.push(SCHED_FIELD_NAMES[3]);
    }
    if cached.last_review != replayed.last_review {
        out.push(SCHED_FIELD_NAMES[4]);
    }
    if cached.reps != replayed.reps {
        out.push(SCHED_FIELD_NAMES[5]);
    }
    if cached.lapses != replayed.lapses {
        out.push(SCHED_FIELD_NAMES[6]);
    }
    if cached.learning_step != replayed.learning_step {
        out.push(SCHED_FIELD_NAMES[7]);
    }
    out
}

fn before_fields_of(row: &ReviewLogRow) -> SchedFields {
    SchedFields {
        sched_state: row.state_before,
        due: row.due_before,
        stability: row.stability_before,
        difficulty: row.difficulty_before,
        last_review: row.last_review_before,
        reps: row.reps_before,
        lapses: row.lapses_before,
        learning_step: row.step_before,
    }
}

fn is_rating(value: u32) -> bool {
    (1..=4).contains(&value)
}

pub fn replay_card(logs: &[ReviewLogRow], preset: &SchedulerPreset) -> Option<ReplayResult> {
    let scheduler = build_fsrs(preset)?;
    let mut sorted: Vec<_> = logs.to_vec();
    sorted.sort_by_key(|r| r.reviewed_at);
    let mut fields = new_card_fields();
    let mut chain_mismatches = Vec::new();
    for (index, row) in sorted.iter().enumerate() {
        if !is_rating(row.rating) {
            chain_mismatches.push(index);
            continue;
        }
        if !compare_sched(&before_fields_of(row), &fields).is_empty() {
            chain_mismatches.push(index);
        }
        let card = to_fsrs_card(&fields);
        let result = schedule_fsrs_card(
            &scheduler,
            preset.max_interval,
            card,
            row.rating as u8,
            row.reviewed_at,
        );
        fields = result.fields;
    }
    Some(ReplayResult {
        fields,
        chain_mismatches,
    })
}

pub fn sched_fields_of_card(card: &CardRow) -> SchedFields {
    sched_fields_of(card)
}
