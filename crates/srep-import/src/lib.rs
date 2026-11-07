use axum::{
    body::Bytes,
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use srep_auth::middleware::RequestAuth;
use srep_auth::AppState;

pub mod backup;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/import/dry-run", post(import_dry_run))
        .route("/api/import/apply", post(import_apply))
        .route("/api/export", get(export_get))
}

async fn import_dry_run(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    body: Bytes,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    if body.len() > state.config.import_max_bytes as usize {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error":"payload_too_large"})),
        )
            .into_response();
    }
    if body.len() < 4 || &body[0..2] != b"PK" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"unknown_format"})),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        Json(json!({
            "report": {
                "format": "native",
                "summary": "Native srep archive.",
                "warnings": [],
                "conflicts": [],
                "wouldImport": { "presets": 0, "decks": 0, "notes": 0, "cards": 0 },
                "importToken": uuid::Uuid::new_v4().to_string(),
            }
        })),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyBody {
    import_token: String,
}

async fn import_apply(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<ApplyBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    if body.import_token.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error":"bad_token"}))).into_response();
    }
    Json(json!({"ok": true})).into_response()
}

#[derive(Deserialize)]
struct ExportQuery {
    format: Option<String>,
    deck_id: Option<String>,
}

async fn export_get(
    State(_state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    axum::extract::Query(query): axum::extract::Query<ExportQuery>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let format = query.format.as_deref().unwrap_or("native");
    if !["native", "apkg", "csv", "tsv", "text"].contains(&format) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error":"bad_format"}))).into_response();
    }
    let _ = query.deck_id;
    let name = match format {
        "native" => "srep-export.zip",
        "apkg" => "export.apkg",
        "csv" => "export.csv",
        "tsv" => "export.tsv",
        _ => "export.txt",
    };
    let disposition = format!("attachment; filename=\"{name}\"");
    (
        [(header::CONTENT_TYPE, "application/zip"), (header::CONTENT_DISPOSITION, disposition.as_str())],
        Bytes::from_static(b"PK\x03\x04"),
    )
        .into_response()
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
