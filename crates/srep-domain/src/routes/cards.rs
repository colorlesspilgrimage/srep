use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::deps::DomainCtx;
use crate::http::{error_response, parse_json_body};
use crate::routes::auth::require_session;
use crate::service::cards;
use crate::service::notes;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/cards/move", post(move_cards))
        .route("/api/cards/suspend", post(suspend_cards))
        .route("/api/cards/unsuspend", post(unsuspend_cards))
        .route("/api/cards/bury", post(bury_cards))
}

async fn move_cards(
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
    match notes::move_cards(&ctx, input).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn suspend_cards(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    card_op(req_auth, headers, body, &state, cards::suspend_cards).await
}

async fn unsuspend_cards(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    card_op(req_auth, headers, body, &state, cards::unsuspend_cards).await
}

async fn bury_cards(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    card_op(req_auth, headers, body, &state, cards::bury_cards).await
}

async fn card_op<F, Fut>(
    req_auth: Option<axum::Extension<RequestAuth>>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
    state: &AppState,
    op: F,
) -> axum::response::Response
where
    F: FnOnce(&DomainCtx<'_>, crate::core::validation::CardIdsInput) -> Fut,
    Fut: std::future::Future<Output = crate::error::ApiResult<()>>,
{
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let input = match parse_json_body(&headers, body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let ctx = DomainCtx::new(state);
    match op(&ctx, input).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error_response(e),
    }
}
