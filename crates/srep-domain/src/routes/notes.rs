use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::core::validation::{parse_id, NoteRestoreInput};
use crate::deps::DomainCtx;
use crate::http::{bad_request, error_response, parse_json_body};
use crate::routes::auth::require_session;
use crate::service::notes;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/notes", post(create_note))
        .route("/api/notes/trash", get(list_trash))
        .route("/api/notes/preview", post(preview_note))
        .route(
            "/api/notes/:id",
            get(get_note).patch(update_note).delete(delete_note),
        )
        .route("/api/notes/:id/restore", post(restore_note))
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
    let Some(id) = parse_id(&id) else {
        return bad_request();
    };
    let ctx = DomainCtx::new(&state);
    match notes::get_note(&ctx, &id).await {
        Ok(note) => Json(json!({"note": note})).into_response(),
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
    let Some(id) = parse_id(&id) else {
        return bad_request();
    };
    let input = match parse_json_body(&headers, body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let ctx = DomainCtx::new(&state);
    match notes::update_note(&ctx, &id, input).await {
        Ok(note) => Json(json!({"note": note})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn delete_note(
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
    match notes::trash_note(&ctx, &id).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn list_trash(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let ctx = DomainCtx::new(&state);
    match notes::list_trash(&ctx).await {
        Ok(list) => Json(json!({"notes": list})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn preview_note(
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
    match notes::preview_note(&ctx, input).await {
        Ok(cards) => Json(json!({"cards": cards})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn restore_note(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let Some(id) = parse_id(&id) else {
        return bad_request();
    };
    let input: NoteRestoreInput = match parse_json_body(&headers, body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let ctx = DomainCtx::new(&state);
    match notes::restore_note(&ctx, &id, input.deck_id).await {
        Ok(note) => Json(json!({"note": note})).into_response(),
        Err(e) => error_response(e),
    }
}
