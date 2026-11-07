use super::algorithm::{FsrsAlgorithm, MemoryState};
use super::help::{date_diff_in_days, date_scheduler};
use super::learning_steps::apply_learning_steps;
use super::models::{FsrsCard, Grade, Rating, State};
use super::params::FsrsParameters;

pub struct BasicScheduler<'a> {
    pub algorithm: &'a FsrsAlgorithm,
    pub params: &'a FsrsParameters,
    last: FsrsCard,
    current: FsrsCard,
    review_ms: i64,
    elapsed_days: i32,
}

impl<'a> BasicScheduler<'a> {
    pub fn new(card: FsrsCard, now_ms: i64, algorithm: &'a FsrsAlgorithm, params: &'a FsrsParameters) -> Self {
        let last = card.clone();
        let mut current = card;
        let elapsed_days = if current.state == State::New {
            0
        } else if let Some(lr) = current.last_review_ms {
            date_diff_in_days(lr, now_ms)
        } else {
            0
        };
        current.last_review_ms = Some(now_ms);
        current.elapsed_days = elapsed_days;
        current.reps += 1;
        Self {
            algorithm,
            params,
            last,
            current,
            review_ms: now_ms,
            elapsed_days,
        }
    }

    fn next_ds(&self, t: i32, g: Grade, r: Option<f64>) -> FsrsCard {
        let mem = if self.current.stability == 0.0 && self.current.difficulty == 0.0 {
            None
        } else {
            Some(MemoryState {
                difficulty: self.current.difficulty,
                stability: self.current.stability,
            })
        };
        let next_state = self.algorithm.next_state(mem, t, g, r);
        let mut card = self.current.clone();
        card.difficulty = next_state.difficulty;
        card.stability = next_state.stability;
        card
    }

    fn new_state(&self, grade: Grade) -> FsrsCard {
        let mut next = self.next_ds(self.elapsed_days, grade, None);
        apply_learning_steps(
            self.params,
            self.algorithm,
            self.last.state,
            &self.current,
            &mut next,
            grade,
            self.review_ms,
            State::Learning,
        );
        next
    }

    fn learning_state(&self, grade: Grade) -> FsrsCard {
        let mut next = self.next_ds(self.elapsed_days, grade, None);
        apply_learning_steps(
            self.params,
            self.algorithm,
            self.last.state,
            &self.current,
            &mut next,
            grade,
            self.review_ms,
            self.last.state,
        );
        next
    }

    fn review_state(&self, grade: Grade) -> FsrsCard {
        let interval = self.elapsed_days;
        let r = self
            .algorithm
            .forgetting_curve(interval, self.current.stability);
        let mut again = self.next_ds(interval, Rating::Again, Some(r));
        let mut hard = self.next_ds(interval, Rating::Hard, Some(r));
        let mut good = self.next_ds(interval, Rating::Good, Some(r));
        let mut easy = self.next_ds(interval, Rating::Easy, Some(r));

        let hard_interval = self.algorithm.next_interval(hard.stability, interval);
        let mut good_interval = self.algorithm.next_interval(good.stability, interval);
        let hard_interval = hard_interval.min(good_interval);
        good_interval = good_interval.max(hard_interval + 1);
        let easy_interval = self
            .algorithm
            .next_interval(easy.stability, interval)
            .max(good_interval + 1);

        hard.scheduled_days = hard_interval;
        hard.due_ms = date_scheduler(self.review_ms, hard_interval, true);
        good.scheduled_days = good_interval;
        good.due_ms = date_scheduler(self.review_ms, good_interval, true);
        easy.scheduled_days = easy_interval;
        easy.due_ms = date_scheduler(self.review_ms, easy_interval, true);

        for c in [&mut hard, &mut good, &mut easy] {
            c.state = State::Review;
            c.learning_steps = 0;
        }

        apply_learning_steps(
            self.params,
            self.algorithm,
            self.last.state,
            &self.current,
            &mut again,
            Rating::Again,
            self.review_ms,
            State::Relearning,
        );
        again.lapses += 1;

        match grade {
            Rating::Again => again,
            Rating::Hard => hard,
            Rating::Good => good,
            Rating::Easy => easy,
        }
    }

    pub fn review(&self, grade: Grade) -> FsrsCard {
        match self.last.state {
            State::New => self.new_state(grade),
            State::Learning | State::Relearning => self.learning_state(grade),
            State::Review => self.review_state(grade),
        }
    }
}
