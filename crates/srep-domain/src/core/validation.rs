use regex::Regex;
use serde::Deserialize;
use std::sync::LazyLock;
use uuid::Uuid;

pub const MAX_FIELD_TEXT: usize = 50_000;
pub const MAX_CARDS_PER_MOVE: usize = 500;

static CONTROL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\p{Cc}").expect("control regex"));

pub fn parse_id(raw: &str) -> Option<String> {
    Uuid::parse_str(raw).ok().map(|u| u.to_string())
}

pub fn validate_deck_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.len() > 100
        || trimmed.contains("::")
        || trimmed.starts_with(':')
        || trimmed.ends_with(':')
        || CONTROL.is_match(trimmed)
    {
        return None;
    }
    Some(trimmed.to_string())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetInput {
    pub name: String,
    pub new_per_day: i32,
    pub reviews_per_day: i32,
    pub desired_retention: f64,
    pub learning_steps: Vec<i32>,
    pub relearning_steps: Vec<i32>,
    pub max_interval: i32,
    pub fsrs_params: Option<Vec<f64>>,
    pub bury_siblings: bool,
    pub new_order: String,
}

pub fn validate_preset(input: &PresetInput) -> bool {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 100 || CONTROL.is_match(name) {
        return false;
    }
    if !(0..=9999).contains(&input.new_per_day) || !(0..=9999).contains(&input.reviews_per_day) {
        return false;
    }
    if !(0.7..=0.99).contains(&input.desired_retention) {
        return false;
    }
    if !(1..=36_500).contains(&input.max_interval) {
        return false;
    }
    if input.new_order != "added" && input.new_order != "random" {
        return false;
    }
    if !validate_steps(&input.learning_steps) || !validate_steps(&input.relearning_steps) {
        return false;
    }
    match &input.fsrs_params {
        None => true,
        Some(p) => (19..=21).contains(&p.len()),
    }
}

fn validate_steps(steps: &[i32]) -> bool {
    steps.len() <= 10 && steps.iter().all(|&s| (1..=43_200).contains(&s))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeckCreateInput {
    pub name: String,
    pub parent_id: Option<String>,
    pub preset_id: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeckPatchInput {
    pub name: Option<String>,
    pub parent_id: Option<Option<String>>,
    pub preset_id: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "action", deny_unknown_fields)]
pub enum DeckDeleteInput {
    #[serde(rename = "move")]
    Move { target_deck_id: String },
    #[serde(rename = "trash")]
    Trash,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardsMoveInput {
    pub card_ids: Vec<String>,
    pub deck_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardIdsInput {
    pub card_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteCreateInput {
    pub note_type_id: String,
    pub deck_id: String,
    pub fields: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}
