use crate::builtin::BUILTIN_NOTE_TYPE_IDS;
use crate::deps::DomainCtx;
use crate::error::{fail, ApiResult};
use crate::types::NoteTypeWithTemplates;

pub async fn list_note_types(ctx: &DomainCtx<'_>) -> ApiResult<Vec<NoteTypeWithTemplates>> {
    let store = ctx.store();
    store
        .ensure_seeded()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    store
        .list_note_types()
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))
}

pub async fn get_note_type(ctx: &DomainCtx<'_>, id: &str) -> ApiResult<NoteTypeWithTemplates> {
    let store = ctx.store();
    store
        .get_note_type(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))
}

pub async fn delete_note_type(ctx: &DomainCtx<'_>, id: &str) -> ApiResult<()> {
    if BUILTIN_NOTE_TYPE_IDS.contains(&id) {
        return Err(fail(axum::http::StatusCode::CONFLICT, "builtin_protected"));
    }
    let store = ctx.store();
    match store
        .delete_note_type_unless_used(id)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
    {
        "not_found" => Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found")),
        "in_use" => Err(fail(axum::http::StatusCode::CONFLICT, "in_use")),
        _ => Ok(()),
    }
}
