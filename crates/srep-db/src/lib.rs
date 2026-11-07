//! Database pool and migrations (dual SQLite / Postgres).

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Postgres, Sqlite};
use srep_config::{Config, DatabaseConfig};
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;
use tracing::info;

#[derive(Clone)]
pub enum DbPool {
    Sqlite(Pool<Sqlite>),
    Postgres(Pool<Postgres>),
}

impl DbPool {
    pub async fn ping(&self) -> Result<()> {
        match self {
            DbPool::Sqlite(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
            DbPool::Postgres(p) => {
                sqlx::query("SELECT 1").execute(p).await?;
            }
        }
        Ok(())
    }

    pub fn dialect(&self) -> &'static str {
        match self {
            DbPool::Sqlite(_) => "sqlite",
            DbPool::Postgres(_) => "postgres",
        }
    }

    pub fn sqlite(&self) -> Option<&Pool<Sqlite>> {
        match self {
            DbPool::Sqlite(p) => Some(p),
            _ => None,
        }
    }

    pub fn postgres(&self) -> Option<&Pool<Postgres>> {
        match self {
            DbPool::Postgres(p) => Some(p),
            _ => None,
        }
    }
}

fn default_migrations_dir(dialect: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("migrations")
        .join(dialect)
}

pub async fn connect(config: &Config) -> Result<DbPool> {
    match &config.database {
        DatabaseConfig::Sqlite { path } => {
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .with_context(|| format!("create sqlite parent {}", parent.display()))?;
            }
            let opts = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))?
                .create_if_missing(true)
                .foreign_keys(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
                .busy_timeout(Duration::from_secs(30));
            let pool = SqlitePoolOptions::new()
                .max_connections(5)
                .connect_with(opts)
                .await
                .context("connect sqlite")?;
            Ok(DbPool::Sqlite(pool))
        }
        DatabaseConfig::Postgres { url } => {
            let pool = PgPoolOptions::new()
                .max_connections(5)
                .connect(url)
                .await
                .context("connect postgres")?;
            Ok(DbPool::Postgres(pool))
        }
    }
}

pub async fn run_migrations(pool: &DbPool, config: &Config) -> Result<()> {
    let dialect = pool.dialect();
    let folder = config
        .migrations_dir
        .clone()
        .unwrap_or_else(|| default_migrations_dir(dialect));

    if !folder.is_dir() {
        anyhow::bail!("migrations folder missing: {}", folder.display());
    }

    let mut entries: Vec<PathBuf> = std::fs::read_dir(&folder)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "sql"))
        .collect();
    entries.sort();

    for path in entries {
        let sql = std::fs::read_to_string(&path)
            .with_context(|| format!("read migration {}", path.display()))?;
        apply_migration_sql(pool, &sql)
            .await
            .with_context(|| format!("apply migration {}", path.display()))?;
    }

    info!(dialect, folder = %folder.display(), "migrations applied");
    Ok(())
}

async fn apply_migration_sql(pool: &DbPool, sql: &str) -> Result<()> {
    let cleaned = sql.replace("--> statement-breakpoint", ";");
    for statement in split_sql_statements(&cleaned) {
        let trimmed = statement.trim();
        if trimmed.is_empty() {
            continue;
        }
        match pool {
            DbPool::Sqlite(p) => {
                sqlx::query(trimmed).execute(p).await?;
            }
            DbPool::Postgres(p) => {
                let pg_sql = sqlite_to_postgres(trimmed);
                sqlx::query(&pg_sql).execute(p).await?;
            }
        }
    }
    Ok(())
}

/// Naive statement splitter (drizzle migrations avoid semicolons inside strings).
fn split_sql_statements(sql: &str) -> Vec<String> {
    sql.split(';')
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .collect()
}

/// Drizzle sqlite migrations use backticks; Postgres copies use unquoted identifiers in pg folder.
fn sqlite_to_postgres(sql: &str) -> String {
    if sql.contains('`') {
        sql.replace('`', "\"")
    } else {
        sql.to_string()
    }
}

pub(crate) fn migrations_folder_for_tests(dialect: &str) -> PathBuf {
    default_migrations_dir(dialect)
}

#[cfg(test)]
mod tests {
    use super::*;
    use srep_config::{AuthConfig, Config, DatabaseConfig, LogLevel};

    #[tokio::test]
    async fn sqlite_migrate_and_ping() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let config = Config {
            database: DatabaseConfig::Sqlite {
                path: db_path.clone(),
            },
            log_level: LogLevel::Info,
            migrations_dir: Some(migrations_folder_for_tests("sqlite")),
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
        };
        let pool = connect(&config).await.unwrap();
        run_migrations(&pool, &config).await.unwrap();
        pool.ping().await.unwrap();
    }
}
