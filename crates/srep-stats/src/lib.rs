mod metrics;
mod optimizer;
mod pending_optimizer;
mod queries;

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
use srep_domain::builtin::DEFAULT_PRESET_ID;
use srep_domain::deps::DomainCtx;
use srep_domain::service::presets;
use srep_study::day_clock::study_window;
use srep_study::store::StudyStore;
use srep_study::study_settings::get_settings_default;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/stats/today", get(stats_today))
        .route("/api/stats/heatmap", get(stats_heatmap))
        .route("/api/stats/streak", get(stats_streak))
        .route("/api/stats/retention", get(stats_retention))
        .route("/api/stats/forecast", get(stats_forecast))
        .route("/api/stats/distribution", get(stats_distribution))
        .route("/api/stats/optimizer/preview", post(optimizer_preview))
        .route("/api/stats/optimizer/apply", post(optimizer_apply))
}

async fn stats_today(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let study = StudyStore::new(&state.db);
    let raw = study.get_study_settings().await.ok().flatten();
    let settings = match get_settings_default(raw.as_ref()) {
        Ok(s) => s,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"bad_request"})),
            )
                .into_response()
        }
    };
    let now = chrono::Utc::now().timestamp_millis();
    let window = study_window(now, &settings);
    let rows = queries::list_review_stats(&state.db).await.unwrap_or_default();
    let window_rows: Vec<_> = metrics::reviews_in_window(&rows, window.start_ms, window.end_ms)
        .into_iter()
        .cloned()
        .collect();
    let today = metrics::summarize_today(&window_rows);
    Json(json!({ "today": today })).into_response()
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct DaysParam {
    days: Option<String>,
}

async fn stats_heatmap(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(q): Query<DaysParam>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let days = q
        .days
        .as_deref()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(365)
        .clamp(1, 730);
    let study = StudyStore::new(&state.db);
    let settings = match get_settings_default(study.get_study_settings().await.ok().flatten().as_ref()) {
        Ok(s) => s,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error":"bad_request"}))).into_response(),
    };
    let now = chrono::Utc::now().timestamp_millis();
    let today = study_window(now, &settings).day_number;
    let since = now - days * metrics::DAY_MS;
    let rows = queries::list_review_stats_since(&state.db, since).await.unwrap_or_default();
    let cells = metrics::build_heatmap(&rows, &settings, today - days + 1, today);
    Json(json!({ "cells": cells })).into_response()
}

async fn stats_streak(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let study = StudyStore::new(&state.db);
    let settings = match get_settings_default(study.get_study_settings().await.ok().flatten().as_ref()) {
        Ok(s) => s,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error":"bad_request"}))).into_response(),
    };
    let now = chrono::Utc::now().timestamp_millis();
    let rows = queries::list_review_stats(&state.db).await.unwrap_or_default();
    let streak = metrics::study_streak(&rows, &settings, now);
    Json(json!({ "streak": streak })).into_response()
}

#[derive(Deserialize)]
struct PresetParam {
    preset_id: Option<String>,
}

async fn stats_retention(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(q): Query<PresetParam>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let ctx = DomainCtx::new(&state);
    let presets = ctx.store().list_presets().await.unwrap_or_default();
    let desired = presets
        .iter()
        .find(|p| p.id == DEFAULT_PRESET_ID)
        .map(|p| p.desired_retention)
        .unwrap_or(0.9);
    let preset_filter = q.preset_id.as_deref();
    if let Some(pid) = preset_filter {
        if !presets.iter().any(|p| p.id == pid) {
            return (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response();
        }
    }
    let rows = queries::list_review_stats(&state.db).await.unwrap_or_default();
    let retention = metrics::compute_retention(&rows, desired, preset_filter);
    Json(json!({ "retention": retention })).into_response()
}

async fn stats_forecast(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(q): Query<DaysParam>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let days = q
        .days
        .as_deref()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(30)
        .clamp(1, 365);
    let study = StudyStore::new(&state.db);
    let settings = match get_settings_default(study.get_study_settings().await.ok().flatten().as_ref()) {
        Ok(s) => s,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"error":"bad_request"}))).into_response(),
    };
    let now = chrono::Utc::now().timestamp_millis();
    let cards = queries::list_card_due_rows(&state.db).await.unwrap_or_default();
    let days_json = metrics::forecast_due(&cards, &settings, now, days);
    Json(json!({ "days": days_json })).into_response()
}

async fn stats_distribution(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let now = chrono::Utc::now().timestamp_millis();
    let cards = queries::list_card_due_rows(&state.db).await.unwrap_or_default();
    let distribution = metrics::card_distribution(&cards, now);
    Json(json!({ "distribution": distribution })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizerPreviewQuery {
    preset_id: String,
}

async fn optimizer_preview(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(q): Query<OptimizerPreviewQuery>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let ctx = DomainCtx::new(&state);
    let presets = ctx.store().list_presets().await.unwrap_or_default();
    let Some(preset) = presets.iter().find(|p| p.id == q.preset_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response();
    };
    let review_count = queries::count_reviews_for_preset(&state.db, &q.preset_id)
        .await
        .unwrap_or(0);
    let rows = queries::list_preset_reviews(&state.db, &q.preset_id)
        .await
        .unwrap_or_default();
    let preview_token = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    pending_optimizer::prune(now);
    match optimizer::preview_optimizer(preset, review_count, &rows, preview_token.clone()) {
        Ok(preview) => {
            pending_optimizer::stash_preview(
                preview_token.clone(),
                q.preset_id.clone(),
                preview.proposed.desired_retention,
                preview.proposed.fsrs_params.clone(),
                now,
            );
            Json(json!({
                "reviewCount": preview.review_count,
                "current": preview.current,
                "proposed": preview.proposed,
                "retention": preview.retention,
                "previewToken": preview.preview_token,
            }))
            .into_response()
        }
        Err("insufficient_reviews") => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error":"insufficient_reviews"})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizerApplyBody {
    preset_id: String,
    preview_token: String,
}

async fn optimizer_apply(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<OptimizerApplyBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let ctx = DomainCtx::new(&state);
    let presets = ctx.store().list_presets().await.unwrap_or_default();
    let Some(preset) = presets.iter().find(|p| p.id == body.preset_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response();
    };
    let now = chrono::Utc::now().timestamp_millis();
    let Some(pending) = pending_optimizer::take_preview(&body.preview_token, now) else {
        return (
            StatusCode::CONFLICT,
            Json(json!({"error":"preview_expired"})),
        )
            .into_response();
    };
    if pending.preset_id != body.preset_id {
        return (
            StatusCode::CONFLICT,
            Json(json!({"error":"preview_expired"})),
        )
            .into_response();
    }
    let review_count = queries::count_reviews_for_preset(&state.db, &body.preset_id)
        .await
        .unwrap_or(0);
    if review_count < optimizer::MIN_REVIEWS_FOR_OPTIMIZE {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error":"insufficient_reviews"})),
        )
            .into_response();
    }
    let input = srep_domain::core::validation::PresetInput {
        name: preset.name.clone(),
        new_per_day: preset.new_per_day,
        reviews_per_day: preset.reviews_per_day,
        desired_retention: pending.proposed_desired_retention,
        learning_steps: preset.learning_steps.clone(),
        relearning_steps: preset.relearning_steps.clone(),
        max_interval: preset.max_interval,
        fsrs_params: Some(pending.proposed_fsrs_params),
        bury_siblings: preset.bury_siblings,
        new_order: preset.new_order.clone(),
    };
    match presets::update_preset(&ctx, &body.preset_id, input).await {
        Ok(_) => Json(json!({ "presetId": body.preset_id })).into_response(),
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
                Json(json!({"error":"unauthenticated"})),
            )
                .into_response(),
        );
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return Some(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"unauthenticated"})),
            )
                .into_response(),
        );
    }
    None
}
