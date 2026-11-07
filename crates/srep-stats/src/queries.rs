use anyhow::Result;
use sqlx::Row;
use srep_db::DbPool;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ReviewStatRow {
    pub reviewed_at: i64,
    pub rating: i32,
    pub state_before: String,
    pub elapsed_ms: i64,
    pub preset_id: Option<String>,
}

pub async fn list_review_stats(pool: &DbPool) -> Result<Vec<ReviewStatRow>> {
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
                .map(|r| ReviewStatRow {
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
                .map(|r| ReviewStatRow {
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

pub async fn list_review_stats_since(pool: &DbPool, since_ms: i64) -> Result<Vec<ReviewStatRow>> {
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
                .map(|r| ReviewStatRow {
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
                .map(|r| ReviewStatRow {
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
