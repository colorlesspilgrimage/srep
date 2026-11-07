use srep_config::{AuthConfig, Config, DatabaseConfig, LogLevel};
use srep_db::{connect, run_migrations, DbPool};
use std::path::PathBuf;

pub async fn test_pool() -> (DbPool, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let migrations = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../migrations/sqlite");
    let config = Config {
        database: DatabaseConfig::Sqlite { path: db_path },
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

