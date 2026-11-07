//! Suspend / unsuspend / bury plans (`core/card-state-plan.ts`).

use crate::parked::{is_parked_state, CardState};
use crate::types::SchedState;

pub const FLAG_ORPHANED: u32 = 1;

#[derive(Debug, Clone)]
pub struct CardStateUpdate {
    pub id: String,
    pub state: CardState,
    pub buried_until: Option<i64>,
}

#[derive(Debug)]
pub enum CardStateFailure {
    CardOrphaned,
}

pub fn plan_suspend(cards: &[crate::answer_plan::CardRow]) -> Vec<CardStateUpdate> {
    cards
        .iter()
        .filter(|c| c.state != CardState::Suspended)
        .map(|c| CardStateUpdate {
            id: c.id.clone(),
            state: CardState::Suspended,
            buried_until: None,
        })
        .collect()
}

pub fn plan_unsuspend(
    cards: &[crate::answer_plan::CardRow],
) -> Result<Vec<CardStateUpdate>, CardStateFailure> {
    let suspended: Vec<_> = cards.iter().filter(|c| c.state == CardState::Suspended).collect();
    if suspended.iter().any(|c| c.flags_orphaned()) {
        return Err(CardStateFailure::CardOrphaned);
    }
    Ok(suspended
        .iter()
        .map(|c| CardStateUpdate {
            id: c.id.clone(),
            state: sched_to_card_state(c.sched_state),
            buried_until: None,
        })
        .collect())
}

pub fn plan_bury(cards: &[crate::answer_plan::CardRow], until_ms: i64) -> Vec<CardStateUpdate> {
    cards
        .iter()
        .filter(|c| !is_parked_state(c.state))
        .map(|c| CardStateUpdate {
            id: c.id.clone(),
            state: CardState::Buried,
            buried_until: Some(until_ms),
        })
        .collect()
}

fn sched_to_card_state(s: SchedState) -> CardState {
    match s {
        SchedState::New => CardState::New,
        SchedState::Learning => CardState::Learning,
        SchedState::Review => CardState::Review,
        SchedState::Relearning => CardState::Relearning,
    }
}

impl crate::answer_plan::CardRow {
    pub fn flags_orphaned(&self) -> bool {
        self.flags & FLAG_ORPHANED != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_plan::CardRow;
    use crate::types::SchedState;

    fn card(id: &str, patch: impl FnOnce(CardRow) -> CardRow) -> CardRow {
        patch(CardRow {
            id: id.to_string(),
            note_id: "n1".to_string(),
            deck_id: None,
            state: CardState::New,
            sched_state: SchedState::New,
            due: 0,
            stability: 0.0,
            difficulty: 0.0,
            last_review: None,
            reps: 0,
            lapses: 0,
            learning_step: 0,
            flags: 0,
        })
    }

    #[test]
    fn suspend_and_unsuspend() {
        let cards = vec![
            card("a", |c| c),
            card("suspended", |mut c| {
                c.state = CardState::Suspended;
                c.sched_state = SchedState::Review;
                c
            }),
        ];
        assert_eq!(plan_suspend(&cards).len(), 1);
        let updates = plan_unsuspend(&cards).unwrap();
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].id, "suspended");
    }

    #[test]
    fn unsuspend_rejects_orphan() {
        let cards = vec![card("o", |mut c| {
            c.state = CardState::Suspended;
            c.flags = FLAG_ORPHANED;
            c
        })];
        assert!(matches!(
            plan_unsuspend(&cards),
            Err(CardStateFailure::CardOrphaned)
        ));
    }
}
