use crate::queue_choice::{
    DeckPackQueue, HeadCard, QueueSource, SHUFFLE_MODULUS, SHUFFLE_MULTIPLIER,
};
use crate::store::StudySnapshotInput;
use anyhow::Result;
use sqlx::Row;
use srep_db::DbPool;

fn in_list(ids: &[String]) -> String {
    ids.iter()
        .map(|id| format!("'{id}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(Debug)]
struct QueueRow {
    deck_id: String,
    card_id: String,
    due: i64,
    position: i32,
}

fn sqlite_query(ids: &str, filter: &str, order: &str, limit: usize) -> String {
    format!(
        "SELECT deck_id, card_id, due, position FROM (
           SELECT card.deck_id AS deck_id, card.id AS card_id, card.due AS due, card.position AS position,
             ROW_NUMBER() OVER (PARTITION BY card.deck_id ORDER BY {order}) AS rn
           FROM card
           INNER JOIN note ON note.id = card.note_id
           WHERE card.deck_id IN ({ids}) AND note.deleted_at IS NULL AND {filter}
         ) queued WHERE rn <= {limit}
         ORDER BY deck_id, rn"
    )
}

fn sqlite_new_order(shuffle_ids: &[String]) -> String {
    if shuffle_ids.is_empty() {
        return "card.position ASC, card.id ASC".to_string();
    }
    let ids = in_list(shuffle_ids);
    format!(
        "CASE WHEN card.deck_id IN ({ids}) THEN (CAST(card.position AS INTEGER) * {SHUFFLE_MULTIPLIER}) % {SHUFFLE_MODULUS} ELSE card.position END ASC, card.position ASC, card.id ASC"
    )
}

fn postgres_query(filter: &str, order: &str) -> String {
    format!(
        "SELECT deck_id, card_id, due, position FROM (
           SELECT card.deck_id AS deck_id, card.id AS card_id, card.due AS due, card.position AS position,
             ROW_NUMBER() OVER (PARTITION BY card.deck_id ORDER BY {order}) AS rn
           FROM card
           INNER JOIN note ON note.id = card.note_id
           WHERE card.deck_id = ANY($1) AND note.deleted_at IS NULL AND {filter}
         ) queued WHERE rn <= $3
         ORDER BY deck_id, rn"
    )
}

fn postgres_new_order() -> &'static str {
    "CASE WHEN card.deck_id = ANY($2) THEN (card.position::bigint * 2654435761) % 4294967296 ELSE card.position::bigint END ASC, card.position ASC, card.id ASC"
}

pub async fn read_queues(
    pool: &DbPool,
    input: &StudySnapshotInput,
    per_deck_limit: usize,
) -> Result<Vec<DeckPackQueue>> {
    if input.deck_ids.is_empty() {
        return Ok(vec![]);
    }
    match pool {
        DbPool::Sqlite(p) => read_sqlite(p, input, per_deck_limit).await,
        DbPool::Postgres(p) => read_postgres(p, input, per_deck_limit).await,
    }
}

async fn read_sqlite(
    p: &sqlx::Pool<sqlx::Sqlite>,
    input: &StudySnapshotInput,
    per_deck_limit: usize,
) -> Result<Vec<DeckPackQueue>> {
    let ids = in_list(&input.deck_ids);
    let limit = per_deck_limit.max(1);
    let learning = sqlite_query(
        &ids,
        &format!(
            "card.state IN ('learning', 'relearning') AND card.due <= {}",
            input.now_ms
        ),
        "card.due ASC, card.id ASC",
        limit,
    );
    let review = sqlite_query(
        &ids,
        &format!(
            "card.state = 'review' AND card.due < {}",
            input.window.end_ms
        ),
        "card.due ASC, card.position ASC, card.id ASC",
        limit,
    );
    let new = sqlite_query(
        &ids,
        "card.state = 'new'",
        &sqlite_new_order(&input.shuffle_deck_ids),
        limit,
    );
    let mut rows = Vec::new();
    for (source, sql) in [
        (QueueSource::Learning, learning),
        (QueueSource::Review, review),
        (QueueSource::New, new),
    ] {
        let fetched = sqlx::query(&sql).fetch_all(p).await?;
        rows.extend(sqlite_rows(&fetched)?.into_iter().map(|row| (source, row)));
    }
    Ok(assemble(&input.deck_ids, rows, per_deck_limit))
}

async fn read_postgres(
    p: &sqlx::Pool<sqlx::Postgres>,
    input: &StudySnapshotInput,
    per_deck_limit: usize,
) -> Result<Vec<DeckPackQueue>> {
    let ids = input.deck_ids.clone();
    let limit = per_deck_limit.max(1) as i64;
    let learning_sql = postgres_query(
        "card.state IN ('learning', 'relearning') AND card.due <= $2",
        "card.due ASC, card.id ASC",
    );
    let review_sql = postgres_query(
        "card.state = 'review' AND card.due < $2",
        "card.due ASC, card.position ASC, card.id ASC",
    );
    let new_sql = postgres_query("card.state = 'new'", postgres_new_order());
    let learning = sqlx::query(&learning_sql)
        .bind(&ids)
        .bind(input.now_ms)
        .bind(limit)
        .fetch_all(p)
        .await?;
    let review = sqlx::query(&review_sql)
        .bind(&ids)
        .bind(input.window.end_ms)
        .bind(limit)
        .fetch_all(p)
        .await?;
    let new = sqlx::query(&new_sql)
        .bind(&ids)
        .bind(&input.shuffle_deck_ids)
        .bind(limit)
        .fetch_all(p)
        .await?;
    let mut rows = Vec::new();
    rows.extend(
        pg_rows(&learning)?
            .into_iter()
            .map(|row| (QueueSource::Learning, row)),
    );
    rows.extend(
        pg_rows(&review)?
            .into_iter()
            .map(|row| (QueueSource::Review, row)),
    );
    rows.extend(
        pg_rows(&new)?
            .into_iter()
            .map(|row| (QueueSource::New, row)),
    );
    Ok(assemble(&input.deck_ids, rows, per_deck_limit))
}

fn sqlite_rows(rows: &[sqlx::sqlite::SqliteRow]) -> Result<Vec<QueueRow>> {
    rows.iter()
        .map(|r| {
            Ok(QueueRow {
                deck_id: r.try_get("deck_id")?,
                card_id: r.try_get("card_id")?,
                due: r.try_get("due")?,
                position: r.try_get("position")?,
            })
        })
        .collect()
}

fn pg_rows(rows: &[sqlx::postgres::PgRow]) -> Result<Vec<QueueRow>> {
    rows.iter()
        .map(|r| {
            Ok(QueueRow {
                deck_id: r.try_get("deck_id")?,
                card_id: r.try_get("card_id")?,
                due: r.try_get("due")?,
                position: r.try_get("position")?,
            })
        })
        .collect()
}

fn assemble(
    deck_ids: &[String],
    rows: Vec<(QueueSource, QueueRow)>,
    per_deck_limit: usize,
) -> Vec<DeckPackQueue> {
    let mut queues = std::collections::HashMap::new();
    for (source, row) in rows {
        let queue = queues
            .entry(row.deck_id.clone())
            .or_insert_with(|| DeckPackQueue {
                deck_id: row.deck_id.clone(),
                ..Default::default()
            });
        let card = HeadCard {
            card_id: row.card_id,
            due: row.due,
            position: row.position as u32,
        };
        let target = match source {
            QueueSource::Learning => &mut queue.learning,
            QueueSource::Review => &mut queue.review,
            QueueSource::New => &mut queue.new,
        };
        if target.len() < per_deck_limit {
            target.push(card);
        }
    }
    deck_ids
        .iter()
        .map(|deck_id| {
            queues.remove(deck_id).unwrap_or_else(|| DeckPackQueue {
                deck_id: deck_id.clone(),
                ..Default::default()
            })
        })
        .collect()
}
