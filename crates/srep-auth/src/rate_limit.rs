use std::collections::HashMap;
use std::sync::Mutex;

pub type RateLimitResult = Result<(), u64>; // Err = retry_after_sec

pub struct RateLimiter {
    limit: u32,
    window_ms: i64,
    windows: Mutex<HashMap<String, (i64, u32)>>,
}

impl RateLimiter {
    pub fn new(limit: u32, window_ms: i64) -> Self {
        Self {
            limit,
            window_ms,
            windows: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, key: &str, now_ms: i64) -> RateLimitResult {
        let mut map = self.windows.lock().expect("rate limiter lock");
        if map.len() > 1000 {
            map.retain(|_, (start, _)| now_ms - *start < self.window_ms);
        }
        let entry = map.entry(key.to_string()).or_insert((now_ms, 0));
        if now_ms - entry.0 >= self.window_ms {
            *entry = (now_ms, 0);
        }
        if entry.1 >= self.limit {
            let retry_ms = entry.0 + self.window_ms - now_ms;
            let retry_sec = ((retry_ms + 999) / 1000).max(1) as u64;
            return Err(retry_sec);
        }
        entry.1 += 1;
        Ok(())
    }

    pub fn release(&self, key: &str, now_ms: i64) {
        let mut map = self.windows.lock().expect("rate limiter lock");
        if let Some(entry) = map.get_mut(key) {
            if now_ms - entry.0 < self.window_ms && entry.1 > 0 {
                entry.1 -= 1;
            }
        }
    }

    pub fn reset(&self, key: &str) {
        self.windows.lock().expect("rate limiter lock").remove(key);
    }
}
