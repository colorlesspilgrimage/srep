use std::collections::HashMap;
use std::sync::Mutex;

use crate::detect_format::ImportFormat;

const TTL_MS: i64 = 15 * 60 * 1000;

#[derive(Clone)]
pub struct PendingImport {
    pub format: ImportFormat,
    pub bytes: Vec<u8>,
    pub expires_at: i64,
}

static PENDING: Mutex<Option<HashMap<String, PendingImport>>> = Mutex::new(None);

fn map() -> std::sync::MutexGuard<'static, Option<HashMap<String, PendingImport>>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

fn ensure() -> HashMap<String, PendingImport> {
    let mut guard = map();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard.take().unwrap()
}

fn store(m: HashMap<String, PendingImport>) {
    *map() = Some(m);
}

pub fn prune(now_ms: i64) {
    let mut m = ensure();
    m.retain(|_, v| v.expires_at > now_ms);
    store(m);
}

pub fn stash_pending(entry: PendingImport, now_ms: i64) -> String {
    prune(now_ms);
    let token = uuid::Uuid::new_v4().to_string();
    let mut m = ensure();
    m.insert(token.clone(), entry);
    store(m);
    token
}

pub fn take_pending(token: &str, now_ms: i64) -> Option<PendingImport> {
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
