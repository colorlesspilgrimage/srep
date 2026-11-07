use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::core::validation::parse_id;
use crate::deps::DomainCtx;
use crate::http::{bad_request, error_response, parse_json_body};
use crate::routes::auth::require_session;
use crate::service::presets;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/presets", get(list_presets).post(create_preset))
        .route("/api/presets/:id", delete(delete_preset).put(update_preset))
}

async fn list_presets(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let ctx = DomainCtx::new(&state);
    match presets::list_presets(&ctx).await {
        Ok(presets) => Json(json!({"presets": presets})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn create_preset(
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
    match presets::create_preset(&ctx, input).await {
        Ok(preset) => (StatusCode::CREATED, Json(json!({"preset": preset}))).into_response(),
        Err(e) => error_response(e),
    }
}

async fn update_preset(
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
    match presets::update_preset(&ctx, &id, input).await {
        Ok(preset) => Json(json!({"preset": preset})).into_response(),
        Err(e) => error_response(e),
    }
}

async fn delete_preset(
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
    match presets::delete_preset(&ctx, &id).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error_response(e),
    }
}
