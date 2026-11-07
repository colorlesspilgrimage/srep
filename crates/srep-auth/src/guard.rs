//! API path guard (mirrors `api-guard.ts`).

use crate::tokens::{csrf_token_for, safe_equal};

const PUBLIC_API_ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/auth/status"),
    ("POST", "/api/auth/setup/options"),
    ("POST", "/api/auth/setup/verify"),
    ("POST", "/api/auth/login/options"),
    ("POST", "/api/auth/login/verify"),
    ("POST", "/api/auth/recovery/login"),
    ("POST", "/api/auth/pairing/exchange"),
];

const ORIGIN_EXEMPT: &[(&str, &str)] = &[("POST", "/api/auth/pairing/exchange")];

pub fn decode_route_path(pathname: &str) -> Option<String> {
    let parts: Result<Vec<_>, _> = pathname
        .split("%25")
        .map(|s| urlencoding::decode(s))
        .collect();
    match parts {
        Ok(v) => Some(v.iter().map(|s| s.as_ref()).collect::<Vec<_>>().join("%25")),
        Err(_) => None,
    }
}

pub fn is_api_path(pathname: &str) -> bool {
    pathname == "/api" || pathname.starts_with("/api/")
}

pub fn is_public_api_route(method: &str, pathname: &str) -> bool {
    PUBLIC_API_ROUTES
        .iter()
        .any(|(m, p)| *m == method && *p == pathname)
}

pub fn is_origin_exempt(method: &str, pathname: &str) -> bool {
    ORIGIN_EXEMPT
        .iter()
        .any(|(m, p)| *m == method && *p == pathname)
}

pub fn is_mutating(method: &str) -> bool {
    !matches!(method, "GET" | "HEAD" | "OPTIONS")
}

pub fn check_origin(origin: Option<&str>, expected: &str) -> bool {
    origin.is_some_and(|o| o == expected)
}

pub fn check_csrf(header: Option<&str>, raw_session_token: &str) -> bool {
    let Some(value) = header.filter(|s| !s.is_empty()) else {
        return false;
    };
    safe_equal(value, &csrf_token_for(raw_session_token))
}
