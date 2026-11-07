mod common;

use srep_domain::builtin::DEFAULT_PRESET_ID;
use srep_domain::core::validation::{DeckCreateInput, PresetInput};
use srep_auth::limiters::AuthLimiters;
use srep_auth::state::AppState;
use srep_auth::webauthn::WebAuthnState;
use srep_domain::deps::DomainCtx;
use srep_domain::service::decks;
use srep_domain::service::presets;
use srep_domain::store::DomainStore;
use std::sync::Arc;

const UNKNOWN: &str = "123e4567-e89b-42d3-a456-426614174000";

fn app_state(pool: &srep_db::DbPool, media: std::path::PathBuf) -> (AppState, Arc<srep_config::Config>) {
    let config = light_config(media);
    let state = AppState {
        config: config.clone(),
        db: pool.clone(),
        webauthn: Arc::new(WebAuthnState::new(&config.auth).unwrap()),
        setup_token: Default::default(),
        limiters: Arc::new(AuthLimiters::new()),
    };
    (state, config)
}

fn light_config(media: std::path::PathBuf) -> Arc<srep_config::Config> {
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
        media_dir: media,
        media_max_bytes: 1,
        import_max_bytes: 1,
        host: "127.0.0.1".into(),
        port: 0,
    })
}

#[tokio::test]
async fn create_list_and_rename_decks() {
    let (pool, _dir) = common::test_pool().await;
    let store = DomainStore::new(&pool);
    store.ensure_seeded().await.unwrap();
    let (state, _) = app_state(&pool, std::path::PathBuf::from("/tmp/media"));
    let ctx = DomainCtx::new(&state);

    let root = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: " Languages ".into(),
            parent_id: None,
            preset_id: None,
            description: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(root.name, "Languages");
    assert_eq!(root.path, "Languages");

    let child = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Japanese".into(),
            parent_id: Some(root.id.clone()),
            preset_id: None,
            description: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(child.path, "Languages::Japanese");
    assert_eq!(child.preset_id, root.preset_id);

    let dup = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Japanese".into(),
            parent_id: Some(root.id.clone()),
            preset_id: None,
            description: None,
        },
    )
    .await;
    assert_eq!(dup.err().unwrap().error, "deck_name_taken");

    let all = decks::list_decks(&ctx).await.unwrap();
    assert_eq!(
        all.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(),
        vec!["Languages", "Languages::Japanese"]
    );
}

#[tokio::test]
async fn preset_inheritance_and_unknown_parent() {
    let (pool, _dir) = common::test_pool().await;
    DomainStore::new(&pool).ensure_seeded().await.unwrap();
    let (state, _) = app_state(&pool, std::path::PathBuf::from("/tmp/media2"));
    let ctx = DomainCtx::new(&state);

    let other = presets::create_preset(
        &ctx,
        PresetInput {
            name: "Other".into(),
            new_per_day: 20,
            reviews_per_day: 200,
            desired_retention: 0.9,
            learning_steps: vec![1, 10],
            relearning_steps: vec![10],
            max_interval: 36_500,
            fsrs_params: None,
            bury_siblings: false,
            new_order: "added".into(),
        },
    )
    .await
    .unwrap();

    let root = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Languages".into(),
            parent_id: None,
            preset_id: Some(other.id.clone()),
            description: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(root.preset_id, other.id);

    let missing = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "X".into(),
            parent_id: Some(UNKNOWN.into()),
            preset_id: None,
            description: None,
        },
    )
    .await;
    assert_eq!(missing.err().unwrap().status, axum::http::StatusCode::NOT_FOUND);

    let bad_preset = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Y".into(),
            parent_id: None,
            preset_id: Some(UNKNOWN.into()),
            description: None,
        },
    )
    .await;
    assert_eq!(bad_preset.err().unwrap().status, axum::http::StatusCode::NOT_FOUND);

    let solo = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Solo".into(),
            parent_id: None,
            preset_id: None,
            description: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(solo.preset_id, DEFAULT_PRESET_ID);
}
