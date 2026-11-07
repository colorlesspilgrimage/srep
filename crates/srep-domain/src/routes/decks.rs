use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::core::validation::parse_id;
use crate::deps::DomainCtx;
use crate::http::{bad_request, error_response, parse_json_body};
use crate::routes::auth::require_session;
use crate::service::decks;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/decks", get(list_decks).post(create_deck))
        .route("/api/decks/counts", get(deck_counts))
        .route(
            "/api/decks/:id",
            get(get_deck).patch(update_deck).delete(delete_deck),
        )
        .route("/api/decks/:id/impact", get(deck_impact))
}

async fn list_decks(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let ctx = DomainCtx::new(&state);
    match decks::list_decks(&ctx).await {
        Ok(decks) => Json(json!({"decks": decks})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn create_deck(
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
    match decks::create_deck(&ctx, input).await {
        Ok(deck) => (StatusCode::CREATED, Json(json!({"deck": deck}))).into_response(),
        Err(e) => error_response(e),
    }
}

async fn get_deck(
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
    match decks::get_deck(&ctx, &id).await {
        Ok(deck) => Json(json!({"deck": deck})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn update_deck(
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
    match decks::update_deck(&ctx, &id, input).await {
        Ok(decks) => Json(json!({"decks": decks})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn delete_deck(
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
    match decks::delete_deck(&ctx, &id, input).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn deck_impact(
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
    match decks::deck_impact(&ctx, &id).await {
        Ok(impact) => Json(json!(impact)).into_response(),
        Err(e) => error_response(e),
    }
}

async fn deck_counts(req_auth: Option<axum::Extension<RequestAuth>>) -> axum::response::Response {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    Json(json!({"counts": {}})).into_response()
}
