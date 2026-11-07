use crate::builtin::DEFAULT_PRESET_ID;
use crate::core::deck_paths::{plan_deck_create, plan_deck_update, DeckPatch};
use crate::core::ids::new_id;
use crate::core::validation::{validate_deck_name, DeckCreateInput, DeckDeleteInput, DeckPatchInput};
use crate::deps::DomainCtx;
use crate::error::{fail, ApiResult};
use crate::types::{DeckDeleteAction, DeckRow};

pub async fn list_decks(ctx: &DomainCtx<'_>) -> ApiResult<Vec<DeckRow>> {
    let store = ctx.store();
    store
        .ensure_seeded()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    store
        .list_decks()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))
}

pub async fn get_deck(ctx: &DomainCtx<'_>, id: &str) -> ApiResult<DeckRow> {
    let store = ctx.store();
    store
        .get_deck(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))
}

pub async fn create_deck(ctx: &DomainCtx<'_>, input: DeckCreateInput) -> ApiResult<DeckRow> {
    let name = validate_deck_name(&input.name)
        .ok_or_else(|| fail(axum::http::StatusCode::BAD_REQUEST, "bad_request"))?;
    let store = ctx.store();
    store
        .ensure_seeded()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    let decks = store
        .list_decks()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    let plan = plan_deck_create(&decks, &name, input.parent_id.as_deref())?;
    if let Some(ref preset_id) = input.preset_id {
        if store
            .get_preset(preset_id)
            .await
            .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
            .is_none()
        {
            return Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"));
        }
    }
    let deck = DeckRow {
        id: new_id(),
        parent_id: plan.parent.as_ref().map(|p| p.id.clone()),
        name: name.clone(),
        path: plan.path,
        preset_id: input
            .preset_id
            .or_else(|| plan.parent.as_ref().map(|p| p.preset_id.clone()))
            .unwrap_or_else(|| DEFAULT_PRESET_ID.to_string()),
        description: input.description.unwrap_or_default(),
        archived_at: None,
    };
    match store
        .insert_deck(&deck)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    {
        "name_taken" => Err(fail(axum::http::StatusCode::CONFLICT, "deck_name_taken")),
        _ => Ok(deck),
    }
}

pub async fn update_deck(
    ctx: &DomainCtx<'_>,
    id: &str,
    input: DeckPatchInput,
) -> ApiResult<Vec<DeckRow>> {
    let store = ctx.store();
    if let Some(ref preset_id) = input.preset_id {
        if store
            .get_preset(preset_id)
            .await
            .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
            .is_none()
        {
            return Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"));
        }
    }
    let decks = store
        .list_decks()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    let patch = DeckPatch {
        name: input.name,
        parent_id: input.parent_id,
        preset_id: input.preset_id,
        description: input.description,
    };
    let updates = plan_deck_update(&decks, id, &patch)?;
    store
        .apply_deck_updates(&updates)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    Ok(updates)
}

pub async fn deck_impact(
    ctx: &DomainCtx<'_>,
    id: &str,
) -> ApiResult<crate::types::DeckImpact> {
    let store = ctx.store();
    store
        .deck_impact(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))
}

pub async fn delete_deck(ctx: &DomainCtx<'_>, id: &str, input: DeckDeleteInput) -> ApiResult<()> {
    let action = match input {
        DeckDeleteInput::Move { target_deck_id } => DeckDeleteAction::Move { target_deck_id },
        DeckDeleteInput::Trash => DeckDeleteAction::Trash,
    };
    let store = ctx.store();
    let result = store
        .delete_deck_tree(id, action, ctx.now_ms())
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    match result {
        "not_found" | "target_not_found" => {
            Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"))
        }
        "target_in_subtree" => Err(fail(axum::http::StatusCode::CONFLICT, "deck_cycle")),
        _ => Ok(()),
    }
}
