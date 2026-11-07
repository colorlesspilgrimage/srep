use axum::Json;
use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::guard::{
    check_csrf, check_origin, decode_route_path, is_api_path, is_mutating, is_origin_exempt,
    is_public_api_route,
};
use crate::session::{evaluate_session, now_ms, should_touch, SessionState};
use crate::state::AppState;
use crate::tokens::{csrf_token_for, sha256_hex};

const SESSION_COOKIE: &str = "srep_session";

#[derive(Clone, Debug, Default)]
pub struct RequestAuth {
    pub session_token: Option<String>,
    pub csrf_token: Option<String>,
    pub session_id: Option<uuid::Uuid>,
    pub bearer: Option<String>,
}

pub async fn auth_layer(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    let decoded = decode_route_path(&path).unwrap_or(path.clone());

    if !is_api_path(&decoded) {
        return next.run(req).await;
    }

    let cookie_token = session_cookie(&req);
    let bearer = bearer_token(&req);
    let mut auth = RequestAuth {
        session_token: None,
        csrf_token: None,
        session_id: None,
        bearer: bearer.clone(),
    };

    if let Some(raw) = cookie_token {
        if let Ok(Some(row)) = resolve_session(&state, &raw).await {
            auth.session_token = Some(raw);
            auth.csrf_token = Some(csrf_token_for(auth.session_token.as_ref().unwrap()));
            auth.session_id = Some(row.id);
        }
    }

    let api_token_ok = if auth.session_token.is_none() {
        if let Some(ref raw) = bearer {
            crate::pairing::resolve_api_token(&state.auth_store(), raw)
                .await
                .ok()
                .flatten()
                .is_some()
        } else {
            false
        }
    } else {
        false
    };

    let public = is_public_api_route(&method, &decoded);
    let authenticated = auth.session_token.is_some() || api_token_ok;

    if !public && !authenticated {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    }

    if is_mutating(&method) && authenticated && auth.bearer.is_none() {
        let origin_ok = is_origin_exempt(&method, &decoded)
            || check_origin(
                req.headers().get("origin").and_then(|v| v.to_str().ok()),
                &state.config.auth.origin,
            );
        if !origin_ok {
            return (StatusCode::FORBIDDEN, Json(json!({"error":"origin"}))).into_response();
        }
        if let Some(ref raw) = auth.session_token {
            let csrf_hdr = req
                .headers()
                .get("x-srep-csrf")
                .and_then(|v| v.to_str().ok());
            if !check_csrf(csrf_hdr, raw) {
                return (StatusCode::FORBIDDEN, Json(json!({"error":"csrf"}))).into_response();
            }
        }
    }

    req.extensions_mut().insert(auth.clone());
    next.run(req).await
}

async fn resolve_session(
    state: &AppState,
    raw_token: &str,
) -> Result<Option<crate::session::SessionRow>, sqlx::Error> {
    let store = state.auth_store();
    let hash = sha256_hex(raw_token.as_bytes());
    let Some(row) = store.get_session_by_token_hash(&hash).await.map_err(|e| {
        tracing::error!(%e, "session lookup");
        sqlx::Error::RowNotFound
    })?
    else {
        return Ok(None);
    };
    let now = now_ms();
    match evaluate_session(row.last_seen_at, row.expires_at, now) {
        SessionState::Valid => {
            if should_touch(row.last_seen_at, now) {
                let _ = store.touch_session(row.id, now).await;
            }
            Ok(Some(row))
        }
        _ => {
            let _ = store.delete_session(row.id).await;
            Ok(None)
        }
    }
}

fn session_cookie(req: &Request<Body>) -> Option<String> {
    let header = req.headers().get(axum::http::header::COOKIE)?;
    let cookies = cookie::Cookie::split_parse(header.to_str().ok()?)
        .filter_map(|c| c.ok())
        .find(|c| c.name() == SESSION_COOKIE)?;
    Some(cookies.value().to_string())
}

fn bearer_token(req: &Request<Body>) -> Option<String> {
    let auth = req.headers().get(axum::http::header::AUTHORIZATION)?;
    let s = auth.to_str().ok()?;
    s.strip_prefix("Bearer ").map(str::to_string)
}

pub fn session_cookie_header(token: &str, max_age_sec: i64) -> String {
    format!(
        "{SESSION_COOKIE}={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age={max_age_sec}"
    )
}
