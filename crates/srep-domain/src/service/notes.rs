use serde::Deserialize;

use crate::core::card_plan::{desired_cards, field_checksum};
use crate::core::ids::{new_id, random_token};
use crate::core::validation::{CardsMoveInput, NoteCreateInput};
use crate::deps::DomainCtx;
use crate::error::{fail, ApiResult};
use crate::types::{CardDraft, NoteRow};

pub async fn create_note(ctx: &DomainCtx<'_>, input: NoteCreateInput) -> ApiResult<NoteRow> {
    let store = ctx.store();
    let note_type = store
        .get_note_type(&input.note_type_id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    if store
        .get_deck(&input.deck_id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .is_none()
    {
        return Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"));
    }
    if input.fields.len() != note_type.fields.len() {
        return Err(fail(
            axum::http::StatusCode::BAD_REQUEST,
            "field_count_mismatch",
        ));
    }
    let now = ctx.now_ms();
    let checksum = field_checksum(
        input
            .fields
            .get(note_type.sort_field_idx as usize)
            .map(String::as_str)
            .unwrap_or(""),
    );
    let note = NoteRow {
        id: new_id(),
        note_type_id: note_type.id.clone(),
        guid: random_token(12),
        fields: input.fields.clone(),
        created_at: now,
        updated_at: now,
        checksum,
        deleted_at: None,
    };
    let desired = desired_cards(&note_type, &input.fields);
    let cards: Vec<CardDraft> = desired
        .into_iter()
        .map(|d| CardDraft {
            id: new_id(),
            template_id: d.template_id,
            ordinal: d.ordinal,
            deck_id: input.deck_id.clone(),
        })
        .collect();
    store
        .insert_note(&note, &input.tags, &cards, now)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    Ok(note)
}

pub async fn move_cards(ctx: &DomainCtx<'_>, input: CardsMoveInput) -> ApiResult<()> {
    let store = ctx.store();
    match store
        .move_cards(&input.card_ids, &input.deck_id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    {
        "deck_not_found" | "card_not_found" => {
            Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"))
        }
        _ => Ok(()),
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateNoteInput {
    pub fields: Vec<String>,
    // Accepted for wire compatibility. Tags are not changed by this endpoint;
    // supplying them leaves the existing note-tag rows unchanged.
    #[serde(default)]
    #[allow(dead_code)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug)]
pub enum UpdateNoteOutcome {
    Updated(NoteRow),
    Missing,
    FieldCountMismatch,
}

pub async fn get_note(ctx: &DomainCtx<'_>, id: &str) -> ApiResult<Option<NoteRow>> {
    ctx.store()
        .get_note(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))
}

pub async fn update_note(
    ctx: &DomainCtx<'_>,
    id: &str,
    input: UpdateNoteInput,
) -> ApiResult<UpdateNoteOutcome> {
    let store = ctx.store();
    let Some(note) = store
        .get_note(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    else {
        return Ok(UpdateNoteOutcome::Missing);
    };
    let Some(note_type) = store
        .get_note_type(&note.note_type_id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    else {
        return Ok(UpdateNoteOutcome::Missing);
    };

    if input.fields.len() != note_type.fields.len() {
        return Ok(UpdateNoteOutcome::FieldCountMismatch);
    }

    let checksum = field_checksum(
        input
            .fields
            .get(note_type.sort_field_idx as usize)
            .map(String::as_str)
            .unwrap_or(""),
    );
    let now = ctx.now_ms();

    let updated = store
        .update_note_fields(id, &input.fields, &checksum, now)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;

    match updated {
        Some(note) => Ok(UpdateNoteOutcome::Updated(note)),
        None => Ok(UpdateNoteOutcome::Missing),
    }
}
