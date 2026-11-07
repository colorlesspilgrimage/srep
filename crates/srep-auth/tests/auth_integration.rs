use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use srep_auth::limiters::AuthLimiters;
use srep_auth::rate_limit::RateLimiter;
use srep_auth::recovery_codes::{
    generate_recovery_codes, hash_recovery_code, normalize_recovery_code, verify_recovery_code,
};
use srep_auth::routes::router;
use srep_auth::state::AppState;
use srep_auth::text::{is_short_text, normalize_nickname};
use srep_auth::tokens::sha256_hex;
use srep_auth::webauthn::WebAuthnState;
use srep_auth::pairing::{hash_pairing_code, normalize_pairing_code, random_pairing_code};
use srep_config::{AuthConfig, Config, DatabaseConfig, LogLevel};
use srep_db::{connect, run_migrations};
use tower::ServiceExt;

fn test_config(dir: &tempfile::TempDir) -> Config {
    Config {
        database: DatabaseConfig::Sqlite {
            path: dir.path().join("test.db"),
        },
        log_level: LogLevel::Info,
        migrations_dir: Some(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../migrations/sqlite"),
        ),
        migrate_on_start: true,
        auth: AuthConfig {
            origin: "http://localhost:3000".into(),
            rp_id: "localhost".into(),
            rp_name: "srep".into(),
        },
        media_dir: dir.path().join("media"),
        media_max_bytes: 1,
        import_max_bytes: 1,
        host: "127.0.0.1".into(),
        port: 0,
    }
}

async fn test_state() -> (AppState, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let config = Arc::new(test_config(&dir));
    let pool = connect(&config).await.unwrap();
    run_migrations(&pool, &config).await.unwrap();
    let webauthn = Arc::new(WebAuthnState::new(&config.auth).unwrap());
    let state = AppState {
        config,
        db: pool,
        webauthn,
        setup_token: Default::default(),
        limiters: Arc::new(AuthLimiters::new()),
    };
    let token = state.ensure_setup_token().await.unwrap();
    let hash = sha256_hex(token.as_bytes());
    state
        .auth_store()
        .arm_setup(&hash)
        .await
        .unwrap();
    (state, dir)
}

#[tokio::test]
async fn auth_status_before_setup() {
    let (state, _dir) = test_state().await;
    let app = router().with_state(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn setup_options_rejects_bad_token() {
    let (state, _dir) = test_state().await;
    let app = router().with_state(state);
    let body = serde_json::json!({
        "setupToken": "wrong",
        "kind": "passkey",
        "nickname": "Laptop"
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/setup/options")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn store_recovery_roundtrip() {
    let (state, _dir) = test_state().await;
    let store = state.auth_store();
    let code = generate_recovery_codes(1).pop().unwrap();
    let hash = hash_recovery_code(&code).unwrap();
    assert!(verify_recovery_code(&code, &hash));
    assert!(normalize_recovery_code(&code).is_some());
    store
        .insert_challenge("x", "{}", srep_auth::types::ChallengePurpose::Setup, 0)
        .await
        .unwrap();
    let _ = store.consume_challenge("x").await.unwrap();
}

#[test]
fn recovery_code_normalize() {
    assert!(normalize_recovery_code("00000-00000").is_some());
    assert!(normalize_recovery_code("bad").is_none());
}

#[test]
fn pairing_code_hash_stable() {
    let code = random_pairing_code();
    let h1 = hash_pairing_code(&code).unwrap();
    let h2 = hash_pairing_code(&code).unwrap();
    assert_eq!(h1, h2);
    assert!(normalize_pairing_code(&code).is_some());
}

#[test]
fn nickname_validation() {
    assert!(normalize_nickname("  ok  ").is_some());
    assert!(normalize_nickname("").is_none());
    assert!(!is_short_text("\u{0000}"));
}

#[test]
fn rate_limiter_blocks_over_limit() {
    let lim = RateLimiter::new(2, 60_000);
    let now = 1_000_000;
    assert!(lim.check("k", now).is_ok());
    assert!(lim.check("k", now).is_ok());
    assert!(lim.check("k", now).is_err());
}

#[tokio::test]
async fn list_credentials_requires_session() {
    let (state, _dir) = test_state().await;
    let app = router().with_state(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/credentials")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
