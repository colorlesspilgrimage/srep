use crate::store::convert::{sched_state_to_str, to_study_card};
use crate::store::CardRebuildUpdate;
use crate::store::ReplayBatchItem;
use crate::types::ReviewLogRow;
use anyhow::Result;
use srep_db::DbPool;
use srep_domain::store::rows::{row_to_card_pg, row_to_card_sqlite};
use sqlx::Row;

pub const REPLAY_PAGE_SIZE: i64 = 500;

pub async fn read_replay_batch(
    pool: &DbPool,
    after_card_id: Option<&str>,
    limit: i64,
) -> Result<Vec<ReplayBatchItem>> {
    match pool {
        DbPool::Sqlite(p) => read_batch_sqlite(p, after_card_id, limit).await,
        DbPool::Postgres(p) => read_batch_pg(p, after_card_id, limit).await,
    }
}

pub async fn rebuild_cards<F>(pool: &DbPool, compute_batch: F) -> Result<(u64, u64)>
where
    F: Fn(&[ReplayBatchItem]) -> Vec<CardRebuildUpdate>,
{
    match pool {
        DbPool::Sqlite(p) => rebuild_sqlite(p, compute_batch).await,
        DbPool::Postgres(p) => rebuild_pg(p, compute_batch).await,
    }
}

async fn read_batch_sqlite(
    p: &sqlx::Pool<sqlx::Sqlite>,
    after: Option<&str>,
    limit: i64,
) -> Result<Vec<ReplayBatchItem>> {
    let mut tx = p.begin().await?;
    let batch = fetch_batch_sqlite(&mut tx, after, limit).await?;
    tx.commit().await?;
    Ok(batch)
}

async fn fetch_batch_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    after: Option<&str>,
    limit: i64,
) -> Result<Vec<ReplayBatchItem>> {
    let cards_rows = if let Some(after) = after {
        sqlx::query("SELECT * FROM card WHERE id > ? ORDER BY id LIMIT ?")
            .bind(after)
            .bind(limit)
            .fetch_all(&mut **tx)
            .await?
    } else {
        sqlx::query("SELECT * FROM card ORDER BY id LIMIT ?")
            .bind(limit)
            .fetch_all(&mut **tx)
            .await?
    };
    if cards_rows.is_empty() {
        return Ok(vec![]);
    }
    let ids: Vec<String> = cards_rows
        .iter()
        .map(|r| r.try_get::<String, _>("id"))
        .collect::<Result<_, _>>()?;
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT * FROM review_log WHERE card_id IN ({placeholders}) ORDER BY reviewed_at, id"
    );
    let mut q = sqlx::query(&sql);
    for id in &ids {
        q = q.bind(id);
    }
    let log_rows = q.fetch_all(&mut **tx).await?;
    let mut logs_by_card: std::collections::HashMap<String, Vec<ReviewLogRow>> =
        std::collections::HashMap::new();
    for row in log_rows {
        let log = super::review::row_to_review_log(&row)?;
        logs_by_card.entry(log.card_id.clone()).or_default().push(log);
    }
    Ok(cards_rows
        .iter()
        .map(|r| {
            let card = to_study_card(&row_to_card_sqlite(r).unwrap());
            ReplayBatchItem {
                logs: logs_by_card.remove(&card.id).unwrap_or_default(),
                card,
            }
        })
        .collect())
}

async fn read_batch_pg(
    p: &sqlx::Pool<sqlx::Postgres>,
    after: Option<&str>,
    limit: i64,
) -> Result<Vec<ReplayBatchItem>> {
    let mut tx = p.begin().await?;
    let batch = fetch_batch_pg(&mut tx, after, limit).await?;
    tx.commit().await?;
    Ok(batch)
}

async fn fetch_batch_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    after: Option<&str>,
    limit: i64,
) -> Result<Vec<ReplayBatchItem>> {
    let cards_rows = if let Some(after) = after {
        sqlx::query("SELECT * FROM card WHERE id > $1 ORDER BY id LIMIT $2")
            .bind(after)
            .bind(limit)
            .fetch_all(&mut **tx)
            .await?
    } else {
        sqlx::query("SELECT * FROM card ORDER BY id LIMIT $1")
            .bind(limit)
            .fetch_all(&mut **tx)
            .await?
    };
    if cards_rows.is_empty() {
        return Ok(vec![]);
    }
    let ids: Vec<String> = cards_rows
        .iter()
        .map(|r| r.try_get::<String, _>("id"))
        .collect::<Result<_, _>>()?;
    let log_rows = sqlx::query(
        "SELECT * FROM review_log WHERE card_id = ANY($1) ORDER BY reviewed_at, id",
    )
    .bind(&ids)
    .fetch_all(&mut **tx)
    .await?;
    let mut logs_by_card: std::collections::HashMap<String, Vec<ReviewLogRow>> =
        std::collections::HashMap::new();
    for row in log_rows {
        let log = super::review::row_to_review_log_pg(&row)?;
        logs_by_card.entry(log.card_id.clone()).or_default().push(log);
    }
    Ok(cards_rows
        .iter()
        .map(|r| {
            let card = to_study_card(&row_to_card_pg(r).unwrap());
            ReplayBatchItem {
                logs: logs_by_card.remove(&card.id).unwrap_or_default(),
                card,
            }
        })
        .collect())
}

async fn rebuild_sqlite<F>(p: &sqlx::Pool<sqlx::Sqlite>, compute_batch: F) -> Result<(u64, u64)>
where
    F: Fn(&[ReplayBatchItem]) -> Vec<CardRebuildUpdate>,
{
    let mut tx = p.begin().await?;
    let (checked, changed) = rebuild_loop_sqlite(&mut tx, &compute_batch).await?;
    tx.commit().await?;
    Ok((checked, changed))
}

async fn rebuild_pg<F>(p: &sqlx::Pool<sqlx::Postgres>, compute_batch: F) -> Result<(u64, u64)>
where
    F: Fn(&[ReplayBatchItem]) -> Vec<CardRebuildUpdate>,
{
    let mut tx = p.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(7303301)")
        .execute(&mut *tx)
        .await?;
    let (checked, changed) = rebuild_loop_pg(&mut tx, &compute_batch).await?;
    tx.commit().await?;
    Ok((checked, changed))
}

async fn rebuild_loop_sqlite<F>(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    compute_batch: &F,
) -> Result<(u64, u64)>
where
    F: Fn(&[ReplayBatchItem]) -> Vec<CardRebuildUpdate>,
{
    let mut checked = 0u64;
    let mut changed = 0u64;
    let mut after: Option<String> = None;
    loop {
        let batch = fetch_batch_sqlite(tx, after.as_deref(), REPLAY_PAGE_SIZE).await?;
        for update in compute_batch(&batch) {
            apply_rebuild_sqlite(tx, &update).await?;
            changed += 1;
        }
        checked += batch.len() as u64;
        if batch.len() < REPLAY_PAGE_SIZE as usize {
            break;
        }
        after = batch.last().map(|b| b.card.id.clone());
    }
    Ok((checked, changed))
}

async fn rebuild_loop_pg<F>(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    compute_batch: &F,
) -> Result<(u64, u64)>
where
    F: Fn(&[ReplayBatchItem]) -> Vec<CardRebuildUpdate>,
{
    let mut checked = 0u64;
    let mut changed = 0u64;
    let mut after: Option<String> = None;
    loop {
        let batch = fetch_batch_pg(tx, after.as_deref(), REPLAY_PAGE_SIZE).await?;
        for update in compute_batch(&batch) {
            apply_rebuild_pg(tx, &update).await?;
            changed += 1;
        }
        checked += batch.len() as u64;
        if batch.len() < REPLAY_PAGE_SIZE as usize {
            break;
        }
        after = batch.last().map(|b| b.card.id.clone());
    }
    Ok((checked, changed))
}

async fn apply_rebuild_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    update: &CardRebuildUpdate,
) -> Result<()> {
    let f = &update.fields;
    sqlx::query(
        r#"UPDATE card SET sched_state = ?, due = ?, stability = ?, difficulty = ?, last_review = ?,
           reps = ?, lapses = ?, learning_step = ?,
           state = CASE WHEN state IN ('suspended', 'buried') THEN state ELSE ? END
           WHERE id = ?"#,
    )
    .bind(sched_state_to_str(f.sched_state))
    .bind(f.due)
    .bind(f.stability)
    .bind(f.difficulty)
    .bind(f.last_review)
    .bind(f.reps as i32)
    .bind(f.lapses as i32)
    .bind(f.learning_step as i32)
    .bind(sched_state_to_str(f.sched_state))
    .bind(&update.id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn apply_rebuild_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    update: &CardRebuildUpdate,
) -> Result<()> {
    let f = &update.fields;
    sqlx::query(
        r#"UPDATE card SET sched_state = $1, due = $2, stability = $3, difficulty = $4, last_review = $5,
           reps = $6, lapses = $7, learning_step = $8,
           state = CASE WHEN state IN ('suspended', 'buried') THEN state ELSE $9 END
           WHERE id = $10"#,
    )
    .bind(sched_state_to_str(f.sched_state))
    .bind(f.due)
    .bind(f.stability)
    .bind(f.difficulty)
    .bind(f.last_review)
    .bind(f.reps as i32)
    .bind(f.lapses as i32)
    .bind(f.learning_step as i32)
    .bind(sched_state_to_str(f.sched_state))
    .bind(&update.id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
