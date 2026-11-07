use crate::builtin::DEFAULT_PRESET_ID;
use crate::core::ids::new_id;
use crate::core::validation::{validate_preset, PresetInput};
use crate::deps::DomainCtx;
use crate::error::{fail, ApiResult};
use crate::types::PresetRow;

pub async fn list_presets(ctx: &DomainCtx<'_>) -> ApiResult<Vec<PresetRow>> {
    let store = ctx.store();
    store
        .ensure_seeded()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    store
        .list_presets()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))
}

pub async fn create_preset(ctx: &DomainCtx<'_>, input: PresetInput) -> ApiResult<PresetRow> {
    if !validate_preset(&input) {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "bad_request"));
    }
    let preset = preset_from_input(new_id(), input);
    let store = ctx.store();
    match store
        .insert_preset(&preset)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    {
        "name_taken" => Err(fail(axum::http::StatusCode::CONFLICT, "name_taken")),
        _ => Ok(preset),
    }
}

pub async fn update_preset(
    ctx: &DomainCtx<'_>,
    id: &str,
    input: PresetInput,
) -> ApiResult<PresetRow> {
    if !validate_preset(&input) {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "bad_request"));
    }
    let preset = preset_from_input(id.to_string(), input);
    let store = ctx.store();
    match store
        .update_preset(&preset)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    {
        "not_found" => Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found")),
        "name_taken" => Err(fail(axum::http::StatusCode::CONFLICT, "name_taken")),
        _ => Ok(preset),
    }
}

pub async fn delete_preset(ctx: &DomainCtx<'_>, id: &str) -> ApiResult<()> {
    if id == DEFAULT_PRESET_ID {
        return Err(fail(axum::http::StatusCode::CONFLICT, "builtin_protected"));
    }
    let store = ctx.store();
    match store
        .delete_preset_unless_used(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    {
        "not_found" => Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found")),
        "in_use" => Err(fail(axum::http::StatusCode::CONFLICT, "in_use")),
        _ => Ok(()),
    }
}

fn preset_from_input(id: String, input: PresetInput) -> PresetRow {
    PresetRow {
        id,
        name: input.name.trim().to_string(),
        new_per_day: input.new_per_day,
        reviews_per_day: input.reviews_per_day,
        desired_retention: input.desired_retention,
        learning_steps: input.learning_steps,
        relearning_steps: input.relearning_steps,
        max_interval: input.max_interval,
        fsrs_params: input.fsrs_params,
        bury_siblings: input.bury_siblings,
        new_order: input.new_order,
    }
}
