use anyhow::Result;
use sqlx::Row;
use srep_db::DbPool;

use crate::metrics::{CardDueRow, ReviewRow};

pub async fn list_review_stats(pool: &DbPool) -> Result<Vec<ReviewRow>> {
    let sql = r#"SELECT review_log.reviewed_at, review_log.rating, review_log.state_before,
                 review_log.elapsed_ms, deck.preset_id
                 FROM review_log
                 INNER JOIN card ON card.id = review_log.card_id
                 LEFT JOIN deck ON deck.id = card.deck_id"#;
    match pool {
        DbPool::Sqlite(p) => {
            let rows = sqlx::query(sql).fetch_all(p).await?;
            Ok(rows
                .iter()
                .map(|r| ReviewRow {
                    reviewed_at: r.try_get("reviewed_at").unwrap_or(0),
                    rating: r.try_get("rating").unwrap_or(0),
                    state_before: r.try_get("state_before").unwrap_or_default(),
                    elapsed_ms: r.try_get("elapsed_ms").unwrap_or(0),
                    preset_id: r.try_get("preset_id").ok(),
                })
                .collect())
        }
        DbPool::Postgres(p) => {
            let rows = sqlx::query(sql).fetch_all(p).await?;
            Ok(rows
                .iter()
                .map(|r| ReviewRow {
                    reviewed_at: r.try_get("reviewed_at").unwrap_or(0),
                    rating: r.try_get("rating").unwrap_or(0),
                    state_before: r.try_get("state_before").unwrap_or_default(),
                    elapsed_ms: r.try_get("elapsed_ms").unwrap_or(0),
                    preset_id: r.try_get("preset_id").ok(),
                })
                .collect())
        }
    }
}

pub async fn list_review_stats_since(pool: &DbPool, since_ms: i64) -> Result<Vec<ReviewRow>> {
    match pool {
        DbPool::Sqlite(p) => {
            let rows = sqlx::query(
                r#"SELECT review_log.reviewed_at, review_log.rating, review_log.state_before,
                   review_log.elapsed_ms, deck.preset_id
                   FROM review_log
                   INNER JOIN card ON card.id = review_log.card_id
                   LEFT JOIN deck ON deck.id = card.deck_id
                   WHERE review_log.reviewed_at >= ?"#,
            )
            .bind(since_ms)
            .fetch_all(p)
            .await?;
            Ok(rows
                .iter()
                .map(|r| ReviewRow {
                    reviewed_at: r.try_get("reviewed_at").unwrap_or(0),
                    rating: r.try_get("rating").unwrap_or(0),
                    state_before: r.try_get("state_before").unwrap_or_default(),
                    elapsed_ms: r.try_get("elapsed_ms").unwrap_or(0),
                    preset_id: r.try_get("preset_id").ok(),
                })
                .collect())
        }
        DbPool::Postgres(p) => {
            let rows = sqlx::query(
                r#"SELECT review_log.reviewed_at, review_log.rating, review_log.state_before,
                   review_log.elapsed_ms, deck.preset_id
                   FROM review_log
                   INNER JOIN card ON card.id = review_log.card_id
                   LEFT JOIN deck ON deck.id = card.deck_id
                   WHERE review_log.reviewed_at >= $1"#,
            )
            .bind(since_ms)
            .fetch_all(p)
            .await?;
            Ok(rows
                .iter()
                .map(|r| ReviewRow {
                    reviewed_at: r.try_get("reviewed_at").unwrap_or(0),
                    rating: r.try_get("rating").unwrap_or(0),
                    state_before: r.try_get("state_before").unwrap_or_default(),
                    elapsed_ms: r.try_get("elapsed_ms").unwrap_or(0),
                    preset_id: r.try_get("preset_id").ok(),
                })
                .collect())
        }
    }
}

pub async fn list_card_due_rows(pool: &DbPool) -> Result<Vec<CardDueRow>> {
    let sql = "SELECT due, sched_state, state, stability, last_review FROM card";
    match pool {
        DbPool::Sqlite(p) => {
            let rows = sqlx::query(sql).fetch_all(p).await?;
            Ok(rows
                .iter()
                .map(|r| CardDueRow {
                    due: r.try_get("due").unwrap_or(0),
                    sched_state: r.try_get("sched_state").unwrap_or_default(),
                    state: r.try_get("state").unwrap_or_default(),
                    stability: r.try_get("stability").unwrap_or(0.0),
                    last_review: r.try_get::<Option<i64>, _>("last_review").ok().flatten(),
                })
                .collect())
        }
        DbPool::Postgres(p) => {
            let rows = sqlx::query(sql).fetch_all(p).await?;
            Ok(rows
                .iter()
                .map(|r| CardDueRow {
                    due: r.try_get("due").unwrap_or(0),
                    sched_state: r.try_get("sched_state").unwrap_or_default(),
                    state: r.try_get("state").unwrap_or_default(),
                    stability: r.try_get("stability").unwrap_or(0.0),
                    last_review: r.try_get::<Option<i64>, _>("last_review").ok().flatten(),
                })
                .collect())
        }
    }
}

pub async fn count_reviews_for_preset(pool: &DbPool, preset_id: &str) -> Result<u32> {
    match pool {
        DbPool::Sqlite(p) => {
            let row = sqlx::query(
                r#"SELECT COUNT(*) AS c FROM review_log
                 INNER JOIN card ON card.id = review_log.card_id
                 INNER JOIN deck ON deck.id = card.deck_id
                 WHERE deck.preset_id = ?"#,
            )
            .bind(preset_id)
            .fetch_one(p)
            .await?;
            Ok(row.try_get::<i64, _>("c").unwrap_or(0) as u32)
        }
        DbPool::Postgres(p) => {
            let row = sqlx::query(
                r#"SELECT COUNT(*) AS c FROM review_log
                 INNER JOIN card ON card.id = review_log.card_id
                 INNER JOIN deck ON deck.id = card.deck_id
                 WHERE deck.preset_id = $1"#,
            )
            .bind(preset_id)
            .fetch_one(p)
            .await?;
            Ok(row.try_get::<i64, _>("c").unwrap_or(0) as u32)
        }
    }
}

pub async fn list_preset_reviews(pool: &DbPool, preset_id: &str) -> Result<Vec<ReviewRow>> {
    match pool {
        DbPool::Sqlite(p) => {
            let rows = sqlx::query(
                r#"SELECT review_log.reviewed_at, review_log.rating, review_log.state_before,
                   review_log.elapsed_ms, deck.preset_id
                   FROM review_log
                   INNER JOIN card ON card.id = review_log.card_id
                   INNER JOIN deck ON deck.id = card.deck_id
                   WHERE deck.preset_id = ?"#,
            )
            .bind(preset_id)
            .fetch_all(p)
            .await?;
            Ok(rows
                .iter()
                .map(|r| ReviewRow {
                    reviewed_at: r.try_get("reviewed_at").unwrap_or(0),
                    rating: r.try_get("rating").unwrap_or(0),
                    state_before: r.try_get("state_before").unwrap_or_default(),
                    elapsed_ms: r.try_get("elapsed_ms").unwrap_or(0),
                    preset_id: r.try_get("preset_id").ok(),
                })
                .collect())
        }
        DbPool::Postgres(p) => {
            let rows = sqlx::query(
                r#"SELECT review_log.reviewed_at, review_log.rating, review_log.state_before,
                   review_log.elapsed_ms, deck.preset_id
                   FROM review_log
                   INNER JOIN card ON card.id = review_log.card_id
                   INNER JOIN deck ON deck.id = card.deck_id
                   WHERE deck.preset_id = $1"#,
            )
            .bind(preset_id)
            .fetch_all(p)
            .await?;
            Ok(rows
                .iter()
                .map(|r| ReviewRow {
                    reviewed_at: r.try_get("reviewed_at").unwrap_or(0),
                    rating: r.try_get("rating").unwrap_or(0),
                    state_before: r.try_get("state_before").unwrap_or_default(),
                    elapsed_ms: r.try_get("elapsed_ms").unwrap_or(0),
                    preset_id: r.try_get("preset_id").ok(),
                })
                .collect())
        }
    }
}
