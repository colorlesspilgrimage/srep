use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::core::validation::parse_id;
use crate::deps::DomainCtx;
use crate::http::{bad_request, error_response};
use crate::routes::auth::require_session;
use crate::service::note_types;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/note-types", get(list_note_types))
        .route(
            "/api/note-types/:id",
            get(get_note_type).delete(delete_note_type),
        )
}

async fn list_note_types(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let ctx = DomainCtx::new(&state);
    match note_types::list_note_types(&ctx).await {
        Ok(items) => Json(json!({"noteTypes": items})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn get_note_type(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let Some(id) = parse_id(&id) else {
        return bad_request();
    };
    let ctx = DomainCtx::new(&state);
    match note_types::get_note_type(&ctx, &id).await {
        Ok(nt) => Json(json!({"noteType": nt})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn delete_note_type(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let Some(id) = parse_id(&id) else {
        return bad_request();
    };
    let ctx = DomainCtx::new(&state);
    match note_types::delete_note_type(&ctx, &id).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error_response(e),
    }
}
