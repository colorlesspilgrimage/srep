use std::sync::Arc;

use srep_auth::AppState;
use srep_config::Config;

use crate::store::DomainStore;

pub struct DomainCtx<'a> {
    pub state: &'a AppState,
}

impl<'a> DomainCtx<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn store(&self) -> DomainStore<'a> {
        DomainStore::new(&self.state.db)
    }

    pub fn config(&self) -> &Arc<Config> {
        &self.state.config
    }

    pub fn now_ms(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
}
