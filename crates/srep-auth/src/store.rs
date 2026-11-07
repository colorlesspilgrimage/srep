use anyhow::Result;
use sqlx::{Postgres, Row, Sqlite};
use uuid::Uuid;

use crate::session::SessionRow;

pub const SETTING_SETUP_TOKEN_HASH: &str = "auth.setup_token_hash";
pub const SETTING_USER_ID: &str = "auth.user_id";

pub struct AuthStore<'a> {
    pub dialect: &'a str,
    pub sqlite: Option<&'a sqlx::Pool<Sqlite>>,
    pub postgres: Option<&'a sqlx::Pool<Postgres>>,
}

impl<'a> AuthStore<'a> {
    pub fn new_sqlite(pool: &'a sqlx::Pool<Sqlite>) -> Self {
        Self {
            dialect: "sqlite",
            sqlite: Some(pool),
            postgres: None,
        }
    }

    pub fn new_postgres(pool: &'a sqlx::Pool<Postgres>) -> Self {
        Self {
            dialect: "postgres",
            sqlite: None,
            postgres: Some(pool),
        }
    }

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query("SELECT value FROM app_settings WHERE key = ?")
                .bind(key)
                .fetch_optional(pool)
                .await?;
            Ok(row.map(|r| r.get::<String, _>("value")))
        } else if let Some(pool) = self.postgres {
            let row = sqlx::query("SELECT value FROM app_settings WHERE key = $1")
                .bind(key)
                .fetch_optional(pool)
                .await?;
            Ok(row.map(|r| r.get::<String, _>("value")))
        } else {
            Ok(None)
        }
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(key)
            .bind(value)
            .execute(pool)
            .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query(
                "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(key)
            .bind(value)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    pub async fn delete_setting(&self, key: &str) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query("DELETE FROM app_settings WHERE key = ?")
                .bind(key)
                .execute(pool)
                .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query("DELETE FROM app_settings WHERE key = $1")
                .bind(key)
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    pub async fn is_setup_complete(&self) -> Result<bool> {
        Ok(self.get_setting("auth.setup_complete").await?.as_deref() == Some("true"))
    }

    pub async fn mark_setup_complete(&self) -> Result<()> {
        self.set_setting("auth.setup_complete", "true").await
    }

    pub async fn get_setup_token_hash(&self) -> Result<Option<String>> {
        self.get_setting(SETTING_SETUP_TOKEN_HASH).await
    }

    pub async fn arm_setup(&self, hash: &str) -> Result<()> {
        self.set_setting(SETTING_SETUP_TOKEN_HASH, hash).await
    }

    pub async fn get_or_create_user_id(&self) -> Result<Uuid> {
        if let Some(existing) = self.get_setting(SETTING_USER_ID).await? {
            return Ok(Uuid::parse_str(&existing)?);
        }
        let id = Uuid::new_v4();
        self.set_setting(SETTING_USER_ID, &id.to_string()).await?;
        Ok(id)
    }

    pub async fn insert_session(&self, session: &SessionRow) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query(
                "INSERT INTO session (id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(session.id.to_string())
            .bind(&session.token_hash)
            .bind(session.created_at)
            .bind(session.last_seen_at)
            .bind(session.expires_at)
            .bind(&session.user_agent)
            .execute(pool)
            .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query(
                "INSERT INTO session (id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(session.id)
            .bind(&session.token_hash)
            .bind(session.created_at)
            .bind(session.last_seen_at)
            .bind(session.expires_at)
            .bind(&session.user_agent)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    pub async fn get_session_by_token_hash(&self, hash: &str) -> Result<Option<SessionRow>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query(
                "SELECT id, token_hash, created_at, last_seen_at, expires_at, user_agent FROM session WHERE token_hash = ?",
            )
            .bind(hash)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(|r| SessionRow {
                id: Uuid::parse_str(&r.get::<String, _>("id")).unwrap_or_else(|_| Uuid::new_v4()),
                token_hash: r.get("token_hash"),
                created_at: r.get("created_at"),
                last_seen_at: r.get("last_seen_at"),
                expires_at: r.get("expires_at"),
                user_agent: r.get("user_agent"),
            }));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query(
                "SELECT id, token_hash, created_at, last_seen_at, expires_at, user_agent FROM session WHERE token_hash = $1",
            )
            .bind(hash)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(|r| SessionRow {
                id: r.get("id"),
                token_hash: r.get("token_hash"),
                created_at: r.get("created_at"),
                last_seen_at: r.get("last_seen_at"),
                expires_at: r.get("expires_at"),
                user_agent: r.get("user_agent"),
            }));
        }
        Ok(None)
    }

    pub async fn delete_session(&self, id: Uuid) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query("DELETE FROM session WHERE id = ?")
                .bind(id.to_string())
                .execute(pool)
                .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query("DELETE FROM session WHERE id = $1")
                .bind(id)
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    pub async fn delete_all_sessions(&self) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query("DELETE FROM session").execute(pool).await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query("DELETE FROM session").execute(pool).await?;
        }
        Ok(())
    }

    pub async fn touch_session(&self, id: Uuid, now_ms: i64) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query("UPDATE session SET last_seen_at = ? WHERE id = ?")
                .bind(now_ms)
                .bind(id.to_string())
                .execute(pool)
                .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query("UPDATE session SET last_seen_at = $1 WHERE id = $2")
                .bind(now_ms)
                .bind(id)
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    pub async fn count_credentials(&self) -> Result<i64> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query("SELECT COUNT(*) AS c FROM auth_credential")
                .fetch_one(pool)
                .await?;
            Ok(row.get::<i64, _>("c"))
        } else if let Some(pool) = self.postgres {
            let row = sqlx::query("SELECT COUNT(*) AS c FROM auth_credential")
                .fetch_one(pool)
                .await?;
            Ok(row.get::<i64, _>("c"))
        } else {
            Ok(0)
        }
    }
}
