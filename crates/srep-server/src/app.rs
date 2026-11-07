use axum::{
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde_json::json;
use srep_auth::{auth_layer, routes as auth_routes, state::AppState};
use srep_browse::router as browse_router;
use srep_domain::router as domain_router;
use srep_import::router as import_router;
use srep_settings::router as settings_router;
use srep_stats::router as stats_router;
use srep_study::router as study_router;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;

use crate::static_files;

pub fn build_app(state: AppState) -> Router {
    let api = Router::new()
        .merge(auth_routes::router())
        .merge(domain_router())
        .merge(study_router())
        .merge(browse_router())
        .merge(stats_router())
        .merge(import_router())
        .merge(settings_router())
        .route("/healthz", get(healthz))
        .route("/api", get(|| async { StatusCode::NOT_FOUND }));

    Router::new()
        .merge(api)
        .fallback(static_files::serve_static_or_spa)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_layer,
        ))
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()))
        .with_state(state)
}

#[cfg(test)]
pub fn build_app_for_test(state: AppState) -> Router {
    build_app(state)
}

async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.ping().await {
        Ok(()) => (
            StatusCode::OK,
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({"status":"ok"})),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(%e, "health check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::CACHE_CONTROL, "no-store")],
                Json(json!({"status":"error"})),
            )
                .into_response()
        }
    }
}
