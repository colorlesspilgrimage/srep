use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde_json::json;

use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/decks", get(list_decks))
        .route("/api/decks/counts", get(deck_counts))
        .route("/api/notes", get(list_notes_stub))
        .route("/api/note-types", get(list_note_types_stub))
        .route("/api/presets", get(list_presets_stub))
}

async fn list_decks(
    _state: State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    let Some(axum::Extension(auth)) = req_auth else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    Json(json!({"decks": []})).into_response()
}

async fn deck_counts(
    _state: State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    let Some(axum::Extension(auth)) = req_auth else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    Json(json!({"counts": {}})).into_response()
}

async fn list_notes_stub(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    unauthorized_unless_session(req_auth).await
}

async fn list_note_types_stub(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    unauthorized_unless_session(req_auth).await
}

async fn list_presets_stub(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    unauthorized_unless_session(req_auth).await
}

async fn unauthorized_unless_session(
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> axum::response::Response {
    let Some(axum::Extension(auth)) = req_auth else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    Json(json!({"items": []})).into_response()
}
