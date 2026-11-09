use sqlx::Row;
use srep_auth::limiters::AuthLimiters;
use srep_auth::state::AppState;
use srep_auth::webauthn::WebAuthnState;
use srep_config::{AuthConfig, Config, DatabaseConfig, LogLevel};
use srep_db::{connect, run_migrations, DbPool};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub async fn test_pool() -> (DbPool, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let database_url = std::env::var("SREP_DATABASE_URL").unwrap_or_default();
    let postgres =
        database_url.starts_with("postgres://") || database_url.starts_with("postgresql://");

    let database = if postgres {
        DatabaseConfig::Postgres { url: database_url }
    } else {
        DatabaseConfig::Sqlite {
            path: dir.path().join("test.db"),
        }
    };
    let migrations = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(if postgres {
        "../../migrations/postgres"
    } else {
        "../../migrations/sqlite"
    });
    let config = Config {
        database,
        log_level: LogLevel::Info,
        migrations_dir: Some(migrations),
        migrate_on_start: true,
        auth: AuthConfig {
            origin: "http://localhost:3000".into(),
            rp_id: "localhost".into(),
            rp_name: "srep".into(),
        },
        media_dir: dir.path().join("media"),
        media_max_bytes: 1024 * 1024,
        import_max_bytes: 1024 * 1024,
        host: "127.0.0.1".into(),
        port: 0,
    };
    let pool = connect(&config).await.unwrap();
    run_migrations(&pool, &config).await.unwrap();
    (pool, dir)
}

pub fn app_state(pool: &DbPool, media: std::path::PathBuf) -> AppState {
    let config = Arc::new(Config {
        database: DatabaseConfig::Sqlite {
            path: std::path::PathBuf::from("/tmp/unused.db"),
        },
        log_level: LogLevel::Info,
        migrations_dir: None,
        migrate_on_start: false,
        auth: AuthConfig {
            origin: "http://localhost:3000".into(),
            rp_id: "localhost".into(),
            rp_name: "srep".into(),
        },
        media_dir: media,
        media_max_bytes: 1,
        import_max_bytes: 1,
        host: "127.0.0.1".into(),
        port: 0,
    });
    AppState {
        config,
        db: pool.clone(),
        webauthn: Arc::new(
            WebAuthnState::new(&AuthConfig {
                origin: "http://localhost:3000".into(),
                rp_id: "localhost".into(),
                rp_name: "srep".into(),
            })
            .unwrap(),
        ),
        setup_token: Default::default(),
        limiters: Arc::new(AuthLimiters::new()),
    }
}

#[derive(Clone)]
pub enum Arg {
    I64(i64),
    F64(f64),
    Text(String),
    Bool(bool),
}

fn dialect_sql<'a>(pool: &DbPool, sqlite: &'a str, postgres: &'a str) -> &'a str {
    match pool.dialect() {
        "sqlite" => sqlite,
        "postgres" => postgres,
        other => panic!("unsupported test dialect: {other}"),
    }
}

pub async fn execute(pool: &DbPool, sql: &str, args: Vec<Arg>) {
    match pool {
        DbPool::Sqlite(inner) => {
            let mut query = sqlx::query(sql);
            for arg in args {
                query = match arg {
                    Arg::I64(value) => query.bind(value),
                    Arg::F64(value) => query.bind(value),
                    Arg::Text(value) => query.bind(value),
                    Arg::Bool(value) => query.bind(value),
                };
            }
            query
                .execute(inner)
                .await
                .unwrap_or_else(|error| panic!("SQL failed ({sql}): {error}"));
        }
        DbPool::Postgres(inner) => {
            let mut query = sqlx::query(sql);
            for arg in args {
                query = match arg {
                    Arg::I64(value) => query.bind(value),
                    Arg::F64(value) => query.bind(value),
                    Arg::Text(value) => query.bind(value),
                    Arg::Bool(value) => query.bind(value),
                };
            }
            query
                .execute(inner)
                .await
                .unwrap_or_else(|error| panic!("SQL failed ({sql}): {error}"));
        }
    }
}

pub async fn fetch_i64(pool: &DbPool, sql: &str, args: Vec<Arg>) -> i64 {
    match pool {
        DbPool::Sqlite(inner) => {
            let mut query = sqlx::query(sql);
            for arg in args {
                query = match arg {
                    Arg::I64(value) => query.bind(value),
                    Arg::F64(value) => query.bind(value),
                    Arg::Text(value) => query.bind(value),
                    Arg::Bool(value) => query.bind(value),
                };
            }
            query
                .fetch_one(inner)
                .await
                .unwrap_or_else(|error| panic!("SQL failed ({sql}): {error}"))
                .get(0)
        }
        DbPool::Postgres(inner) => {
            let mut query = sqlx::query(sql);
            for arg in args {
                query = match arg {
                    Arg::I64(value) => query.bind(value),
                    Arg::F64(value) => query.bind(value),
                    Arg::Text(value) => query.bind(value),
                    Arg::Bool(value) => query.bind(value),
                };
            }
            query
                .fetch_one(inner)
                .await
                .unwrap_or_else(|error| panic!("SQL failed ({sql}): {error}"))
                .get(0)
        }
    }
}

pub async fn fetch_all_i64(pool: &DbPool, sql: &str, args: Vec<Arg>) -> Vec<i64> {
    match pool {
        DbPool::Sqlite(inner) => {
            let mut query = sqlx::query(sql);
            for arg in args {
                query = match arg {
                    Arg::I64(value) => query.bind(value),
                    Arg::F64(value) => query.bind(value),
                    Arg::Text(value) => query.bind(value),
                    Arg::Bool(value) => query.bind(value),
                };
            }
            query
                .fetch_all(inner)
                .await
                .unwrap_or_else(|error| panic!("SQL failed ({sql}): {error}"))
                .into_iter()
                .map(|row| row.get(0))
                .collect()
        }
        DbPool::Postgres(inner) => {
            let mut query = sqlx::query(sql);
            for arg in args {
                query = match arg {
                    Arg::I64(value) => query.bind(value),
                    Arg::F64(value) => query.bind(value),
                    Arg::Text(value) => query.bind(value),
                    Arg::Bool(value) => query.bind(value),
                };
            }
            query
                .fetch_all(inner)
                .await
                .unwrap_or_else(|error| panic!("SQL failed ({sql}): {error}"))
                .into_iter()
                .map(|row| row.get(0))
                .collect()
        }
    }
}

fn placeholders(pool: &DbPool, len: usize) -> String {
    (0..len)
        .map(|index| match pool.dialect() {
            "sqlite" => "?".to_string(),
            "postgres" => format!("${}", index + 1),
            other => panic!("unsupported test dialect: {other}"),
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn card_args(card_ids: &[String]) -> Vec<Arg> {
    card_ids.iter().cloned().map(Arg::Text).collect::<Vec<_>>()
}

pub async fn review_log_count(pool: &DbPool, card_ids: &[String]) -> i64 {
    assert!(!card_ids.is_empty());
    let sql = format!(
        "SELECT COUNT(*) FROM review_log WHERE card_id IN ({})",
        placeholders(pool, card_ids.len())
    );
    fetch_i64(pool, &sql, card_args(card_ids)).await
}

pub async fn reviewed_at_for_cards(pool: &DbPool, card_ids: &[String]) -> Vec<i64> {
    assert!(!card_ids.is_empty());
    let sql = format!(
        "SELECT reviewed_at FROM review_log WHERE card_id IN ({})",
        placeholders(pool, card_ids.len())
    );
    fetch_all_i64(pool, &sql, card_args(card_ids)).await
}

pub async fn card_reps(pool: &DbPool, card_id: &str) -> i64 {
    let sql = dialect_sql(
        pool,
        "SELECT reps FROM card WHERE id = ?",
        "SELECT reps FROM card WHERE id = $1",
    );
    fetch_i64(pool, sql, vec![Arg::Text(card_id.to_string())]).await
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub struct SeedIds {
    pub deck_id: String,
    pub note_id: String,
    pub template_id: String,
    pub card_ids: Vec<String>,
}

pub async fn seed_deck(
    pool: &DbPool,
    card_count: usize,
    new_per_day: i64,
    reviews_per_day: i64,
) -> SeedIds {
    let unique = Uuid::new_v4().to_string();
    let preset_id = Uuid::new_v4().to_string();
    let deck_id = Uuid::new_v4().to_string();
    let note_type_id = Uuid::new_v4().to_string();
    let template_id = Uuid::new_v4().to_string();
    let note_id = Uuid::new_v4().to_string();

    let sql = dialect_sql(
        pool,
        "INSERT INTO deck_preset (id, name, new_per_day, reviews_per_day, desired_retention, learning_steps, relearning_steps, max_interval, fsrs_params, bury_siblings, new_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        "INSERT INTO deck_preset (id, name, new_per_day, reviews_per_day, desired_retention, learning_steps, relearning_steps, max_interval, fsrs_params, bury_siblings, new_order) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11)",
    );
    execute(
        pool,
        sql,
        vec![
            Arg::Text(preset_id.clone()),
            Arg::Text(format!("sync-preset-{unique}")),
            Arg::I64(new_per_day),
            Arg::I64(reviews_per_day),
            Arg::F64(0.9),
            Arg::Text("[1,10]".into()),
            Arg::Text("[10]".into()),
            Arg::I64(36500),
            Arg::Text("null".into()),
            Arg::Bool(false),
            Arg::Text("added".into()),
        ],
    )
    .await;

    let sql = dialect_sql(
        pool,
        "INSERT INTO deck (id, parent_id, name, path, preset_id, description, archived_at) VALUES (?,NULL,?,?,?,?,NULL)",
        "INSERT INTO deck (id, parent_id, name, path, preset_id, description, archived_at) VALUES ($1,NULL,$2,$3,$4,$5,NULL)",
    );
    execute(
        pool,
        sql,
        vec![
            Arg::Text(deck_id.clone()),
            Arg::Text(format!("sync-deck-{unique}")),
            Arg::Text(format!("sync-test-{unique}")),
            Arg::Text(preset_id),
            Arg::Text(String::new()),
        ],
    )
    .await;

    let sql = dialect_sql(
        pool,
        "INSERT INTO note_type (id, name, fields, css_class, sort_field_idx) VALUES (?,?,?,?,?)",
        "INSERT INTO note_type (id, name, fields, css_class, sort_field_idx) VALUES ($1,$2,$3::jsonb,$4,$5)",
    );
    execute(
        pool,
        sql,
        vec![
            Arg::Text(note_type_id.clone()),
            Arg::Text(format!("sync-note-type-{unique}")),
            Arg::Text("[\"Front\",\"Back\"]".into()),
            Arg::Text(String::new()),
            Arg::I64(0),
        ],
    )
    .await;

    let sql = dialect_sql(
        pool,
        "INSERT INTO card_template (id, note_type_id, name, ordinal, front_tpl, back_tpl) VALUES (?,?,?,?,?,?)",
        "INSERT INTO card_template (id, note_type_id, name, ordinal, front_tpl, back_tpl) VALUES ($1,$2,$3,$4,$5,$6)",
    );
    execute(
        pool,
        sql,
        vec![
            Arg::Text(template_id.clone()),
            Arg::Text(note_type_id.clone()),
            Arg::Text("Card 1".into()),
            Arg::I64(0),
            Arg::Text("{{Front}}".into()),
            Arg::Text("{{Front}}<hr>{{Back}}".into()),
        ],
    )
    .await;

    let timestamp = now_ms();
    let sql = dialect_sql(
        pool,
        "INSERT INTO note (id, note_type_id, guid, fields, created_at, updated_at, checksum, deleted_at) VALUES (?,?,?,?,?,?,?,NULL)",
        "INSERT INTO note (id, note_type_id, guid, fields, created_at, updated_at, checksum, deleted_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,NULL)",
    );
    execute(
        pool,
        sql,
        vec![
            Arg::Text(note_id.clone()),
            Arg::Text(note_type_id),
            Arg::Text(Uuid::new_v4().to_string()),
            Arg::Text("[\"Q\",\"A\"]".into()),
            Arg::I64(timestamp),
            Arg::I64(timestamp),
            Arg::Text("test".into()),
        ],
    )
    .await;

    let mut card_ids = Vec::with_capacity(card_count);
    for position in 0..card_count {
        card_ids.push(
            seed_card_at(
                pool,
                &deck_id,
                &note_id,
                &template_id,
                "new",
                "new",
                0,
                position as i64,
            )
            .await,
        );
    }

    SeedIds {
        deck_id,
        note_id,
        template_id,
        card_ids,
    }
}

pub async fn seed_card(
    pool: &DbPool,
    deck_id: &str,
    note_id: &str,
    template_id: &str,
    state: &str,
    sched_state: &str,
    reps: i64,
    ordinal: i64,
) -> String {
    seed_card_at(
        pool,
        deck_id,
        note_id,
        template_id,
        state,
        sched_state,
        reps,
        ordinal,
    )
    .await
}

async fn seed_card_at(
    pool: &DbPool,
    deck_id: &str,
    note_id: &str,
    template_id: &str,
    state: &str,
    sched_state: &str,
    reps: i64,
    position: i64,
) -> String {
    let card_id = Uuid::new_v4().to_string();
    let sql = dialect_sql(
        pool,
        "INSERT INTO card (id, note_id, template_id, ordinal, deck_id, state, sched_state, due, stability, difficulty, last_review, reps, lapses, position, buried_until, flags, learning_step) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,NULL,?,?)",
        "INSERT INTO card (id, note_id, template_id, ordinal, deck_id, state, sched_state, due, stability, difficulty, last_review, reps, lapses, position, buried_until, flags, learning_step) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,$13,NULL,$14,$15)",
    );
    execute(
        pool,
        sql,
        vec![
            Arg::Text(card_id.clone()),
            Arg::Text(note_id.to_string()),
            Arg::Text(template_id.to_string()),
            Arg::I64(position),
            Arg::Text(deck_id.to_string()),
            Arg::Text(state.to_string()),
            Arg::Text(sched_state.to_string()),
            Arg::I64(0),
            Arg::F64(0.0),
            Arg::F64(0.0),
            Arg::I64(reps),
            Arg::I64(0),
            Arg::I64(position),
            Arg::I64(0),
            Arg::I64(0),
        ],
    )
    .await;
    card_id
}
