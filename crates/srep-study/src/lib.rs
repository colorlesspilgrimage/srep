#![allow(
    clippy::too_many_arguments,
    clippy::large_enum_variant,
    clippy::let_and_return,
    clippy::needless_question_mark,
    clippy::map_identity,
    clippy::reversed_empty_ranges,
    clippy::unnecessary_lazy_evaluations,
    clippy::manual_repeat_n,
    dead_code
)]

use axum::{
    extract::{Query, State},
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
pub mod pack;
pub mod parked;
pub mod queue_choice;
pub mod replay;
pub mod sched;
pub mod service;
pub mod store;
pub mod study_settings;
pub mod types;
pub mod validation;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/study/next", get(study_next))
        .route("/api/study/undo-events", get(study_undo_events))
        .route("/api/study/offline-pack", get(study_offline_pack))
        .route("/api/study/answer", post(study_answer))
        .route("/api/study/sync", post(study_sync))
        .route("/api/study/undo", post(study_undo))
        .route("/api/study/rebuild", post(study_rebuild))
        .route("/api/study/verify", post(study_verify))
        .route(
            "/api/settings/study",
            get(settings_study_get).put(settings_study_put),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoEventsQuery {
    since: Option<i64>,
}

async fn study_undo_events(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(query): Query<UndoEventsQuery>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    match service::study_undo_events(&state, query.since.unwrap_or(0)).await {
        Ok(reply) => Json(reply).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NextQuery {
    deck_id: Option<String>,
}

async fn study_next(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(query): Query<NextQuery>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    match service::study_next(&state, query.deck_id.as_deref()).await {
        Ok(reply) => Json(reply).into_response(),
        Err(service::StudyError::NotFound) => {
            (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackQuery {
    deck_id: Option<String>,
    limit: Option<String>,
}

async fn study_offline_pack(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(query): Query<PackQuery>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let Some(limit) = validation::parse_pack_limit(query.limit.as_deref()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response();
    };
    if let Some(deck_id) = query.deck_id.as_deref() {
        if validation::parse_uuid(deck_id).is_none() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"bad_request"})),
            )
                .into_response();
        }
    }
    match pack::study_pack(&state, query.deck_id.as_deref(), limit).await {
        Ok(reply) => Json(reply).into_response(),
        Err(service::StudyError::NotFound) => {
            (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response()
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnswerBodyRaw {
    card_id: String,
    rating: u8,
    reps: u32,
    elapsed_ms: u64,
}

async fn study_answer(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<AnswerBodyRaw>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let Some(parsed) =
        validation::parse_answer_body(&body.card_id, body.rating, body.reps, body.elapsed_ms)
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response();
    };
    match service::study_answer(&state, parsed).await {
        Ok(v) => Json(v).into_response(),
        Err(service::StudyError::NotFound) => {
            (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response()
        }
        Err(service::StudyError::StaleCard) => {
            (StatusCode::CONFLICT, Json(json!({"error":"stale_card"}))).into_response()
        }
        Err(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncBodyRaw {
    device_id: String,
    items: Vec<serde_json::Value>,
}

async fn study_sync(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<SyncBodyRaw>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let Some((device_id, items)) = validation::parse_sync_body(&body.device_id, &body.items) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response();
    };
    let device_id = device_id.to_string();
    match service::study_sync(&state, &device_id, items).await {
        Ok(v) => Json(v).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

async fn study_undo(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    match service::study_undo(&state).await {
        Ok(v) => Json(v).into_response(),
        Err(service::StudyError::NothingToUndo) => (
            StatusCode::NOT_FOUND,
            Json(json!({"error":"nothing_to_undo"})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

async fn study_rebuild(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    match service::study_rebuild(&state).await {
        Ok(v) => Json(v).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

async fn study_verify(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    match service::study_verify(&state).await {
        Ok(report) => Json(json!({ "report": report })).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

async fn settings_study_get(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    match service::get_study_settings(&state).await {
        Ok(settings) => Json(json!({ "settings": settings })).into_response(),
        Err(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsBody {
    rollover_hour: u8,
    timezone: String,
}

async fn settings_study_put(
    State(state): State<AppState>,
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
    let settings = types::StudySettings {
        rollover_hour: parsed.rollover_hour,
        timezone: parsed.timezone,
    };
    match service::put_study_settings(&state, settings.clone()).await {
        Ok(s) => Json(json!({ "settings": s })).into_response(),
        Err(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
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
