use anyhow::Result;
use srep_db::DbPool;

pub async fn trash_notes(pool: &DbPool, ids: &[String], now: i64) -> Result<&'static str> {
    let ids = normalize_ids(ids)?;
    match pool {
        DbPool::Sqlite(p) => {
            let mut tx = p.begin().await?;
            for id in &ids {
                let exists: Option<String> =
                    sqlx::query_scalar("SELECT id FROM note WHERE id = ? AND deleted_at IS NULL")
                        .bind(id)
                        .fetch_optional(&mut *tx)
                        .await?;
                if exists.is_none() {
                    return Ok("not_found");
                }
                sqlx::query("UPDATE note SET deleted_at = ?, updated_at = ? WHERE id = ?")
                    .bind(now)
                    .bind(now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
        }
        DbPool::Postgres(p) => {
            let mut tx = p.begin().await?;
            for id in &ids {
                let exists: Option<String> =
                    sqlx::query_scalar("SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL")
                        .bind(id)
                        .fetch_optional(&mut *tx)
                        .await?;
                if exists.is_none() {
                    return Ok("not_found");
                }
                sqlx::query("UPDATE note SET deleted_at = $1, updated_at = $2 WHERE id = $3")
                    .bind(now)
                    .bind(now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
        }
    }
    Ok("ok")
}

pub async fn replace_note_tags(
    pool: &DbPool,
    ids: &[String],
    add: &[String],
    remove: &[String],
    now: i64,
) -> Result<&'static str> {
    let ids = normalize_ids(ids)?;
    for t in add.iter().chain(remove) {
        if t.len() > 200 || t.contains('\0') {
            return Ok("bad_request");
        }
    }
    match pool {
        DbPool::Sqlite(p) => {
            let mut tx = p.begin().await?;
            for id in &ids {
                if sqlx::query_scalar::<_, String>(
                    "SELECT id FROM note WHERE id = ? AND deleted_at IS NULL",
                )
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .is_none()
                {
                    return Ok("not_found");
                }
                let mut tags: Vec<String> =
                    sqlx::query_scalar("SELECT tag FROM note_tag WHERE note_id = ? ORDER BY tag")
                        .bind(id)
                        .fetch_all(&mut *tx)
                        .await?;
                for r in remove {
                    tags.retain(|t| t != r);
                }
                for a in add {
                    if !tags.contains(a) {
                        tags.push(a.clone());
                    }
                }
                tags.sort();
                sqlx::query("DELETE FROM note_tag WHERE note_id = ?")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                for tag in &tags {
                    sqlx::query("INSERT INTO note_tag (note_id, tag) VALUES (?, ?)")
                        .bind(id)
                        .bind(tag)
                        .execute(&mut *tx)
                        .await?;
                }
                sqlx::query("UPDATE note SET updated_at = ? WHERE id = ?")
                    .bind(now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
        }
        DbPool::Postgres(p) => {
            let mut tx = p.begin().await?;
            for id in &ids {
                if sqlx::query_scalar::<_, String>(
                    "SELECT id FROM note WHERE id = $1 AND deleted_at IS NULL",
                )
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .is_none()
                {
                    return Ok("not_found");
                }
                let mut tags: Vec<String> =
                    sqlx::query_scalar("SELECT tag FROM note_tag WHERE note_id = $1 ORDER BY tag")
                        .bind(id)
                        .fetch_all(&mut *tx)
                        .await?;
                for r in remove {
                    tags.retain(|t| t != r);
                }
                for a in add {
                    if !tags.contains(a) {
                        tags.push(a.clone());
                    }
                }
                tags.sort();
                sqlx::query("DELETE FROM note_tag WHERE note_id = $1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                for tag in &tags {
                    sqlx::query("INSERT INTO note_tag (note_id, tag) VALUES ($1, $2)")
                        .bind(id)
                        .bind(tag)
                        .execute(&mut *tx)
                        .await?;
                }
                sqlx::query("UPDATE note SET updated_at = $1 WHERE id = $2")
                    .bind(now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
        }
    }
    Ok("ok")
}

fn normalize_ids(ids: &[String]) -> Result<Vec<String>> {
    if ids.is_empty() || ids.len() > 100 {
        anyhow::bail!("bad");
    }
    let mut out = Vec::new();
    for id in ids {
        let parsed = uuid::Uuid::parse_str(id)?;
        out.push(parsed.to_string());
    }
    out.sort();
    out.dedup();
    Ok(out)
}

pub fn map_bulk(code: &str) -> (axum::http::StatusCode, &'static str) {
    match code {
        "ok" => (axum::http::StatusCode::OK, "ok"),
        "not_found" => (axum::http::StatusCode::NOT_FOUND, "not_found"),
        _ => (axum::http::StatusCode::BAD_REQUEST, "bad_request"),
    }
}
