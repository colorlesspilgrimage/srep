pub fn is_short_text(value: &str) -> bool {
    value.len() >= 1
        && value.len() <= 64
        && !value.chars().any(|c| c.is_control())
}

pub fn normalize_nickname(input: &str) -> Option<String> {
    let nickname = input.trim();
    if !is_short_text(nickname) {
        return None;
    }
    Some(nickname.to_string())
}
