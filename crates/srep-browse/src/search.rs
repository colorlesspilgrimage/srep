use crate::query::parse_query;
use anyhow::Result;
use serde::Serialize;
use sqlx::Row;
use srep_db::DbPool;
use srep_study::day_clock::study_window;
use srep_study::store::StudyStore;
use srep_study::study_settings::get_settings_default;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseRow {
    pub card_id: String,
    pub note_id: String,
    pub deck_id: String,
    pub deck_path: String,
    pub state: String,
    pub due: i64,
    pub lapses: i32,
    pub fields: Vec<String>,
    pub tags: Vec<String>,
}

pub struct BrowsePage {
    pub rows: Vec<BrowseRow>,
    pub next_cursor: Option<String>,
}

pub async fn search_browse(
    pool: &DbPool,
    q: Option<&str>,
    limit: usize,
    cursor: Option<&str>,
) -> Result<Result<BrowsePage, &'static str>> {
    let limit = limit.clamp(1, 100);
    let _parsed = parse_query(q.unwrap_or(""));
    let study = StudyStore::new(pool);
    let raw = study.get_study_settings().await?;
    let settings = match get_settings_default(raw.as_ref()) {
        Ok(s) => s,
        Err(_) => return Ok(Err("bad_query")),
    };
    let window_end = study_window(chrono::Utc::now().timestamp_millis(), &settings).end_ms;
    if let Some(c) = cursor {
        if uuid::Uuid::parse_str(c).is_err() {
            return Ok(Err("bad_query"));
        }
    }
    let fetch = limit + 1;
    let rows = match pool {
        DbPool::Sqlite(p) => fetch_sqlite(p, cursor, fetch, window_end).await?,
        DbPool::Postgres(p) => fetch_pg(p, cursor, fetch, window_end).await?,
    };
    let has_more = rows.len() > limit;
    let page_rows: Vec<_> = rows.into_iter().take(limit).collect();
    let next = if has_more {
        page_rows.last().map(|r| r.card_id.clone())
    } else {
        None
    };
    Ok(Ok(BrowsePage {
        rows: page_rows,
        next_cursor: next,
    }))
}

async fn fetch_sqlite(
    p: &sqlx::Pool<sqlx::Sqlite>,
    cursor: Option<&str>,
    limit: usize,
    window_end: i64,
) -> Result<Vec<BrowseRow>> {
    let sql = if cursor.is_some() {
        r#"SELECT card.id AS card_id, note.id AS note_id, deck.id AS deck_id, deck.path AS deck_path,
           card.state, card.due, card.lapses, note.fields
           FROM card
           INNER JOIN note ON note.id = card.note_id
           INNER JOIN deck ON deck.id = card.deck_id
           WHERE note.deleted_at IS NULL AND deck.archived_at IS NULL
             AND card.id > ?
           ORDER BY card.id LIMIT ?"#
    } else {
        r#"SELECT card.id AS card_id, note.id AS note_id, deck.id AS deck_id, deck.path AS deck_path,
           card.state, card.due, card.lapses, note.fields
           FROM card
           INNER JOIN note ON note.id = card.note_id
           INNER JOIN deck ON deck.id = card.deck_id
           WHERE note.deleted_at IS NULL AND deck.archived_at IS NULL
           ORDER BY card.id LIMIT ?"#
    };
    let rows = if let Some(c) = cursor {
        sqlx::query(sql)
            .bind(c)
            .bind(limit as i64)
            .fetch_all(p)
            .await?
    } else {
        sqlx::query(sql).bind(limit as i64).fetch_all(p).await?
    };
    let mut out = Vec::new();
    for row in rows {
        let note_id: String = row.try_get("note_id")?;
        let tags = load_tags_sqlite(p, &note_id).await?;
        let fields_json: String = row.try_get("fields")?;
        out.push(BrowseRow {
            card_id: row.try_get("card_id")?,
            note_id,
            deck_id: row.try_get("deck_id")?,
            deck_path: row.try_get("deck_path")?,
            state: row.try_get("state")?,
            due: row.try_get("due")?,
            lapses: row.try_get("lapses")?,
            fields: serde_json::from_str(&fields_json).unwrap_or_default(),
            tags,
        });
    }
    let _ = window_end;
    Ok(out)
}

async fn fetch_pg(
    p: &sqlx::Pool<sqlx::Postgres>,
    cursor: Option<&str>,
    limit: usize,
    window_end: i64,
) -> Result<Vec<BrowseRow>> {
    let rows = if let Some(c) = cursor {
        sqlx::query(
            r#"SELECT card.id AS card_id, note.id AS note_id, deck.id AS deck_id, deck.path AS deck_path,
               card.state, card.due, card.lapses, note.fields
               FROM card
               INNER JOIN note ON note.id = card.note_id
               INNER JOIN deck ON deck.id = card.deck_id
               WHERE note.deleted_at IS NULL AND deck.archived_at IS NULL
                 AND card.id > $1
               ORDER BY card.id LIMIT $2"#,
        )
        .bind(c)
        .bind(limit as i64)
        .fetch_all(p)
        .await?
    } else {
        sqlx::query(
            r#"SELECT card.id AS card_id, note.id AS note_id, deck.id AS deck_id, deck.path AS deck_path,
               card.state, card.due, card.lapses, note.fields
               FROM card
               INNER JOIN note ON note.id = card.note_id
               INNER JOIN deck ON deck.id = card.deck_id
               WHERE note.deleted_at IS NULL AND deck.archived_at IS NULL
               ORDER BY card.id LIMIT $1"#,
        )
        .bind(limit as i64)
        .fetch_all(p)
        .await?
    };
    let mut out = Vec::new();
    for row in rows {
        let note_id: String = row.try_get("note_id")?;
        let tags = load_tags_pg(p, &note_id).await?;
        let fields_json: String = row.try_get("fields")?;
        out.push(BrowseRow {
            card_id: row.try_get("card_id")?,
            note_id,
            deck_id: row.try_get("deck_id")?,
            deck_path: row.try_get("deck_path")?,
            state: row.try_get("state")?,
            due: row.try_get("due")?,
            lapses: row.try_get("lapses")?,
            fields: serde_json::from_str(&fields_json).unwrap_or_default(),
            tags,
        });
    }
    let _ = window_end;
    Ok(out)
}

async fn load_tags_sqlite(p: &sqlx::Pool<sqlx::Sqlite>, note_id: &str) -> Result<Vec<String>> {
    let rows = sqlx::query("SELECT tag FROM note_tag WHERE note_id = ? ORDER BY tag")
        .bind(note_id)
        .fetch_all(p)
        .await?;
    Ok(rows.iter().filter_map(|r| r.try_get("tag").ok()).collect())
}

async fn load_tags_pg(p: &sqlx::Pool<sqlx::Postgres>, note_id: &str) -> Result<Vec<String>> {
    let rows = sqlx::query("SELECT tag FROM note_tag WHERE note_id = $1 ORDER BY tag")
        .bind(note_id)
        .fetch_all(p)
        .await?;
    Ok(rows.iter().filter_map(|r| r.try_get("tag").ok()).collect())
}
