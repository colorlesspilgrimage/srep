use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

pub mod answer_plan;
pub mod card_state_plan;
pub mod day_clock;
pub mod fsrs_adapter;
pub mod parked;
pub mod queue_choice;
pub mod replay;
pub mod sched;
pub mod study_settings;
pub mod types;
pub mod validation;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/study/next", get(study_next))
        .route("/api/study/answer", post(study_answer))
        .route("/api/study/undo", post(study_undo))
        .route("/api/study/rebuild", post(study_rebuild))
        .route("/api/study/verify", post(study_verify))
        .route("/api/settings/study", get(settings_study_get).put(settings_study_put))
        .route("/api/cards/suspend", post(cards_suspend))
        .route("/api/cards/unsuspend", post(cards_unsuspend))
        .route("/api/cards/bury", post(cards_bury))
}

async fn study_next(
    _state: State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let settings = types::default_study_settings();
    let window = day_clock::study_window(chrono::Utc::now().timestamp_millis(), &settings);
    let counts = queue_choice::StudyCounts::default();
    (
        StatusCode::OK,
        Json(json!({
            "status": "done",
            "counts": counts,
            "window": window,
        })),
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

async fn settings_study_get(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let settings = types::default_study_settings();
    Json(json!({ "settings": settings })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsBody {
    rollover_hour: u8,
    timezone: String,
}

async fn settings_study_put(
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<SettingsBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let Some(parsed) = validation::parse_study_settings(body.rollover_hour, &body.timezone) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response();
    };
    Json(json!({
        "settings": {
            "rolloverHour": parsed.rollover_hour,
            "timezone": parsed.timezone,
        }
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CardIdsBody {
    card_ids: Vec<String>,
}

async fn cards_suspend(
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<CardIdsBody>,
) -> impl IntoResponse {
    card_state_route(req_auth, body.card_ids).await
}

async fn cards_unsuspend(
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<CardIdsBody>,
) -> impl IntoResponse {
    card_state_route(req_auth, body.card_ids).await
}

async fn cards_bury(
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<CardIdsBody>,
) -> impl IntoResponse {
    card_state_route(req_auth, body.card_ids).await
}

async fn card_state_route(
    req_auth: Option<axum::Extension<RequestAuth>>,
    card_ids: Vec<String>,
) -> axum::response::Response {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    if validation::parse_card_ids(&card_ids).is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response();
    }
    // Persistence applied in store layer (R2+); planning APIs are in `card_state_plan`.
    Json(json!({ "ok": true })).into_response()
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
