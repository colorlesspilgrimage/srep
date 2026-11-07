use crate::query::{BrowseIs, BrowseProp, BrowseQuery};

pub struct WhereParts {
    pub sql: String,
    pub binds: Vec<String>,
}

fn escape_like(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch == '%' || ch == '_' || ch == '\\' {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn ascii_lower(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                char::from_u32(c as u32 + 32).unwrap_or(c)
            } else {
                c
            }
        })
        .collect()
}

fn is_clause_sql(is: BrowseIs, window_end: i64) -> String {
    match is {
        BrowseIs::New => "card.state = 'new'".into(),
        BrowseIs::Suspended => "card.state = 'suspended'".into(),
        BrowseIs::Due => format!("card.state = 'review' AND card.due < {window_end}"),
    }
}

fn prop_clause_sql(prop: &BrowseProp) -> String {
    let op = prop.op.as_str();
    format!("card.lapses {} {}", op, prop.value)
}

pub fn browse_where_sqlite(query: &BrowseQuery, window_end: i64, cursor: Option<&str>) -> WhereParts {
    let mut parts = vec![
        "note.deleted_at IS NULL".to_string(),
        "deck.archived_at IS NULL".to_string(),
    ];
    let mut binds = Vec::new();
    if let Some(c) = cursor {
        parts.push("card.id > ?".into());
        binds.push(c.to_string());
    }
    for deck in &query.decks {
        parts.push(
            "(deck.path = ? OR substr(deck.path, 1, length(?) + 2) = ? || '::')".into(),
        );
        binds.push(deck.clone());
        binds.push(deck.clone());
        binds.push(deck.clone());
    }
    for tag in &query.tags {
        parts.push(
            "EXISTS (SELECT 1 FROM note_tag WHERE note_tag.note_id = note.id AND note_tag.tag = ?)".into(),
        );
        binds.push(tag.clone());
    }
    for is in &query.is {
        parts.push(is_clause_sql(*is, window_end));
    }
    for prop in &query.props {
        parts.push(prop_clause_sql(prop));
    }
    for text in &query.texts {
        parts.push(
            "EXISTS (SELECT 1 FROM json_each(note.fields) AS field WHERE lower(field.value) LIKE ? ESCAPE '\\')".into(),
        );
        let pattern = format!("%{}%", escape_like(&ascii_lower(text)));
        binds.push(pattern);
    }
    WhereParts {
        sql: parts.join(" AND "),
        binds,
    }
}

pub fn browse_where_pg(query: &BrowseQuery, window_end: i64, cursor: Option<&str>) -> WhereParts {
    let mut parts = vec![
        "note.deleted_at IS NULL".to_string(),
        "deck.archived_at IS NULL".to_string(),
    ];
    let mut binds = Vec::new();
    let mut n = 1usize;
    if let Some(c) = cursor {
        parts.push(format!("card.id > ${n}"));
        n += 1;
        binds.push(c.to_string());
    }
    for deck in &query.decks {
        parts.push(format!(
            "(deck.path = ${n} OR substr(deck.path, 1, length(${n}) + 2) = ${n} || '::')"
        ));
        n += 1;
        binds.push(deck.clone());
    }
    for tag in &query.tags {
        parts.push(format!(
            "EXISTS (SELECT 1 FROM note_tag WHERE note_tag.note_id = note.id AND note_tag.tag = ${n})"
        ));
        n += 1;
        binds.push(tag.clone());
    }
    for is in &query.is {
        parts.push(is_clause_sql(*is, window_end));
    }
    for prop in &query.props {
        parts.push(prop_clause_sql(prop));
    }
    for text in &query.texts {
        parts.push(format!(
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text(note.fields::jsonb) AS field(value) \
             WHERE translate(field.value, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') \
             LIKE ${n} ESCAPE '\\')"
        ));
        let pattern = format!("%{}%", escape_like(&ascii_lower(text)));
        n += 1;
        binds.push(pattern);
    }
    let _ = n;
    WhereParts {
        sql: parts.join(" AND "),
        binds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::{BrowseIs, BrowseOp, BrowseProp};

    #[test]
    fn sqlite_includes_is_and_prop() {
        let q = BrowseQuery {
            is: vec![BrowseIs::Due, BrowseIs::New],
            props: vec![BrowseProp {
                op: BrowseOp::Gt,
                value: 3,
            }],
            texts: vec!["gato".into()],
            ..Default::default()
        };
        let parts = browse_where_sqlite(&q, 99, None);
        assert!(parts.sql.contains("card.state = 'review'"));
        assert!(parts.sql.contains("card.lapses > 3"));
        assert!(parts.sql.contains("json_each"));
        assert_eq!(parts.binds.len(), 1);
    }

    #[test]
    fn pg_text_uses_translate() {
        let q = BrowseQuery {
            texts: vec!["GATO".into()],
            ..Default::default()
        };
        let parts = browse_where_pg(&q, 1, None);
        assert!(parts.sql.contains("translate("));
        assert!(parts.sql.contains("jsonb_array_elements_text"));
    }
}
