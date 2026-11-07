use base64::Engine;
use rand::RngCore;
use scrypt::{scrypt, Params};

use crate::tokens::safe_equal;

const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH: usize = 10;
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;
const KEY_BYTES: usize = 32;
const SALT_BYTES: usize = 16;

pub fn generate_recovery_codes(count: usize) -> Vec<String> {
    let mut codes = std::collections::HashSet::new();
    while codes.len() < count {
        codes.insert(random_code());
    }
    codes.into_iter().collect()
}

fn random_code() -> String {
    let mut buf = [0u8; CODE_LENGTH];
    rand::thread_rng().fill_bytes(&mut buf);
    let mut out = String::with_capacity(CODE_LENGTH);
    for b in buf {
        out.push(ALPHABET[(b as usize) % ALPHABET.len()] as char);
    }
    format!("{}-{}", &out[..5], &out[5..])
}

pub fn normalize_recovery_code(input: &str) -> Option<String> {
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
    if mapped.len() != CODE_LENGTH {
        return None;
    }
    Some(mapped)
}

fn scrypt_key(code: &str, salt: &[u8]) -> Option<[u8; KEY_BYTES]> {
    // N=16384 => log_n=14 (matches TS scrypt params).
    let params = Params::new(14, SCRYPT_R, SCRYPT_P, KEY_BYTES).ok()?;
    let mut out = [0u8; KEY_BYTES];
    scrypt(code.as_bytes(), salt, &params, &mut out).ok()?;
    Some(out)
}

fn b64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

/// Matches TS `hashRecoveryCode` format: `scrypt$<salt_b64url>$<hash_b64url>`
pub fn hash_recovery_code(code: &str) -> Option<String> {
    let normalized = normalize_recovery_code(code)?;
    let mut salt = [0u8; SALT_BYTES];
    rand::thread_rng().fill_bytes(&mut salt);
    let hash = scrypt_key(&normalized, &salt)?;
    Some(format!("scrypt${}${}", b64url(&salt), b64url(&hash)))
}

pub fn verify_recovery_code(code: &str, stored: &str) -> bool {
    let normalized = match normalize_recovery_code(code) {
        Some(n) => n,
        None => return false,
    };
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 3 || parts[0] != "scrypt" {
        return false;
    }
    let salt = match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[1]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let expected = parts[2];
    let hash = match scrypt_key(&normalized, &salt) {
        Some(h) => h,
        None => return false,
    };
    safe_equal(&b64url(&hash), expected)
}

/// Constant-time-ish compare of hashed digests for setup token (raw sha256 hex).
pub fn setup_token_hash_matches(token: &str, stored_hash: &str) -> bool {
    let hash = crate::tokens::sha256_hex(token.as_bytes());
    safe_equal(&hash, stored_hash)
}
