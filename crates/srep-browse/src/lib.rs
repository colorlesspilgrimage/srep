use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use srep_auth::middleware::{private_json, RequestAuth};
use srep_auth::AppState;

pub mod browse_where;
pub mod bulk;
pub mod query;
pub mod search;

#[derive(Deserialize)]
struct BrowseParams {
    q: Option<String>,
    limit: Option<String>,
    cursor: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/browse", get(browse_get))
        .route("/api/notes/trash", post(notes_trash))
        .route("/api/notes/tags", post(notes_tags))
}

async fn browse_get(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Query(params): Query<BrowseParams>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let limit = params
        .limit
        .as_deref()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(50);
    match search::search_browse(
        &state.db,
        params.q.as_deref(),
        limit,
        params.cursor.as_deref(),
    )
    .await
    {
        Ok(Ok(page)) => {
            Json(json!({ "rows": page.rows, "nextCursor": page.next_cursor })).into_response()
        }
        Ok(Err(_)) => (StatusCode::BAD_REQUEST, Json(json!({"error":"bad_query"}))).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteTrashBody {
    note_ids: Vec<String>,
}

async fn notes_trash(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<NoteTrashBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let now = chrono::Utc::now().timestamp_millis();
    match bulk::trash_notes(&state.db, &body.note_ids, now).await {
        Ok(code) => {
            let (status, _) = bulk::map_bulk(code);
            if status.is_success() {
                Json(json!({"ok": true})).into_response()
            } else {
                (status, Json(json!({"error": code}))).into_response()
            }
        }
        Err(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteTagsBody {
    note_ids: Vec<String>,
    add: Vec<String>,
    remove: Vec<String>,
}

async fn notes_tags(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<NoteTagsBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(req_auth).await {
        return resp;
    }
    let now = chrono::Utc::now().timestamp_millis();
    match bulk::replace_note_tags(&state.db, &body.note_ids, &body.add, &body.remove, now).await {
        Ok(code) => {
            let (status, _) = bulk::map_bulk(code);
            if status.is_success() {
                Json(json!({"ok": true})).into_response()
            } else {
                (status, Json(json!({"error": code}))).into_response()
            }
        }
        Err(_) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"bad_request"})),
        )
            .into_response(),
    }
}

async fn require_auth(
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> Option<axum::response::Response> {
    let Some(axum::Extension(auth)) = req_auth else {
        return Some(private_json(
            StatusCode::UNAUTHORIZED,
            json!({"error":"unauthenticated"}),
        ));
    };
    if auth.session_token.is_none() && auth.bearer.is_none() {
        return Some(private_json(
            StatusCode::UNAUTHORIZED,
            json!({"error":"unauthenticated"}),
        ));
    }
    None
}
