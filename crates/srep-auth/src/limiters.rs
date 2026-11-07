use std::sync::Arc;

use crate::rate_limit::RateLimiter;

pub const SETUP_FAILURE_KEY: &str = "setup";
pub const RECOVERY_FAILURE_KEY: &str = "recovery";
pub const PAIRING_FAILURE_KEY: &str = "pairing";

const MINUTE_MS: i64 = 60 * 1000;

#[derive(Clone)]
pub struct AuthLimiters {
    pub auth_attempts: Arc<RateLimiter>,
    pub setup_token_failures: Arc<RateLimiter>,
    pub recovery_failures: Arc<RateLimiter>,
    pub pairing_failures: Arc<RateLimiter>,
}

impl AuthLimiters {
    pub fn new() -> Self {
        Self {
            auth_attempts: Arc::new(RateLimiter::new(20, 5 * MINUTE_MS)),
            setup_token_failures: Arc::new(RateLimiter::new(5, 15 * MINUTE_MS)),
            recovery_failures: Arc::new(RateLimiter::new(5, 15 * MINUTE_MS)),
            pairing_failures: Arc::new(RateLimiter::new(10, 15 * MINUTE_MS)),
        }
    }
}

impl Default for AuthLimiters {
    fn default() -> Self {
        Self::new()
    }
}
