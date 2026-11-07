use crate::queue_choice::{DeckSnapshot, HeadCard, SHUFFLE_MODULUS, SHUFFLE_MULTIPLIER};
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

pub async fn read_snapshots(
    pool: &DbPool,
    input: &StudySnapshotInput,
) -> Result<Vec<DeckSnapshot>> {
    if input.deck_ids.is_empty() {
        return Ok(vec![]);
    }
    match pool {
        DbPool::Sqlite(p) => read_sqlite(p, input).await,
        DbPool::Postgres(p) => read_postgres(p, input).await,
    }
}

async fn read_sqlite(
    p: &sqlx::Pool<sqlx::Sqlite>,
    input: &StudySnapshotInput,
) -> Result<Vec<DeckSnapshot>> {
    let mut tx = p.begin().await?;
    let parts = fetch_parts_sqlite(&mut tx, input).await?;
    tx.commit().await?;
    Ok(assemble(&input.deck_ids, parts))
}

async fn read_postgres(
    p: &sqlx::Pool<sqlx::Postgres>,
    input: &StudySnapshotInput,
) -> Result<Vec<DeckSnapshot>> {
    let mut tx = p.begin().await?;
    let parts = fetch_parts_pg(&mut tx, input).await?;
    tx.commit().await?;
    Ok(assemble(&input.deck_ids, parts))
}

struct BatchParts {
    done: Vec<(String, String, i64)>,
    learning: Vec<(String, i64, i64, Option<i64>)>,
    learning_heads: Vec<HeadRow>,
    review_counts: Vec<(String, i64)>,
    review_heads: Vec<HeadRow>,
    new_counts: Vec<(String, i64)>,
    new_heads: Vec<HeadRow>,
}

struct HeadRow {
    deck_id: String,
    card_id: String,
    due: i64,
    position: i32,
}

async fn fetch_parts_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    input: &StudySnapshotInput,
) -> Result<BatchParts> {
    let ids = in_list(&input.deck_ids);
    let win = &input.window;
    let done_sql = format!(
        "SELECT card.deck_id, review_log.state_before, COUNT(*) AS n
         FROM review_log
         INNER JOIN card ON card.id = review_log.card_id
         WHERE card.deck_id IN ({ids})
           AND review_log.reviewed_at >= {start}
           AND review_log.reviewed_at < {end}
           AND review_log.state_before IN ('new', 'review')
         GROUP BY card.deck_id, review_log.state_before",
        start = win.start_ms,
        end = win.end_ms
    );
    let learning_sql = format!(
        "SELECT card.deck_id,
            COALESCE(SUM(CASE WHEN card.due <= {now} THEN 1 ELSE 0 END), 0) AS due_now,
            COALESCE(SUM(CASE WHEN card.due < {end} THEN 1 ELSE 0 END), 0) AS today,
            MIN(CASE WHEN card.due > {now} AND card.due < {end} THEN card.due END) AS next_due
         FROM card
         INNER JOIN note ON note.id = card.note_id
         WHERE card.deck_id IN ({ids}) AND note.deleted_at IS NULL
           AND card.state IN ('learning', 'relearning')
         GROUP BY card.deck_id",
        now = input.now_ms,
        end = win.end_ms
    );
    let review_filter = format!("card.state = 'review' AND card.due < {}", win.end_ms);
    let fresh_filter = "card.state = 'new'";
    let learning_filter = format!(
        "card.state IN ('learning', 'relearning') AND card.due <= {}",
        input.now_ms
    );
    let shuffle_set: std::collections::HashSet<_> =
        input.shuffle_deck_ids.iter().cloned().collect();
    let shuffle_order = fresh_order_sql(&input.shuffle_deck_ids);
    let review_order = "card.due ASC, card.position ASC, card.id ASC";
    let learning_order = "card.due ASC, card.id ASC";
    let review_count_sql = count_sql(&ids, &review_filter);
    let new_count_sql = count_sql(&ids, fresh_filter);
    let learning_heads = head_sql(&input.deck_ids, &ids, &learning_filter, learning_order);
    let review_heads = head_sql(&input.deck_ids, &ids, &review_filter, review_order);
    let new_heads = head_sql(&input.deck_ids, &ids, fresh_filter, &shuffle_order);
    let done = fetch_done_sqlite(tx, &done_sql).await?;
    let learning = fetch_learning_sqlite(tx, &learning_sql).await?;
    let learning_heads = fetch_heads_sqlite(tx, &learning_heads).await?;
    let review_counts = fetch_counts_sqlite(tx, &review_count_sql).await?;
    let review_heads = fetch_heads_sqlite(tx, &review_heads).await?;
    let new_counts = fetch_counts_sqlite(tx, &new_count_sql).await?;
    let new_heads = fetch_heads_sqlite(tx, &new_heads).await?;
    let _ = shuffle_set;
    Ok(BatchParts {
        done,
        learning,
        learning_heads,
        review_counts,
        review_heads,
        new_counts,
        new_heads,
    })
}

async fn fetch_parts_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    input: &StudySnapshotInput,
) -> Result<BatchParts> {
    let ids = input.deck_ids.clone();
    let win = &input.window;
    let done_sql = "SELECT card.deck_id, review_log.state_before, COUNT(*)::bigint AS n
         FROM review_log
         INNER JOIN card ON card.id = review_log.card_id
         WHERE card.deck_id = ANY($1)
           AND review_log.reviewed_at >= $2
           AND review_log.reviewed_at < $3
           AND review_log.state_before IN ('new', 'review')
         GROUP BY card.deck_id, review_log.state_before";
    let learning_sql = "SELECT card.deck_id,
            COALESCE(SUM(CASE WHEN card.due <= $2 THEN 1 ELSE 0 END), 0)::bigint AS due_now,
            COALESCE(SUM(CASE WHEN card.due < $3 THEN 1 ELSE 0 END), 0)::bigint AS today,
            MIN(CASE WHEN card.due > $2 AND card.due < $3 THEN card.due END) AS next_due
         FROM card
         INNER JOIN note ON note.id = card.note_id
         WHERE card.deck_id = ANY($1) AND note.deleted_at IS NULL
           AND card.state IN ('learning', 'relearning')
         GROUP BY card.deck_id";
    let done = fetch_done_pg(tx, done_sql, &ids, win.start_ms, win.end_ms).await?;
    let learning = fetch_learning_pg(tx, learning_sql, &ids, input.now_ms, win.end_ms).await?;
    let review_counts = fetch_counts_pg(tx, &ids, "card.state = 'review'", win.end_ms).await?;
    let new_counts = fetch_counts_pg(tx, &ids, "card.state = 'new'", win.end_ms).await?;
    let learning_heads = fetch_heads_pg(tx, &ids, "learning", input.now_ms, win.end_ms).await?;
    let review_heads = fetch_heads_pg(tx, &ids, "review", input.now_ms, win.end_ms).await?;
    let new_heads = fetch_heads_pg(tx, &ids, "new", input.now_ms, win.end_ms).await?;
    Ok(BatchParts {
        done,
        learning,
        learning_heads,
        review_counts,
        review_heads,
        new_counts,
        new_heads,
    })
}

fn count_sql(ids: &str, filter: &str) -> String {
    format!(
        "SELECT card.deck_id, COUNT(*) AS n
         FROM card
         INNER JOIN note ON note.id = card.note_id
         WHERE card.deck_id IN ({ids}) AND note.deleted_at IS NULL AND {filter}
         GROUP BY card.deck_id"
    )
}

fn fresh_order_sql(shuffle_ids: &[String]) -> String {
    if shuffle_ids.is_empty() {
        return "card.position ASC, card.id ASC".to_string();
    }
    format!(
        "(CAST(card.position AS INTEGER) * {SHUFFLE_MULTIPLIER}) % {SHUFFLE_MODULUS} ASC, card.position ASC, card.id ASC"
    )
}

fn head_sql(deck_ids: &[String], ids: &str, filter: &str, order: &str) -> String {
    let deck_source = deck_ids
        .iter()
        .map(|id| format!("SELECT '{id}' AS deck_id"))
        .collect::<Vec<_>>()
        .join(" UNION ALL ");
    format!(
        "SELECT d.deck_id, head.id AS card_id, head.due, head.position
         FROM ({deck_source}) d
         INNER JOIN card head ON head.id = (
           SELECT card.id FROM card
           INNER JOIN note ON note.id = card.note_id
           WHERE card.deck_id = d.deck_id AND note.deleted_at IS NULL
             AND card.deck_id IN ({ids}) AND {filter}
           ORDER BY {order}
           LIMIT 1
         )"
    )
}

async fn fetch_done_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    sql: &str,
) -> Result<Vec<(String, String, i64)>> {
    let rows = sqlx::query(sql).fetch_all(&mut **tx).await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok((
                r.try_get("deck_id")?,
                r.try_get("state_before")?,
                r.try_get::<i64, _>("n")?,
            ))
        })
        .collect::<Result<_>>()?)
}

async fn fetch_learning_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    sql: &str,
) -> Result<Vec<(String, i64, i64, Option<i64>)>> {
    let rows = sqlx::query(sql).fetch_all(&mut **tx).await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok((
                r.try_get("deck_id")?,
                r.try_get("due_now")?,
                r.try_get("today")?,
                r.try_get("next_due")?,
            ))
        })
        .collect::<Result<_>>()?)
}

async fn fetch_counts_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    sql: &str,
) -> Result<Vec<(String, i64)>> {
    let rows = sqlx::query(sql).fetch_all(&mut **tx).await?;
    Ok(rows
        .iter()
        .map(|r| Ok((r.try_get("deck_id")?, r.try_get("n")?)))
        .collect::<Result<_>>()?)
}

async fn fetch_heads_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    sql: &str,
) -> Result<Vec<HeadRow>> {
    let rows = sqlx::query(sql).fetch_all(&mut **tx).await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok(HeadRow {
                deck_id: r.try_get("deck_id")?,
                card_id: r.try_get("card_id")?,
                due: r.try_get("due")?,
                position: r.try_get("position")?,
            })
        })
        .collect::<Result<_>>()?)
}

async fn fetch_done_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    sql: &str,
    ids: &[String],
    start: i64,
    end: i64,
) -> Result<Vec<(String, String, i64)>> {
    let rows = sqlx::query(sql)
        .bind(ids)
        .bind(start)
        .bind(end)
        .fetch_all(&mut **tx)
        .await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok((
                r.try_get("deck_id")?,
                r.try_get("state_before")?,
                r.try_get("n")?,
            ))
        })
        .collect::<Result<_>>()?)
}

async fn fetch_learning_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    sql: &str,
    ids: &[String],
    now: i64,
    end: i64,
) -> Result<Vec<(String, i64, i64, Option<i64>)>> {
    let rows = sqlx::query(sql)
        .bind(ids)
        .bind(now)
        .bind(end)
        .fetch_all(&mut **tx)
        .await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok((
                r.try_get("deck_id")?,
                r.try_get("due_now")?,
                r.try_get("today")?,
                r.try_get("next_due")?,
            ))
        })
        .collect::<Result<_>>()?)
}

async fn fetch_counts_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ids: &[String],
    state_filter: &str,
    end_ms: i64,
) -> Result<Vec<(String, i64)>> {
    let sql = format!(
        "SELECT card.deck_id, COUNT(*)::bigint AS n
         FROM card
         INNER JOIN note ON note.id = card.note_id
         WHERE card.deck_id = ANY($1) AND note.deleted_at IS NULL
           AND {state_filter} AND card.due < $2
         GROUP BY card.deck_id"
    );
    let rows = sqlx::query(&sql)
        .bind(ids)
        .bind(end_ms)
        .fetch_all(&mut **tx)
        .await?;
    Ok(rows
        .iter()
        .map(|r| Ok((r.try_get("deck_id")?, r.try_get("n")?)))
        .collect::<Result<_>>()?)
}

async fn fetch_heads_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ids: &[String],
    kind: &str,
    now: i64,
    end: i64,
) -> Result<Vec<HeadRow>> {
    let (filter, order) = match kind {
        "learning" => (
            "card.state IN ('learning', 'relearning') AND card.due <= $3",
            "card.due ASC, card.id ASC",
        ),
        "review" => (
            "card.state = 'review' AND card.due < $4",
            "card.due ASC, card.position ASC, card.id ASC",
        ),
        _ => ("card.state = 'new'", "card.position ASC, card.id ASC"),
    };
    let sql = format!(
        "SELECT DISTINCT ON (card.deck_id) card.deck_id, card.id AS card_id, card.due, card.position
         FROM card
         INNER JOIN note ON note.id = card.note_id
         WHERE card.deck_id = ANY($1) AND note.deleted_at IS NULL AND {filter}
         ORDER BY card.deck_id, {order}"
    );
    let rows = if kind == "review" {
        sqlx::query(&sql)
            .bind(ids)
            .bind(now)
            .bind(now)
            .bind(end)
            .fetch_all(&mut **tx)
            .await?
    } else if kind == "learning" {
        sqlx::query(&sql)
            .bind(ids)
            .bind(now)
            .bind(now)
            .fetch_all(&mut **tx)
            .await?
    } else {
        sqlx::query(&sql)
            .bind(ids)
            .bind(now)
            .fetch_all(&mut **tx)
            .await?
    };
    Ok(rows
        .iter()
        .map(|r| {
            Ok(HeadRow {
                deck_id: r.try_get("deck_id")?,
                card_id: r.try_get("card_id")?,
                due: r.try_get("due")?,
                position: r.try_get("position")?,
            })
        })
        .collect::<Result<_>>()?)
}

fn assemble(deck_ids: &[String], parts: BatchParts) -> Vec<DeckSnapshot> {
    let mut done_new = std::collections::HashMap::new();
    let mut done_review = std::collections::HashMap::new();
    for (deck, state, n) in parts.done {
        if state == "new" {
            done_new.insert(deck, n as u32);
        } else if state == "review" {
            done_review.insert(deck, n as u32);
        }
    }
    let mut learn = std::collections::HashMap::new();
    for (deck, due_now, today, next) in parts.learning {
        learn.insert(deck, (due_now as u32, today as u32, next));
    }
    let mut review_counts = std::collections::HashMap::new();
    for (d, n) in parts.review_counts {
        review_counts.insert(d, n as u32);
    }
    let mut new_counts = std::collections::HashMap::new();
    for (d, n) in parts.new_counts {
        new_counts.insert(d, n as u32);
    }
    let head = |rows: &[HeadRow]| {
        let mut m = std::collections::HashMap::new();
        for r in rows {
            m.insert(
                r.deck_id.clone(),
                HeadCard {
                    card_id: r.card_id.clone(),
                    due: r.due,
                    position: r.position as u32,
                },
            );
        }
        m
    };
    let learning_heads = head(&parts.learning_heads);
    let review_heads = head(&parts.review_heads);
    let new_heads = head(&parts.new_heads);
    deck_ids
        .iter()
        .map(|deck_id| {
            let l = learn.get(deck_id);
            DeckSnapshot {
                deck_id: deck_id.clone(),
                new_done: *done_new.get(deck_id).unwrap_or(&0),
                review_done: *done_review.get(deck_id).unwrap_or(&0),
                learning_due_count: l.map(|x| x.0).unwrap_or(0),
                learning_today_count: l.map(|x| x.1).unwrap_or(0),
                next_learning_due: l.and_then(|x| x.2),
                learning_head: learning_heads.get(deck_id).cloned(),
                review_due_count: *review_counts.get(deck_id).unwrap_or(&0),
                review_head: review_heads.get(deck_id).cloned(),
                new_count: *new_counts.get(deck_id).unwrap_or(&0),
                new_head: new_heads.get(deck_id).cloned(),
            }
        })
        .collect()
}
