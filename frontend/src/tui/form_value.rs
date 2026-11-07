pub const FORM_VALUE_MAX: usize = 80;

pub fn form_ids_ok(id_prefix: &str, name: &str) -> bool {
    id_prefix.len() <= 16
        && id_prefix.chars().all(|c| c.is_ascii_lowercase())
        && !name.is_empty()
        && name.len() <= 32
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub enum FormValueResult {
    Ok(String),
    Err(&'static str),
}

pub fn accept_form_value(value: &str) -> FormValueResult {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return FormValueResult::Err("Enter a value.");
    }
    if trimmed.len() > FORM_VALUE_MAX {
        return FormValueResult::Err("Use at most 80 characters.");
    }
    FormValueResult::Ok(trimmed.to_string())
}
