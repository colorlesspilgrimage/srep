mod display;
pub mod keybinds;
pub mod store;
pub mod theme;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use srep_auth::http_util::{error_response, read_json, unauthenticated};
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

pub use display::DisplayPrefs;
pub use keybinds::KeybindMap;
pub use store::SettingsStore;
pub use theme::ThemeSettings;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/settings/theme", get(theme_get).put(theme_put))
        .route("/api/settings/keybinds", get(keybinds_get).put(keybinds_put))
        .route("/api/settings/display", get(display_get).put(display_put))
}

fn require_session(req_auth: Option<axum::Extension<RequestAuth>>) -> Option<axum::response::Response> {
    let Some(axum::Extension(auth)) = req_auth else {
        return Some(unauthenticated());
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return Some(unauthenticated());
    }
    None
}

async fn theme_get(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let store = store::SettingsStore::new(&state.db);
    match theme::get_theme(&store).await {
        Ok(id) => Json(json!({ "id": id })).into_response(),
        Err(code) => error_response(StatusCode::INTERNAL_SERVER_ERROR, code),
    }
}

async fn theme_put(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let input: ThemeSettings = match read_json(&body).await {
        Ok(v) => v,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "bad_request"),
    };
    let store = store::SettingsStore::new(&state.db);
    match theme::put_theme(&store, &input.id).await {
        Ok(id) => Json(json!({ "id": id })).into_response(),
        Err(code) => error_response(StatusCode::BAD_REQUEST, code),
    }
}

async fn keybinds_get(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let store = store::SettingsStore::new(&state.db);
    match keybinds::get_keybinds(&store).await {
        Ok(map) => Json(json!({ "keybinds": map })).into_response(),
        Err(code) => error_response(StatusCode::INTERNAL_SERVER_ERROR, code),
    }
}

async fn keybinds_put(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let value: serde_json::Value = match read_json(&body).await {
        Ok(v) => v,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "bad_request"),
    };
    let store = store::SettingsStore::new(&state.db);
    match keybinds::put_keybinds(&store, value).await {
        Ok(map) => Json(json!({ "keybinds": map })).into_response(),
        Err(code) => error_response(StatusCode::BAD_REQUEST, code),
    }
}

async fn display_get(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let store = store::SettingsStore::new(&state.db);
    match display::get_display(&store).await {
        Ok(prefs) => Json(json!({ "display": prefs })).into_response(),
        Err(code) => error_response(StatusCode::INTERNAL_SERVER_ERROR, code),
    }
}

async fn display_put(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let prefs: DisplayPrefs = match read_json(&body).await {
        Ok(v) => v,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "bad_request"),
    };
    let store = store::SettingsStore::new(&state.db);
    match display::put_display(&store, &prefs).await {
        Ok(p) => Json(json!({ "display": p })).into_response(),
        Err(code) => error_response(StatusCode::BAD_REQUEST, code),
    }
}
