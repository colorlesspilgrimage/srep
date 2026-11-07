const MAX_TAG_LENGTH: usize = 100;
const MAX_TAGS: usize = 100;

pub fn normalize_tags(input: &[String]) -> Option<Vec<String>> {
    let mut tags = std::collections::BTreeSet::new();
    for raw in input {
        let tag = raw.trim().to_lowercase();
        if tag.is_empty()
            || tag.len() > MAX_TAG_LENGTH
            || tag.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return None;
        }
        tags.insert(tag);
    }
    if tags.len() > MAX_TAGS {
        return None;
    }
    Some(tags.into_iter().collect())
}
