use crate::metrics::{compute_retention, ReviewRow};
use srep_domain::types::PresetRow;
use srep_study::sched::{check_parameters, generator_parameters, DEFAULT_W};
use serde::Serialize;

pub const MIN_REVIEWS_FOR_OPTIMIZE: u32 = 50;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizerPreview {
    pub review_count: u32,
    pub current: OptimizerCurrent,
    pub proposed: OptimizerProposed,
    pub retention: OptimizerRetention,
    pub preview_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizerCurrent {
    pub desired_retention: f64,
    pub fsrs_params: Option<Vec<f64>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizerProposed {
    pub desired_retention: f64,
    pub fsrs_params: Vec<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizerRetention {
    pub true_retention: Option<f64>,
    pub mature_reviews: u32,
}

fn clamp_retention(value: f64) -> f64 {
    value.clamp(0.7, 0.99)
}

pub fn build_proposed_params(
    preset: &PresetRow,
    rows: &[ReviewRow],
) -> Result<(f64, Vec<f64>), &'static str> {
    let stats = compute_retention(rows, preset.desired_retention, Some(&preset.id));
    let empirical = stats.true_retention.unwrap_or(preset.desired_retention);
    let blend = clamp_retention(empirical * 0.85 + preset.desired_retention * 0.15);
    let base_w = preset.fsrs_params.clone().unwrap_or_else(|| DEFAULT_W.to_vec());
    check_parameters(&base_w).map_err(|_| "bad_preset")?;
    let learning: Vec<u32> = preset.learning_steps.iter().map(|s| *s as u32).collect();
    let relearning: Vec<u32> = preset.relearning_steps.iter().map(|s| *s as u32).collect();
    let params = generator_parameters(
        blend,
        preset.max_interval,
        &learning,
        &relearning,
        Some(&base_w),
        true,
    );
    Ok((blend, params.w))
}

pub fn preview_optimizer(
    preset: &PresetRow,
    review_count: u32,
    rows: &[ReviewRow],
    preview_token: String,
) -> Result<OptimizerPreview, &'static str> {
    if review_count < MIN_REVIEWS_FOR_OPTIMIZE {
        return Err("insufficient_reviews");
    }
    let (desired, fsrs_params) = build_proposed_params(preset, rows)?;
    let retention = compute_retention(rows, preset.desired_retention, Some(&preset.id));
    Ok(OptimizerPreview {
        review_count,
        current: OptimizerCurrent {
            desired_retention: preset.desired_retention,
            fsrs_params: preset.fsrs_params.clone(),
        },
        proposed: OptimizerProposed {
            desired_retention: desired,
            fsrs_params,
        },
        retention: OptimizerRetention {
            true_retention: retention.true_retention,
            mature_reviews: retention.mature_reviews,
        },
        preview_token,
    })
}
