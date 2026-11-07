use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use srep_auth::middleware::RequestAuth;

pub fn require_session(req_auth: Option<axum::Extension<RequestAuth>>) -> Option<Response> {
    let Some(axum::Extension(auth)) = req_auth else {
        return Some(unauthorized());
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return Some(unauthorized());
    }
    None
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"error":"unauthorized"})),
    )
        .into_response()
}
