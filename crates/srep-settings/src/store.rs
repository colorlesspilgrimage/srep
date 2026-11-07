use anyhow::Result;
use sqlx::Row;
use srep_db::DbPool;

pub const KEY_THEME: &str = "settings.theme";
pub const KEY_KEYBINDS: &str = "settings.keybinds";
pub const KEY_DISPLAY: &str = "settings.display";

pub struct SettingsStore<'a> {
    pool: &'a DbPool,
}

impl<'a> SettingsStore<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    pub async fn get_json(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let raw = match self.pool {
            DbPool::Sqlite(p) => {
                let row = sqlx::query("SELECT value FROM app_settings WHERE key = ?")
                    .bind(key)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| r.get::<String, _>("value"))
            }
            DbPool::Postgres(p) => {
                let row = sqlx::query("SELECT value FROM app_settings WHERE key = $1")
                    .bind(key)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| r.get::<String, _>("value"))
            }
        };
        Ok(raw
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok()))
    }

    pub async fn put_json(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        let text = serde_json::to_string(value)?;
        match self.pool {
            DbPool::Sqlite(p) => {
                sqlx::query(
                    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(key)
                .bind(&text)
                .execute(p)
                .await?;
            }
            DbPool::Postgres(p) => {
                sqlx::query(
                    "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(key)
                .bind(&text)
                .execute(p)
                .await?;
            }
        }
        Ok(())
    }
}
