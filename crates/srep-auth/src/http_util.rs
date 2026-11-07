use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::de::DeserializeOwned;
use serde_json::json;

pub const MAX_BODY_BYTES: usize = 64 * 1024;

pub fn error_response(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({ "error": error }))).into_response()
}

pub fn unauthenticated() -> Response {
    error_response(StatusCode::UNAUTHORIZED, "unauthenticated")
}

pub fn rate_limited(retry_after_sec: u64) -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(header::RETRY_AFTER, retry_after_sec.to_string())],
        Json(json!({ "error": "rate_limited" })),
    )
        .into_response()
}

pub async fn read_json<T: DeserializeOwned>(body: &[u8]) -> Result<T, &'static str> {
    if body.len() > MAX_BODY_BYTES {
        return Err("payload_too_large");
    }
    serde_json::from_slice(body).map_err(|_| "bad_request")
}

pub fn user_agent(headers: &HeaderMap) -> String {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(256)
        .collect()
}

pub fn client_key(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .split(',')
        .next()
        .unwrap_or("unknown")
        .trim()
        .to_string()
}
