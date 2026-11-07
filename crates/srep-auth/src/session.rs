use chrono::Utc;
use uuid::Uuid;

use crate::tokens::{random_token, sha256_hex};

pub const SESSION_IDLE_MS: i64 = 7 * 24 * 60 * 60 * 1000;
pub const SESSION_ABSOLUTE_MS: i64 = 30 * 24 * 60 * 60 * 1000;
pub const TOUCH_INTERVAL_MS: i64 = 60 * 1000;

#[derive(Debug, Clone)]
pub struct SessionRow {
    pub id: Uuid,
    pub token_hash: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
    pub user_agent: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Valid,
    IdleExpired,
    AbsoluteExpired,
}

pub fn new_session_times(now_ms: i64) -> (i64, i64, i64) {
    (now_ms, now_ms, now_ms + SESSION_ABSOLUTE_MS)
}

pub fn evaluate_session(last_seen_at: i64, expires_at: i64, now_ms: i64) -> SessionState {
    if now_ms >= expires_at {
        SessionState::AbsoluteExpired
    } else if now_ms >= last_seen_at + SESSION_IDLE_MS {
        SessionState::IdleExpired
    } else {
        SessionState::Valid
    }
}

pub fn should_touch(last_seen_at: i64, now_ms: i64) -> bool {
    now_ms - last_seen_at >= TOUCH_INTERVAL_MS
}

pub struct NewSession {
    pub row: SessionRow,
    pub raw_token: String,
    pub max_age_sec: i64,
}

pub fn build_session(now_ms: i64, user_agent: &str) -> NewSession {
    let raw_token = random_token(32);
    let (created_at, last_seen_at, expires_at) = new_session_times(now_ms);
    let ua = user_agent.chars().take(256).collect::<String>();
    NewSession {
        row: SessionRow {
            id: Uuid::new_v4(),
            token_hash: sha256_hex(raw_token.as_bytes()),
            created_at,
            last_seen_at,
            expires_at,
            user_agent: ua,
        },
        raw_token,
        max_age_sec: SESSION_ABSOLUTE_MS / 1000,
    }
}

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}
