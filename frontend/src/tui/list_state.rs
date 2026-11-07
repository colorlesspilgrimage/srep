pub fn list_key_index(length: usize, selected_index: usize, key: &str) -> Option<usize> {
    if length < 1 {
        return None;
    }
    match key {
        "Home" => Some(0),
        "End" => Some(length - 1),
        "ArrowDown" => Some((selected_index + 1).min(length - 1)),
        "ArrowUp" => Some(selected_index.saturating_sub(1)),
        _ => None,
    }
}
