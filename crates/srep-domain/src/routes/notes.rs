use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::deps::DomainCtx;
use crate::http::{error_response, parse_json_body};
use crate::routes::auth::require_session;
use crate::service::notes;
use crate::service::notes::UpdateNoteOutcome;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/notes", post(create_note))
        .route("/api/notes/:id", get(get_note).patch(update_note))
}

async fn create_note(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let input = match parse_json_body(&headers, body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let ctx = DomainCtx::new(&state);
    match notes::create_note(&ctx, input).await {
        Ok(note) => (StatusCode::CREATED, Json(json!({"note": note}))).into_response(),
        Err(e) => error_response(e),
    }
}

async fn get_note(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let ctx = DomainCtx::new(&state);
    match notes::get_note(&ctx, &id).await {
        Ok(Some(note)) => (StatusCode::OK, Json(json!({"note": note}))).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(e) => error_response(e),
    }
}

async fn update_note(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let input = match parse_json_body(&headers, body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let ctx = DomainCtx::new(&state);
    match notes::update_note(&ctx, &id, input).await {
        Ok(UpdateNoteOutcome::Updated(note)) => {
            (StatusCode::OK, Json(json!({"note": note}))).into_response()
        }
        Ok(UpdateNoteOutcome::Missing) => {
            (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response()
        }
        Ok(UpdateNoteOutcome::FieldCountMismatch) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "field_count_mismatch"})),
        )
            .into_response(),
        Err(e) => error_response(e),
    }
}
