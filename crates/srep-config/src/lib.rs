//! Environment configuration (mirrors `src/lib/server/config.ts`).

use std::path::PathBuf;
use thiserror::Error;
use url::Url;

pub const DEFAULT_MEDIA_MAX_BYTES: u64 = 10 * 1024 * 1024;
pub const DEFAULT_IMPORT_MAX_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone)]
pub enum DatabaseConfig {
    Sqlite { path: PathBuf },
    Postgres { url: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Fatal,
    Error,
    Warn,
    Info,
    Debug,
    Trace,
    Silent,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub origin: String,
    pub rp_id: String,
    pub rp_name: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub database: DatabaseConfig,
    pub log_level: LogLevel,
    pub migrations_dir: Option<PathBuf>,
    pub migrate_on_start: bool,
    pub auth: AuthConfig,
    pub media_dir: PathBuf,
    pub media_max_bytes: u64,
    pub import_max_bytes: u64,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{0}")]
    Message(String),
}

fn parse_log_level(raw: &str) -> Result<LogLevel, ConfigError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "fatal" => Ok(LogLevel::Fatal),
        "error" => Ok(LogLevel::Error),
        "warn" => Ok(LogLevel::Warn),
        "info" => Ok(LogLevel::Info),
        "debug" => Ok(LogLevel::Debug),
        "trace" => Ok(LogLevel::Trace),
        "silent" => Ok(LogLevel::Silent),
        _ => Err(ConfigError::Message(format!(
            "SREP_LOG_LEVEL: unknown level {raw:?}"
        ))),
    }
}

pub fn parse_database_url(url: &str) -> Result<DatabaseConfig, ConfigError> {
    let url = url.trim();
    if url.is_empty() {
        return Err(ConfigError::Message(
            "SREP_DATABASE_URL must not be empty".into(),
        ));
    }
    if let Some(path) = url.strip_prefix("sqlite:") {
        let path = path.trim();
        if path.is_empty() {
            return Err(ConfigError::Message(
                "SREP_DATABASE_URL: sqlite path must not be empty".into(),
            ));
        }
        if path.contains('\0') {
            return Err(ConfigError::Message(
                "SREP_DATABASE_URL: sqlite path must not contain NUL".into(),
            ));
        }
        return Ok(DatabaseConfig::Sqlite {
            path: PathBuf::from(path),
        });
    }
    if url.starts_with("postgres://") || url.starts_with("postgresql://") {
        let parsed = Url::parse(url)
            .map_err(|_| ConfigError::Message("SREP_DATABASE_URL: invalid postgres URL".into()))?;
        if parsed.host_str().unwrap_or("").is_empty() {
            return Err(ConfigError::Message(
                "SREP_DATABASE_URL: postgres URL needs a host".into(),
            ));
        }
        return Ok(DatabaseConfig::Postgres { url: url.into() });
    }
    Err(ConfigError::Message(
        "SREP_DATABASE_URL: must start with sqlite:, postgres://, or postgresql://".into(),
    ))
}

pub fn redact_database_url(url: &str) -> String {
    if url.starts_with("sqlite:") {
        return url.to_string();
    }
    match Url::parse(url) {
        Ok(parsed) => {
            let port = parsed.port().map(|p| format!(":{p}")).unwrap_or_default();
            format!(
                "postgres://{}{}{}",
                parsed.host_str().unwrap_or(""),
                port,
                parsed.path()
            )
        }
        Err(_) => "postgres://invalid".into(),
    }
}

/// Load configuration from process environment (production defaults match Docker).
pub fn from_env() -> Result<Config, ConfigError> {
    let db_raw = std::env::var("SREP_DATABASE_URL")
        .map_err(|_| ConfigError::Message("SREP_DATABASE_URL is required".into()))?;
    let database = parse_database_url(&db_raw)?;

    let log_level =
        parse_log_level(&std::env::var("SREP_LOG_LEVEL").unwrap_or_else(|_| "info".into()))?;

    let migrate_on_start = std::env::var("SREP_MIGRATE_ON_START")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(true);

    let migrations_dir = std::env::var("SREP_MIGRATIONS_DIR").ok().map(PathBuf::from);

    let origin = std::env::var("SREP_ORIGIN")
        .or_else(|_| std::env::var("ORIGIN"))
        .unwrap_or_else(|_| "http://localhost:3000".into());
    let rp_id = std::env::var("SREP_RP_ID").unwrap_or_else(|_| {
        Url::parse(&origin)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_else(|| "localhost".into())
    });
    let rp_name = std::env::var("SREP_RP_NAME").unwrap_or_else(|_| "srep".into());

    let media_dir = std::env::var("SREP_MEDIA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/data/media"));

    let media_max_bytes = std::env::var("SREP_MEDIA_MAX_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_MEDIA_MAX_BYTES);

    let import_max_bytes = std::env::var("SREP_IMPORT_MAX_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_IMPORT_MAX_BYTES);

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3000);

    Ok(Config {
        database,
        log_level,
        migrations_dir,
        migrate_on_start,
        auth: AuthConfig {
            origin,
            rp_id,
            rp_name,
        },
        media_dir,
        media_max_bytes,
        import_max_bytes,
        host,
        port,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_url_parses() {
        let db = parse_database_url("sqlite:/tmp/x.db").unwrap();
        assert!(matches!(db, DatabaseConfig::Sqlite { .. }));
    }
}
