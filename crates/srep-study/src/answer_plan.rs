//! Answer / undo planning (parity: `core/answer-plan.ts`).

use crate::fsrs_adapter::{answer_card, SchedulerPreset};
use crate::parked::{is_parked_state, CardState};
use crate::types::{Rating, ReviewLogRow, SchedFields, SchedState, StudyWindow};

#[derive(Debug, Clone)]
pub struct AnswerPreset {
    pub desired_retention: f64,
    pub learning_steps: Vec<u32>,
    pub relearning_steps: Vec<u32>,
    pub max_interval: i32,
    pub fsrs_params: Option<Vec<f64>>,
    pub bury_siblings: bool,
}

#[derive(Debug, Clone)]
pub struct CardRow {
    pub id: String,
    pub note_id: String,
    pub state: CardState,
    pub sched_state: SchedState,
    pub due: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub last_review: Option<i64>,
    pub reps: u32,
    pub lapses: u32,
    pub learning_step: u32,
    pub flags: u32,
}

#[derive(Debug)]
pub enum PlanFailure {
    StaleCard,
    CardNotStudyable,
    BadPreset,
}

pub struct AnswerPlan {
    pub card_update: SchedFields,
    pub card_state: SchedState,
    pub log: ReviewLogRow,
    pub bury_ids: Vec<String>,
    pub bury_until: i64,
}

pub fn sched_fields_of(card: &CardRow) -> SchedFields {
    SchedFields {
        sched_state: card.sched_state,
        due: card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        last_review: card.last_review,
        reps: card.reps,
        lapses: card.lapses,
        learning_step: card.learning_step,
    }
}

pub fn plan_answer(
    card: &CardRow,
    preset: &AnswerPreset,
    siblings: &[CardRow],
    last_reviewed_at_max: Option<i64>,
    rating: Rating,
    expected_reps: u32,
    elapsed_ms: u64,
    now_ms: i64,
    window: &StudyWindow,
    log_id: String,
) -> Result<AnswerPlan, PlanFailure> {
    if card.reps != expected_reps {
        return Err(PlanFailure::StaleCard);
    }
    if is_parked_state(card.state) {
        return Err(PlanFailure::CardNotStudyable);
    }
    let reviewed_at = now_ms.max(last_reviewed_at_max.unwrap_or(-1) + 1);
    let before = sched_fields_of(card);
    let scheduler = SchedulerPreset {
        desired_retention: preset.desired_retention,
        learning_steps: preset.learning_steps.clone(),
        relearning_steps: preset.relearning_steps.clone(),
        max_interval: preset.max_interval,
        fsrs_params: preset.fsrs_params.clone(),
    };
    let result = answer_card(&scheduler, &before, rating, reviewed_at)
        .ok_or(PlanFailure::BadPreset)?;
    let bury_ids = if preset.bury_siblings {
        siblings
            .iter()
            .filter(|s| s.id != card.id && s.note_id == card.note_id)
            .filter(|s| matches!(s.state, CardState::New | CardState::Review))
            .map(|s| s.id.clone())
            .collect()
    } else {
        vec![]
    };
    Ok(AnswerPlan {
        card_state: result.fields.sched_state,
        card_update: result.fields,
        log: ReviewLogRow {
            id: log_id,
            card_id: card.id.clone(),
            reviewed_at,
            rating: rating as u32,
            state_before: before.sched_state,
            due_before: before.due,
            stability_before: before.stability,
            difficulty_before: before.difficulty,
            last_review_before: before.last_review,
            reps_before: before.reps,
            lapses_before: before.lapses,
            step_before: before.learning_step,
            elapsed_ms,
            interval_after: result.interval_minutes,
            buried_sibling_ids: bury_ids.clone(),
        },
        bury_ids,
        bury_until: window.end_ms,
    })
}

