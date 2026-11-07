use crate::error::{fail, ApiFailure};
use crate::types::CardRow;

pub const FLAG_ORPHANED: i32 = 1;

#[derive(Debug, Clone)]
pub struct CardStateUpdate {
    pub id: String,
    pub state: String,
    pub buried_until: Option<i64>,
}

pub fn plan_suspend(cards: &[CardRow]) -> Vec<CardStateUpdate> {
    cards
        .iter()
        .filter(|c| c.state != "suspended")
        .map(|c| CardStateUpdate {
            id: c.id.clone(),
            state: "suspended".into(),
            buried_until: None,
        })
        .collect()
}

pub fn plan_unsuspend(cards: &[CardRow]) -> Result<Vec<CardStateUpdate>, ApiFailure> {
    let suspended: Vec<_> = cards.iter().filter(|c| c.state == "suspended").collect();
    if suspended
        .iter()
        .any(|c| (c.flags & FLAG_ORPHANED) != 0)
    {
        return Err(fail(axum::http::StatusCode::CONFLICT, "card_orphaned"));
    }
    Ok(suspended
        .into_iter()
        .map(|c| CardStateUpdate {
            id: c.id.clone(),
            state: c.sched_state.clone(),
            buried_until: None,
        })
        .collect())
}

pub fn plan_bury(cards: &[CardRow], until_ms: i64) -> Vec<CardStateUpdate> {
    cards
        .iter()
        .filter(|c| c.state != "suspended" && c.state != "buried")
        .map(|c| CardStateUpdate {
            id: c.id.clone(),
            state: "buried".into(),
            buried_until: Some(until_ms),
        })
        .collect()
}
