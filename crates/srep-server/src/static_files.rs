use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Redirect, Response},
};
use rust_embed::Embed;
use srep_auth::session::{evaluate_session, now_ms, SessionState};
use srep_auth::tokens::sha256_hex;
use srep_auth::AppState;
use srep_settings::{keybinds, theme, KeybindMap, SettingsStore};
use uuid::Uuid;

use crate::spa_shell::{self, ShellPrefs};

#[derive(Embed)]
#[folder = "../../site/"]
struct SiteAssets;

const GUEST_PAGES: &[&str] = &["/login", "/setup"];

fn security_headers(
    config: &srep_config::AuthConfig,
    nonce: Option<&str>,
) -> Vec<(header::HeaderName, HeaderValue)> {
    let script_src = match nonce {
        Some(n) => format!("script-src 'self' 'wasm-unsafe-eval' 'nonce-{n}'"),
        None => "script-src 'self' 'wasm-unsafe-eval'".to_string(),
    };
    let csp = [
        "default-src 'none'",
        script_src.as_str(),
        "style-src 'self'",
        "style-src-attr 'unsafe-hashes' 'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=' 'sha256-aqNNdDLnnrDOnTNdkJpYlAxKVJtLt9CtFLklmInuUAE='",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
    .join("; ");
    let mut headers = vec![
        (
            header::HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ),
        (
            header::HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ),
        (
            header::HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("no-referrer"),
        ),
        (
            header::HeaderName::from_static("cross-origin-opener-policy"),
            HeaderValue::from_static("same-origin"),
        ),
        (
            header::HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("same-origin"),
        ),
        (
            header::HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static(
                "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()",
            ),
        ),
        (
            header::HeaderName::from_static("content-security-policy"),
            HeaderValue::from_str(&csp).unwrap_or(HeaderValue::from_static("default-src 'self'")),
        ),
    ];
    if config.origin.starts_with("https://") {
        headers.push((
            header::HeaderName::from_static("strict-transport-security"),
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ));
    }
    headers
}

fn is_static_asset(path: &str) -> bool {
    path.contains('.')
        || path.starts_with("icons/")
        || path == "manifest.webmanifest"
        || path == "app.css"
        || path == "themes.css"
}

async fn session_authenticated(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(cookie_hdr) = headers.get(header::COOKIE) else {
        return false;
    };
    let Ok(cookie_str) = cookie_hdr.to_str() else {
        return false;
    };
    let raw = cookie::Cookie::split_parse(cookie_str)
        .filter_map(|c| c.ok())
        .find(|c| c.name() == "srep_session")
        .map(|c| c.value().to_string());
    let Some(raw) = raw else {
        return false;
    };
    let hash = sha256_hex(raw.as_bytes());
    let Ok(Some(row)) = state.auth_store().get_session_by_token_hash(&hash).await else {
        return false;
    };
    matches!(
        evaluate_session(row.last_seen_at, row.expires_at, now_ms()),
        SessionState::Valid
    )
}

fn apply_private_headers(response: &mut Response) {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("vary"),
        HeaderValue::from_static("Cookie"),
    );
}

fn apply_headers(mut response: Response, state: &AppState, nonce: Option<&str>) -> Response {
    for (name, value) in security_headers(&state.config.auth, nonce) {
        response.headers_mut().insert(name, value);
    }
    response
}

async fn shell_prefs(state: &AppState) -> ShellPrefs {
    let store = SettingsStore::new(&state.db);
    let theme_id = theme::get_theme(&store)
        .await
        .unwrap_or_else(|_| spa_shell::normalize_theme("xai-dark"));
    let keybinds = keybinds::get_keybinds(&store)
        .await
        .unwrap_or_else(|_| KeybindMap::default());
    ShellPrefs { theme_id, keybinds }
}

fn personalize_html(html: &str, path: &str, prefs: &ShellPrefs) -> String {
    spa_shell::inject_spa_html(html, path, prefs)
}

pub async fn serve_static_or_spa(
    State(state): State<AppState>,
    uri: Uri,
    headers: HeaderMap,
) -> impl IntoResponse {
    let path = uri.path();
    let trimmed = path.trim_start_matches('/');
    let file_key = if trimmed.is_empty() {
        "index.html"
    } else {
        trimmed
    };

    if GUEST_PAGES.contains(&path) {
        if session_authenticated(&state, &headers).await {
            return Redirect::temporary("/").into_response();
        }
    } else if !path.starts_with("/api")
        && !is_static_asset(trimmed)
        && !session_authenticated(&state, &headers).await
    {
        let location = if state.auth_store().is_setup_complete().await.unwrap_or(false) {
            "/login"
        } else {
            "/setup"
        };
        let mut resp = Redirect::to(location).into_response();
        *resp.status_mut() = StatusCode::SEE_OTHER;
        apply_private_headers(&mut resp);
        return apply_headers(resp, &state, None);
    }

    let authed = session_authenticated(&state, &headers).await;

    if let Some(content) = SiteAssets::get(file_key) {
        let mime = mime_guess::from_path(file_key).first_or_octet_stream();
        let bytes = content.data.into_owned();
        let body_bytes = if mime.as_ref().starts_with("text/html") && authed && file_key == "index.html"
        {
            let prefs = shell_prefs(&state).await;
            let base = String::from_utf8_lossy(&bytes).into_owned();
            personalize_html(&base, path, &prefs).into_bytes()
        } else {
            bytes
        };
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime.as_ref())
            .body(Body::from(body_bytes))
            .unwrap();
        if mime.as_ref().starts_with("text/html") {
            apply_private_headers(&mut response);
            let nonce = Uuid::new_v4().simple().to_string();
            let nonce_ref = nonce.as_str();
            response = apply_headers(response, &state, Some(nonce_ref));
        }
        return response;
    }

    if let Some(index) = SiteAssets::get("index.html") {
        let nonce = Uuid::new_v4().simple().to_string();
        let nonce_ref = nonce.as_str();
        let mut body = index.data.into_owned();
        if authed {
            let prefs = shell_prefs(&state).await;
            let base = String::from_utf8_lossy(&body).into_owned();
            body = personalize_html(&base, path, &prefs).into_bytes();
        }
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(body))
            .unwrap();
        apply_private_headers(&mut response);
        response = apply_headers(response, &state, Some(nonce_ref));
        return response;
    }

    StatusCode::NOT_FOUND.into_response()
}
