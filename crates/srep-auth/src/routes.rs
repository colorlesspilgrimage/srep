use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;
use webauthn_rs::prelude::{PublicKeyCredential, RegisterPublicKeyCredential};

use crate::challenges::{create_challenge, take_challenge, ChallengeState, TakeChallengeError};
use crate::http_util::{client_key, error_response, rate_limited, user_agent};
use crate::limiters::{PAIRING_FAILURE_KEY, RECOVERY_FAILURE_KEY, SETUP_FAILURE_KEY};
use crate::middleware::{session_cookie_header, RequestAuth};
use crate::pairing::{create_pairing_code, exchange_pairing_code};
use crate::recovery_codes::{generate_recovery_codes, hash_recovery_code, verify_recovery_code};
use crate::session::{build_session, now_ms};
use crate::state::AppState;
use crate::types::RecoveryRow;
use crate::text::normalize_nickname;
use crate::tokens::{csrf_token_for, sha256_hex, safe_equal};
use crate::types::{
    ApiTokenView, ChallengePurpose, DeleteCredentialResult, PublicCredential,
};
use crate::webauthn_ops::{
    challenge_string_from_creation, challenge_string_from_request, check_sign_count,
    credential_id_from_string, credential_id_to_string, finish_login, finish_registration,
    passkey_from_row, row_from_passkey, start_login, start_registration,
    transports_from_registration,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/status", get(auth_status))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/auth/logout-all", post(auth_logout_all))
        .route("/api/auth/setup/options", post(setup_options))
        .route("/api/auth/setup/verify", post(setup_verify))
        .route("/api/auth/login/options", post(login_options))
        .route("/api/auth/login/verify", post(login_verify))
        .route("/api/auth/recovery", get(recovery_status))
        .route("/api/auth/recovery/login", post(recovery_login))
        .route("/api/auth/credentials", get(list_credentials))
        .route("/api/auth/credentials/options", post(credentials_options))
        .route("/api/auth/credentials/verify", post(credentials_verify))
        .route("/api/auth/credentials/:id", patch(rename_credential).delete(delete_credential))
        .route("/api/auth/pairing/code", post(pairing_code))
        .route("/api/auth/pairing/exchange", post(pairing_exchange))
        .route("/api/auth/tokens", get(list_tokens))
        .route("/api/auth/tokens/:id", patch(rename_token).delete(revoke_token))
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
    let headers = [(header::SET_COOKIE, clear_session_cookie())];
    (headers, Json(json!({"ok": true})))
}

async fn auth_logout_all(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    let Some(axum::Extension(auth)) = req_auth else {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    };
    if auth.session_token.is_none() {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let _ = state.auth_store().delete_all_sessions().await;
    let headers = [(header::SET_COOKIE, clear_session_cookie())];
    (
        StatusCode::OK,
        headers,
        Json(json!({"ok": true})),
    )
        .into_response()
}

fn check_auth_attempts(state: &AppState, headers: &HeaderMap) -> Option<axum::response::Response> {
    let key = client_key(headers);
    match state.limiters.auth_attempts.check(&key, now_ms()) {
        Ok(()) => None,
        Err(sec) => Some(rate_limited(sec)),
    }
}

fn check_failure_limited(
    _state: &AppState,
    limiter: &std::sync::Arc<crate::rate_limit::RateLimiter>,
    key: &str,
) -> Option<axum::response::Response> {
    match limiter.check(key, now_ms()) {
        Ok(()) => None,
        Err(sec) => Some(rate_limited(sec)),
    }
}

async fn setup_token_valid(state: &AppState, token: &str) -> bool {
    let hash = sha256_hex(token.as_bytes());
    if let Ok(Some(stored)) = state.auth_store().get_setup_token_hash().await {
        if safe_equal(&hash, &stored) {
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

#[derive(Deserialize)]
struct SetupOptionsBody {
    #[serde(rename = "setupToken")]
    setup_token: String,
    kind: String,
    nickname: String,
}

async fn setup_options(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SetupOptionsBody>,
) -> impl IntoResponse {
    if let Some(r) = check_auth_attempts(&state, &headers) {
        return r;
    }
    let store = state.auth_store();
    if store.is_setup_complete().await.unwrap_or(false) {
        return error_response(StatusCode::FORBIDDEN, "setup_locked");
    }
    if !setup_token_valid(&state, &body.setup_token).await {
        return error_response(StatusCode::FORBIDDEN, "setup_token_invalid");
    }
    if normalize_nickname(&body.nickname).is_none() {
        return error_response(StatusCode::BAD_REQUEST, "invalid_nickname");
    }
    if body.kind != "passkey" && body.kind != "security_key" {
        return error_response(StatusCode::BAD_REQUEST, "invalid_kind");
    }
    let user_id = Uuid::new_v4();
    let _ = store.insert_user_id_if_absent(user_id).await;
    let user_id = store.get_or_create_user_id().await.unwrap_or(user_id);
    let exclude = vec![];
    match start_registration(&state.webauthn.webauthn, user_id, &body.kind, exclude) {
        Ok((ccr, reg)) => {
            let challenge = challenge_string_from_creation(&ccr);
            let challenge_id = match create_challenge(
                &store,
                ChallengePurpose::Setup,
                &challenge,
                ChallengeState::Setup(reg),
            )
            .await
            {
                Ok(id) => id,
                Err(_) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, "challenge_store"),
            };
            (StatusCode::OK, Json(json!({ "options": ccr, "challengeId": challenge_id }))).into_response()
        }
        Err(e) => {
            tracing::error!(?e, "setup options");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "webauthn")
        }
    }
}

#[derive(Deserialize)]
struct SetupVerifyBody {
    #[serde(rename = "setupToken")]
    setup_token: String,
    #[serde(rename = "challengeId")]
    challenge_id: String,
    response: RegisterPublicKeyCredential,
    kind: String,
    nickname: String,
}

async fn setup_verify(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SetupVerifyBody>,
) -> impl IntoResponse {
    if let Some(r) = check_failure_limited(&state, &state.limiters.setup_token_failures, SETUP_FAILURE_KEY)
    {
        return r;
    }
    if let Some(r) = check_auth_attempts(&state, &headers) {
        state.limiters.setup_token_failures.release(SETUP_FAILURE_KEY, now_ms());
        return r;
    }
    let store = state.auth_store();
    if store.is_setup_complete().await.unwrap_or(false) {
        state.limiters.setup_token_failures.release(SETUP_FAILURE_KEY, now_ms());
        return error_response(StatusCode::FORBIDDEN, "setup_locked");
    }
    if !setup_token_valid(&state, &body.setup_token).await {
        return error_response(StatusCode::FORBIDDEN, "setup_token_invalid");
    }
    let nick = match normalize_nickname(&body.nickname) {
        Some(n) => n,
        None => {
            state.limiters.setup_token_failures.release(SETUP_FAILURE_KEY, now_ms());
            return error_response(StatusCode::BAD_REQUEST, "invalid_nickname");
        }
    };
    let taken = match take_challenge(&store, &body.challenge_id, ChallengePurpose::Setup).await {
        Ok(t) => t,
        Err(TakeChallengeError::Expired) => {
            state.limiters.setup_token_failures.release(SETUP_FAILURE_KEY, now_ms());
            return error_response(StatusCode::BAD_REQUEST, "challenge_expired");
        }
        Err(TakeChallengeError::Invalid) => {
            state.limiters.setup_token_failures.release(SETUP_FAILURE_KEY, now_ms());
            return error_response(StatusCode::BAD_REQUEST, "challenge_invalid");
        }
    };
    let ChallengeState::Setup(reg_state) = taken.state else {
        return error_response(StatusCode::BAD_REQUEST, "challenge_invalid");
    };
    let passkey = match finish_registration(&state.webauthn.webauthn, &body.response, &reg_state) {
        Ok(p) => p,
        Err(_) => {
            state.limiters.setup_token_failures.release(SETUP_FAILURE_KEY, now_ms());
            return error_response(StatusCode::BAD_REQUEST, "verification_failed");
        }
    };
    let transports = transports_from_registration(&body.response);
    let cred = row_from_passkey(&passkey, &body.kind, &nick, now_ms(), transports);
    let recovery_codes = generate_recovery_codes(10);
    let recovery_hashes: Vec<RecoveryRow> = recovery_codes
        .iter()
        .filter_map(|code| {
            Some(RecoveryRow {
                id: Uuid::new_v4(),
                code_hash: hash_recovery_code(code)?,
            })
        })
        .collect();
    let ua = user_agent(&headers);
    let session = build_session(now_ms(), &ua);
    let done = store
        .complete_setup(&cred, &recovery_hashes, &session.row)
        .await
        .unwrap_or(false);
    if !done {
        return error_response(StatusCode::FORBIDDEN, "setup_locked");
    }
    state.limiters.setup_token_failures.reset(SETUP_FAILURE_KEY);
    let cookie = session_cookie_header(&session.raw_token, session.max_age_sec);
    let csrf = csrf_token_for(&session.raw_token);
    (
        StatusCode::OK,
        [
            (header::SET_COOKIE, cookie),
        ],
        Json(json!({
            "recoveryCodes": recovery_codes,
            "credential": PublicCredential::from(cred),
            "csrfToken": csrf,
        })),
    )
        .into_response()
}

#[derive(Deserialize)]
struct LoginOptionsBody {
    kind: Option<String>,
}

async fn login_options(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<LoginOptionsBody>>,
) -> impl IntoResponse {
    if let Some(r) = check_auth_attempts(&state, &headers) {
        return r;
    }
    let store = state.auth_store();
    if !store.is_setup_complete().await.unwrap_or(false) {
        return error_response(StatusCode::FORBIDDEN, "setup_required");
    }
    let kind = body
        .as_ref()
        .and_then(|b| b.kind.clone())
        .unwrap_or_else(|| "passkey".to_string());
    if kind != "passkey" && kind != "security_key" {
        return error_response(StatusCode::BAD_REQUEST, "bad_request");
    }
    let mut keys = vec![];
    if kind == "security_key" {
        let creds = store.list_credentials().await.unwrap_or_default();
        let keys_list: Vec<_> = creds.into_iter().filter(|c| c.kind == "security_key").collect();
        if keys_list.is_empty() {
            return error_response(StatusCode::BAD_REQUEST, "no_security_key");
        }
        for c in keys_list {
            if let Ok(pk) = passkey_from_row(&c) {
                keys.push(pk);
            }
        }
    } else {
        for c in store.list_credentials().await.unwrap_or_default() {
            if let Ok(pk) = passkey_from_row(&c) {
                keys.push(pk);
            }
        }
    }
    match start_login(&state.webauthn.webauthn, &keys, &kind) {
        Ok((rcr, st)) => {
            let challenge = challenge_string_from_request(&rcr);
            let challenge_id = create_challenge(
                &store,
                ChallengePurpose::Login,
                &challenge,
                ChallengeState::Login(st),
            )
            .await
            .unwrap_or_default();
            (StatusCode::OK, Json(json!({ "options": rcr, "challengeId": challenge_id }))).into_response()
        }
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "webauthn"),
    }
}

#[derive(Deserialize)]
struct LoginVerifyBody {
    #[serde(rename = "challengeId")]
    challenge_id: String,
    response: PublicKeyCredential,
}

async fn login_verify(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginVerifyBody>,
) -> impl IntoResponse {
    if let Some(r) = check_auth_attempts(&state, &headers) {
        return r;
    }
    let store = state.auth_store();
    let taken = match take_challenge(&store, &body.challenge_id, ChallengePurpose::Login).await {
        Ok(t) => t,
        Err(TakeChallengeError::Expired) => {
            return error_response(StatusCode::BAD_REQUEST, "challenge_expired")
        }
        Err(TakeChallengeError::Invalid) => {
            return error_response(StatusCode::BAD_REQUEST, "challenge_invalid")
        }
    };
    let ChallengeState::Login(auth_state) = taken.state else {
        return error_response(StatusCode::BAD_REQUEST, "challenge_invalid");
    };
    let cred_id = body.response.id.clone();
    let credential = match store.get_credential_by_credential_id(&cred_id).await {
        Ok(Some(c)) => c,
        _ => return error_response(StatusCode::UNAUTHORIZED, "login_failed"),
    };
    let result = match finish_login(&state.webauthn.webauthn, &body.response, &auth_state) {
        Ok(r) => r,
        Err(_) => return error_response(StatusCode::UNAUTHORIZED, "login_failed"),
    };
    let new_sign = result.counter() as i64;
    if !check_sign_count(credential.sign_count, result.counter()) {
        return error_response(StatusCode::UNAUTHORIZED, "login_failed");
    }
    if !store
        .update_sign_count(credential.id, new_sign, now_ms())
        .await
        .unwrap_or(false)
    {
        return error_response(StatusCode::UNAUTHORIZED, "login_failed");
    }
    let ua = user_agent(&headers);
    let session = build_session(now_ms(), &ua);
    let _ = store.insert_session(&session.row).await;
    let cookie = session_cookie_header(&session.raw_token, session.max_age_sec);
    let csrf = csrf_token_for(&session.raw_token);
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "csrfToken": csrf })),
    )
        .into_response()
}

async fn recovery_status(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let unused = state
        .auth_store()
        .list_unused_recovery()
        .await
        .unwrap_or_default();
    Json(json!({ "unusedCount": unused.len() })).into_response()
}

#[derive(Deserialize)]
struct RecoveryLoginBody {
    code: String,
}

async fn recovery_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RecoveryLoginBody>,
) -> impl IntoResponse {
    if let Some(r) = check_failure_limited(&state, &state.limiters.recovery_failures, RECOVERY_FAILURE_KEY)
    {
        return r;
    }
    if let Some(r) = check_auth_attempts(&state, &headers) {
        state.limiters.recovery_failures.release(RECOVERY_FAILURE_KEY, now_ms());
        return r;
    }
    let store = state.auth_store();
    let unused = store.list_unused_recovery().await.unwrap_or_default();
    let mut match_id = None;
    for row in &unused {
        if verify_recovery_code(&body.code, &row.code_hash) {
            match_id = Some(row.id);
            break;
        }
    }
    let Some(id) = match_id else {
        return error_response(StatusCode::UNAUTHORIZED, "recovery_failed");
    };
    if !store.consume_recovery(id, now_ms()).await.unwrap_or(false) {
        return error_response(StatusCode::UNAUTHORIZED, "recovery_failed");
    }
    let ua = user_agent(&headers);
    let session = build_session(now_ms(), &ua);
    let _ = store.insert_session(&session.row).await;
    state.limiters.recovery_failures.reset(RECOVERY_FAILURE_KEY);
    let cookie = session_cookie_header(&session.raw_token, session.max_age_sec);
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(json!({
            "csrfToken": csrf_token_for(&session.raw_token),
            "remaining": unused.len().saturating_sub(1),
        })),
    )
        .into_response()
}

fn require_session(req_auth: Option<axum::Extension<RequestAuth>>) -> bool {
    req_auth
        .map(|e| e.0.session_token.is_some())
        .unwrap_or(false)
}

async fn list_credentials(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let creds = state.auth_store().list_credentials().await.unwrap_or_default();
    let public: Vec<PublicCredential> = creds.into_iter().map(PublicCredential::from).collect();
    Json(json!({ "credentials": public })).into_response()
}

#[derive(Deserialize)]
struct RegisterOptionsBody {
    kind: String,
    nickname: String,
}

async fn credentials_options(
    State(state): State<AppState>,
    headers: HeaderMap,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<RegisterOptionsBody>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    if let Some(r) = check_auth_attempts(&state, &headers) {
        return r;
    }
    if normalize_nickname(&body.nickname).is_none() {
        return error_response(StatusCode::BAD_REQUEST, "invalid_nickname");
    }
    let store = state.auth_store();
    let user_id = Uuid::new_v4();
    let _ = store.insert_user_id_if_absent(user_id).await;
    let user_id = store.get_or_create_user_id().await.unwrap_or(user_id);
    let existing = store.list_credentials().await.unwrap_or_default();
    let mut exclude = vec![];
    for c in &existing {
        if let Some(id) = credential_id_from_string(&c.credential_id) {
            exclude.push(id);
        }
    }
    match start_registration(&state.webauthn.webauthn, user_id, &body.kind, exclude) {
        Ok((ccr, reg)) => {
            let challenge = challenge_string_from_creation(&ccr);
            let challenge_id = create_challenge(
                &store,
                ChallengePurpose::Register,
                &challenge,
                ChallengeState::Register(reg),
            )
            .await
            .unwrap_or_default();
            (StatusCode::OK, Json(json!({ "options": ccr, "challengeId": challenge_id }))).into_response()
        }
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "webauthn"),
    }
}

#[derive(Deserialize)]
struct RegisterVerifyBody {
    #[serde(rename = "challengeId")]
    challenge_id: String,
    response: RegisterPublicKeyCredential,
    kind: String,
    nickname: String,
}

async fn credentials_verify(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<RegisterVerifyBody>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let nick = match normalize_nickname(&body.nickname) {
        Some(n) => n,
        None => return error_response(StatusCode::BAD_REQUEST, "invalid_nickname"),
    };
    let store = state.auth_store();
    let taken = match take_challenge(&store, &body.challenge_id, ChallengePurpose::Register).await {
        Ok(t) => t,
        Err(TakeChallengeError::Expired) => {
            return error_response(StatusCode::BAD_REQUEST, "challenge_expired")
        }
        Err(TakeChallengeError::Invalid) => {
            return error_response(StatusCode::BAD_REQUEST, "challenge_invalid")
        }
    };
    let ChallengeState::Register(reg_state) = taken.state else {
        return error_response(StatusCode::BAD_REQUEST, "challenge_invalid");
    };
    let passkey = match finish_registration(&state.webauthn.webauthn, &body.response, &reg_state) {
        Ok(p) => p,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "verification_failed"),
    };
    let cred_id = credential_id_to_string(passkey.cred_id());
    if store
        .get_credential_by_credential_id(&cred_id)
        .await
        .ok()
        .flatten()
        .is_some()
    {
        return error_response(StatusCode::CONFLICT, "duplicate_credential");
    }
    let transports = transports_from_registration(&body.response);
    let row = row_from_passkey(&passkey, &body.kind, &nick, now_ms(), transports);
    let _ = store.insert_credential(&row).await;
    Json(json!({ "credential": PublicCredential::from(row) })).into_response()
}

#[derive(Deserialize)]
struct RenameBody {
    nickname: String,
}

async fn rename_credential(
    State(state): State<AppState>,
    Path(id): Path<String>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<RenameBody>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Ok(uid) = Uuid::parse_str(&id) else {
        return error_response(StatusCode::BAD_REQUEST, "bad_request");
    };
    let nick = match normalize_nickname(&body.nickname) {
        Some(n) => n,
        None => return error_response(StatusCode::BAD_REQUEST, "invalid_nickname"),
    };
    if state.auth_store().rename_credential(uid, &nick).await.unwrap_or(false) {
        Json(json!({ "ok": true })).into_response()
    } else {
        error_response(StatusCode::NOT_FOUND, "not_found")
    }
}

async fn delete_credential(
    State(state): State<AppState>,
    Path(id): Path<String>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Ok(uid) = Uuid::parse_str(&id) else {
        return error_response(StatusCode::BAD_REQUEST, "bad_request");
    };
    match state
        .auth_store()
        .delete_credential_unless_last(uid)
        .await
        .unwrap_or(DeleteCredentialResult::NotFound)
    {
        DeleteCredentialResult::Deleted => Json(json!({ "ok": true })).into_response(),
        DeleteCredentialResult::LastCredential => {
            error_response(StatusCode::CONFLICT, "last_credential")
        }
        DeleteCredentialResult::NotFound => error_response(StatusCode::NOT_FOUND, "not_found"),
    }
}

#[derive(Deserialize)]
struct PairingCodeBody {
    name: Option<String>,
}

async fn pairing_code(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<PairingCodeBody>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let store = state.auth_store();
    match create_pairing_code(&store, &state.config.auth.origin, body.name.as_deref()).await {
        Ok((code, expires_at, qr)) => Json(json!({
            "code": code,
            "expiresAt": expires_at,
            "qrPayload": qr,
        }))
        .into_response(),
        Err(e) => error_response(StatusCode::BAD_REQUEST, e),
    }
}

#[derive(Deserialize)]
struct PairingExchangeBody {
    code: String,
    name: Option<String>,
}

async fn pairing_exchange(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PairingExchangeBody>,
) -> impl IntoResponse {
    if let Some(r) = check_failure_limited(&state, &state.limiters.pairing_failures, PAIRING_FAILURE_KEY)
    {
        return r;
    }
    if let Some(r) = check_auth_attempts(&state, &headers) {
        state.limiters.pairing_failures.release(PAIRING_FAILURE_KEY, now_ms());
        return r;
    }
    let store = state.auth_store();
    match exchange_pairing_code(&store, &body.code, body.name.as_deref()).await {
        Ok((token, token_id, name)) => {
            state.limiters.pairing_failures.reset(PAIRING_FAILURE_KEY);
            Json(json!({
                "token": token,
                "tokenId": token_id.to_string(),
                "name": name,
            }))
            .into_response()
        }
        Err("token_limit") => error_response(StatusCode::CONFLICT, "token_limit"),
        Err("invalid_nickname") => error_response(StatusCode::BAD_REQUEST, "invalid_nickname"),
        Err(_) => error_response(StatusCode::UNAUTHORIZED, "pairing_failed"),
    }
}

async fn list_tokens(
    State(state): State<AppState>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let tokens: Vec<ApiTokenView> = state
        .auth_store()
        .list_api_tokens()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(ApiTokenView::from)
        .collect();
    Json(json!({ "tokens": tokens })).into_response()
}

#[derive(Deserialize)]
struct TokenRenameBody {
    name: String,
}

async fn rename_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
    req_auth: Option<axum::Extension<RequestAuth>>,
    Json(body): Json<TokenRenameBody>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Ok(uid) = Uuid::parse_str(&id) else {
        return error_response(StatusCode::BAD_REQUEST, "bad_request");
    };
    if !crate::text::is_short_text(body.name.trim()) {
        return error_response(StatusCode::BAD_REQUEST, "invalid_nickname");
    }
    if state
        .auth_store()
        .rename_api_token(uid, body.name.trim())
        .await
        .unwrap_or(false)
    {
        Json(json!({ "ok": true })).into_response()
    } else {
        error_response(StatusCode::NOT_FOUND, "not_found")
    }
}

async fn revoke_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
    req_auth: Option<axum::Extension<RequestAuth>>,
) -> impl IntoResponse {
    if !require_session(req_auth) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let Ok(uid) = Uuid::parse_str(&id) else {
        return error_response(StatusCode::BAD_REQUEST, "bad_request");
    };
    if state
        .auth_store()
        .revoke_api_token(uid, now_ms())
        .await
        .unwrap_or(false)
    {
        Json(json!({ "ok": true })).into_response()
    } else {
        error_response(StatusCode::NOT_FOUND, "not_found")
    }
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
            sqlx::query("DELETE FROM api_token").execute(pool).await?;
            sqlx::query("DELETE FROM pairing_code").execute(pool).await?;
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
                sqlx::query("DELETE FROM api_token").execute(pool).await?;
                sqlx::query("DELETE FROM pairing_code").execute(pool).await?;
            }
        }
    }
    let _ = store.delete_all_sessions().await;
    store.delete_setting("auth.setup_complete").await?;
    store.delete_setting("auth.user_id").await?;
    let token = crate::tokens::random_token(32);
    let hash = sha256_hex(token.as_bytes());
    store.arm_setup(&hash).await?;
    let mut guard = state.setup_token.write().await;
    *guard = Some(token.clone());
    Ok(token)
}
