//! Browse search parser (parity: `parse-query.ts`).

use srep_domain::core::tags::normalize_tags;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowseIs {
    Due,
    New,
    Suspended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowseOp {
    Gt,
    Gte,
    Lt,
    Lte,
    Eq,
}

impl BrowseOp {
    pub fn as_str(self) -> &'static str {
        match self {
            BrowseOp::Gt => ">",
            BrowseOp::Gte => ">=",
            BrowseOp::Lt => "<",
            BrowseOp::Lte => "<=",
            BrowseOp::Eq => "=",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowseProp {
    pub op: BrowseOp,
    pub value: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BrowseQuery {
    pub decks: Vec<String>,
    pub tags: Vec<String>,
    pub is: Vec<BrowseIs>,
    pub props: Vec<BrowseProp>,
    pub texts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBrowse {
    pub ok: bool,
    pub query: BrowseQuery,
}

const MAX_QUERY_CHARS: usize = 500;
const MAX_TOKENS: usize = 8;
const MAX_PROP: i64 = 1_000_000;

#[derive(Debug, Clone)]
struct Token {
    text: String,
    force_free: bool,
}

fn is_space(ch: char) -> bool {
    matches!(ch, ' ' | '\n' | '\t' | '\r' | '\x0C' | '\x0B')
}

fn count_quotes(input: &str) -> usize {
    input.chars().filter(|&c| c == '"').count()
}

fn read_token(input: &str, start: usize) -> Option<(Token, usize)> {
    let force_free = input.chars().nth(start)? == '"';
    let mut text = String::new();
    let mut in_quote = false;
    let mut index = start;
    let chars: Vec<char> = input.chars().collect();
    while index < chars.len() {
        let ch = chars[index];
        if ch == '"' {
            in_quote = !in_quote;
            index += 1;
            continue;
        }
        if !in_quote && is_space(ch) {
            break;
        }
        text.push(ch);
        index += 1;
    }
    if text.is_empty() {
        return None;
    }
    let byte_index = input
        .char_indices()
        .nth(index)
        .map(|(i, _)| i)
        .unwrap_or(input.len());
    Some((Token { text, force_free }, byte_index))
}

fn tokenize(input: &str) -> Option<Vec<Token>> {
    if count_quotes(input) % 2 != 0 {
        return None;
    }
    let mut tokens = Vec::new();
    let mut index = 0;
    let chars: Vec<char> = input.chars().collect();
    while index < chars.len() {
        while index < chars.len() && is_space(chars[index]) {
            index += 1;
        }
        if index >= chars.len() {
            break;
        }
        let byte_start = input
            .char_indices()
            .nth(index)
            .map(|(i, _)| i)
            .unwrap_or(input.len());
        let (token, next) = read_token(input, byte_start)?;
        tokens.push(token);
        index = input[..next].chars().count();
    }
    Some(tokens)
}

fn push_text(query: &mut BrowseQuery, text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    query.texts.push(text.to_string());
    true
}

fn push_deck(query: &mut BrowseQuery, path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }
    query.decks.push(trimmed.to_string());
    true
}

fn push_tag(query: &mut BrowseQuery, raw: &str) -> bool {
    let Some(tags) = normalize_tags(&[raw.to_string()]) else {
        return false;
    };
    if tags.len() != 1 {
        return false;
    }
    query.tags.push(tags[0].clone());
    true
}

fn push_is(query: &mut BrowseQuery, value: &str) -> bool {
    let flag = match value {
        "due" => BrowseIs::Due,
        "new" => BrowseIs::New,
        "suspended" => BrowseIs::Suspended,
        _ => return false,
    };
    query.is.push(flag);
    true
}

fn push_prop(query: &mut BrowseQuery, value: &str) -> bool {
    let re = regex::Regex::new(r"^(lapses)(>=|<=|>|<|=)(0|[1-9][0-9]*)$").unwrap();
    let Some(caps) = re.captures(value) else {
        return false;
    };
    let Some(op_raw) = caps.get(2) else {
        return false;
    };
    let Some(digits) = caps.get(3) else {
        return false;
    };
    let op = match op_raw.as_str() {
        ">" => BrowseOp::Gt,
        ">=" => BrowseOp::Gte,
        "<" => BrowseOp::Lt,
        "<=" => BrowseOp::Lte,
        "=" => BrowseOp::Eq,
        _ => return false,
    };
    let Ok(number) = digits.as_str().parse::<i64>() else {
        return false;
    };
    if number > MAX_PROP {
        return false;
    }
    query.props.push(BrowseProp { op, value: number });
    true
}

fn classify(token: &Token, query: &mut BrowseQuery) -> bool {
    if token.force_free {
        return push_text(query, &token.text);
    }
    let text = &token.text;
    if let Some(rest) = text.strip_prefix("deck:") {
        return push_deck(query, rest);
    }
    if let Some(rest) = text.strip_prefix("tag:") {
        return push_tag(query, rest);
    }
    if let Some(rest) = text.strip_prefix("is:") {
        return push_is(query, rest);
    }
    if let Some(rest) = text.strip_prefix("prop:") {
        return push_prop(query, rest);
    }
    push_text(query, text)
}

pub fn parse_query(input: &str) -> ParsedBrowse {
    if input.len() > MAX_QUERY_CHARS || input.contains('\0') {
        return ParsedBrowse {
            ok: false,
            query: BrowseQuery::default(),
        };
    }
    let Some(tokens) = tokenize(input) else {
        return ParsedBrowse {
            ok: false,
            query: BrowseQuery::default(),
        };
    };
    if tokens.len() > MAX_TOKENS {
        return ParsedBrowse {
            ok: false,
            query: BrowseQuery::default(),
        };
    }
    let mut query = BrowseQuery::default();
    for token in tokens {
        if !classify(&token, &mut query) {
            return ParsedBrowse {
                ok: false,
                query: BrowseQuery::default(),
            };
        }
    }
    ParsedBrowse { ok: true, query }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good(query: BrowseQuery) -> ParsedBrowse {
        ParsedBrowse { ok: true, query }
    }

    #[test]
    fn parses_deck_tag_is_prop_text() {
        assert_eq!(
            parse_query("deck:Spanish::Verbs"),
            good(BrowseQuery {
                decks: vec!["Spanish::Verbs".into()],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query("tag:animals"),
            good(BrowseQuery {
                tags: vec!["animals".into()],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query("tag:ANIMALS"),
            good(BrowseQuery {
                tags: vec!["animals".into()],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query(r#"tag:"lang::ja""#),
            good(BrowseQuery {
                tags: vec!["lang::ja".into()],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query("is:due"),
            good(BrowseQuery {
                is: vec![BrowseIs::Due],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query("prop:lapses>3"),
            good(BrowseQuery {
                props: vec![BrowseProp {
                    op: BrowseOp::Gt,
                    value: 3
                }],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query("gato"),
            good(BrowseQuery {
                texts: vec!["gato".into()],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query(r#""hello world""#),
            good(BrowseQuery {
                texts: vec!["hello world".into()],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query(r#"deck:"My Deck""#),
            good(BrowseQuery {
                decks: vec!["My Deck".into()],
                ..Default::default()
            })
        );
        assert_eq!(
            parse_query("is:new is:suspended"),
            good(BrowseQuery {
                is: vec![BrowseIs::New, BrowseIs::Suspended],
                ..Default::default()
            })
        );
    }

    #[test]
    fn rejects_bad_tokens() {
        for input in [
            "prop:lapses!",
            "prop:lapses>1000001",
            "prop:lapses>-1",
            "is:learning",
            "tag:",
            "deck:",
            "\"\"",
            "\"",
            "a\"b",
            &"a".repeat(501),
            &(0..9).map(|i| format!("t{i}")).collect::<Vec<_>>().join(" "),
            "gato\u{0000}",
        ] {
            let parsed = parse_query(input);
            assert!(!parsed.ok, "expected bad query for {input:?}");
        }
    }

    #[test]
    fn accepts_edge_ok_queries() {
        assert!(parse_query(&"a".repeat(500)).ok);
        assert!(parse_query(&(0..8).map(|i| format!("t{i}")).collect::<Vec<_>>().join(" ")).ok);
        assert!(parse_query("   ").ok);
        assert_eq!(
            parse_query("deck:Spanish\u{00a0}"),
            good(BrowseQuery {
                decks: vec!["Spanish".into()],
                ..Default::default()
            })
        );
    }
}
