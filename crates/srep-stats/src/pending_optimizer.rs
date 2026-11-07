use std::collections::HashMap;
use std::sync::Mutex;

const TTL_MS: i64 = 15 * 60 * 1000;

#[derive(Clone)]
pub struct PendingOptimizer {
    pub preset_id: String,
    pub proposed_desired_retention: f64,
    pub proposed_fsrs_params: Vec<f64>,
    pub expires_at: i64,
}

static PENDING: Mutex<Option<HashMap<String, PendingOptimizer>>> = Mutex::new(None);

fn map() -> std::sync::MutexGuard<'static, Option<HashMap<String, PendingOptimizer>>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

fn ensure() -> HashMap<String, PendingOptimizer> {
    let mut guard = map();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard.take().unwrap()
}

fn store(m: HashMap<String, PendingOptimizer>) {
    *map() = Some(m);
}

pub fn prune(now_ms: i64) {
    let mut m = ensure();
    m.retain(|_, v| v.expires_at > now_ms);
    store(m);
}

pub fn stash_preview(
    token: String,
    preset_id: String,
    desired: f64,
    fsrs_params: Vec<f64>,
    now_ms: i64,
) {
    prune(now_ms);
    let mut m = ensure();
    m.insert(
        token,
        PendingOptimizer {
            preset_id,
            proposed_desired_retention: desired,
            proposed_fsrs_params: fsrs_params,
            expires_at: now_ms + TTL_MS,
        },
    );
    store(m);
}

pub fn take_preview(token: &str, now_ms: i64) -> Option<PendingOptimizer> {
    prune(now_ms);
    let mut m = ensure();
    let entry = m.remove(token)?;
    if entry.expires_at <= now_ms {
        store(m);
        return None;
    }
    store(m);
    Some(entry)
}
