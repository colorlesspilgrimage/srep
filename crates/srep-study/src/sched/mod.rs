//! ts-fsrs 5.4.2 scheduling core (short-term scheduler).

mod algorithm;
mod basic;
mod help;
mod learning_steps;
mod models;
mod params;

pub use algorithm::FsrsAlgorithm;
pub use basic::BasicScheduler;
pub use models::{create_empty_card, FsrsCard, Grade, Rating, State};
pub use params::{
    check_parameters, generator_parameters, migrate_parameters, FsrsParameters, ParamError,
    DEFAULT_W,
};

pub struct FsrsEngine {
    algorithm: FsrsAlgorithm,
    params: FsrsParameters,
}

impl FsrsEngine {
    pub fn try_new(params: FsrsParameters) -> Result<Self, ParamError> {
        Ok(Self {
            algorithm: FsrsAlgorithm::new(params.clone()),
            params,
        })
    }

    pub fn next(&self, card: FsrsCard, now_ms: i64, grade: Grade) -> FsrsCard {
        let sched = BasicScheduler::new(card, now_ms, &self.algorithm, &self.params);
        sched.review(grade)
    }
}
