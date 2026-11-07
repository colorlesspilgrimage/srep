//! Browse search parser (port target: `parse-query.ts`).

#[derive(Debug, Clone, Default)]
pub struct BrowseQuery {
    pub deck: Option<String>,
    pub tag: Option<String>,
    pub text: Option<String>,
}

pub fn parse_query(input: &str) -> BrowseQuery {
    let mut q = BrowseQuery::default();
    for token in input.split_whitespace() {
        if let Some(rest) = token.strip_prefix("deck:") {
            q.deck = Some(rest.to_string());
        } else if let Some(rest) = token.strip_prefix("tag:") {
            q.tag = Some(rest.to_string());
        } else {
            q.text = Some(token.to_string());
        }
    }
    q
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_deck_prefix() {
        let q = parse_query("deck:Languages");
        assert_eq!(q.deck.as_deref(), Some("Languages"));
    }
}
