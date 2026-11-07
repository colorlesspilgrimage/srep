pub fn is_uuid(id: &str) -> bool {
    if id.len() != 36 {
        return false;
    }
    let bytes = id.as_bytes();
    let dashes = [8, 13, 18, 23];
    for (i, &b) in bytes.iter().enumerate() {
        if dashes.contains(&i) {
            if b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}
