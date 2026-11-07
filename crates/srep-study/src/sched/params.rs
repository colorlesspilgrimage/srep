//! FSRS parameters (ts-fsrs `default.ts` / `constant.ts`).

use super::models::StepUnit;

pub const S_MIN: f64 = 0.001;
pub const S_MAX: f64 = 36500.0;
pub const INIT_S_MAX: f64 = 100.0;
pub const FSRS5_DEFAULT_DECAY: f64 = 0.5;
pub const FSRS6_DEFAULT_DECAY: f64 = 0.1542;
pub const W17_W18_CEILING: f64 = 2.0;

pub const DEFAULT_W: [f64; 21] = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
    0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, FSRS6_DEFAULT_DECAY,
];

#[derive(Debug, Clone)]
pub struct FsrsParameters {
    pub request_retention: f64,
    pub maximum_interval: i32,
    pub w: Vec<f64>,
    pub enable_fuzz: bool,
    pub enable_short_term: bool,
    pub learning_steps: Vec<StepUnit>,
    pub relearning_steps: Vec<StepUnit>,
}

fn clamp_parameters_bounds(enable_short_term: bool) -> Vec<(f64, f64)> {
    vec![
        (S_MIN, INIT_S_MAX),
        (S_MIN, INIT_S_MAX),
        (S_MIN, INIT_S_MAX),
        (S_MIN, INIT_S_MAX),
        (1.0, 10.0),
        (0.001, 4.0),
        (0.001, 4.0),
        (0.001, 0.75),
        (0.0, 4.5),
        (0.0, 0.8),
        (0.001, 3.5),
        (0.001, 5.0),
        (0.001, 0.25),
        (0.001, 0.9),
        (0.0, 4.0),
        (0.0, 1.0),
        (1.0, 6.0),
        (0.0, W17_W18_CEILING),
        (0.0, W17_W18_CEILING),
        (
            if enable_short_term { 0.01 } else { 0.0 },
            0.8,
        ),
        (0.1, 0.8),
    ]
}

fn clamp_val(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max)
}

pub fn clip_parameters(
    parameters: &[f64],
    num_relearning_steps: usize,
    enable_short_term: bool,
) -> Vec<f64> {
    let clip = clamp_parameters_bounds(enable_short_term);
    let mut params: Vec<f64> = parameters
        .iter()
        .enumerate()
        .map(|(i, &p)| {
            let (min, max) = clip.get(i).copied().unwrap_or((f64::MIN, f64::MAX));
            clamp_val(p, min, max)
        })
        .collect();
    if num_relearning_steps > 1 && params.len() > 18 {
        let w11 = clamp_val(params[11], clip[11].0, clip[11].1);
        let w13 = clamp_val(params[13], clip[13].0, clip[13].1);
        let w14 = clamp_val(params[14], clip[14].0, clip[14].1);
        let value = -(w11.ln() + (2.0_f64.powf(w13) - 1.0).ln() + w14 * 0.3)
            / num_relearning_steps as f64;
        let w17_w18_ceiling = clamp_val(value.sqrt().max(0.0), 0.01, W17_W18_CEILING);
        if params.len() > 17 {
            params[17] = params[17].clamp(clip[17].0, w17_w18_ceiling);
        }
        if params.len() > 18 {
            params[18] = params[18].clamp(clip[18].0, w17_w18_ceiling);
        }
    }
    params
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct ParamError(pub String);

pub fn check_parameters(parameters: &[f64]) -> Result<(), ParamError> {
    if parameters.iter().any(|p| !p.is_finite()) {
        return Err(ParamError(format!(
            "Non-finite or NaN value in parameters {:?}",
            parameters
        )));
    }
    if ![17, 19, 21].contains(&parameters.len()) {
        return Err(ParamError(format!(
            "Invalid parameter length: {}. Must be 17, 19 or 21 for FSRSv4, 5 and 6 respectively.",
            parameters.len()
        )));
    }
    Ok(())
}

pub fn migrate_parameters(
    parameters: Option<&[f64]>,
    num_relearning_steps: usize,
    enable_short_term: bool,
) -> Vec<f64> {
    let Some(parameters) = parameters else {
        return DEFAULT_W.to_vec();
    };
    match parameters.len() {
        21 => clip_parameters(parameters, num_relearning_steps, enable_short_term),
        19 => {
            let mut w = clip_parameters(parameters, num_relearning_steps, enable_short_term);
            w.extend([0.0, FSRS5_DEFAULT_DECAY]);
            w
        }
        17 => {
            let mut w = clip_parameters(parameters, num_relearning_steps, enable_short_term);
            if w.len() > 6 {
                w[4] = ((w[5] * 2.0 + w[4]) * 1e8).round() / 1e8;
                w[5] = ((w[5] * 3.0 + 1.0).ln() / 3.0 * 1e8).round() / 1e8;
                w[6] = ((w[6] + 0.5) * 1e8).round() / 1e8;
            }
            w.extend([0.0, 0.0, 0.0, FSRS5_DEFAULT_DECAY]);
            w
        }
        _ => DEFAULT_W.to_vec(),
    }
}

pub fn minutes_to_step(minutes: u32) -> StepUnit {
    StepUnit(format!("{}m", minutes.max(1)))
}

pub fn generator_parameters(
    desired_retention: f64,
    max_interval: i32,
    learning_minutes: &[u32],
    relearning_minutes: &[u32],
    fsrs_params: Option<&[f64]>,
    enable_short_term: bool,
) -> FsrsParameters {
    let learning_steps: Vec<_> = if learning_minutes.is_empty() {
        vec![StepUnit("1m".into()), StepUnit("10m".into())]
    } else {
        learning_minutes.iter().map(|&m| minutes_to_step(m)).collect()
    };
    let relearning_steps: Vec<_> = if relearning_minutes.is_empty() {
        vec![StepUnit("10m".into())]
    } else {
        relearning_minutes
            .iter()
            .map(|&m| minutes_to_step(m))
            .collect()
    };
    let w = migrate_parameters(
        fsrs_params,
        relearning_steps.len(),
        enable_short_term,
    );
    FsrsParameters {
        request_retention: desired_retention,
        maximum_interval: max_interval,
        w: clip_parameters(&w, relearning_steps.len(), enable_short_term),
        enable_fuzz: false,
        enable_short_term,
        learning_steps,
        relearning_steps,
    }
}
