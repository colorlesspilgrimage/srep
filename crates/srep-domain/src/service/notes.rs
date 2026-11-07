use crate::core::card_plan::{desired_cards, field_checksum, reconcile, DesiredCard};
use crate::core::ids::{new_id, random_token};
use crate::core::tags::normalize_tags;
use crate::core::validation::{
    CardsMoveInput, NoteCreateInput, NotePatchInput, NotePreviewInput, MAX_FIELD_TEXT,
};
use crate::deps::DomainCtx;
use crate::error::{fail, ApiResult};
use crate::store::notes::NoteChange;
use crate::types::{CardDraft, NoteRow, NoteTypeWithTemplates};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteView {
    pub id: String,
    pub note_type_id: String,
    pub guid: String,
    pub fields: Vec<String>,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub cards: Vec<CardView>,
    pub duplicates: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardView {
    pub id: String,
    pub template_id: String,
    pub template_name: String,
    pub ordinal: i32,
    pub deck_id: Option<String>,
    pub state: String,
    pub position: i32,
    pub flags: i32,
    pub front: String,
    pub back: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCard {
    pub template_name: String,
    pub ordinal: i32,
    pub front: String,
    pub back: String,
}

fn checksum_of(note_type: &NoteTypeWithTemplates, fields: &[String]) -> String {
    field_checksum(
        fields
            .get(note_type.sort_field_idx as usize)
            .map(String::as_str)
            .unwrap_or(""),
    )
}

async fn note_view(
    ctx: &DomainCtx<'_>,
    note_type: &NoteTypeWithTemplates,
    id: &str,
) -> ApiResult<NoteView> {
    let store = ctx.store();
    let state = store
        .get_note_state(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    let duplicates = if state.note.deleted_at.is_none() {
        store
            .find_note_ids_by_checksum(&note_type.id, &state.note.checksum, Some(id))
            .await
            .unwrap_or_default()
    } else {
        vec![]
    };
    let cards = state
        .cards
        .iter()
        .map(|card| {
            let template = note_type
                .templates
                .iter()
                .find(|t| t.id == card.template_id);
            CardView {
                id: card.id.clone(),
                template_id: card.template_id.clone(),
                template_name: template.map(|t| t.name.clone()).unwrap_or_default(),
                ordinal: card.ordinal,
                deck_id: card.deck_id.clone(),
                state: card.state.clone(),
                position: card.position,
                flags: card.flags,
                front: String::new(),
                back: String::new(),
            }
        })
        .collect();
    Ok(NoteView {
        id: state.note.id,
        note_type_id: state.note.note_type_id,
        guid: state.note.guid,
        fields: state.note.fields,
        tags: state.tags,
        created_at: state.note.created_at,
        updated_at: state.note.updated_at,
        deleted_at: state.note.deleted_at,
        cards,
        duplicates,
    })
}

pub async fn create_note(ctx: &DomainCtx<'_>, input: NoteCreateInput) -> ApiResult<NoteView> {
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
    if input.fields.len() != note_type.fields.len()
        || input
            .fields
            .iter()
            .any(|f| f.len() > MAX_FIELD_TEXT || f.contains('\0'))
    {
        return Err(fail(
            axum::http::StatusCode::BAD_REQUEST,
            "field_count_mismatch",
        ));
    }
    let tags = normalize_tags(&input.tags)
        .ok_or_else(|| fail(axum::http::StatusCode::BAD_REQUEST, "invalid_tag"))?;
    let now = ctx.now_ms();
    let checksum = checksum_of(&note_type, &input.fields);
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
        .insert_note(&note, &tags, &cards, now)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    note_view(ctx, &note_type, &note.id).await
}

pub async fn get_note(ctx: &DomainCtx<'_>, id: &str) -> ApiResult<NoteView> {
    let store = ctx.store();
    let state = store
        .get_note_state(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    let note_type = store
        .get_note_type(&state.note.note_type_id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    note_view(ctx, &note_type, id).await
}

pub async fn update_note(
    ctx: &DomainCtx<'_>,
    id: &str,
    patch: NotePatchInput,
) -> ApiResult<NoteView> {
    let store = ctx.store();
    let current = store
        .get_note_state(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    if current.note.deleted_at.is_some() {
        return Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"));
    }
    let note_type = store
        .get_note_type(&current.note.note_type_id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    let fields = patch.fields.unwrap_or(current.note.fields);
    let tags_in = patch.tags.unwrap_or(current.tags);
    if fields.len() != note_type.fields.len()
        || fields
            .iter()
            .any(|f| f.len() > MAX_FIELD_TEXT || f.contains('\0'))
    {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "field_count_mismatch"));
    }
    let tags = normalize_tags(&tags_in)
        .ok_or_else(|| fail(axum::http::StatusCode::BAD_REQUEST, "invalid_tag"))?;
    if let Some(ref deck_id) = patch.deck_id {
        if store
            .get_deck(deck_id)
            .await
            .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
            .is_none()
        {
            return Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"));
        }
    }
    let desired = desired_cards(&note_type, &fields);
    let plan = reconcile(&desired, &current.cards);
    let home = current
        .cards
        .iter()
        .find_map(|c| c.deck_id.clone())
        .or(patch.deck_id);
    if !plan.create.is_empty() && home.is_none() {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "deck_required"));
    }
    let now = ctx.now_ms();
    let create: Vec<CardDraft> = plan
        .create
        .into_iter()
        .map(|c: DesiredCard| CardDraft {
            id: new_id(),
            template_id: c.template_id,
            ordinal: c.ordinal,
            deck_id: home.clone().unwrap(),
        })
        .collect();
    let change = NoteChange {
        fields: fields.clone(),
        checksum: checksum_of(&note_type, &fields),
        updated_at: now,
        tags,
        create,
        delete_ids: plan.delete_ids,
        orphan_ids: plan.orphan_ids,
        unorphan_ids: plan.unorphan_ids,
    };
    let result = store.update_note(id, change).await.map_err(|_| {
        fail(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "bad_request",
        )
    })?;
    if result == "not_found" {
        return Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"));
    }
    note_view(ctx, &note_type, id).await
}

pub async fn trash_note(ctx: &DomainCtx<'_>, id: &str) -> ApiResult<()> {
    let store = ctx.store();
    let ok = store
        .trash_note(id, ctx.now_ms())
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    if ok {
        Ok(())
    } else {
        Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"))
    }
}

pub async fn list_trash(
    ctx: &DomainCtx<'_>,
) -> ApiResult<Vec<crate::types::TrashedNoteSummary>> {
    let store = ctx.store();
    store
        .list_trashed_notes()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))
}

pub async fn restore_note(
    ctx: &DomainCtx<'_>,
    id: &str,
    deck_id: Option<String>,
) -> ApiResult<NoteView> {
    let store = ctx.store();
    let result = store
        .restore_note(id, deck_id.as_deref(), ctx.now_ms())
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    match result {
        "deck_required" => Err(fail(axum::http::StatusCode::BAD_REQUEST, "deck_required")),
        "not_found" | "deck_not_found" | "not_trashed" => {
            Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"))
        }
        _ => get_note(ctx, id).await,
    }
}

pub async fn preview_note(
    ctx: &DomainCtx<'_>,
    input: NotePreviewInput,
) -> ApiResult<Vec<PreviewCard>> {
    let store = ctx.store();
    let note_type = store
        .get_note_type(&input.note_type_id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    if input.fields.len() != note_type.fields.len()
        || input
            .fields
            .iter()
            .any(|f| f.len() > MAX_FIELD_TEXT || f.contains('\0'))
    {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "bad_request"));
    }
    let desired = desired_cards(&note_type, &input.fields);
    let cards = desired
        .into_iter()
        .map(|d| {
            let template = note_type
                .templates
                .iter()
                .find(|t| t.id == d.template_id);
            PreviewCard {
                template_name: template.map(|t| t.name.clone()).unwrap_or_default(),
                ordinal: d.ordinal,
                front: String::new(),
                back: String::new(),
            }
        })
        .collect();
    Ok(cards)
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
