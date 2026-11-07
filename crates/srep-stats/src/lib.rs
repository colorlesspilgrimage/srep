mod metrics;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;
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
    let parsed = match &state.db {
        srep_db::DbPool::Sqlite(p) => {
            let rows = sqlx::query(
                "SELECT reviewed_at, rating, state_before FROM review_log WHERE reviewed_at >= ? AND reviewed_at < ?",
            )
            .bind(window.start_ms)
            .bind(window.end_ms)
            .fetch_all(p)
            .await
            .unwrap_or_default();
            rows.iter()
                .filter_map(|r| {
                    Some((
                        r.try_get("reviewed_at").ok()?,
                        r.try_get("rating").ok()?,
                        r.try_get::<String, _>("state_before").ok()?,
                    ))
                })
                .collect::<Vec<_>>()
        }
        srep_db::DbPool::Postgres(p) => {
            let rows = sqlx::query(
                "SELECT reviewed_at, rating, state_before FROM review_log WHERE reviewed_at >= $1 AND reviewed_at < $2",
            )
            .bind(window.start_ms)
            .bind(window.end_ms)
            .fetch_all(p)
            .await
            .unwrap_or_default();
            rows.iter()
                .filter_map(|r| {
                    Some((
                        r.try_get("reviewed_at").ok()?,
                        r.try_get("rating").ok()?,
                        r.try_get::<String, _>("state_before").ok()?,
                    ))
                })
                .collect::<Vec<_>>()
        }
    };
    let today = metrics::summarize_today(&parsed);
    Json(json!({ "today": today })).into_response()
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct DaysParam {
    days: Option<String>,
}

async fn stats_heatmap(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(_q): Query<DaysParam>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    Json(json!({ "cells": [] })).into_response()
}

async fn stats_streak(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    Json(json!({ "streak": { "current": 0, "longest": 0 } })).into_response()
}

async fn stats_retention(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    Json(json!({ "retention": { "desired": 0.9, "estimated": null } })).into_response()
}

async fn stats_forecast(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    Json(json!({ "days": [] })).into_response()
}

async fn stats_distribution(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    Json(json!({ "distribution": { "buckets": [] } })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct OptimizerPreviewQuery {
    preset_id: String,
}

async fn optimizer_preview(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(_q): Query<OptimizerPreviewQuery>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct OptimizerApplyBody {
    preset_id: String,
    preview_token: String,
}

async fn optimizer_apply(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(_body): Json<OptimizerApplyBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    (StatusCode::NOT_FOUND, Json(json!({"error":"not_found"}))).into_response()
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
