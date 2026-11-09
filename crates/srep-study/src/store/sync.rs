use crate::answer_plan::{plan_answer, AnswerPlan, CardRow, PlanFailure};
use crate::parked::is_parked_state;
use crate::store::convert::sched_state_to_str;
use crate::store::review::{
    apply_answer_pg, apply_answer_sqlite, read_answer_ctx_pg, read_answer_ctx_sqlite, AnswerContext,
};
use crate::types::StudyWindow;
use crate::validation::SyncItem;
use anyhow::Result;
use serde_json::{json, Value};
use sqlx::Row;
use srep_auth::tokens::sha256_hex;
use srep_db::DbPool;
use uuid::Uuid;

pub async fn sync_apply_item(
    pool: &DbPool,
    device_id: &str,
    item: &SyncItem,
    now_ms: i64,
    window: &StudyWindow,
) -> Result<Value> {
    let review_id = item.review_id.to_string();
    let card_id = item.card_id.to_string();
    let request_hash = request_hash(item);

    match pool {
        DbPool::Sqlite(p) => {
            let mut tx = p.begin().await?;
            if let Some((stored_hash, stored_result)) =
                read_receipt_sqlite(&mut tx, device_id, &review_id).await?
            {
                tx.commit().await?;
                return Ok(receipt_reply(
                    &review_id,
                    &request_hash,
                    &stored_hash,
                    stored_result,
                ));
            }

            let Some(ctx) = read_answer_ctx_sqlite(&mut tx, &card_id).await? else {
                let result = invalid_result(item.review_id, "card_not_found");
                write_receipt_sqlite(&mut tx, device_id, item, &request_hash, &result, now_ms)
                    .await?;
                tx.commit().await?;
                return Ok(result);
            };

            let log_id = Uuid::new_v4().to_string();
            let (plan, result) = plan_item(ctx, item, now_ms, window, log_id);
            if let Some(plan) = plan.as_ref() {
                apply_answer_sqlite(&mut tx, &card_id, plan).await?;
            }
            write_receipt_sqlite(&mut tx, device_id, item, &request_hash, &result, now_ms).await?;
            tx.commit().await?;
            Ok(result)
        }
        DbPool::Postgres(p) => {
            let mut tx = p.begin().await?;
            sqlx::query("SELECT pg_advisory_xact_lock(7303301)")
                .execute(&mut *tx)
                .await?;
            if let Some((stored_hash, stored_result)) =
                read_receipt_pg(&mut tx, device_id, &review_id).await?
            {
                tx.commit().await?;
                return Ok(receipt_reply(
                    &review_id,
                    &request_hash,
                    &stored_hash,
                    stored_result,
                ));
            }

            let Some(ctx) = read_answer_ctx_pg(&mut tx, &card_id).await? else {
                let result = invalid_result(item.review_id, "card_not_found");
                write_receipt_pg(&mut tx, device_id, item, &request_hash, &result, now_ms).await?;
                tx.commit().await?;
                return Ok(result);
            };

            let log_id = Uuid::new_v4().to_string();
            let (plan, result) = plan_item(ctx, item, now_ms, window, log_id);
            if let Some(plan) = plan.as_ref() {
                apply_answer_pg(&mut tx, &card_id, plan).await?;
            }
            write_receipt_pg(&mut tx, device_id, item, &request_hash, &result, now_ms).await?;
            tx.commit().await?;
            Ok(result)
        }
    }
}

/// R17: log ids undone at or after `since_ms`, in undo order.
/// Used by the client to reconcile its durable acked-review ledger
/// against authoritative server state on its next pull.
pub async fn undo_events_since(pool: &DbPool, since: i64) -> Result<Vec<String>> {
    match pool {
        DbPool::Sqlite(p) => {
            let rows = sqlx::query(
                "SELECT log_id FROM undo_events WHERE undone_at >= ? ORDER BY undone_at ASC",
            )
            .bind(since)
            .fetch_all(p)
            .await?;
            let mut log_ids = Vec::with_capacity(rows.len());
            for row in rows {
                log_ids.push(row.try_get::<String, _>("log_id")?);
            }
            Ok(log_ids)
        }
        DbPool::Postgres(p) => {
            let rows = sqlx::query(
                "SELECT log_id FROM undo_events WHERE undone_at >= $1 ORDER BY undone_at ASC",
            )
            .bind(since)
            .fetch_all(p)
            .await?;
            let mut log_ids = Vec::with_capacity(rows.len());
            for row in rows {
                log_ids.push(row.try_get::<String, _>("log_id")?);
            }
            Ok(log_ids)
        }
    }
}

pub async fn review_log_head(pool: &DbPool) -> Result<Option<i64>> {
    match pool {
        DbPool::Sqlite(p) => {
            let row = sqlx::query("SELECT MAX(reviewed_at) AS head FROM review_log")
                .fetch_one(p)
                .await?;
            Ok(row.try_get("head")?)
        }
        DbPool::Postgres(p) => {
            let row = sqlx::query("SELECT MAX(reviewed_at) AS head FROM review_log")
                .fetch_one(p)
                .await?;
            Ok(row.try_get("head")?)
        }
    }
}

fn request_hash(item: &SyncItem) -> String {
    let canonical = format!(
        "{{\"cardId\":\"{}\",\"rating\":{},\"reps\":{},\"elapsedMs\":{},\"clientOccurredAt\":{}}}",
        item.card_id, item.rating, item.reps, item.elapsed_ms, item.client_occurred_at
    );
    sha256_hex(canonical.as_bytes())
}

fn plan_item(
    ctx: AnswerContext,
    item: &SyncItem,
    now_ms: i64,
    window: &StudyWindow,
    log_id: String,
) -> (Option<AnswerPlan>, Value) {
    match plan_answer(
        &ctx.card,
        &ctx.deck_preset,
        &ctx.siblings,
        ctx.last_reviewed_at_max,
        item.rating,
        item.reps,
        item.elapsed_ms,
        now_ms,
        window,
        log_id,
    ) {
        Ok(plan) => {
            let result = accepted_result(item.review_id, &plan);
            (Some(plan), result)
        }
        Err(PlanFailure::StaleCard) => (
            None,
            json!({
                "reviewId": item.review_id.to_string(),
                "status": "stale_card",
                "card": card_snapshot(&ctx.card),
            }),
        ),
        Err(_) => {
            let reason = if is_parked_state(ctx.card.state) {
                "card_not_studyable"
            } else {
                "bad_preset"
            };
            (None, invalid_result(item.review_id, reason))
        }
    }
}

fn accepted_result(review_id: Uuid, plan: &AnswerPlan) -> Value {
    let log = &plan.log;
    let u = &plan.card_update;
    json!({
        "reviewId": review_id.to_string(),
        "status": "accepted",
        "logId": log.id,
        "card": {
            "id": log.card_id,
            "state": sched_state_to_str(u.sched_state),
            "due": u.due,
            "reps": u.reps,
            "lapses": u.lapses,
            "stability": u.stability,
            "difficulty": u.difficulty,
        }
    })
}

fn card_snapshot(card: &CardRow) -> Value {
    json!({
        "id": card.id,
        "state": sched_state_to_str(card.sched_state),
        "due": card.due,
        "reps": card.reps,
        "lapses": card.lapses,
        "stability": card.stability,
        "difficulty": card.difficulty,
    })
}

fn invalid_result(review_id: Uuid, reason: &str) -> Value {
    json!({
        "reviewId": review_id.to_string(),
        "status": "invalid",
        "reason": reason,
    })
}

fn receipt_reply(
    review_id: &str,
    request_hash: &str,
    stored_hash: &str,
    stored_result: Value,
) -> Value {
    if request_hash != stored_hash {
        return json!({
            "reviewId": review_id,
            "status": "idempotency_mismatch",
        });
    }

    let outcome = stored_result
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("invalid")
        .to_string();
    let mut result = stored_result.as_object().cloned().unwrap_or_default();
    result.insert("reviewId".to_string(), json!(review_id));
    result.insert("status".to_string(), json!("duplicate"));
    result.insert("outcome".to_string(), json!(outcome));
    Value::Object(result)
}

async fn read_receipt_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    device_id: &str,
    review_id: &str,
) -> Result<Option<(String, Value)>> {
    let row = sqlx::query(
        "SELECT request_hash, result_json FROM sync_receipts WHERE device_id = ? AND review_id = ?",
    )
    .bind(device_id)
    .bind(review_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let hash: String = row.try_get("request_hash")?;
    let result_json: String = row.try_get("result_json")?;
    Ok(Some((hash, serde_json::from_str(&result_json)?)))
}

async fn read_receipt_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    device_id: &str,
    review_id: &str,
) -> Result<Option<(String, Value)>> {
    let row = sqlx::query(
        "SELECT request_hash, result_json FROM sync_receipts WHERE device_id = $1 AND review_id = $2",
    )
    .bind(device_id)
    .bind(review_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let hash: String = row.try_get("request_hash")?;
    let result_json: String = row.try_get("result_json")?;
    Ok(Some((hash, serde_json::from_str(&result_json)?)))
}

async fn write_receipt_sqlite(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    device_id: &str,
    item: &SyncItem,
    request_hash: &str,
    result: &Value,
    now_ms: i64,
) -> Result<()> {
    let outcome = result
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("invalid");
    let log_id = result.get("logId").and_then(Value::as_str);
    sqlx::query(
        "INSERT INTO sync_receipts (device_id, review_id, request_hash, outcome, log_id, client_occurred_at, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(device_id)
    .bind(item.review_id.to_string())
    .bind(request_hash)
    .bind(outcome)
    .bind(log_id)
    .bind(item.client_occurred_at)
    .bind(serde_json::to_string(result)?)
    .bind(now_ms)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn write_receipt_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    device_id: &str,
    item: &SyncItem,
    request_hash: &str,
    result: &Value,
    now_ms: i64,
) -> Result<()> {
    let outcome = result
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("invalid");
    let log_id = result.get("logId").and_then(Value::as_str);
    sqlx::query(
        "INSERT INTO sync_receipts (device_id, review_id, request_hash, outcome, log_id, client_occurred_at, result_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(device_id)
    .bind(item.review_id.to_string())
    .bind(request_hash)
    .bind(outcome)
    .bind(log_id)
    .bind(item.client_occurred_at)
    .bind(serde_json::to_string(result)?)
    .bind(now_ms)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
