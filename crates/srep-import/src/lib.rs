use axum::{routing::post, Router};
use srep_auth::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/import/dry-run",
            post(|| async {
                (
                    axum::http::StatusCode::NOT_IMPLEMENTED,
                    axum::Json(serde_json::json!({"error":"import_pending"})),
                )
            }),
        )
        .route(
            "/api/export",
            post(|| async {
                (
                    axum::http::StatusCode::NOT_IMPLEMENTED,
                    axum::Json(serde_json::json!({"error":"export_pending"})),
                )
            }),
        )
}
