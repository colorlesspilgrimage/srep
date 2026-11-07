use std::collections::HashMap;

use super::help::step_to_minutes;
use super::models::{Grade, Rating, State};
use super::params::FsrsParameters;

#[derive(Debug, Clone, Copy)]
pub struct StepInfo {
    pub scheduled_minutes: u32,
    pub next_step: u32,
}

pub fn basic_learning_steps(
    params: &FsrsParameters,
    state: State,
    cur_step: u32,
) -> HashMap<Rating, StepInfo> {
    let learning_steps = match state {
        State::Relearning | State::Review => &params.relearning_steps,
        _ => &params.learning_steps,
    };
    let steps_length = learning_steps.len();
    let mut result = HashMap::new();
    if steps_length == 0 || cur_step as usize >= steps_length {
        return result;
    }
    let first = learning_steps[0].0.as_str();
    let first_min = step_to_minutes(first).unwrap_or(1);

    let get_hard = || {
        if steps_length == 1 {
            (first_min as f64 * 1.5).round() as u32
        } else {
            let next = step_to_minutes(&learning_steps[1].0).unwrap_or(first_min);
            ((first_min + next) as f64 / 2.0).round() as u32
        }
    };

    if state == State::Review {
        result.insert(
            Rating::Again,
            StepInfo {
                scheduled_minutes: first_min,
                next_step: 0,
            },
        );
        return result;
    }

    result.insert(
        Rating::Again,
        StepInfo {
            scheduled_minutes: first_min,
            next_step: 0,
        },
    );
    result.insert(
        Rating::Hard,
        StepInfo {
            scheduled_minutes: get_hard(),
            next_step: cur_step,
        },
    );
    if let Some(next_step) = learning_steps.get((cur_step + 1) as usize) {
        let next_min = step_to_minutes(&next_step.0).unwrap_or(0);
        if next_min > 0 {
            result.insert(
                Rating::Good,
                StepInfo {
                    scheduled_minutes: next_min,
                    next_step: cur_step + 1,
                },
            );
        }
    }
    result
}

pub fn apply_learning_steps(
    params: &FsrsParameters,
    algorithm: &super::algorithm::FsrsAlgorithm,
    last_state: State,
    current: &super::models::FsrsCard,
    next: &mut super::models::FsrsCard,
    grade: Grade,
    review_ms: i64,
    to_state: State,
) {
    let steps = basic_learning_steps(params, last_state, current.learning_steps);
    let Some(info) = steps.get(&grade) else {
        next.state = State::Review;
        next.learning_steps = 0;
        let interval = algorithm.next_interval(next.stability, current.elapsed_days);
        next.scheduled_days = interval;
        next.due_ms = super::help::date_scheduler(review_ms, interval, true);
        return;
    };
    let scheduled_minutes = info.scheduled_minutes;
    if scheduled_minutes > 0 && scheduled_minutes < 1440 {
        next.learning_steps = info.next_step;
        next.scheduled_days = 0;
        next.state = to_state;
        next.due_ms = super::help::date_scheduler(review_ms, scheduled_minutes as i32, false);
    } else {
        next.state = State::Review;
        if scheduled_minutes >= 1440 {
            next.learning_steps = info.next_step;
            next.due_ms = super::help::date_scheduler(review_ms, scheduled_minutes as i32, false);
            next.scheduled_days = (scheduled_minutes / 1440) as i32;
        } else {
            next.learning_steps = 0;
            let interval = algorithm.next_interval(next.stability, current.elapsed_days);
            next.scheduled_days = interval;
            next.due_ms = super::help::date_scheduler(review_ms, interval, true);
        }
    }
}
