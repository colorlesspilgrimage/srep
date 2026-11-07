use crate::query::BrowseQuery;

pub struct WhereParts {
    pub sql: String,
    pub binds: Vec<String>,
}

pub fn browse_where_sqlite(query: &BrowseQuery, window_end: i64, cursor: Option<&str>) -> WhereParts {
    let mut sql = String::from(
        "note.deleted_at IS NULL AND deck.archived_at IS NULL",
    );
    let mut binds = Vec::new();
    if let Some(c) = cursor {
        sql.push_str(" AND card.id > ?");
        binds.push(c.to_string());
    }
    for deck in &query.decks {
        sql.push_str(" AND (deck.path = ? OR substr(deck.path, 1, length(?) + 2) = ? || '::')");
        binds.push(deck.clone());
        binds.push(deck.clone());
        binds.push(deck.clone());
    }
    for tag in &query.tags {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM note_tag WHERE note_tag.note_id = note.id AND note_tag.tag = ?)",
        );
        binds.push(tag.clone());
    }
    for text in &query.texts {
        sql.push_str(
            " AND EXISTS (SELECT 1 FROM json_each(note.fields) AS field WHERE lower(field.value) LIKE ? ESCAPE '\\')",
        );
        let pattern = format!("%{}%", escape_like(&text.to_lowercase()));
        binds.push(pattern);
    }
    let _ = window_end;
    WhereParts { sql, binds }
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

pub fn browse_where_pg(query: &BrowseQuery, window_end: i64, cursor: Option<&str>) -> WhereParts {
    let mut sql = String::from("note.deleted_at IS NULL AND deck.archived_at IS NULL");
    let mut binds = Vec::new();
    let mut n = 1;
    if let Some(c) = cursor {
        sql.push_str(&format!(" AND card.id > ${n}"));
        n += 1;
        binds.push(c.to_string());
    }
    for deck in &query.decks {
        sql.push_str(&format!(
            " AND (deck.path = ${n} OR substr(deck.path, 1, length(${n}) + 2) = ${n} || '::')"
        ));
        n += 1;
        binds.push(deck.clone());
    }
    for tag in &query.tags {
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM note_tag WHERE note_tag.note_id = note.id AND note_tag.tag = ${n})"
        ));
        n += 1;
        binds.push(tag.clone());
    }
    let _ = window_end;
    WhereParts { sql, binds }
}
