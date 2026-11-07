//! FSRS memory algorithm (ts-fsrs `algorithm.ts`).

use super::help::{clamp, round_to};
use super::models::{Grade, Rating};
use super::params::{FsrsParameters, S_MIN};

#[derive(Debug, Clone, Copy)]
pub struct MemoryState {
    pub difficulty: f64,
    pub stability: f64,
}

pub struct FsrsAlgorithm {
    pub param: FsrsParameters,
    interval_modifier: f64,
}

impl FsrsAlgorithm {
    pub fn new(param: FsrsParameters) -> Self {
        let interval_modifier = Self::calculate_interval_modifier(&param, param.request_retention);
        Self {
            param,
            interval_modifier,
        }
    }

    fn compute_decay_factor(w: &[f64]) -> (f64, f64) {
        let decay = -w[20];
        let factor = (decay.powi(-1) * 0.9_f64.ln()).exp() - 1.0;
        (decay, round_to(factor, 8))
    }

    fn calculate_interval_modifier(param: &FsrsParameters, request_retention: f64) -> f64 {
        let (decay, factor) = Self::compute_decay_factor(&param.w);
        round_to((request_retention.powf(1.0 / decay) - 1.0) / factor, 8)
    }

    pub fn forgetting_curve(&self, elapsed_days: i32, stability: f64) -> f64 {
        let (decay, factor) = Self::compute_decay_factor(&self.param.w);
        round_to(
            (1.0 + (factor * elapsed_days as f64) / stability).powf(decay),
            8,
        )
    }

    pub fn init_stability(&self, g: Grade) -> f64 {
        let idx = g as usize - 1;
        self.param.w.get(idx).copied().unwrap_or(0.1).max(0.1)
    }

    pub fn init_difficulty(&self, g: Grade) -> f64 {
        let w = &self.param.w;
        let gi = g as i32 as f64;
        let d = w[4] - ((gi - 1.0) * w[5]).exp() + 1.0;
        round_to(d, 8)
    }

    pub fn next_interval(&self, stability: f64, elapsed_days: i32) -> i32 {
        let new_interval = (stability * self.interval_modifier)
            .round()
            .clamp(1.0, self.param.maximum_interval as f64) as i32;
        new_interval
    }

    fn linear_damping(&self, delta_d: f64, old_d: f64) -> f64 {
        round_to(delta_d * (10.0 - old_d) / 9.0, 8)
    }

    fn mean_reversion(&self, init: f64, current: f64) -> f64 {
        let w = &self.param.w;
        round_to(w[7] * init + (1.0 - w[7]) * current, 8)
    }

    pub fn next_difficulty(&self, d: f64, g: Grade) -> f64 {
        let delta_d = -self.param.w[6] * (g as i32 as f64 - 3.0);
        let next_d = d + self.linear_damping(delta_d, d);
        clamp(
            self.mean_reversion(self.init_difficulty(Rating::Easy), next_d),
            1.0,
            10.0,
        )
    }

    pub fn next_recall_stability(&self, d: f64, s: f64, r: f64, g: Grade) -> f64 {
        let w = &self.param.w;
        let hard_penalty = if g == Rating::Hard { w[15] } else { 1.0 };
        let easy_bonus = if g == Rating::Easy { w[16] } else { 1.0 };
        round_to(
            clamp(
                s * (1.0
                    + w[8].exp()
                        * (11.0 - d)
                        * s.powf(-w[9])
                        * ((1.0 - r) * w[10]).exp_m1()
                        * hard_penalty
                        * easy_bonus),
                S_MIN,
                36500.0,
            ),
            8,
        )
    }

    pub fn next_forget_stability(&self, d: f64, s: f64, r: f64) -> f64 {
        let w = &self.param.w;
        round_to(
            clamp(
                w[11] * d.powf(-w[12]) * ((s + 1.0).powf(w[13]) - 1.0) * ((1.0 - r) * w[14]).exp(),
                S_MIN,
                36500.0,
            ),
            8,
        )
    }

    pub fn next_short_term_stability(&self, s: f64, g: Grade) -> f64 {
        let w = &self.param.w;
        let sinc = s.powf(-w[19]) * (w[17] * (g as i32 as f64 - 3.0 + w[18])).exp();
        let masked = if g as i32 >= Rating::Hard as i32 {
            sinc.max(1.0)
        } else {
            sinc
        };
        round_to(clamp(s * masked, S_MIN, 36500.0), 8)
    }

    pub fn next_state(&self, memory: Option<MemoryState>, t: i32, g: Grade, r: Option<f64>) -> MemoryState {
        let (d, s) = memory.map(|m| (m.difficulty, m.stability)).unwrap_or((0.0, 0.0));
        if d == 0.0 && s == 0.0 {
            return MemoryState {
                difficulty: clamp(self.init_difficulty(g), 1.0, 10.0),
                stability: self.init_stability(g),
            };
        }
        let w = &self.param.w;
        let r = r.unwrap_or_else(|| self.forgetting_curve(t, s));
        let new_s = if t == 0 && self.param.enable_short_term {
            self.next_short_term_stability(s, g)
        } else if g == Rating::Again {
            let s_after_fail = self.next_forget_stability(d, s, r);
            let (w17, w18) = if self.param.enable_short_term {
                (w[17], w[18])
            } else {
                (0.0, 0.0)
            };
            let next_s_min = s / (w17 * w18).exp();
            clamp(round_to(next_s_min, 8), S_MIN, s_after_fail)
        } else {
            self.next_recall_stability(d, s, r, g)
        };
        MemoryState {
            difficulty: self.next_difficulty(d, g),
            stability: new_s,
        }
    }
}
