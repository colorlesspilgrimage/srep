use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetRow {
    pub id: String,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckRow {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub path: String,
    pub preset_id: String,
    pub description: String,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTypeRow {
    pub id: String,
    pub name: String,
    pub fields: Vec<String>,
    pub css_class: String,
    pub sort_field_idx: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRow {
    pub id: String,
    pub note_type_id: String,
    pub name: String,
    pub ordinal: i32,
    pub front_tpl: String,
    pub back_tpl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTypeWithTemplates {
    pub id: String,
    pub name: String,
    pub fields: Vec<String>,
    pub css_class: String,
    pub sort_field_idx: i32,
    pub templates: Vec<TemplateRow>,
}

impl NoteTypeWithTemplates {
    pub fn from_parts(note_type: NoteTypeRow, templates: Vec<TemplateRow>) -> Self {
        Self {
            id: note_type.id,
            name: note_type.name,
            fields: note_type.fields,
            css_class: note_type.css_class,
            sort_field_idx: note_type.sort_field_idx,
            templates,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRow {
    pub id: String,
    pub note_type_id: String,
    pub guid: String,
    pub fields: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub checksum: String,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardRow {
    pub id: String,
    pub note_id: String,
    pub template_id: String,
    pub ordinal: i32,
    pub deck_id: Option<String>,
    pub state: String,
    pub due: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub last_review: Option<i64>,
    pub reps: i32,
    pub lapses: i32,
    pub position: i32,
    pub buried_until: Option<i64>,
    pub flags: i32,
    pub sched_state: String,
    pub learning_step: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRow {
    pub id: String,
    pub sha256: String,
    pub mime: String,
    pub size: i64,
    pub original_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaView {
    #[serde(flatten)]
    pub row: MediaRow,
    pub created: bool,
}

#[derive(Debug, Clone)]
pub struct CardDraft {
    pub id: String,
    pub template_id: String,
    pub ordinal: i32,
    pub deck_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckImpact {
    pub decks: i32,
    pub cards: i32,
    pub notes: i32,
}

#[derive(Debug, Clone)]
pub struct NoteState {
    pub note: NoteRow,
    pub tags: Vec<String>,
    pub cards: Vec<CardRow>,
}

#[derive(Debug, Clone)]
pub struct SeedInput {
    pub preset: PresetRow,
    pub note_types: Vec<NoteTypeWithTemplates>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedNoteSummary {
    pub id: String,
    pub preview: String,
    pub deleted_at: i64,
}

pub enum DeckDeleteAction {
    Move { target_deck_id: String },
    Trash,
}
