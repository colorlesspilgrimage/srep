//! Browse search parser (parity: `parse-query.ts`).

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BrowseQuery {
    pub decks: Vec<String>,
    pub tags: Vec<String>,
    pub texts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBrowse {
    pub ok: bool,
    pub query: BrowseQuery,
}

const MAX_QUERY_CHARS: usize = 500;
const MAX_TOKENS: usize = 8;

pub fn parse_query(input: &str) -> ParsedBrowse {
    if input.len() > MAX_QUERY_CHARS || input.contains('\0') {
        return ParsedBrowse {
            ok: false,
            query: BrowseQuery::default(),
        };
    }
    let mut query = BrowseQuery::default();
    let mut tokens = 0usize;
    for token in input.split_whitespace() {
        tokens += 1;
        if tokens > MAX_TOKENS {
            return ParsedBrowse {
                ok: false,
                query: BrowseQuery::default(),
            };
        }
        if let Some(rest) = token.strip_prefix("deck:") {
            if rest.trim().is_empty() {
                return ParsedBrowse {
                    ok: false,
                    query: BrowseQuery::default(),
                };
            }
            query.decks.push(rest.to_string());
        } else if let Some(rest) = token.strip_prefix("tag:") {
            let tag = rest.trim().to_lowercase();
            if tag.is_empty() || tag.chars().any(|c| c.is_whitespace() || c.is_control()) {
                return ParsedBrowse {
                    ok: false,
                    query: BrowseQuery::default(),
                };
            }
            query.tags.push(tag);
        } else if !token.is_empty() {
            query.texts.push(token.to_string());
        }
    }
    ParsedBrowse { ok: true, query }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_deck_prefix() {
        let parsed = parse_query("deck:Languages");
        assert!(parsed.ok);
        assert_eq!(parsed.query.decks, vec!["Languages".to_string()]);
    }
}
