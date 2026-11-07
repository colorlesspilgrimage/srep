use rand::RngCore;

use crate::session::now_ms;
use crate::store::AuthStore;
use crate::text::is_short_text;
use crate::tokens::{random_token, sha256_hex};
use crate::types::{ApiTokenRow, PairingCodeRow, CHALLENGE_TTL_MS};
use uuid::Uuid;

pub const PAIRING_CODE_TTL_MS: i64 = CHALLENGE_TTL_MS;
pub const API_TOKEN_TOUCH_MS: i64 = 60 * 1000;
pub const MAX_API_TOKENS: i64 = 20;
pub const PAIRING_CODE_LENGTH: usize = 8;

const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub fn random_pairing_code() -> String {
    let mut buf = [0u8; PAIRING_CODE_LENGTH];
    rand::thread_rng().fill_bytes(&mut buf);
    let mut out = String::with_capacity(PAIRING_CODE_LENGTH);
    for b in buf {
        out.push(ALPHABET[(b as usize) % ALPHABET.len()] as char);
    }
    format!("{}-{}", &out[..4], &out[4..])
}

pub fn normalize_pairing_code(input: &str) -> Option<String> {
    let mut mapped = String::new();
    for c in input.trim().to_uppercase().chars() {
        if c == '-' || c == ' ' {
            continue;
        }
        let c = match c {
            'I' | 'L' => '1',
            'O' => '0',
            c => c,
        };
        if !ALPHABET.contains(&(c as u8)) {
            return None;
        }
        mapped.push(c);
    }
    if mapped.len() != PAIRING_CODE_LENGTH {
        return None;
    }
    Some(mapped)
}

pub fn hash_pairing_code(code: &str) -> Option<String> {
    let normalized = normalize_pairing_code(code)?;
    Some(sha256_hex(normalized.as_bytes()))
}

fn default_device_name(now: i64) -> String {
    use chrono::{TimeZone, Utc};
    let d = Utc
        .timestamp_millis_opt(now)
        .single()
        .map(|t| t.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "device".into());
    format!("iOS device {d}")
}

pub fn build_bearer_token() -> String {
    format!("srep_{}", random_token(32))
}

pub async fn create_pairing_code(
    store: &AuthStore<'_>,
    origin: &str,
    name: Option<&str>,
) -> Result<
    (
        String,
        i64,
        serde_json::Value,
    ),
    &'static str,
> {
    let device_name = match name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) if is_short_text(n) => n.to_string(),
        Some(_) => return Err("invalid_nickname"),
        None => default_device_name(now_ms()),
    };
    let now = now_ms();
    store.prune_pairing_codes(now).await.map_err(|_| "pairing_failed")?;
    store
        .invalidate_open_pairing_codes(now)
        .await
        .map_err(|_| "pairing_failed")?;
    let code = random_pairing_code();
    let code_hash = hash_pairing_code(&code).ok_or("pairing_failed")?;
    let expires = now + PAIRING_CODE_TTL_MS;
    let row = PairingCodeRow {
        id: Uuid::new_v4(),
        code_hash,
        name: device_name.clone(),
        created_at: now,
        expires_at: expires,
        consumed_at: None,
    };
    store
        .insert_pairing_code(&row)
        .await
        .map_err(|_| "pairing_failed")?;
    let qr = serde_json::json!({
        "v": 1,
        "origin": origin,
        "code": code,
    });
    Ok((code, expires, qr))
}

pub async fn exchange_pairing_code(
    store: &AuthStore<'_>,
    code: &str,
    name: Option<&str>,
) -> Result<(String, Uuid, String), &'static str> {
    let now = now_ms();
    store.prune_pairing_codes(now).await.map_err(|_| "pairing_failed")?;
    let code_hash = hash_pairing_code(code).ok_or("pairing_failed")?;
    let open = store
        .get_open_pairing_code_by_hash(&code_hash, now)
        .await
        .map_err(|_| "pairing_failed")?
        .ok_or("pairing_failed")?;
    if store.count_active_api_tokens().await.unwrap_or(0) >= MAX_API_TOKENS {
        return Err("token_limit");
    }
    let device_name = match name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) if is_short_text(n) => n.to_string(),
        Some(_) => return Err("invalid_nickname"),
        None => open.name.clone(),
    };
    if !store.consume_pairing_code(open.id, now).await.unwrap_or(false) {
        return Err("pairing_failed");
    }
    let raw = build_bearer_token();
    let row = ApiTokenRow {
        id: Uuid::new_v4(),
        token_hash: sha256_hex(raw.as_bytes()),
        name: device_name.clone(),
        created_at: now,
        last_used_at: Some(now),
        revoked_at: None,
    };
    store
        .insert_api_token(&row)
        .await
        .map_err(|_| "pairing_failed")?;
    Ok((raw, row.id, device_name))
}

pub async fn resolve_api_token(
    store: &AuthStore<'_>,
    raw_token: &str,
) -> anyhow::Result<Option<ApiTokenRow>> {
    if !raw_token.starts_with("srep_") || raw_token.len() < 20 {
        return Ok(None);
    }
    let hash = sha256_hex(raw_token.as_bytes());
    let Some(mut row) = store.get_api_token_by_token_hash(&hash).await? else {
        return Ok(None);
    };
    if row.revoked_at.is_some() {
        return Ok(None);
    }
    let now = now_ms();
    let last = row.last_used_at.unwrap_or(row.created_at);
    if now - last >= API_TOKEN_TOUCH_MS {
        store.touch_api_token(row.id, now).await?;
        row.last_used_at = Some(now);
    }
    Ok(Some(row))
}
