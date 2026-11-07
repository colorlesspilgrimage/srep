use axum::body::Bytes;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::{fail, ApiFailure, ErrorBody};

const MAX_BODY: usize = 64 * 1024;

pub fn error_response(failure: ApiFailure) -> Response {
    (
        failure.status,
        Json(ErrorBody {
            error: failure.error,
        }),
    )
        .into_response()
}

pub fn bad_request() -> Response {
    error_response(fail(StatusCode::BAD_REQUEST, "bad_request"))
}

pub fn unsupported_media_type() -> Response {
    error_response(fail(
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "unsupported_media_type",
    ))
}

#[allow(clippy::result_large_err)]
pub fn parse_json_body<T: DeserializeOwned>(
    headers: &HeaderMap,
    body: Bytes,
) -> Result<T, Response> {
    let ctype = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !ctype.to_lowercase().starts_with("application/json") {
        return Err(unsupported_media_type());
    }
    if body.len() > MAX_BODY {
        return Err(error_response(fail(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        )));
    }
    let text = std::str::from_utf8(&body).map_err(|_| bad_request())?;
    serde_json::from_str(text).map_err(|_| bad_request())
}

pub fn extra_keys_bad_request(value: &Value) -> bool {
    value.as_object().is_none()
}
