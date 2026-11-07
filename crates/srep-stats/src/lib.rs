use axum::{routing::get, Router};
use srep_auth::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/stats/today",
        get(|| async { axum::Json(serde_json::json!({"reviews":0})) }),
    )
}
