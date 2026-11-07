use anyhow::Result;
use serde_json::json;
use sqlx::{Postgres, Row, Sqlite};
use uuid::Uuid;

use crate::session::SessionRow;
use crate::types::{
    ApiTokenRow, ChallengePurpose, CredentialRow, DeleteCredentialResult, PairingCodeRow,
    RecoveryRow,
};

pub const SETTING_SETUP_TOKEN_HASH: &str = "auth.setup_token_hash";
pub const SETTING_USER_ID: &str = "auth.user_id";

#[derive(Debug, Clone)]
pub struct ConsumedChallenge {
    pub challenge: String,
    pub purpose: ChallengePurpose,
    pub expires_at: i64,
}

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
        let Some(v) = self.get_setting("auth.setup_complete").await? else {
            return Ok(false);
        };
        if v == "true" {
            return Ok(true);
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&v) {
            return Ok(json == json!(true));
        }
        Ok(false)
    }

    pub async fn mark_setup_complete(&self) -> Result<()> {
        self.set_setting("auth.setup_complete", "true").await
    }

    pub async fn get_setup_token_hash(&self) -> Result<Option<String>> {
        self.get_setting(SETTING_SETUP_TOKEN_HASH).await
    }

    pub async fn arm_setup(&self, hash: &str) -> Result<()> {
        if !self.is_setup_complete().await? {
            self.set_setting(SETTING_SETUP_TOKEN_HASH, hash).await?;
        }
        Ok(())
    }

    pub async fn get_or_create_user_id(&self) -> Result<Uuid> {
        if let Some(existing) = self.get_setting(SETTING_USER_ID).await? {
            return Ok(Uuid::parse_str(&existing)?);
        }
        let id = Uuid::new_v4();
        self.set_setting(SETTING_USER_ID, &id.to_string()).await?;
        Ok(id)
    }

    pub async fn insert_user_id_if_absent(&self, candidate: Uuid) -> Result<Uuid> {
        if self.get_setting(SETTING_USER_ID).await?.is_none() {
            let _ = self
                .set_setting(SETTING_USER_ID, &candidate.to_string())
                .await;
        }
        self.get_or_create_user_id().await
    }

    pub async fn complete_setup(
        &self,
        credential: &CredentialRow,
        recovery: &[RecoveryRow],
        session: &SessionRow,
    ) -> Result<bool> {
        if self.sqlite.is_some() {
            self.complete_setup_sqlite(credential, recovery, session)
                .await
        } else if self.postgres.is_some() {
            self.complete_setup_postgres(credential, recovery, session)
                .await
        } else {
            Ok(false)
        }
    }

    async fn complete_setup_sqlite(
        &self,
        credential: &CredentialRow,
        recovery: &[RecoveryRow],
        session: &SessionRow,
    ) -> Result<bool> {
        let pool = self.sqlite.unwrap();
        let mut tx = pool.begin().await?;
        let locked = sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES ('auth.setup_complete', 'true') ON CONFLICT(key) DO NOTHING",
        )
        .execute(&mut *tx)
        .await?;
        if locked.rows_affected() == 0 {
            tx.rollback().await?;
            return Ok(false);
        }
        insert_credential_tx_sqlite(&mut tx, credential).await?;
        for row in recovery {
            sqlx::query("INSERT INTO auth_recovery (id, code_hash) VALUES (?, ?)")
                .bind(row.id.to_string())
                .bind(&row.code_hash)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("DELETE FROM app_settings WHERE key = ?")
            .bind(SETTING_SETUP_TOKEN_HASH)
            .execute(&mut *tx)
            .await?;
        insert_session_tx_sqlite(&mut tx, session).await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn complete_setup_postgres(
        &self,
        credential: &CredentialRow,
        recovery: &[RecoveryRow],
        session: &SessionRow,
    ) -> Result<bool> {
        let pool = self.postgres.unwrap();
        let mut tx = pool.begin().await?;
        let locked = sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES ('auth.setup_complete', 'true') ON CONFLICT(key) DO NOTHING",
        )
        .execute(&mut *tx)
        .await?;
        if locked.rows_affected() == 0 {
            tx.rollback().await?;
            return Ok(false);
        }
        insert_credential_tx_postgres(&mut tx, credential).await?;
        for row in recovery {
            sqlx::query("INSERT INTO auth_recovery (id, code_hash) VALUES ($1, $2)")
                .bind(row.id)
                .bind(&row.code_hash)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("DELETE FROM app_settings WHERE key = $1")
            .bind(SETTING_SETUP_TOKEN_HASH)
            .execute(&mut *tx)
            .await?;
        insert_session_tx_postgres(&mut tx, session).await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn insert_session(&self, session: &SessionRow) -> Result<()> {
        if let Some(pool) = self.sqlite {
            insert_session_tx_sqlite(&mut *pool.acquire().await?, session).await
        } else if let Some(pool) = self.postgres {
            insert_session_tx_postgres(&mut *pool.acquire().await?, session).await
        } else {
            Ok(())
        }
    }

    pub async fn get_session_by_token_hash(&self, hash: &str) -> Result<Option<SessionRow>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query(
                "SELECT id, token_hash, created_at, last_seen_at, expires_at, user_agent FROM session WHERE token_hash = ?",
            )
            .bind(hash)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_session_sqlite));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query(
                "SELECT id, token_hash, created_at, last_seen_at, expires_at, user_agent FROM session WHERE token_hash = $1",
            )
            .bind(hash)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_session_postgres));
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

    pub async fn list_credentials(&self) -> Result<Vec<CredentialRow>> {
        if let Some(pool) = self.sqlite {
            let rows = sqlx::query(
                "SELECT id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at FROM auth_credential ORDER BY created_at",
            )
            .fetch_all(pool)
            .await?;
            return Ok(rows.into_iter().map(map_credential_sqlite).collect());
        }
        if let Some(pool) = self.postgres {
            let rows = sqlx::query(
                "SELECT id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at FROM auth_credential ORDER BY created_at",
            )
            .fetch_all(pool)
            .await?;
            return Ok(rows.into_iter().map(map_credential_postgres).collect());
        }
        Ok(vec![])
    }

    pub async fn get_credential_by_credential_id(
        &self,
        credential_id: &str,
    ) -> Result<Option<CredentialRow>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query(
                "SELECT id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at FROM auth_credential WHERE credential_id = ?",
            )
            .bind(credential_id)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_credential_sqlite));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query(
                "SELECT id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at FROM auth_credential WHERE credential_id = $1",
            )
            .bind(credential_id)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_credential_postgres));
        }
        Ok(None)
    }

    pub async fn get_credential_by_id(&self, id: Uuid) -> Result<Option<CredentialRow>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query(
                "SELECT id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at FROM auth_credential WHERE id = ?",
            )
            .bind(id.to_string())
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_credential_sqlite));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query(
                "SELECT id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at FROM auth_credential WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_credential_postgres));
        }
        Ok(None)
    }

    pub async fn insert_credential(&self, credential: &CredentialRow) -> Result<()> {
        if let Some(pool) = self.sqlite {
            insert_credential_tx_sqlite(&mut *pool.acquire().await?, credential).await
        } else if let Some(pool) = self.postgres {
            insert_credential_tx_postgres(&mut *pool.acquire().await?, credential).await
        } else {
            Ok(())
        }
    }

    pub async fn rename_credential(&self, id: Uuid, nickname: &str) -> Result<bool> {
        if let Some(pool) = self.sqlite {
            let r = sqlx::query("UPDATE auth_credential SET nickname = ? WHERE id = ?")
                .bind(nickname)
                .bind(id.to_string())
                .execute(pool)
                .await?;
            return Ok(r.rows_affected() > 0);
        }
        if let Some(pool) = self.postgres {
            let r = sqlx::query("UPDATE auth_credential SET nickname = $1 WHERE id = $2")
                .bind(nickname)
                .bind(id)
                .execute(pool)
                .await?;
            return Ok(r.rows_affected() > 0);
        }
        Ok(false)
    }

    pub async fn delete_credential_unless_last(&self, id: Uuid) -> Result<DeleteCredentialResult> {
        if self.sqlite.is_some() {
            return self.delete_credential_sqlite(id).await;
        }
        if self.postgres.is_some() {
            return self.delete_credential_postgres(id).await;
        }
        Ok(DeleteCredentialResult::NotFound)
    }

    async fn delete_credential_sqlite(&self, id: Uuid) -> Result<DeleteCredentialResult> {
        let pool = self.sqlite.unwrap();
        let mut tx = pool.begin().await?;
        let deleted = sqlx::query(
            "DELETE FROM auth_credential WHERE id = ? AND (SELECT COUNT(*) FROM auth_credential) > 1 RETURNING id",
        )
        .bind(id.to_string())
        .fetch_optional(&mut *tx)
        .await?;
        if deleted.is_some() {
            tx.commit().await?;
            return Ok(DeleteCredentialResult::Deleted);
        }
        let exists = sqlx::query("SELECT id FROM auth_credential WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&mut *tx)
            .await?;
        tx.rollback().await?;
        Ok(if exists.is_some() {
            DeleteCredentialResult::LastCredential
        } else {
            DeleteCredentialResult::NotFound
        })
    }

    async fn delete_credential_postgres(&self, id: Uuid) -> Result<DeleteCredentialResult> {
        let pool = self.postgres.unwrap();
        let mut tx = pool.begin().await?;
        let deleted = sqlx::query(
            "DELETE FROM auth_credential WHERE id = $1 AND (SELECT COUNT(*) FROM auth_credential) > 1 RETURNING id",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        if deleted.is_some() {
            tx.commit().await?;
            return Ok(DeleteCredentialResult::Deleted);
        }
        let exists = sqlx::query("SELECT id FROM auth_credential WHERE id = $1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
        tx.rollback().await?;
        Ok(if exists.is_some() {
            DeleteCredentialResult::LastCredential
        } else {
            DeleteCredentialResult::NotFound
        })
    }

    pub async fn update_sign_count(
        &self,
        id: Uuid,
        sign_count: i64,
        last_used_at: i64,
    ) -> Result<bool> {
        let advances = if sign_count == 0 {
            "sign_count = 0"
        } else {
            "sign_count < ?"
        };
        if let Some(pool) = self.sqlite {
            let sql = format!(
                "UPDATE auth_credential SET sign_count = ?, last_used_at = ? WHERE id = ? AND {advances}"
            );
            let q = if sign_count == 0 {
                sqlx::query(&sql)
                    .bind(sign_count)
                    .bind(last_used_at)
                    .bind(id.to_string())
            } else {
                sqlx::query(&sql)
                    .bind(sign_count)
                    .bind(last_used_at)
                    .bind(id.to_string())
                    .bind(sign_count)
            };
            let r = q.execute(pool).await?;
            return Ok(r.rows_affected() > 0);
        }
        if let Some(pool) = self.postgres {
            let r = if sign_count == 0 {
                sqlx::query(
                    "UPDATE auth_credential SET sign_count = $1, last_used_at = $2 WHERE id = $3 AND sign_count = 0",
                )
                .bind(sign_count)
                .bind(last_used_at)
                .bind(id)
                .execute(pool)
                .await?
            } else {
                sqlx::query(
                    "UPDATE auth_credential SET sign_count = $1, last_used_at = $2 WHERE id = $3 AND sign_count < $1",
                )
                .bind(sign_count)
                .bind(last_used_at)
                .bind(id)
                .execute(pool)
                .await?
            };
            return Ok(r.rows_affected() > 0);
        }
        Ok(false)
    }

    pub async fn insert_challenge(
        &self,
        id: &str,
        payload: &str,
        purpose: ChallengePurpose,
        expires_at: i64,
    ) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query(
                "INSERT INTO auth_challenge (id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?)",
            )
            .bind(id)
            .bind(payload)
            .bind(purpose.as_str())
            .bind(expires_at)
            .execute(pool)
            .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query(
                "INSERT INTO auth_challenge (id, challenge, purpose, expires_at) VALUES ($1, $2, $3, $4)",
            )
            .bind(id)
            .bind(payload)
            .bind(purpose.as_str())
            .bind(expires_at)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    pub async fn consume_challenge(&self, id: &str) -> Result<Option<ConsumedChallenge>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query(
                "DELETE FROM auth_challenge WHERE id = ? RETURNING challenge, purpose, expires_at",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_challenge_sqlite));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query(
                "DELETE FROM auth_challenge WHERE id = $1 RETURNING challenge, purpose, expires_at",
            )
            .bind(id)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_challenge_postgres));
        }
        Ok(None)
    }

    pub async fn prune_challenges(&self, now: i64) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query("DELETE FROM auth_challenge WHERE expires_at <= ?")
                .bind(now)
                .execute(pool)
                .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query("DELETE FROM auth_challenge WHERE expires_at <= $1")
                .bind(now)
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    pub async fn list_unused_recovery(&self) -> Result<Vec<RecoveryRow>> {
        if let Some(pool) = self.sqlite {
            let rows = sqlx::query("SELECT id, code_hash FROM auth_recovery WHERE used_at IS NULL")
                .fetch_all(pool)
                .await?;
            return Ok(rows
                .into_iter()
                .map(|r| RecoveryRow {
                    id: Uuid::parse_str(&r.get::<String, _>("id"))
                        .unwrap_or_else(|_| Uuid::new_v4()),
                    code_hash: r.get("code_hash"),
                })
                .collect());
        }
        if let Some(pool) = self.postgres {
            let rows = sqlx::query("SELECT id, code_hash FROM auth_recovery WHERE used_at IS NULL")
                .fetch_all(pool)
                .await?;
            return Ok(rows
                .into_iter()
                .map(|r| RecoveryRow {
                    id: r.get("id"),
                    code_hash: r.get("code_hash"),
                })
                .collect());
        }
        Ok(vec![])
    }

    pub async fn consume_recovery(&self, id: Uuid, now: i64) -> Result<bool> {
        if let Some(pool) = self.sqlite {
            let r = sqlx::query(
                "UPDATE auth_recovery SET used_at = ? WHERE id = ? AND used_at IS NULL",
            )
            .bind(now)
            .bind(id.to_string())
            .execute(pool)
            .await?;
            return Ok(r.rows_affected() > 0);
        }
        if let Some(pool) = self.postgres {
            let r = sqlx::query(
                "UPDATE auth_recovery SET used_at = $1 WHERE id = $2 AND used_at IS NULL",
            )
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
            return Ok(r.rows_affected() > 0);
        }
        Ok(false)
    }

    pub async fn insert_api_token(&self, row: &ApiTokenRow) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query(
                "INSERT INTO api_token (id, token_hash, name, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(row.id.to_string())
            .bind(&row.token_hash)
            .bind(&row.name)
            .bind(row.created_at)
            .bind(row.last_used_at)
            .bind(row.revoked_at)
            .execute(pool)
            .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query(
                "INSERT INTO api_token (id, token_hash, name, created_at, last_used_at, revoked_at) VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(row.id)
            .bind(&row.token_hash)
            .bind(&row.name)
            .bind(row.created_at)
            .bind(row.last_used_at)
            .bind(row.revoked_at)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    pub async fn get_api_token_by_token_hash(&self, hash: &str) -> Result<Option<ApiTokenRow>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query(
                "SELECT id, token_hash, name, created_at, last_used_at, revoked_at FROM api_token WHERE token_hash = ?",
            )
            .bind(hash)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_api_token_sqlite));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query(
                "SELECT id, token_hash, name, created_at, last_used_at, revoked_at FROM api_token WHERE token_hash = $1",
            )
            .bind(hash)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_api_token_postgres));
        }
        Ok(None)
    }

    pub async fn list_api_tokens(&self) -> Result<Vec<ApiTokenRow>> {
        if let Some(pool) = self.sqlite {
            let rows = sqlx::query(
                "SELECT id, token_hash, name, created_at, last_used_at, revoked_at FROM api_token ORDER BY created_at",
            )
            .fetch_all(pool)
            .await?;
            return Ok(rows.into_iter().map(map_api_token_sqlite).collect());
        }
        if let Some(pool) = self.postgres {
            let rows = sqlx::query(
                "SELECT id, token_hash, name, created_at, last_used_at, revoked_at FROM api_token ORDER BY created_at",
            )
            .fetch_all(pool)
            .await?;
            return Ok(rows.into_iter().map(map_api_token_postgres).collect());
        }
        Ok(vec![])
    }

    pub async fn rename_api_token(&self, id: Uuid, name: &str) -> Result<bool> {
        if let Some(pool) = self.sqlite {
            let r =
                sqlx::query("UPDATE api_token SET name = ? WHERE id = ? AND revoked_at IS NULL")
                    .bind(name)
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
            return Ok(r.rows_affected() > 0);
        }
        if let Some(pool) = self.postgres {
            let r =
                sqlx::query("UPDATE api_token SET name = $1 WHERE id = $2 AND revoked_at IS NULL")
                    .bind(name)
                    .bind(id)
                    .execute(pool)
                    .await?;
            return Ok(r.rows_affected() > 0);
        }
        Ok(false)
    }

    pub async fn revoke_api_token(&self, id: Uuid, now: i64) -> Result<bool> {
        if let Some(pool) = self.sqlite {
            let r = sqlx::query(
                "UPDATE api_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
            )
            .bind(now)
            .bind(id.to_string())
            .execute(pool)
            .await?;
            return Ok(r.rows_affected() > 0);
        }
        if let Some(pool) = self.postgres {
            let r = sqlx::query(
                "UPDATE api_token SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL",
            )
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
            return Ok(r.rows_affected() > 0);
        }
        Ok(false)
    }

    pub async fn touch_api_token(&self, id: Uuid, now: i64) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query("UPDATE api_token SET last_used_at = ? WHERE id = ?")
                .bind(now)
                .bind(id.to_string())
                .execute(pool)
                .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query("UPDATE api_token SET last_used_at = $1 WHERE id = $2")
                .bind(now)
                .bind(id)
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    pub async fn count_active_api_tokens(&self) -> Result<i64> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query("SELECT COUNT(*) AS c FROM api_token WHERE revoked_at IS NULL")
                .fetch_one(pool)
                .await?;
            return Ok(row.get::<i64, _>("c"));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query("SELECT COUNT(*) AS c FROM api_token WHERE revoked_at IS NULL")
                .fetch_one(pool)
                .await?;
            return Ok(row.get::<i64, _>("c"));
        }
        Ok(0)
    }

    pub async fn insert_pairing_code(&self, row: &PairingCodeRow) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query(
                "INSERT INTO pairing_code (id, code_hash, name, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(row.id.to_string())
            .bind(&row.code_hash)
            .bind(&row.name)
            .bind(row.created_at)
            .bind(row.expires_at)
            .bind(row.consumed_at)
            .execute(pool)
            .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query(
                "INSERT INTO pairing_code (id, code_hash, name, created_at, expires_at, consumed_at) VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(row.id)
            .bind(&row.code_hash)
            .bind(&row.name)
            .bind(row.created_at)
            .bind(row.expires_at)
            .bind(row.consumed_at)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    pub async fn invalidate_open_pairing_codes(&self, now: i64) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query(
                "UPDATE pairing_code SET consumed_at = ? WHERE consumed_at IS NULL AND expires_at > ?",
            )
            .bind(now)
            .bind(now)
            .execute(pool)
            .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query(
                "UPDATE pairing_code SET consumed_at = $1 WHERE consumed_at IS NULL AND expires_at > $2",
            )
            .bind(now)
            .bind(now)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    pub async fn get_open_pairing_code_by_hash(
        &self,
        code_hash: &str,
        now: i64,
    ) -> Result<Option<PairingCodeRow>> {
        if let Some(pool) = self.sqlite {
            let row = sqlx::query(
                "SELECT id, code_hash, name, created_at, expires_at, consumed_at FROM pairing_code WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
            )
            .bind(code_hash)
            .bind(now)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_pairing_sqlite));
        }
        if let Some(pool) = self.postgres {
            let row = sqlx::query(
                "SELECT id, code_hash, name, created_at, expires_at, consumed_at FROM pairing_code WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > $2",
            )
            .bind(code_hash)
            .bind(now)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_pairing_postgres));
        }
        Ok(None)
    }

    pub async fn consume_pairing_code(&self, id: Uuid, now: i64) -> Result<bool> {
        if let Some(pool) = self.sqlite {
            let r = sqlx::query(
                "UPDATE pairing_code SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
            )
            .bind(now)
            .bind(id.to_string())
            .execute(pool)
            .await?;
            return Ok(r.rows_affected() > 0);
        }
        if let Some(pool) = self.postgres {
            let r = sqlx::query(
                "UPDATE pairing_code SET consumed_at = $1 WHERE id = $2 AND consumed_at IS NULL",
            )
            .bind(now)
            .bind(id)
            .execute(pool)
            .await?;
            return Ok(r.rows_affected() > 0);
        }
        Ok(false)
    }

    pub async fn prune_pairing_codes(&self, now: i64) -> Result<()> {
        if let Some(pool) = self.sqlite {
            sqlx::query(
                "DELETE FROM pairing_code WHERE expires_at <= ? OR consumed_at IS NOT NULL",
            )
            .bind(now)
            .execute(pool)
            .await?;
        } else if let Some(pool) = self.postgres {
            sqlx::query(
                "DELETE FROM pairing_code WHERE expires_at <= $1 OR consumed_at IS NOT NULL",
            )
            .bind(now)
            .execute(pool)
            .await?;
        }
        Ok(())
    }
}

fn map_session_sqlite(r: sqlx::sqlite::SqliteRow) -> SessionRow {
    SessionRow {
        id: Uuid::parse_str(&r.get::<String, _>("id")).unwrap_or_else(|_| Uuid::new_v4()),
        token_hash: r.get("token_hash"),
        created_at: r.get("created_at"),
        last_seen_at: r.get("last_seen_at"),
        expires_at: r.get("expires_at"),
        user_agent: r.get("user_agent"),
    }
}

fn map_session_postgres(r: sqlx::postgres::PgRow) -> SessionRow {
    SessionRow {
        id: r.get("id"),
        token_hash: r.get("token_hash"),
        created_at: r.get("created_at"),
        last_seen_at: r.get("last_seen_at"),
        expires_at: r.get("expires_at"),
        user_agent: r.get("user_agent"),
    }
}

fn map_credential_sqlite(r: sqlx::sqlite::SqliteRow) -> CredentialRow {
    let id = Uuid::parse_str(&r.get::<String, _>("id")).unwrap_or_else(|_| Uuid::new_v4());
    let transports: String = r.get("transports");
    let transports: Vec<String> = serde_json::from_str(&transports).unwrap_or_default();
    CredentialRow {
        id,
        credential_id: r.get("credential_id"),
        public_key: r.get("public_key"),
        sign_count: r.get("sign_count"),
        transports,
        kind: r.get("kind"),
        nickname: r.get("nickname"),
        created_at: r.get("created_at"),
        last_used_at: r.get("last_used_at"),
    }
}

fn map_credential_postgres(r: sqlx::postgres::PgRow) -> CredentialRow {
    let id: Uuid = r.get("id");
    let transports: String = r.get("transports");
    let transports: Vec<String> = serde_json::from_str(&transports).unwrap_or_default();
    CredentialRow {
        id,
        credential_id: r.get("credential_id"),
        public_key: r.get("public_key"),
        sign_count: r.get("sign_count"),
        transports,
        kind: r.get("kind"),
        nickname: r.get("nickname"),
        created_at: r.get("created_at"),
        last_used_at: r.get("last_used_at"),
    }
}

fn map_challenge_sqlite(r: sqlx::sqlite::SqliteRow) -> ConsumedChallenge {
    let purpose: String = r.get("purpose");
    ConsumedChallenge {
        challenge: r.get("challenge"),
        purpose: ChallengePurpose::parse(&purpose).unwrap_or(ChallengePurpose::Login),
        expires_at: r.get("expires_at"),
    }
}

fn map_challenge_postgres(r: sqlx::postgres::PgRow) -> ConsumedChallenge {
    let purpose: String = r.get("purpose");
    ConsumedChallenge {
        challenge: r.get("challenge"),
        purpose: ChallengePurpose::parse(&purpose).unwrap_or(ChallengePurpose::Login),
        expires_at: r.get("expires_at"),
    }
}

fn map_api_token_sqlite(r: sqlx::sqlite::SqliteRow) -> ApiTokenRow {
    ApiTokenRow {
        id: Uuid::parse_str(&r.get::<String, _>("id")).unwrap_or_else(|_| Uuid::new_v4()),
        token_hash: r.get("token_hash"),
        name: r.get("name"),
        created_at: r.get("created_at"),
        last_used_at: r.get("last_used_at"),
        revoked_at: r.get("revoked_at"),
    }
}

fn map_api_token_postgres(r: sqlx::postgres::PgRow) -> ApiTokenRow {
    ApiTokenRow {
        id: r.get("id"),
        token_hash: r.get("token_hash"),
        name: r.get("name"),
        created_at: r.get("created_at"),
        last_used_at: r.get("last_used_at"),
        revoked_at: r.get("revoked_at"),
    }
}

fn map_pairing_sqlite(r: sqlx::sqlite::SqliteRow) -> PairingCodeRow {
    PairingCodeRow {
        id: Uuid::parse_str(&r.get::<String, _>("id")).unwrap_or_else(|_| Uuid::new_v4()),
        code_hash: r.get("code_hash"),
        name: r.get("name"),
        created_at: r.get("created_at"),
        expires_at: r.get("expires_at"),
        consumed_at: r.get("consumed_at"),
    }
}

fn map_pairing_postgres(r: sqlx::postgres::PgRow) -> PairingCodeRow {
    PairingCodeRow {
        id: r.get("id"),
        code_hash: r.get("code_hash"),
        name: r.get("name"),
        created_at: r.get("created_at"),
        expires_at: r.get("expires_at"),
        consumed_at: r.get("consumed_at"),
    }
}

async fn insert_session_tx_sqlite(
    conn: &mut sqlx::sqlite::SqliteConnection,
    session: &SessionRow,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO session (id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(session.id.to_string())
    .bind(&session.token_hash)
    .bind(session.created_at)
    .bind(session.last_seen_at)
    .bind(session.expires_at)
    .bind(&session.user_agent)
    .execute(conn)
    .await?;
    Ok(())
}

async fn insert_session_tx_postgres(
    conn: &mut sqlx::postgres::PgConnection,
    session: &SessionRow,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO session (id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(session.id)
    .bind(&session.token_hash)
    .bind(session.created_at)
    .bind(session.last_seen_at)
    .bind(session.expires_at)
    .bind(&session.user_agent)
    .execute(conn)
    .await?;
    Ok(())
}

async fn insert_credential_tx_sqlite(
    conn: &mut sqlx::sqlite::SqliteConnection,
    credential: &CredentialRow,
) -> Result<()> {
    let transports = serde_json::to_string(&credential.transports)?;
    sqlx::query(
        "INSERT INTO auth_credential (id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(credential.id.to_string())
    .bind(&credential.credential_id)
    .bind(&credential.public_key)
    .bind(credential.sign_count)
    .bind(transports)
    .bind(&credential.kind)
    .bind(&credential.nickname)
    .bind(credential.created_at)
    .bind(credential.last_used_at)
    .execute(conn)
    .await?;
    Ok(())
}

async fn insert_credential_tx_postgres(
    conn: &mut sqlx::postgres::PgConnection,
    credential: &CredentialRow,
) -> Result<()> {
    let transports = serde_json::to_string(&credential.transports)?;
    sqlx::query(
        "INSERT INTO auth_credential (id, credential_id, public_key, sign_count, transports, kind, nickname, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(credential.id)
    .bind(&credential.credential_id)
    .bind(&credential.public_key)
    .bind(credential.sign_count)
    .bind(transports)
    .bind(&credential.kind)
    .bind(&credential.nickname)
    .bind(credential.created_at)
    .bind(credential.last_used_at)
    .execute(conn)
    .await?;
    Ok(())
}
