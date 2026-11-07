use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq as _;

pub fn sha256_hex(bytes: impl AsRef<[u8]>) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

pub fn random_token(len: usize) -> String {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, buf)
}

/// CSRF token derived from session secret (matches TS `csrfTokenFor`).
pub fn csrf_token_for(raw_session_token: &str) -> String {
    let digest = Sha256::digest(format!("srep-csrf:{raw_session_token}"));
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, digest)
}

/// Both inputs are hashed first so compared digests always have equal length (TS `safeEqual`).
pub fn safe_equal(a: &str, b: &str) -> bool {
    let left = Sha256::digest(a.as_bytes());
    let right = Sha256::digest(b.as_bytes());
    left.ct_eq(&right).into()
}
