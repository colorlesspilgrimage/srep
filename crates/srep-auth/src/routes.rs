use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use webauthn_rs::prelude::PasskeyRegistration;

use crate::middleware::RequestAuth;
use crate::state::AppState;
use crate::tokens::{safe_equal, sha256_hex};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/status", get(auth_status))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/auth/logout-all", post(auth_logout_all))
        .route("/api/auth/setup/options", post(setup_options))
        .route("/api/auth/setup/verify", post(not_impl))
        .route("/api/auth/login/options", post(not_impl))
        .route("/api/auth/login/verify", post(not_impl))
        .route("/api/auth/recovery/login", post(not_impl))
        .route("/api/auth/credentials", get(list_credentials_stub))
        .route("/api/auth/pairing/code", post(not_impl))
        .route("/api/auth/pairing/exchange", post(not_impl))
        .route("/api/auth/tokens", get(list_tokens_stub))
}

async fn not_impl() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({"error":"not_implemented_yet"})),
    )
}

async fn auth_status(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    let store = state.auth_store();
    let setup_complete = store.is_setup_complete().await.unwrap_or(false);
    let auth = req_auth.map(|e| e.0);
    if auth
        .as_ref()
        .and_then(|a| a.session_token.as_ref())
        .is_none()
    {
        return Json(json!({
            "setupComplete": setup_complete,
            "authenticated": false,
        }));
    }
    let csrf = auth.as_ref().and_then(|a| a.csrf_token.clone());
    Json(json!({
        "setupComplete": setup_complete,
        "authenticated": true,
        "csrfToken": csrf,
    }))
}

async fn auth_logout(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if let Some(axum::Extension(auth)) = req_auth {
        if let Some(id) = auth.session_id {
            let _ = state.auth_store().delete_session(id).await;
        }
    }
    let headers = [(axum::http::header::SET_COOKIE, clear_session_cookie())];
    (headers, Json(json!({"ok": true})))
}

async fn auth_logout_all(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    let Some(axum::Extension(auth)) = req_auth else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    };
    if auth.session_token.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    let _ = state.auth_store().delete_all_sessions().await;
    let headers = [(axum::http::header::SET_COOKIE, clear_session_cookie())];
    (StatusCode::OK, headers, Json(json!({"ok": true}))).into_response()
}

#[derive(Deserialize)]
struct SetupOptionsBody {
    #[serde(rename = "setupToken")]
    setup_token: String,
    kind: String,
    nickname: String,
}

async fn setup_options(
    State(state): State<AppState>,
    Json(body): Json<SetupOptionsBody>,
) -> impl IntoResponse {
    let store = state.auth_store();
    if store.is_setup_complete().await.unwrap_or(false) {
        return (StatusCode::FORBIDDEN, Json(json!({"error":"setup_locked"}))).into_response();
    }
    if !setup_token_valid(&state, &body.setup_token).await {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"setup_token_invalid"})),
        )
            .into_response();
    }
    let user_id = match store.get_or_create_user_id().await {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"internal"})),
            )
                .into_response()
        }
    };
    if body.kind != "passkey" && body.kind != "security_key" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_kind"})),
        )
            .into_response();
    }
    let nick = body.nickname.trim();
    if nick.is_empty() || nick.len() > 64 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_nickname"})),
        )
            .into_response();
    }
    match state.webauthn.webauthn.start_passkey_registration(
        user_id,
        &user_id.to_string(),
        nick,
        None,
    ) {
        Ok((ccr, reg)) => {
            let challenge_id = uuid::Uuid::new_v4().to_string();
            if save_challenge(&store, &challenge_id, &reg).await.is_err() {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error":"challenge_store"})),
                )
                    .into_response();
            }
            (
                StatusCode::OK,
                Json(json!({
                    "options": ccr,
                    "challengeId": challenge_id,
                })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(?e, "setup options");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"webauthn"})),
            )
                .into_response()
        }
    }
}

async fn setup_token_valid(state: &AppState, token: &str) -> bool {
    let hash = sha256_hex(token.as_bytes());
    if let Ok(Some(stored)) = state.auth_store().get_setup_token_hash().await {
        if stored == hash {
            return true;
        }
    }
    if let Some(mem) = state.setup_token.read().await.as_deref() {
        if safe_equal(token, mem) {
            return true;
        }
    }
    false
}

async fn save_challenge(
    store: &crate::store::AuthStore<'_>,
    id: &str,
    reg: &PasskeyRegistration,
) -> Result<(), sqlx::Error> {
    let now = crate::session::now_ms();
    let expires = now + 5 * 60 * 1000;
    let payload = serde_json::to_string(reg).map_err(|_| sqlx::Error::ColumnNotFound(id.into()))?;
    if let Some(pool) = store.sqlite {
        sqlx::query(
            "INSERT INTO auth_challenge (id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?)",
        )
        .bind(id)
        .bind(payload)
        .bind("setup")
        .bind(expires)
        .execute(pool)
        .await?;
    } else if let Some(pool) = store.postgres {
        sqlx::query(
            "INSERT INTO auth_challenge (id, challenge, purpose, expires_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(payload)
        .bind("setup")
        .bind(expires)
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn list_credentials_stub(
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    let Some(axum::Extension(auth)) = req_auth else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    };
    if auth.session_token.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    Json(json!({"credentials": []})).into_response()
}

async fn list_tokens_stub(req_auth: Option<axum::Extension<RequestAuth>>) -> impl IntoResponse {
    let Some(axum::Extension(auth)) = req_auth else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    };
    if auth.session_token.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        )
            .into_response();
    }
    Json(json!({"tokens": []})).into_response()
}

fn clear_session_cookie() -> String {
    "srep_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0".to_string()
}

pub async fn reset_auth(state: &AppState) -> anyhow::Result<String> {
    let store = state.auth_store();
    match store.sqlite {
        Some(pool) => {
            sqlx::query("DELETE FROM auth_credential")
                .execute(pool)
                .await?;
            sqlx::query("DELETE FROM auth_recovery")
                .execute(pool)
                .await?;
            sqlx::query("DELETE FROM auth_challenge")
                .execute(pool)
                .await?;
        }
        None => {
            if let Some(pool) = store.postgres {
                sqlx::query("DELETE FROM auth_credential")
                    .execute(pool)
                    .await?;
                sqlx::query("DELETE FROM auth_recovery")
                    .execute(pool)
                    .await?;
                sqlx::query("DELETE FROM auth_challenge")
                    .execute(pool)
                    .await?;
            }
        }
    }
    let _ = store.delete_all_sessions().await;
    let _ = store.delete_setting("auth.setup_complete").await?;
    let token = crate::tokens::random_token(32);
    let hash = sha256_hex(token.as_bytes());
    store.arm_setup(&hash).await?;
    let mut guard = state.setup_token.write().await;
    *guard = Some(token.clone());
    Ok(token)
}
