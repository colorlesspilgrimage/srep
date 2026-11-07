use axum::{routing::get, Router};
use srep_auth::AppState;

pub mod query;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/browse",
        get(|| async { axum::Json(serde_json::json!({"items":[]})) }),
    )
}
