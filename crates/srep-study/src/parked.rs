//! Parked card states (suspended / buried).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardState {
    New,
    Learning,
    Review,
    Relearning,
    Suspended,
    Buried,
}

pub fn is_parked_state(state: CardState) -> bool {
    matches!(state, CardState::Suspended | CardState::Buried)
}
