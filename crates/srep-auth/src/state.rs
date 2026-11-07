use std::sync::Arc;

use srep_config::Config;
use srep_db::DbPool;
use tokio::sync::RwLock;

use crate::limiters::AuthLimiters;
use crate::store::AuthStore;
use crate::webauthn::WebAuthnState;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: DbPool,
    pub webauthn: Arc<WebAuthnState>,
    pub setup_token: Arc<RwLock<Option<String>>>,
    pub limiters: Arc<AuthLimiters>,
}

impl AppState {
    pub fn auth_store(&self) -> AuthStore<'_> {
        match &self.db {
            DbPool::Sqlite(p) => AuthStore::new_sqlite(p),
            DbPool::Postgres(p) => AuthStore::new_postgres(p),
        }
    }

    pub async fn ensure_setup_token(&self) -> Option<String> {
        let store = self.auth_store();
        if store.is_setup_complete().await.ok() == Some(true) {
            return None;
        }
        let mut guard = self.setup_token.write().await;
        if guard.is_none() {
            if let Ok(Some(hash)) = store.get_setup_token_hash().await {
                // token was armed earlier; we cannot recover raw token
                let _ = hash;
            } else {
                let token = crate::tokens::random_token(32);
                let hash = crate::tokens::sha256_hex(token.as_bytes());
                let _ = store.arm_setup(&hash).await;
                *guard = Some(token);
            }
        }
        guard.clone()
    }
}
