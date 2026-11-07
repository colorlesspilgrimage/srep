use super::rows;
use super::DomainStore;
use crate::core::card_state::FLAG_ORPHANED;
use crate::types::{CardDraft, NoteState, TrashedNoteSummary};
use anyhow::Result;
use sqlx::{Postgres, Row, Sqlite};
use srep_db::DbPool;

const TRASH_PREVIEW_MAX: usize = 80;

pub struct NoteChange {
    pub fields: Vec<String>,
    pub checksum: String,
    pub updated_at: i64,
    pub tags: Vec<String>,
    pub create: Vec<CardDraft>,
    pub delete_ids: Vec<String>,
    pub orphan_ids: Vec<String>,
    pub unorphan_ids: Vec<String>,
}

fn trash_preview(fields: &[String]) -> String {
    let first = fields.first().map(String::as_str).unwrap_or("");
    if first.len() > TRASH_PREVIEW_MAX {
        first[..TRASH_PREVIEW_MAX].to_string()
    } else {
        first.to_string()
    }
}

impl<'a> DomainStore<'a> {
    pub async fn get_note_state(&self, id: &str) -> Result<Option<NoteState>> {
        match self.pool {
            DbPool::Sqlite(p) => read_state_sqlite(p, id).await,
            DbPool::Postgres(p) => read_state_pg(p, id).await,
        }
    }

    pub async fn find_note_ids_by_checksum(
        &self,
        note_type_id: &str,
        checksum: &str,
        exclude_id: Option<&str>,
    ) -> Result<Vec<String>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let rows = if let Some(ex) = exclude_id {
                    sqlx::query(
                        "SELECT id FROM note WHERE note_type_id = ? AND checksum = ? AND deleted_at IS NULL AND id != ? ORDER BY created_at, id",
                    )
                    .bind(note_type_id)
                    .bind(checksum)
                    .bind(ex)
                    .fetch_all(p)
                    .await?
                } else {
                    sqlx::query(
                        "SELECT id FROM note WHERE note_type_id = ? AND checksum = ? AND deleted_at IS NULL ORDER BY created_at, id",
                    )
                    .bind(note_type_id)
                    .bind(checksum)
                    .fetch_all(p)
                    .await?
                };
                Ok(rows.iter().filter_map(|r| r.try_get("id").ok()).collect())
            }
            DbPool::Postgres(p) => {
                let rows = if let Some(ex) = exclude_id {
                    sqlx::query(
                        "SELECT id FROM note WHERE note_type_id = $1 AND checksum = $2 AND deleted_at IS NULL AND id != $3 ORDER BY created_at, id",
                    )
                    .bind(note_type_id)
                    .bind(checksum)
                    .bind(ex)
                    .fetch_all(p)
                    .await?
                } else {
                    sqlx::query(
                        "SELECT id FROM note WHERE note_type_id = $1 AND checksum = $2 AND deleted_at IS NULL ORDER BY created_at, id",
                    )
                    .bind(note_type_id)
                    .bind(checksum)
                    .fetch_all(p)
                    .await?
                };
                Ok(rows.iter().filter_map(|r| r.try_get("id").ok()).collect())
            }
        }
    }

    pub async fn trash_note(&self, id: &str, now: i64) -> Result<bool> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let r = sqlx::query(
                    "UPDATE note SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
                )
                .bind(now)
                .bind(now)
                .bind(id)
                .execute(p)
                .await?;
                Ok(r.rows_affected() > 0)
            }
            DbPool::Postgres(p) => {
                let r = sqlx::query(
                    "UPDATE note SET deleted_at = $1, updated_at = $2 WHERE id = $3 AND deleted_at IS NULL",
                )
                .bind(now)
                .bind(now)
                .bind(id)
                .execute(p)
                .await?;
                Ok(r.rows_affected() > 0)
            }
        }
    }

    pub async fn list_trashed_notes(&self) -> Result<Vec<TrashedNoteSummary>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let rows = sqlx::query(
                    "SELECT id, fields, deleted_at FROM note WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id ASC",
                )
                .fetch_all(p)
                .await?;
                Ok(rows
                    .iter()
                    .filter_map(|r| {
                        let deleted_at: i64 = r.try_get("deleted_at").ok()?;
                        let fields_json: String = r.try_get("fields").ok()?;
                        let fields: Vec<String> = serde_json::from_str(&fields_json).ok()?;
                        Some(TrashedNoteSummary {
                            id: r.try_get("id").ok()?,
                            preview: trash_preview(&fields),
                            deleted_at,
                        })
                    })
                    .collect())
            }
            DbPool::Postgres(p) => {
                let rows = sqlx::query(
                    "SELECT id, fields, deleted_at FROM note WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id ASC",
                )
                .fetch_all(p)
                .await?;
                Ok(rows
                    .iter()
                    .filter_map(|r| {
                        let deleted_at: i64 = r.try_get("deleted_at").ok()?;
                        let fields_json: String = r.try_get("fields").ok()?;
                        let fields: Vec<String> = serde_json::from_str(&fields_json).ok()?;
                        Some(TrashedNoteSummary {
                            id: r.try_get("id").ok()?,
                            preview: trash_preview(&fields),
                            deleted_at,
                        })
                    })
                    .collect())
            }
        }
    }

    pub async fn restore_note(
        &self,
        id: &str,
        deck_id: Option<&str>,
        now: i64,
    ) -> Result<&'static str> {
        match self.pool {
            DbPool::Sqlite(p) => restore_sqlite(p, id, deck_id, now).await,
            DbPool::Postgres(p) => restore_pg(p, id, deck_id, now).await,
        }
    }

    pub async fn update_note(
        &self,
        id: &str,
        change: NoteChange,
    ) -> Result<&'static str> {
        match self.pool {
            DbPool::Sqlite(p) => update_sqlite(p, id, change).await,
            DbPool::Postgres(p) => update_pg(p, id, change).await,
        }
    }
}

async fn read_state_sqlite(p: &sqlx::Pool<Sqlite>, id: &str) -> Result<Option<NoteState>> {
    let row = sqlx::query("SELECT * FROM note WHERE id = ?")
        .bind(id)
        .fetch_optional(p)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let note = rows::row_to_note_sqlite(&row)?;
    let tags = sqlx::query("SELECT tag FROM note_tag WHERE note_id = ? ORDER BY tag")
        .bind(id)
        .fetch_all(p)
        .await?
        .iter()
        .filter_map(|r| r.try_get("tag").ok())
        .collect();
    let cards = sqlx::query("SELECT * FROM card WHERE note_id = ? ORDER BY position")
        .bind(id)
        .fetch_all(p)
        .await?
        .into_iter()
        .map(|r| rows::row_to_card_sqlite(&r))
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(NoteState { note, tags, cards }))
}

async fn read_state_pg(p: &sqlx::Pool<Postgres>, id: &str) -> Result<Option<NoteState>> {
    let row = sqlx::query("SELECT * FROM note WHERE id = $1")
        .bind(id)
        .fetch_optional(p)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let note = rows::row_to_note_pg(&row)?;
    let tags = sqlx::query("SELECT tag FROM note_tag WHERE note_id = $1 ORDER BY tag")
        .bind(id)
        .fetch_all(p)
        .await?
        .iter()
        .filter_map(|r| r.try_get("tag").ok())
        .collect();
    let cards = sqlx::query("SELECT * FROM card WHERE note_id = $1 ORDER BY position")
        .bind(id)
        .fetch_all(p)
        .await?
        .into_iter()
        .map(|r| rows::row_to_card_pg(&r))
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(NoteState { note, tags, cards }))
}

async fn restore_sqlite(
    p: &sqlx::Pool<Sqlite>,
    id: &str,
    deck_id: Option<&str>,
    now: i64,
) -> Result<&'static str> {
    let mut tx = p.begin().await?;
    let row = sqlx::query("SELECT deleted_at FROM note WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(row) = row else {
        return Ok("not_found");
    };
    let deleted_at: Option<i64> = row.try_get("deleted_at")?;
    if deleted_at.is_none() {
        return Ok("not_trashed");
    }
    let homeless = sqlx::query("SELECT id FROM card WHERE note_id = ? AND deck_id IS NULL LIMIT 1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if homeless.is_some() {
        let Some(deck_id) = deck_id else {
            return Ok("deck_required");
        };
        let exists = sqlx::query("SELECT id FROM deck WHERE id = ?")
            .bind(deck_id)
            .fetch_optional(&mut *tx)
            .await?;
        if exists.is_none() {
            return Ok("deck_not_found");
        }
        sqlx::query("UPDATE card SET deck_id = ? WHERE note_id = ? AND deck_id IS NULL")
            .bind(deck_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE note SET deleted_at = NULL, updated_at = ? WHERE id = ?")
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok("ok")
}

async fn restore_pg(
    p: &sqlx::Pool<Postgres>,
    id: &str,
    deck_id: Option<&str>,
    now: i64,
) -> Result<&'static str> {
    let mut tx = p.begin().await?;
    let row = sqlx::query("SELECT deleted_at FROM note WHERE id = $1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(row) = row else {
        return Ok("not_found");
    };
    let deleted_at: Option<i64> = row.try_get("deleted_at")?;
    if deleted_at.is_none() {
        return Ok("not_trashed");
    }
    let homeless = sqlx::query("SELECT id FROM card WHERE note_id = $1 AND deck_id IS NULL LIMIT 1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if homeless.is_some() {
        let Some(deck_id) = deck_id else {
            return Ok("deck_required");
        };
        let exists = sqlx::query("SELECT id FROM deck WHERE id = $1")
            .bind(deck_id)
            .fetch_optional(&mut *tx)
            .await?;
        if exists.is_none() {
            return Ok("deck_not_found");
        }
        sqlx::query("UPDATE card SET deck_id = $2 WHERE note_id = $1 AND deck_id IS NULL")
            .bind(id)
            .bind(deck_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE note SET deleted_at = NULL, updated_at = $2 WHERE id = $1")
        .bind(id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok("ok")
}

async fn update_sqlite(p: &sqlx::Pool<Sqlite>, id: &str, change: NoteChange) -> Result<&'static str> {
    let mut tx = p.begin().await?;
    let state = read_state_sqlite(p, id).await?;
    let Some(state) = state else {
        return Ok("not_found");
    };
    if state.note.deleted_at.is_some() {
        return Ok("not_found");
    }
    apply_change_sqlite(&mut tx, id, &change).await?;
    tx.commit().await?;
    Ok("ok")
}

async fn update_pg(p: &sqlx::Pool<Postgres>, id: &str, change: NoteChange) -> Result<&'static str> {
    let state = read_state_pg(p, id).await?;
    let Some(state) = state else {
        return Ok("not_found");
    };
    if state.note.deleted_at.is_some() {
        return Ok("not_found");
    }
    let mut tx = p.begin().await?;
    apply_change_pg(&mut tx, id, &change).await?;
    tx.commit().await?;
    Ok("ok")
}

async fn apply_change_sqlite(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    change: &NoteChange,
) -> Result<()> {
    let fields = serde_json::to_string(&change.fields)?;
    sqlx::query("UPDATE note SET fields = ?, checksum = ?, updated_at = ? WHERE id = ?")
        .bind(&fields)
        .bind(&change.checksum)
        .bind(change.updated_at)
        .bind(id)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM note_tag WHERE note_id = ?")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    for tag in &change.tags {
        sqlx::query("INSERT INTO note_tag (note_id, tag) VALUES (?, ?)")
            .bind(id)
            .bind(tag)
            .execute(&mut **tx)
            .await?;
    }
    for del in &change.delete_ids {
        sqlx::query("DELETE FROM card WHERE id = ?")
            .bind(del)
            .execute(&mut **tx)
            .await?;
    }
    set_orphan_sqlite(tx, &change.orphan_ids, true).await?;
    set_orphan_sqlite(tx, &change.unorphan_ids, false).await?;
    insert_drafts_sqlite(tx, id, &change.create, change.updated_at).await?;
    Ok(())
}

async fn apply_change_pg(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    id: &str,
    change: &NoteChange,
) -> Result<()> {
    let fields = serde_json::to_string(&change.fields)?;
    sqlx::query("UPDATE note SET fields = $2::jsonb, checksum = $3, updated_at = $4 WHERE id = $1")
        .bind(id)
        .bind(&fields)
        .bind(&change.checksum)
        .bind(change.updated_at)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM note_tag WHERE note_id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    for tag in &change.tags {
        sqlx::query("INSERT INTO note_tag (note_id, tag) VALUES ($1, $2)")
            .bind(id)
            .bind(tag)
            .execute(&mut **tx)
            .await?;
    }
    for del in &change.delete_ids {
        sqlx::query("DELETE FROM card WHERE id = $1")
            .bind(del)
            .execute(&mut **tx)
            .await?;
    }
    set_orphan_pg(tx, &change.orphan_ids, true).await?;
    set_orphan_pg(tx, &change.unorphan_ids, false).await?;
    insert_drafts_pg(tx, id, &change.create, change.updated_at).await?;
    Ok(())
}

async fn set_orphan_sqlite(tx: &mut sqlx::Transaction<'_, Sqlite>, ids: &[String], orphan: bool) -> Result<()> {
    for id in ids {
        if orphan {
            sqlx::query("UPDATE card SET state = 'suspended', flags = flags | ? WHERE id = ?")
                .bind(FLAG_ORPHANED)
                .bind(id)
                .execute(&mut **tx)
                .await?;
        } else {
            sqlx::query("UPDATE card SET flags = flags & ~? WHERE id = ?")
                .bind(FLAG_ORPHANED)
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(())
}

async fn set_orphan_pg(tx: &mut sqlx::Transaction<'_, Postgres>, ids: &[String], orphan: bool) -> Result<()> {
    for id in ids {
        if orphan {
            sqlx::query("UPDATE card SET state = 'suspended', flags = flags | $2 WHERE id = $1")
                .bind(id)
                .bind(FLAG_ORPHANED)
                .execute(&mut **tx)
                .await?;
        } else {
            sqlx::query("UPDATE card SET flags = flags & ~$2 WHERE id = $1")
                .bind(id)
                .bind(FLAG_ORPHANED)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(())
}

async fn insert_drafts_sqlite(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    note_id: &str,
    drafts: &[CardDraft],
    now: i64,
) -> Result<()> {
    if drafts.is_empty() {
        return Ok(());
    }
    let position: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM card")
        .fetch_one(&mut **tx)
        .await?;
    let mut pos = position;
    for draft in drafts {
        sqlx::query(
            r#"INSERT INTO card (id, note_id, template_id, ordinal, deck_id, state, due, stability, difficulty,
               last_review, reps, lapses, position, buried_until, flags, sched_state, learning_step)
               VALUES (?, ?, ?, ?, ?, 'new', ?, 0, 0, NULL, 0, 0, ?, NULL, 0, 'new', 0)"#,
        )
        .bind(&draft.id)
        .bind(note_id)
        .bind(&draft.template_id)
        .bind(draft.ordinal)
        .bind(&draft.deck_id)
        .bind(now)
        .bind(pos)
        .execute(&mut **tx)
        .await?;
        pos += 1;
    }
    Ok(())
}

async fn insert_drafts_pg(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    note_id: &str,
    drafts: &[CardDraft],
    now: i64,
) -> Result<()> {
    if drafts.is_empty() {
        return Ok(());
    }
    let position: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM card")
        .fetch_one(&mut **tx)
        .await?;
    let mut pos = position;
    for draft in drafts {
        sqlx::query(
            r#"INSERT INTO card (id, note_id, template_id, ordinal, deck_id, state, due, stability, difficulty,
               last_review, reps, lapses, position, buried_until, flags, sched_state, learning_step)
               VALUES ($1,$2,$3,$4,$5,'new',$6,0,0,NULL,0,0,$7,NULL,0,'new',0)"#,
        )
        .bind(&draft.id)
        .bind(note_id)
        .bind(&draft.template_id)
        .bind(draft.ordinal)
        .bind(&draft.deck_id)
        .bind(now)
        .bind(pos)
        .execute(&mut **tx)
        .await?;
        pos += 1;
    }
    Ok(())
}
