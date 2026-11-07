use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

use crate::deps::DomainCtx;
use crate::http::error_response;
use crate::routes::auth::require_session;
use crate::service::media;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/media", post(upload_media))
        .route("/api/media/:sha", get(serve_media))
}

async fn upload_media(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let declared = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let filename = headers
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if body.len() as u64 > state.config.media_max_bytes {
        return error_response(crate::error::fail(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        ));
    }
    let ctx = DomainCtx::new(&state);
    match media::store_media(&ctx, &body, declared, filename).await {
        Ok(view) => {
            let status = if view.created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            (
                status,
                Json(json!({
                    "media": {
                        "id": view.row.id,
                        "sha256": view.row.sha256,
                        "mime": view.row.mime,
                        "size": view.row.size,
                        "originalName": view.row.original_name,
                        "created": view.created,
                    }
                })),
            )
                .into_response()
        }
        Err(e) => error_response(e),
    }
}

async fn serve_media(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Path(sha): Path<String>,
) -> impl IntoResponse {
    if let Some(r) = require_session(req_auth) {
        return r;
    }
    let ctx = DomainCtx::new(&state);
    match media::read_media(&ctx, &sha).await {
        Ok((row, bytes)) => {
            let mut response = (
                StatusCode::OK,
                [(header::CONTENT_TYPE, row.mime)],
                bytes,
            )
                .into_response();
            response.headers_mut().insert(
                HeaderName::from_static("x-content-type-options"),
                HeaderValue::from_static("nosniff"),
            );
            response.headers_mut().insert(
                HeaderName::from_static("content-security-policy"),
                HeaderValue::from_static("sandbox; default-src 'none'"),
            );
            response
        }
        Err(e) => error_response(e),
    }
}
