use crate::types::*;
use anyhow::{Context, Result};
use sqlx::Row;

pub struct PresetDbJson {
    pub learning_steps: String,
    pub relearning_steps: String,
    pub fsrs_params: String,
}

pub fn preset_to_db(row: &PresetRow) -> Result<PresetDbJson> {
    Ok(PresetDbJson {
        learning_steps: serde_json::to_string(&row.learning_steps)?,
        relearning_steps: serde_json::to_string(&row.relearning_steps)?,
        fsrs_params: serde_json::to_string(&row.fsrs_params)?,
    })
}

pub fn row_to_preset(row: &sqlx::sqlite::SqliteRow) -> Result<PresetRow> {
    row_to_preset_generic(row)
}

pub fn row_to_preset_pg(row: &sqlx::postgres::PgRow) -> Result<PresetRow> {
    row_to_preset_generic(row)
}

fn row_to_preset_generic<R: Row>(row: &R) -> Result<PresetRow> {
    let learning: String = row.try_get("learning_steps")?;
    let relearning: String = row.try_get("relearning_steps")?;
    let fsrs: String = row.try_get("fsrs_params")?;
    Ok(PresetRow {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        new_per_day: row.try_get("new_per_day")?,
        reviews_per_day: row.try_get("reviews_per_day")?,
        desired_retention: row.try_get("desired_retention")?,
        learning_steps: serde_json::from_str(&learning)?,
        relearning_steps: serde_json::from_str(&relearning)?,
        max_interval: row.try_get("max_interval")?,
        fsrs_params: serde_json::from_str(&fsrs).unwrap_or(None),
        bury_siblings: row.try_get("bury_siblings")?,
        new_order: row.try_get("new_order")?,
    })
}

pub fn row_to_deck(row: &sqlx::sqlite::SqliteRow) -> Result<DeckRow> {
    row_to_deck_generic(row)
}

pub fn row_to_deck_pg(row: &sqlx::postgres::PgRow) -> Result<DeckRow> {
    row_to_deck_generic(row)
}

fn row_to_deck_generic<R: Row>(row: &R) -> Result<DeckRow> {
    Ok(DeckRow {
        id: row.try_get("id")?,
        parent_id: row.try_get("parent_id")?,
        name: row.try_get("name")?,
        path: row.try_get("path")?,
        preset_id: row.try_get("preset_id")?,
        description: row.try_get("description")?,
        archived_at: row.try_get("archived_at")?,
    })
}

pub fn row_to_note_type<R: Row>(row: &R) -> Result<NoteTypeRow> {
    let fields: String = row.try_get("fields")?;
    Ok(NoteTypeRow {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        fields: serde_json::from_str(&fields)?,
        css_class: row.try_get("css_class")?,
        sort_field_idx: row.try_get("sort_field_idx")?,
    })
}

pub fn row_to_template<R: Row>(row: &R) -> Result<TemplateRow> {
    Ok(TemplateRow {
        id: row.try_get("id")?,
        note_type_id: row.try_get("note_type_id")?,
        name: row.try_get("name")?,
        ordinal: row.try_get("ordinal")?,
        front_tpl: row.try_get("front_tpl")?,
        back_tpl: row.try_get("back_tpl")?,
    })
}

pub fn row_to_note<R: Row>(row: &R) -> Result<NoteRow> {
    let fields: String = row.try_get("fields")?;
    Ok(NoteRow {
        id: row.try_get("id")?,
        note_type_id: row.try_get("note_type_id")?,
        guid: row.try_get("guid")?,
        fields: serde_json::from_str(&fields)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        checksum: row.try_get("checksum")?,
        deleted_at: row.try_get("deleted_at")?,
    })
}

pub fn row_to_card<R: Row>(row: &R) -> Result<CardRow> {
    Ok(CardRow {
        id: row.try_get("id")?,
        note_id: row.try_get("note_id")?,
        template_id: row.try_get("template_id")?,
        ordinal: row.try_get("ordinal")?,
        deck_id: row.try_get("deck_id")?,
        state: row.try_get("state")?,
        due: row.try_get("due")?,
        stability: row.try_get("stability")?,
        difficulty: row.try_get("difficulty")?,
        last_review: row.try_get("last_review")?,
        reps: row.try_get("reps")?,
        lapses: row.try_get("lapses")?,
        position: row.try_get("position")?,
        buried_until: row.try_get("buried_until")?,
        flags: row.try_get("flags")?,
        sched_state: row.try_get("sched_state")?,
        learning_step: row.try_get("learning_step")?,
    })
}

pub fn row_to_media<R: Row>(row: &R) -> Result<MediaRow> {
    Ok(MediaRow {
        id: row.try_get("id")?,
        sha256: row.try_get("sha256")?,
        mime: row.try_get("mime")?,
        size: row.try_get("size")?,
        original_name: row.try_get("original_name")?,
    })
}

pub fn is_unique_violation(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(db) => {
            let code = db.code().map(|c| c.to_string());
            code.as_deref() == Some("2067")
                || code.as_deref() == Some("1555")
                || db.message().contains("unique")
                || db.message().contains("duplicate")
        }
        _ => false,
    }
}
