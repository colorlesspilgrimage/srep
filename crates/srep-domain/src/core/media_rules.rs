use regex::Regex;
use std::sync::LazyLock;

static SHA256_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-f0-9]{64}$").expect("sha256 regex"));

pub fn is_sha256_hex(s: &str) -> bool {
    SHA256_RE.is_match(s)
}

pub fn sanitize_original_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "upload".into();
    }
    trimmed.chars().take(200).collect()
}

/// Minimal MIME sniff for tests (PNG magic).
pub fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    None
}

pub fn normalize_declared_mime(declared: &str) -> String {
    declared
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase()
}
