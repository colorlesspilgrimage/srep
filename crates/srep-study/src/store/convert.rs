use crate::answer_plan::CardRow;
use crate::parked::CardState;
use crate::types::{SchedState, StudySettings};
use srep_domain::types::{CardRow as DbCard, PresetRow};

pub fn card_state_from_str(s: &str) -> CardState {
    match s {
        "learning" => CardState::Learning,
        "review" => CardState::Review,
        "relearning" => CardState::Relearning,
        "suspended" => CardState::Suspended,
        "buried" => CardState::Buried,
        _ => CardState::New,
    }
}

pub fn sched_state_from_str(s: &str) -> SchedState {
    match s {
        "learning" => SchedState::Learning,
        "review" => SchedState::Review,
        "relearning" => SchedState::Relearning,
        _ => SchedState::New,
    }
}

pub fn sched_state_to_str(s: SchedState) -> &'static str {
    match s {
        SchedState::New => "new",
        SchedState::Learning => "learning",
        SchedState::Review => "review",
        SchedState::Relearning => "relearning",
    }
}

pub fn card_state_to_str(s: CardState) -> &'static str {
    match s {
        CardState::New => "new",
        CardState::Learning => "learning",
        CardState::Review => "review",
        CardState::Relearning => "relearning",
        CardState::Suspended => "suspended",
        CardState::Buried => "buried",
    }
}

pub fn to_study_card(c: &DbCard) -> CardRow {
    CardRow {
        id: c.id.clone(),
        note_id: c.note_id.clone(),
        deck_id: c.deck_id.clone(),
        state: card_state_from_str(&c.state),
        sched_state: sched_state_from_str(&c.sched_state),
        due: c.due,
        stability: c.stability,
        difficulty: c.difficulty,
        last_review: c.last_review,
        reps: c.reps as u32,
        lapses: c.lapses as u32,
        learning_step: c.learning_step as u32,
        flags: c.flags as u32,
    }
}

pub fn to_answer_preset(p: &PresetRow) -> crate::answer_plan::AnswerPreset {
    crate::answer_plan::AnswerPreset {
        desired_retention: p.desired_retention,
        learning_steps: p.learning_steps.iter().map(|&x| x as u32).collect(),
        relearning_steps: p.relearning_steps.iter().map(|&x| x as u32).collect(),
        max_interval: p.max_interval,
        fsrs_params: p.fsrs_params.clone(),
        bury_siblings: p.bury_siblings,
    }
}

pub fn study_settings_json(s: &StudySettings) -> serde_json::Value {
    serde_json::json!({
        "rolloverHour": s.rollover_hour,
        "timezone": s.timezone,
    })
}
