use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn healthz_ok_on_sqlite() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("test.db");
    std::env::set_var("SREP_DATABASE_URL", format!("sqlite:{}", db.display()));
    std::env::set_var("SREP_ORIGIN", "http://localhost:3999");
    std::env::set_var("SREP_RP_ID", "localhost");
    std::env::set_var("PORT", "3999");

    let config = Arc::new(srep_config::from_env().unwrap());
    let pool = srep_db::connect(&config).await.unwrap();
    srep_db::run_migrations(&pool, &config).await.unwrap();
    let webauthn = Arc::new(srep_auth::webauthn::WebAuthnState::new(&config.auth).unwrap());
    let state = srep_auth::AppState {
        config: config.clone(),
        db: pool,
        webauthn,
        setup_token: Default::default(),
        limiters: std::sync::Arc::new(srep_auth::limiters::AuthLimiters::new()),
    };

    let app = srep_server::build_app(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(200)).await;

    let resp = reqwest::get(format!("http://127.0.0.1:{port}/healthz"))
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap();
    assert_eq!(resp["status"], "ok");
}
