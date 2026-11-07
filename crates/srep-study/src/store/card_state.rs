use crate::answer_plan::CardRow;
use crate::card_state_plan::CardStateFailure;
use crate::card_state_plan::CardStateUpdate;
use crate::store::convert::{card_state_to_str, sched_state_to_str, to_study_card};
use crate::store::ChangeCardStatesResult;
use anyhow::Result;
use srep_db::DbPool;
use srep_domain::store::rows::row_to_card_sqlite;

const CHUNK: usize = 500;

pub async fn unbury_expired(pool: &DbPool, now_ms: i64) -> Result<u64> {
    match pool {
        DbPool::Sqlite(p) => {
            let r = sqlx::query(
                "UPDATE card SET state = sched_state, buried_until = NULL WHERE state = 'buried' AND buried_until <= ?",
            )
            .bind(now_ms)
            .execute(p)
            .await?;
            Ok(r.rows_affected())
        }
        DbPool::Postgres(p) => {
            let r = sqlx::query(
                "UPDATE card SET state = sched_state, buried_until = NULL WHERE state = 'buried' AND buried_until <= $1",
            )
            .bind(now_ms)
            .execute(p)
            .await?;
            Ok(r.rows_affected())
        }
    }
}

async fn read_cards_sqlite(
    ex: &mut sqlx::SqliteConnection,
    ids: &[String],
) -> Result<Vec<CardRow>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(CHUNK) {
        let placeholders = std::iter::repeat("?")
            .take(chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("SELECT * FROM card WHERE id IN ({placeholders}) ORDER BY id");
        let mut q = sqlx::query(&sql);
        for id in chunk {
            q = q.bind(id);
        }
        let rows = q.fetch_all(&mut *ex).await?;
        for row in rows {
            out.push(to_study_card(&row_to_card_sqlite(&row)?));
        }
    }
    Ok(out)
}

async fn apply_updates_sqlite(
    ex: &mut sqlx::SqliteConnection,
    updates: &[CardStateUpdate],
) -> Result<()> {
    for group in group_updates(updates) {
        for chunk in group.ids.chunks(CHUNK) {
            let placeholders = std::iter::repeat("?")
                .take(chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let state = card_state_to_str(group.state);
            let sql = format!(
                "UPDATE card SET state = ?, buried_until = ? WHERE id IN ({placeholders})"
            );
            let mut q = sqlx::query(&sql).bind(state).bind(group.buried_until);
            for id in chunk {
                q = q.bind(id);
            }
            q.execute(&mut *ex).await?;
        }
    }
    Ok(())
}

struct GroupedUpdate {
    state: crate::parked::CardState,
    buried_until: Option<i64>,
    ids: Vec<String>,
}

fn group_updates(updates: &[CardStateUpdate]) -> Vec<GroupedUpdate> {
    use std::collections::HashMap;
    let mut map: HashMap<(crate::parked::CardState, Option<i64>), Vec<String>> = HashMap::new();
    for u in updates {
        map.entry((u.state, u.buried_until))
            .or_default()
            .push(u.id.clone());
    }
    map.into_iter()
        .map(|((state, buried_until), ids)| GroupedUpdate {
            state,
            buried_until,
            ids,
        })
        .collect()
}

pub async fn change_card_states<F>(
    pool: &DbPool,
    card_ids: &[String],
    compute: F,
) -> Result<ChangeCardStatesResult>
where
    F: FnOnce(&[CardRow]) -> Result<Vec<CardStateUpdate>, CardStateFailure>,
{
    let mut ids: Vec<_> = card_ids.to_vec();
    ids.sort();
    ids.dedup();
    match pool {
        DbPool::Sqlite(p) => {
            let mut tx = p.begin().await?;
            let cards = read_cards_sqlite(&mut tx, &ids).await?;
            if cards.len() != ids.len() {
                return Ok(ChangeCardStatesResult::CardNotFound);
            }
            let updates = match compute(&cards) {
                Ok(u) => u,
                Err(e) => return Ok(ChangeCardStatesResult::Failure(e)),
            };
            apply_updates_sqlite(&mut tx, &updates).await?;
            tx.commit().await?;
            Ok(ChangeCardStatesResult::Ok)
        }
        DbPool::Postgres(p) => {
            let mut tx = p.begin().await?;
            sqlx::query("SELECT pg_advisory_xact_lock(7303301)")
                .execute(&mut *tx)
                .await?;
            let cards = read_cards_pg(&mut tx, &ids).await?;
            if cards.len() != ids.len() {
                return Ok(ChangeCardStatesResult::CardNotFound);
            }
            let updates = match compute(&cards) {
                Ok(u) => u,
                Err(e) => return Ok(ChangeCardStatesResult::Failure(e)),
            };
            apply_updates_pg(&mut tx, &updates).await?;
            tx.commit().await?;
            Ok(ChangeCardStatesResult::Ok)
        }
    }
}

async fn read_cards_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ids: &[String],
) -> Result<Vec<CardRow>> {
    use srep_domain::store::rows::row_to_card_pg;
    let mut out = Vec::new();
    for chunk in ids.chunks(CHUNK) {
        let rows = sqlx::query("SELECT * FROM card WHERE id = ANY($1) ORDER BY id")
            .bind(chunk)
            .fetch_all(&mut **tx)
            .await?;
        for row in rows {
            out.push(to_study_card(&row_to_card_pg(&row)?));
        }
    }
    Ok(out)
}

async fn apply_updates_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    updates: &[CardStateUpdate],
) -> Result<()> {
    for group in group_updates(updates) {
        let state = card_state_to_str(group.state);
        sqlx::query("UPDATE card SET state = $1, buried_until = $2 WHERE id = ANY($3)")
            .bind(state)
            .bind(group.buried_until)
            .bind(&group.ids)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

// silence unused import warning for sched_state_to_str if added later
#[allow(dead_code)]
fn _sched() {
    let _ = sched_state_to_str(crate::types::SchedState::New);
}
