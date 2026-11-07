//! FSRS scheduling wrapper (parity: `core/fsrs-adapter.ts`).

use crate::sched::{
    check_parameters, generator_parameters, FsrsCard, FsrsEngine, Rating, State,
};
use crate::types::{Rating as AppRating, SchedFields, SchedState};

const DAY_MS: i64 = 86_400_000;
const MINUTE_MS: i64 = 60_000;

#[derive(Debug, Clone)]
pub struct SchedulerPreset {
    pub desired_retention: f64,
    pub learning_steps: Vec<u32>,
    pub relearning_steps: Vec<u32>,
    pub max_interval: i32,
    pub fsrs_params: Option<Vec<f64>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnswerResult {
    pub fields: SchedFields,
    pub interval_minutes: u32,
}

fn sched_state_name(s: State) -> SchedState {
    match s {
        State::New => SchedState::New,
        State::Learning => SchedState::Learning,
        State::Review => SchedState::Review,
        State::Relearning => SchedState::Relearning,
    }
}

fn state_from_sched(s: SchedState) -> State {
    match s {
        SchedState::New => State::New,
        SchedState::Learning => State::Learning,
        SchedState::Review => State::Review,
        SchedState::Relearning => State::Relearning,
    }
}

/// Returns `None` when parameters are invalid (parity with ts-fsrs).
pub fn build_fsrs(preset: &SchedulerPreset) -> Option<FsrsEngine> {
    if let Some(ref w) = preset.fsrs_params {
        check_parameters(w).ok()?;
    }
    let params = generator_parameters(
        preset.desired_retention,
        preset.max_interval,
        &preset.learning_steps,
        &preset.relearning_steps,
        preset.fsrs_params.as_deref(),
        true,
    );
    FsrsEngine::try_new(params).ok()
}

pub fn new_card_fields() -> SchedFields {
    SchedFields {
        sched_state: SchedState::New,
        due: 0,
        stability: 0.0,
        difficulty: 0.0,
        last_review: None,
        reps: 0,
        lapses: 0,
        learning_step: 0,
    }
}

pub fn to_fsrs_card(fields: &SchedFields) -> FsrsCard {
    FsrsCard {
        due_ms: fields.due,
        stability: fields.stability,
        difficulty: fields.difficulty,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: fields.learning_step,
        reps: fields.reps,
        lapses: fields.lapses,
        state: state_from_sched(fields.sched_state),
        last_review_ms: fields.last_review,
    }
}

pub fn schedule_fsrs_card(
    scheduler: &FsrsEngine,
    max_interval: i32,
    card: FsrsCard,
    rating: AppRating,
    now_ms: i64,
) -> AnswerResult {
    let grade = match rating {
        1 => Rating::Again,
        2 => Rating::Hard,
        3 => Rating::Good,
        4 => Rating::Easy,
        _ => Rating::Good,
    };
    let next = scheduler.next(card, now_ms, grade);
    let due = next.due_ms.min(now_ms + i64::from(max_interval) * DAY_MS);
    AnswerResult {
        fields: SchedFields {
            sched_state: sched_state_name(next.state),
            due,
            stability: next.stability,
            difficulty: next.difficulty,
            last_review: Some(next.last_review_ms.unwrap_or(now_ms)),
            reps: next.reps,
            lapses: next.lapses,
            learning_step: next.learning_steps,
        },
        interval_minutes: ((due - now_ms) as f64 / MINUTE_MS as f64).round() as u32,
    }
}

pub fn answer_card(
    preset: &SchedulerPreset,
    fields: &SchedFields,
    rating: AppRating,
    now_ms: i64,
) -> Option<AnswerResult> {
    let scheduler = build_fsrs(preset)?;
    Some(schedule_fsrs_card(
        &scheduler,
        preset.max_interval,
        to_fsrs_card(fields),
        rating,
        now_ms,
    ))
}

pub type AnswerPreviews = std::collections::HashMap<AppRating, (i64, u32)>;

pub fn preview_answers(
    preset: &SchedulerPreset,
    fields: &SchedFields,
    now_ms: i64,
) -> Option<AnswerPreviews> {
    let scheduler = build_fsrs(preset)?;
    let mut out = AnswerPreviews::new();
    for rating in crate::types::RATINGS {
        let result = schedule_fsrs_card(
            &scheduler,
            preset.max_interval,
            to_fsrs_card(fields),
            rating,
            now_ms,
        );
        out.insert(rating, (result.fields.due, result.interval_minutes));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_767_258_000_000; // 2026-01-01T09:00:00Z
    const MIN: i64 = 60_000;

    fn default_preset() -> SchedulerPreset {
        SchedulerPreset {
            desired_retention: 0.9,
            learning_steps: vec![1, 10],
            relearning_steps: vec![10],
            max_interval: 36_500,
            fsrs_params: None,
        }
    }

    fn run(preset: &SchedulerPreset, ratings: &[AppRating]) -> Vec<(SchedFields, i64)> {
        let mut fields = new_card_fields();
        let mut at = T0;
        let scheduler = build_fsrs(preset).expect("preset");
        let mut steps = Vec::new();
        for &rating in ratings {
            let result = schedule_fsrs_card(
                &scheduler,
                preset.max_interval,
                to_fsrs_card(&fields),
                rating,
                at,
            );
            steps.push((result.fields.clone(), at));
            fields = result.fields;
            at = fields.due;
        }
        steps
    }

    #[test]
    fn golden_a_lapse_chain() {
        let steps = run(&default_preset(), &[3, 3, 3, 1, 3, 3, 4]);
        assert_eq!(steps.len(), 7);
        assert_eq!(steps[0].0.sched_state, SchedState::Learning);
        assert_eq!(steps[0].0.due, T0 + 10 * MIN);
        assert!((steps[0].0.stability - 2.3065).abs() < 1e-4);
        assert_eq!(steps[1].0.sched_state, SchedState::Review);
        assert_eq!(steps[1].0.due, 1_767_431_400_000);
        assert_eq!(steps[3].0.sched_state, SchedState::Relearning);
    }

    #[test]
    fn build_fsrs_rejects_bad_params() {
        assert!(build_fsrs(&SchedulerPreset {
            fsrs_params: Some(vec![1.0]),
            ..default_preset()
        })
        .is_none());
    }

    #[test]
    fn new_card_due_ignored() {
        let preset = default_preset();
        let a = answer_card(&preset, &new_card_fields(), 3, T0);
        let mut fields = new_card_fields();
        fields.due = T0 - 5 * DAY_MS;
        let b = answer_card(&preset, &fields, 3, T0);
        assert_eq!(a, b);
    }
}
