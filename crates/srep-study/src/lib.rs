use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

pub mod fsrs_engine;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/study/next", get(study_next))
        .route("/api/study/answer", post(study_answer))
        .route("/api/study/undo", post(study_undo))
        .route("/api/study/rebuild", post(study_rebuild))
        .route("/api/study/verify", post(study_verify))
}

async fn study_next(
    _state: State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    (
        StatusCode::OK,
        Json(json!({"card": null, "finished": true})),
    )
        .into_response()
}

async fn study_answer(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({"error":"not_implemented"})),
    )
        .into_response()
}

async fn study_undo(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({"error":"not_implemented"})),
    )
        .into_response()
}

async fn study_rebuild(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({"error":"not_implemented"})),
    )
        .into_response()
}

async fn study_verify(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({"error":"not_implemented"})),
    )
        .into_response()
}

async fn require_auth(
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> Option<axum::response::Response> {
    let Some(axum::Extension(auth)) = req_auth else {
        return Some(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"unauthorized"})),
            )
                .into_response(),
        );
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return Some(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"unauthorized"})),
            )
                .into_response(),
        );
    }
    None
}
