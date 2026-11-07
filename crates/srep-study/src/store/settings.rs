use crate::store::convert::study_settings_json;
use crate::types::StudySettings;
use anyhow::Result;
use srep_db::DbPool;

pub const STUDY_SETTINGS_KEY: &str = "study";

pub async fn get_settings(pool: &DbPool) -> Result<Option<serde_json::Value>> {
    match pool {
        DbPool::Sqlite(p) => {
            let row: Option<(String,)> =
                sqlx::query_as("SELECT value FROM app_settings WHERE key = ?")
                    .bind(STUDY_SETTINGS_KEY)
                    .fetch_optional(p)
                    .await?;
            Ok(row.map(|(v,)| serde_json::from_str(&v).unwrap_or(serde_json::Value::Null)))
        }
        DbPool::Postgres(p) => {
            let row: Option<(serde_json::Value,)> =
                sqlx::query_as("SELECT value FROM app_settings WHERE key = $1")
                    .bind(STUDY_SETTINGS_KEY)
                    .fetch_optional(p)
                    .await?;
            Ok(row.map(|(v,)| v))
        }
    }
}

pub async fn put_settings(pool: &DbPool, value: &StudySettings) -> Result<()> {
    let json = study_settings_json(value);
    let text = serde_json::to_string(&json)?;
    match pool {
        DbPool::Sqlite(p) => {
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(STUDY_SETTINGS_KEY)
            .bind(&text)
            .execute(p)
            .await?;
        }
        DbPool::Postgres(p) => {
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(STUDY_SETTINGS_KEY)
            .bind(&json)
            .execute(p)
            .await?;
        }
    }
    Ok(())
}
