mod common;

use srep_auth::limiters::AuthLimiters;
use srep_auth::state::AppState;
use srep_auth::webauthn::WebAuthnState;
use srep_domain::builtin::DEFAULT_PRESET_ID;
use srep_domain::core::validation::{DeckCreateInput, PresetInput};
use srep_domain::deps::DomainCtx;
use srep_domain::service::decks;
use srep_domain::service::presets;
use srep_domain::store::DomainStore;
use std::sync::Arc;

const UNKNOWN: &str = "123e4567-e89b-42d3-a456-426614174000";

fn preset_input(name: &str) -> PresetInput {
    PresetInput {
        name: name.into(),
        new_per_day: 20,
        reviews_per_day: 200,
        desired_retention: 0.9,
        learning_steps: vec![1, 10],
        relearning_steps: vec![10],
        max_interval: 36_500,
        fsrs_params: None,
        bury_siblings: false,
        new_order: "added".into(),
    }
}

fn test_config() -> Arc<srep_config::Config> {
    Arc::new(srep_config::Config {
        database: srep_config::DatabaseConfig::Sqlite {
            path: std::path::PathBuf::from("/tmp/unused.db"),
        },
        log_level: srep_config::LogLevel::Info,
        migrations_dir: None,
        migrate_on_start: false,
        auth: srep_config::AuthConfig {
            origin: "http://localhost:3000".into(),
            rp_id: "localhost".into(),
            rp_name: "srep".into(),
        },
        media_dir: std::path::PathBuf::from("/tmp/media"),
        media_max_bytes: 1,
        import_max_bytes: 1,
        host: "127.0.0.1".into(),
        port: 0,
    })
}

#[tokio::test]
async fn preset_crud() {
    let (pool, _dir) = common::test_pool().await;
    DomainStore::new(&pool).ensure_seeded().await.unwrap();
    let config = test_config();
    let state = AppState {
        config: config.clone(),
        db: pool.clone(),
        webauthn: Arc::new(WebAuthnState::new(&config.auth).unwrap()),
        setup_token: Default::default(),
        limiters: Arc::new(AuthLimiters::new()),
        simulation_clock: None,
    };
    let ctx = DomainCtx::new(&state);

    let created = presets::create_preset(&ctx, preset_input("Fast"))
        .await
        .unwrap();
    let listed = presets::list_presets(&ctx).await.unwrap();
    assert!(listed.iter().any(|p| p.name == "Default"));
    assert!(listed.iter().any(|p| p.name == "Fast"));

    let updated = presets::update_preset(&ctx, &created.id, preset_input("Faster"))
        .await
        .unwrap();
    assert_eq!(updated.name, "Faster");

    presets::delete_preset(&ctx, &created.id).await.unwrap();
    let again = presets::delete_preset(&ctx, &created.id).await;
    assert_eq!(
        again.err().unwrap().status,
        axum::http::StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn builtin_protected_and_in_use() {
    let (pool, _dir) = common::test_pool().await;
    DomainStore::new(&pool).ensure_seeded().await.unwrap();
    let config = test_config();
    let state = AppState {
        config: config.clone(),
        db: pool.clone(),
        webauthn: Arc::new(WebAuthnState::new(&config.auth).unwrap()),
        setup_token: Default::default(),
        limiters: Arc::new(AuthLimiters::new()),
        simulation_clock: None,
    };
    let ctx = DomainCtx::new(&state);

    let protected = presets::delete_preset(&ctx, DEFAULT_PRESET_ID).await;
    assert_eq!(protected.err().unwrap().error, "builtin_protected");

    let used = presets::create_preset(&ctx, preset_input("Used"))
        .await
        .unwrap();
    decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "D".into(),
            parent_id: None,
            preset_id: Some(used.id.clone()),
            description: None,
        },
    )
    .await
    .unwrap();

    let in_use = presets::delete_preset(&ctx, &used.id).await;
    assert_eq!(in_use.err().unwrap().error, "in_use");

    let dup = presets::create_preset(&ctx, preset_input("Used")).await;
    assert_eq!(dup.err().unwrap().error, "name_taken");

    let missing = presets::update_preset(&ctx, UNKNOWN, preset_input("Z")).await;
    assert_eq!(
        missing.err().unwrap().status,
        axum::http::StatusCode::NOT_FOUND
    );
}
