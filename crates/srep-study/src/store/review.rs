use crate::answer_plan::{AnswerPlan, AnswerPreset, CardRow, PlanFailure, UndoPlan};
use crate::store::convert::{to_answer_preset, to_study_card};
use crate::store::AnswerCardResult;
use crate::types::ReviewLogRow;
use anyhow::Result;
use srep_db::DbPool;
use srep_domain::store::rows::{row_to_card_pg, row_to_card_sqlite, row_to_preset, row_to_preset_pg};
use sqlx::Row;

pub struct AnswerContext {
    pub card: CardRow,
    pub deck_preset: AnswerPreset,
    pub siblings: Vec<CardRow>,
    pub last_reviewed_at_max: Option<i64>,
}

pub struct UndoContext {
    pub log: ReviewLogRow,
    pub card: CardRow,
    pub buried: Vec<CardRow>,
}

pub enum UndoResult {
    NothingToUndo,
    Ok(ReviewLogRow),
}

pub async fn read_card(
    pool: &DbPool,
    card_id: &str,
) -> Result<Option<(CardRow, Option<srep_domain::types::PresetRow>)>> {
    match pool {
        DbPool::Sqlite(p) => {
            let row = sqlx::query("SELECT * FROM card WHERE id = ?")
                .bind(card_id)
                .fetch_optional(p)
                .await?;
            let Some(row) = row else {
                return Ok(None);
            };
            let card_db = row_to_card_sqlite(&row)?;
            let card = to_study_card(&card_db);
            let preset = match card_db.deck_id.as_deref() {
                Some(deck_id) => {
                    let prow = sqlx::query(
                        r#"SELECT p.* FROM deck d
                           INNER JOIN deck_preset p ON p.id = d.preset_id
                           WHERE d.id = ?"#,
                    )
                    .bind(deck_id)
                    .fetch_optional(p)
                    .await?;
                    prow.map(|r| row_to_preset(&r)).transpose()?
                }
                None => None,
            };
            Ok(Some((card, preset)))
        }
        DbPool::Postgres(p) => {
            let row = sqlx::query("SELECT * FROM card WHERE id = $1")
                .bind(card_id)
                .fetch_optional(p)
                .await?;
            let Some(row) = row else {
                return Ok(None);
            };
            let card_db = row_to_card_pg(&row)?;
            let card = to_study_card(&card_db);
            let preset = match card_db.deck_id.as_deref() {
                Some(deck_id) => {
                    let prow = sqlx::query(
                        r#"SELECT p.* FROM deck d
                           INNER JOIN deck_preset p ON p.id = d.preset_id
                           WHERE d.id = $1"#,
                    )
                    .bind(deck_id)
                    .fetch_optional(p)
                    .await?;
                    prow.map(|r| row_to_preset_pg(&r)).transpose()?
                }
                None => None,
            };
            Ok(Some((card, preset)))
        }
    }
}

pub async fn answer_card<F>(pool: &DbPool, card_id: &str, compute: F) -> Result<AnswerCardResult>
where
    F: FnOnce(AnswerContext) -> Result<AnswerPlan, PlanFailure>,
{
    match pool {
        DbPool::Sqlite(p) => {
            let mut tx = p.begin().await?;
            let ctx = match read_answer_ctx_sqlite(&mut tx, card_id).await? {
                Some(c) => c,
                None => return Ok(AnswerCardResult::NotFound),
            };
            let plan = match compute(ctx) {
                Ok(p) => p,
                Err(e) => return Ok(AnswerCardResult::Failure(e)),
            };
            apply_answer_sqlite(&mut tx, card_id, &plan).await?;
            tx.commit().await?;
            Ok(AnswerCardResult::Ok(plan))
        }
        DbPool::Postgres(p) => {
            let mut tx = p.begin().await?;
            sqlx::query("SELECT pg_advisory_xact_lock(7303301)")
                .execute(&mut *tx)
                .await?;
            let ctx = match read_answer_ctx_pg(&mut tx, card_id).await? {
                Some(c) => c,
                None => return Ok(AnswerCardResult::NotFound),
            };
            let plan = match compute(ctx) {
                Ok(p) => p,
                Err(e) => return Ok(AnswerCardResult::Failure(e)),
            };
            apply_answer_pg(&mut tx, card_id, &plan).await?;
            tx.commit().await?;
            Ok(AnswerCardResult::Ok(plan))
        }
    }
}

pub async fn undo_last_review<F>(pool: &DbPool, compute: F) -> Result<UndoResult>
where
    F: FnOnce(UndoContext) -> UndoPlan,
{
    match pool {
        DbPool::Sqlite(p) => {
            let mut tx = p.begin().await?;
            let result = undo_sqlite(&mut tx, compute).await?;
            tx.commit().await?;
            Ok(result)
        }
        DbPool::Postgres(p) => {
            let mut tx = p.begin().await?;
            sqlx::query("SELECT pg_advisory_xact_lock(7303301)")
                .execute(&mut *tx)
                .await?;
            let result = undo_pg(&mut tx, compute).await?;
            tx.commit().await?;
            Ok(result)
        }
    }
}

async fn read_answer_ctx_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    card_id: &str,
) -> Result<Option<AnswerContext>> {
    let row = sqlx::query(
        r#"SELECT c.* FROM card c
           INNER JOIN note n ON n.id = c.note_id
           WHERE c.id = ? AND n.deleted_at IS NULL"#,
    )
    .bind(card_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(card_row) = row else {
        return Ok(None);
    };
    let card_db = row_to_card_sqlite(&card_row)?;
    if card_db.deck_id.is_none() {
        return Ok(None);
    }
    let deck_id = card_db.deck_id.as_ref().unwrap();
    let preset_row = sqlx::query(
        r#"SELECT p.* FROM deck d
           INNER JOIN deck_preset p ON p.id = d.preset_id
           WHERE d.id = ?"#,
    )
    .bind(deck_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(preset_row) = preset_row else {
        return Ok(None);
    };
    let preset = row_to_preset(&preset_row)?;
    let siblings_rows = sqlx::query("SELECT * FROM card WHERE note_id = ? AND id != ? ORDER BY position")
        .bind(&card_db.note_id)
        .bind(card_id)
        .fetch_all(&mut **tx)
        .await?;
    let siblings: Vec<_> = siblings_rows
        .iter()
        .map(|r| to_study_card(&row_to_card_sqlite(r).unwrap()))
        .collect();
    let max: Option<i64> = sqlx::query_scalar("SELECT MAX(reviewed_at) FROM review_log")
        .fetch_one(&mut **tx)
        .await?;
    let last_reviewed_at_max = max;
    Ok(Some(AnswerContext {
        card: to_study_card(&card_db),
        deck_preset: to_answer_preset(&preset),
        siblings,
        last_reviewed_at_max,
    }))
}

async fn read_answer_ctx_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    card_id: &str,
) -> Result<Option<AnswerContext>> {
    let row = sqlx::query(
        r#"SELECT c.* FROM card c
           INNER JOIN note n ON n.id = c.note_id
           WHERE c.id = $1 AND n.deleted_at IS NULL"#,
    )
    .bind(card_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(card_row) = row else {
        return Ok(None);
    };
    let card_db = row_to_card_pg(&card_row)?;
    if card_db.deck_id.is_none() {
        return Ok(None);
    }
    let deck_id = card_db.deck_id.as_ref().unwrap();
    let preset_row = sqlx::query(
        r#"SELECT p.* FROM deck d
           INNER JOIN deck_preset p ON p.id = d.preset_id
           WHERE d.id = $1"#,
    )
    .bind(deck_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(preset_row) = preset_row else {
        return Ok(None);
    };
    let preset = row_to_preset_pg(&preset_row)?;
    let siblings_rows = sqlx::query("SELECT * FROM card WHERE note_id = $1 AND id != $2 ORDER BY position")
        .bind(&card_db.note_id)
        .bind(card_id)
        .fetch_all(&mut **tx)
        .await?;
    let siblings: Vec<_> = siblings_rows
        .iter()
        .map(|r| to_study_card(&row_to_card_pg(r).unwrap()))
        .collect();
    let max: Option<i64> = sqlx::query_scalar("SELECT MAX(reviewed_at) FROM review_log")
        .fetch_one(&mut **tx)
        .await?;
    let last_reviewed_at_max = max;
    Ok(Some(AnswerContext {
        card: to_study_card(&card_db),
        deck_preset: to_answer_preset(&preset),
        siblings,
        last_reviewed_at_max,
    }))
}

fn sched_to_parked(s: crate::types::SchedState) -> crate::parked::CardState {
    match s {
        crate::types::SchedState::New => crate::parked::CardState::New,
        crate::types::SchedState::Learning => crate::parked::CardState::Learning,
        crate::types::SchedState::Review => crate::parked::CardState::Review,
        crate::types::SchedState::Relearning => crate::parked::CardState::Relearning,
    }
}

async fn apply_answer_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    card_id: &str,
    plan: &AnswerPlan,
) -> Result<()> {
    use crate::store::convert::{card_state_to_str, sched_state_to_str};
    let u = &plan.card_update;
    sqlx::query(
        r#"UPDATE card SET sched_state = ?, state = ?, due = ?, stability = ?, difficulty = ?,
           last_review = ?, reps = ?, lapses = ?, learning_step = ? WHERE id = ?"#,
    )
    .bind(sched_state_to_str(u.sched_state))
    .bind(card_state_to_str(sched_to_parked(plan.card_state)))
    .bind(u.due)
    .bind(u.stability)
    .bind(u.difficulty)
    .bind(u.last_review)
    .bind(u.reps as i32)
    .bind(u.lapses as i32)
    .bind(u.learning_step as i32)
    .bind(card_id)
    .execute(&mut **tx)
    .await?;
    let buried_json = serde_json::to_string(&plan.log.buried_sibling_ids)?;
    sqlx::query(
        r#"INSERT INTO review_log (id, card_id, reviewed_at, rating, state_before, due_before,
           stability_before, difficulty_before, last_review_before, reps_before, lapses_before,
           step_before, elapsed_ms, interval_after, buried_sibling_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&plan.log.id)
    .bind(&plan.log.card_id)
    .bind(plan.log.reviewed_at)
    .bind(plan.log.rating as i32)
    .bind(sched_state_to_str(plan.log.state_before))
    .bind(plan.log.due_before)
    .bind(plan.log.stability_before)
    .bind(plan.log.difficulty_before)
    .bind(plan.log.last_review_before)
    .bind(plan.log.reps_before as i32)
    .bind(plan.log.lapses_before as i32)
    .bind(plan.log.step_before as i32)
    .bind(plan.log.elapsed_ms as i64)
    .bind(plan.log.interval_after as i32)
    .bind(buried_json)
    .execute(&mut **tx)
    .await?;
    for bury_id in &plan.bury_ids {
        sqlx::query(
            "UPDATE card SET state = 'buried', buried_until = ? WHERE id = ? AND state IN ('new', 'review')",
        )
        .bind(plan.bury_until)
        .bind(bury_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn apply_answer_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    card_id: &str,
    plan: &AnswerPlan,
) -> Result<()> {
    use crate::store::convert::{card_state_to_str, sched_state_to_str};
    let u = &plan.card_update;
    sqlx::query(
        r#"UPDATE card SET sched_state = $1, state = $2, due = $3, stability = $4, difficulty = $5,
           last_review = $6, reps = $7, lapses = $8, learning_step = $9 WHERE id = $10"#,
    )
    .bind(sched_state_to_str(u.sched_state))
    .bind(card_state_to_str(sched_to_parked(plan.card_state)))
    .bind(u.due)
    .bind(u.stability)
    .bind(u.difficulty)
    .bind(u.last_review)
    .bind(u.reps as i32)
    .bind(u.lapses as i32)
    .bind(u.learning_step as i32)
    .bind(card_id)
    .execute(&mut **tx)
    .await?;
    let buried_json = serde_json::to_value(&plan.log.buried_sibling_ids)?;
    sqlx::query(
        r#"INSERT INTO review_log (id, card_id, reviewed_at, rating, state_before, due_before,
           stability_before, difficulty_before, last_review_before, reps_before, lapses_before,
           step_before, elapsed_ms, interval_after, buried_sibling_ids)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)"#,
    )
    .bind(&plan.log.id)
    .bind(&plan.log.card_id)
    .bind(plan.log.reviewed_at)
    .bind(plan.log.rating as i32)
    .bind(sched_state_to_str(plan.log.state_before))
    .bind(plan.log.due_before)
    .bind(plan.log.stability_before)
    .bind(plan.log.difficulty_before)
    .bind(plan.log.last_review_before)
    .bind(plan.log.reps_before as i32)
    .bind(plan.log.lapses_before as i32)
    .bind(plan.log.step_before as i32)
    .bind(plan.log.elapsed_ms as i64)
    .bind(plan.log.interval_after as i32)
    .bind(buried_json)
    .execute(&mut **tx)
    .await?;
    for bury_id in &plan.bury_ids {
        sqlx::query(
            "UPDATE card SET state = 'buried', buried_until = $1 WHERE id = $2 AND state IN ('new', 'review')",
        )
        .bind(plan.bury_until)
        .bind(bury_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn undo_sqlite<F>(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    compute: F,
) -> Result<UndoResult>
where
    F: FnOnce(UndoContext) -> UndoPlan,
{
    let log_row = sqlx::query(
        "SELECT * FROM review_log ORDER BY reviewed_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await?;
    let Some(log_row) = log_row else {
        return Ok(UndoResult::NothingToUndo);
    };
    let log = row_to_review_log(&log_row)?;
    let card_row = sqlx::query("SELECT * FROM card WHERE id = ?")
        .bind(&log.card_id)
        .fetch_one(&mut **tx)
        .await?;
    let card = to_study_card(&row_to_card_sqlite(&card_row)?);
    let buried = read_buried_sqlite(tx, &log.buried_sibling_ids).await?;
    let plan = compute(UndoContext {
        log: log.clone(),
        card,
        buried,
    });
    apply_undo_sqlite(tx, &log.card_id, &plan).await?;
    sqlx::query("DELETE FROM review_log WHERE id = ?")
        .bind(&log.id)
        .execute(&mut **tx)
        .await?;
    Ok(UndoResult::Ok(log))
}

async fn undo_pg<F>(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, compute: F) -> Result<UndoResult>
where
    F: FnOnce(UndoContext) -> UndoPlan,
{
    let log_row = sqlx::query(
        "SELECT * FROM review_log ORDER BY reviewed_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await?;
    let Some(log_row) = log_row else {
        return Ok(UndoResult::NothingToUndo);
    };
    let log = row_to_review_log_pg(&log_row)?;
    let card_row = sqlx::query("SELECT * FROM card WHERE id = $1")
        .bind(&log.card_id)
        .fetch_one(&mut **tx)
        .await?;
    let card = to_study_card(&row_to_card_pg(&card_row)?);
    let buried = read_buried_pg(tx, &log.buried_sibling_ids).await?;
    let plan = compute(UndoContext {
        log: log.clone(),
        card,
        buried,
    });
    apply_undo_pg(tx, &log.card_id, &plan).await?;
    sqlx::query("DELETE FROM review_log WHERE id = $1")
        .bind(&log.id)
        .execute(&mut **tx)
        .await?;
    Ok(UndoResult::Ok(log))
}

pub(crate) fn row_to_review_log(row: &sqlx::sqlite::SqliteRow) -> Result<ReviewLogRow> {
    use crate::store::convert::sched_state_from_str;
    let buried: String = row.try_get("buried_sibling_ids")?;
    let buried_sibling_ids: Vec<String> = serde_json::from_str(&buried).unwrap_or_default();
    Ok(ReviewLogRow {
        id: row.try_get("id")?,
        card_id: row.try_get("card_id")?,
        reviewed_at: row.try_get("reviewed_at")?,
        rating: row.try_get::<i32, _>("rating")? as u32,
        state_before: sched_state_from_str(row.try_get("state_before")?),
        due_before: row.try_get("due_before")?,
        stability_before: row.try_get("stability_before")?,
        difficulty_before: row.try_get("difficulty_before")?,
        last_review_before: row.try_get("last_review_before")?,
        reps_before: row.try_get::<i32, _>("reps_before")? as u32,
        lapses_before: row.try_get::<i32, _>("lapses_before")? as u32,
        step_before: row.try_get::<i32, _>("step_before")? as u32,
        elapsed_ms: row.try_get::<i64, _>("elapsed_ms")? as u64,
        interval_after: row.try_get::<i32, _>("interval_after")? as u32,
        buried_sibling_ids,
    })
}

pub(crate) fn row_to_review_log_pg(row: &sqlx::postgres::PgRow) -> Result<ReviewLogRow> {
    use crate::store::convert::sched_state_from_str;
    let buried: serde_json::Value = row.try_get("buried_sibling_ids")?;
    let buried_sibling_ids: Vec<String> =
        serde_json::from_value(buried).unwrap_or_default();
    Ok(ReviewLogRow {
        id: row.try_get("id")?,
        card_id: row.try_get("card_id")?,
        reviewed_at: row.try_get("reviewed_at")?,
        rating: row.try_get::<i32, _>("rating")? as u32,
        state_before: sched_state_from_str(row.try_get("state_before")?),
        due_before: row.try_get("due_before")?,
        stability_before: row.try_get("stability_before")?,
        difficulty_before: row.try_get("difficulty_before")?,
        last_review_before: row.try_get("last_review_before")?,
        reps_before: row.try_get::<i32, _>("reps_before")? as u32,
        lapses_before: row.try_get::<i32, _>("lapses_before")? as u32,
        step_before: row.try_get::<i32, _>("step_before")? as u32,
        elapsed_ms: row.try_get::<i64, _>("elapsed_ms")? as u64,
        interval_after: row.try_get::<i32, _>("interval_after")? as u32,
        buried_sibling_ids,
    })
}

async fn read_buried_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ids: &[String],
) -> Result<Vec<CardRow>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
    let sql = format!("SELECT * FROM card WHERE id IN ({placeholders}) ORDER BY id");
    let mut q = sqlx::query(&sql);
    for id in ids {
        q = q.bind(id);
    }
    let rows = q.fetch_all(&mut **tx).await?;
    Ok(rows
        .iter()
        .map(|r| to_study_card(&row_to_card_sqlite(r).unwrap()))
        .collect())
}

async fn read_buried_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ids: &[String],
) -> Result<Vec<CardRow>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let rows = sqlx::query("SELECT * FROM card WHERE id = ANY($1) ORDER BY id")
        .bind(ids)
        .fetch_all(&mut **tx)
        .await?;
    Ok(rows
        .iter()
        .map(|r| to_study_card(&row_to_card_pg(r).unwrap()))
        .collect())
}

async fn apply_undo_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    card_id: &str,
    plan: &UndoPlan,
) -> Result<()> {
    use crate::store::convert::{card_state_to_str, sched_state_to_str};
    let r = &plan.card_restore;
    sqlx::query(
        r#"UPDATE card SET sched_state = ?, state = ?, due = ?, stability = ?, difficulty = ?,
           last_review = ?, reps = ?, lapses = ?, learning_step = ? WHERE id = ?"#,
    )
    .bind(sched_state_to_str(r.sched_state))
    .bind(card_state_to_str(r.state))
    .bind(r.due)
    .bind(r.stability)
    .bind(r.difficulty)
    .bind(r.last_review)
    .bind(r.reps as i32)
    .bind(r.lapses as i32)
    .bind(r.learning_step as i32)
    .bind(card_id)
    .execute(&mut **tx)
    .await?;
    for id in &plan.unbury_ids {
        sqlx::query("UPDATE card SET state = sched_state, buried_until = NULL WHERE id = ? AND state = 'buried'")
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

async fn apply_undo_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    card_id: &str,
    plan: &UndoPlan,
) -> Result<()> {
    use crate::store::convert::{card_state_to_str, sched_state_to_str};
    let r = &plan.card_restore;
    sqlx::query(
        r#"UPDATE card SET sched_state = $1, state = $2, due = $3, stability = $4, difficulty = $5,
           last_review = $6, reps = $7, lapses = $8, learning_step = $9 WHERE id = $10"#,
    )
    .bind(sched_state_to_str(r.sched_state))
    .bind(card_state_to_str(r.state))
    .bind(r.due)
    .bind(r.stability)
    .bind(r.difficulty)
    .bind(r.last_review)
    .bind(r.reps as i32)
    .bind(r.lapses as i32)
    .bind(r.learning_step as i32)
    .bind(card_id)
    .execute(&mut **tx)
    .await?;
    for id in &plan.unbury_ids {
        sqlx::query(
            "UPDATE card SET state = sched_state, buried_until = NULL WHERE id = $1 AND state = 'buried'",
        )
        .bind(id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
