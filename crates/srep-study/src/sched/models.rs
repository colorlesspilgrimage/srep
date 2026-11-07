//! FSRS card models (ts-fsrs `models.ts`).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    New = 0,
    Learning = 1,
    Review = 2,
    Relearning = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Rating {
    Again = 1,
    Hard = 2,
    Good = 3,
    Easy = 4,
}

pub type Grade = Rating;

#[derive(Debug, Clone)]
pub struct StepUnit(pub String);

#[derive(Debug, Clone)]
pub struct FsrsCard {
    pub due_ms: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i32,
    pub scheduled_days: i32,
    pub learning_steps: u32,
    pub reps: u32,
    pub lapses: u32,
    pub state: State,
    pub last_review_ms: Option<i64>,
}

impl Default for FsrsCard {
    fn default() -> Self {
        Self {
            due_ms: 0,
            stability: 0.0,
            difficulty: 0.0,
            elapsed_days: 0,
            scheduled_days: 0,
            learning_steps: 0,
            reps: 0,
            lapses: 0,
            state: State::New,
            last_review_ms: None,
        }
    }
}

pub fn create_empty_card(now_ms: i64) -> FsrsCard {
    FsrsCard {
        due_ms: now_ms,
        ..Default::default()
    }
}
