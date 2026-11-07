use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::deps::DomainCtx;
use crate::http::{error_response, parse_json_body};
use crate::routes::auth::require_session;
use crate::service::notes;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/notes", post(create_note))
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
