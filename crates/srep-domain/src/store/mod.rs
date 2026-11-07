mod rows;

use crate::builtin::builtin_seed;
use crate::core::card_state::CardStateUpdate;
use crate::error::{fail, ApiFailure};
use crate::types::*;
use anyhow::{Context, Result};
use srep_db::DbPool;
use sqlx::{Executor, Row, Sqlite, Transaction};
use std::collections::HashSet;

pub struct DomainStore<'a> {
    pool: &'a DbPool,
}

const ID_CHUNK: usize = 500;

impl<'a> DomainStore<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    pub async fn ensure_seeded(&self) -> Result<()> {
        let count: i64 = self
            .scalar("SELECT COUNT(*) FROM deck_preset")
            .await?;
        if count == 0 {
            self.seed_defaults(&builtin_seed()).await?;
        }
        Ok(())
    }

    fn executor(&self) -> &'a dyn Executor<'a, Database = Sqlite> {
        match self.pool {
            DbPool::Sqlite(p) => p,
            DbPool::Postgres(p) => p,
        }
    }

    async fn scalar<T>(&self, sql: &str) -> Result<T>
    where
        T: for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
    {
        let row = sqlx::query(sql).fetch_one(self.executor()).await?;
        Ok(row.get(0))
    }

    // --- seed & presets ---

    pub async fn seed_defaults(&self, seed: &SeedInput) -> Result<()> {
        let preset_json = rows::preset_to_db(&seed.preset)?;
        sqlx::query(
            r#"INSERT OR IGNORE INTO deck_preset
            (id, name, new_per_day, reviews_per_day, desired_retention, learning_steps, relearning_steps,
             max_interval, fsrs_params, bury_siblings, new_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&seed.preset.id)
        .bind(&seed.preset.name)
        .bind(seed.preset.new_per_day)
        .bind(seed.preset.reviews_per_day)
        .bind(seed.preset.desired_retention)
        .bind(&preset_json.learning_steps)
        .bind(&preset_json.relearning_steps)
        .bind(seed.preset.max_interval)
        .bind(&preset_json.fsrs_params)
        .bind(seed.preset.bury_siblings)
        .bind(&seed.preset.new_order)
        .execute(self.executor())
        .await?;

        for nt in &seed.note_types {
            let fields = serde_json::to_string(&nt.fields)?;
            let _ = sqlx::query(
                r#"INSERT OR IGNORE INTO note_type (id, name, fields, css_class, sort_field_idx)
                   VALUES (?, ?, ?, ?, ?)"#,
            )
            .bind(&nt.id)
            .bind(&nt.name)
            .bind(fields)
            .bind(&nt.css_class)
            .bind(nt.sort_field_idx)
            .execute(self.executor())
            .await?;

            for t in &nt.templates {
                let _ = sqlx::query(
                    r#"INSERT OR IGNORE INTO card_template (id, note_type_id, name, ordinal, front_tpl, back_tpl)
                       VALUES (?, ?, ?, ?, ?, ?)"#,
                )
                .bind(&t.id)
                .bind(&t.note_type_id)
                .bind(&t.name)
                .bind(t.ordinal)
                .bind(&t.front_tpl)
                .bind(&t.back_tpl)
                .execute(self.executor())
                .await?;
            }
        }
        Ok(())
    }

    pub async fn list_presets(&self) -> Result<Vec<PresetRow>> {
        let rows = sqlx::query("SELECT * FROM deck_preset ORDER BY name")
            .fetch_all(self.executor())
            .await?;
        rows.iter().map(rows::row_to_preset).collect()
    }

    pub async fn get_preset(&self, id: &str) -> Result<Option<PresetRow>> {
        let row = sqlx::query("SELECT * FROM deck_preset WHERE id = ?")
            .bind(id)
            .fetch_optional(self.executor())
            .await?;
        row.map(rows::row_to_preset).transpose()
    }

    pub async fn insert_preset(&self, row: &PresetRow) -> Result<&'static str> {
        let json = rows::preset_to_db(row)?;
        let exists: Option<String> = sqlx::query_scalar(
            "SELECT id FROM deck_preset WHERE name = ? AND id != ?",
        )
        .bind(&row.name)
        .bind(&row.id)
        .fetch_optional(self.executor())
        .await?;
        if exists.is_some() {
            return Ok("name_taken");
        }
        match sqlx::query(
            r#"INSERT INTO deck_preset (id, name, new_per_day, reviews_per_day, desired_retention,
                learning_steps, relearning_steps, max_interval, fsrs_params, bury_siblings, new_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&row.id)
        .bind(&row.name)
        .bind(row.new_per_day)
        .bind(row.reviews_per_day)
        .bind(row.desired_retention)
        .bind(&json.learning_steps)
        .bind(&json.relearning_steps)
        .bind(row.max_interval)
        .bind(&json.fsrs_params)
        .bind(row.bury_siblings)
        .bind(&row.new_order)
        .execute(self.executor())
        .await
        {
            Ok(_) => Ok("ok"),
            Err(e) if rows::is_unique_violation(&e) => Ok("name_taken"),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn update_preset(&self, row: &PresetRow) -> Result<&'static str> {
        let current = self.get_preset(&row.id).await?;
        if current.is_none() {
            return Ok("not_found");
        }
        let json = rows::preset_to_db(row)?;
        let exists: Option<String> = sqlx::query_scalar(
            "SELECT id FROM deck_preset WHERE name = ? AND id != ?",
        )
        .bind(&row.name)
        .bind(&row.id)
        .fetch_optional(self.executor())
        .await?;
        if exists.is_some() {
            return Ok("name_taken");
        }
        sqlx::query(
            r#"UPDATE deck_preset SET name = ?, new_per_day = ?, reviews_per_day = ?, desired_retention = ?,
               learning_steps = ?, relearning_steps = ?, max_interval = ?, fsrs_params = ?,
               bury_siblings = ?, new_order = ? WHERE id = ?"#,
        )
        .bind(&row.name)
        .bind(row.new_per_day)
        .bind(row.reviews_per_day)
        .bind(row.desired_retention)
        .bind(&json.learning_steps)
        .bind(&json.relearning_steps)
        .bind(row.max_interval)
        .bind(&json.fsrs_params)
        .bind(row.bury_siblings)
        .bind(&row.new_order)
        .bind(&row.id)
        .execute(self.executor())
        .await?;
        Ok("ok")
    }

    pub async fn delete_preset_unless_used(&self, id: &str) -> Result<&'static str> {
        if self.get_preset(id).await?.is_none() {
            return Ok("not_found");
        }
        let in_use: Option<String> =
            sqlx::query_scalar("SELECT id FROM deck WHERE preset_id = ? LIMIT 1")
                .bind(id)
                .fetch_optional(self.executor())
                .await?;
        if in_use.is_some() {
            return Ok("in_use");
        }
        sqlx::query("DELETE FROM deck_preset WHERE id = ?")
            .bind(id)
            .execute(self.executor())
            .await?;
        Ok("deleted")
    }

    // --- decks ---

    pub async fn list_decks(&self) -> Result<Vec<DeckRow>> {
        let rows = sqlx::query("SELECT * FROM deck ORDER BY path")
            .fetch_all(self.executor())
            .await?;
        rows.iter().map(rows::row_to_deck).collect()
    }

    pub async fn get_deck(&self, id: &str) -> Result<Option<DeckRow>> {
        let row = sqlx::query("SELECT * FROM deck WHERE id = ?")
            .bind(id)
            .fetch_optional(self.executor())
            .await?;
        row.map(rows::row_to_deck).transpose()
    }

    pub async fn insert_deck(&self, row: &DeckRow) -> Result<&'static str> {
        match sqlx::query(
            r#"INSERT INTO deck (id, parent_id, name, path, preset_id, description, archived_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&row.id)
        .bind(&row.parent_id)
        .bind(&row.name)
        .bind(&row.path)
        .bind(&row.preset_id)
        .bind(&row.description)
        .bind(row.archived_at)
        .execute(self.executor())
        .await
        {
            Ok(_) => Ok("ok"),
            Err(e) if rows::is_unique_violation(&e) => Ok("name_taken"),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn apply_deck_updates(&self, updates: &[DeckRow]) -> Result<()> {
        for deck in updates {
            sqlx::query(
                r#"UPDATE deck SET parent_id = ?, name = ?, path = ?, preset_id = ?, description = ?
                   WHERE id = ?"#,
            )
            .bind(&deck.parent_id)
            .bind(&deck.name)
            .bind(&deck.path)
            .bind(&deck.preset_id)
            .bind(&deck.description)
            .bind(&deck.id)
            .execute(self.executor())
            .await?;
        }
        Ok(())
    }

    pub async fn deck_impact(&self, root_id: &str) -> Result<Option<DeckImpact>> {
        let decks = self.list_decks().await?;
        let ids = crate::core::deck_paths::subtree_ids(&decks, root_id);
        if ids.is_empty() {
            return Ok(None);
        }
        let mut card_count = 0;
        let mut note_ids = HashSet::new();
        for chunk in chunks(&ids) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT note_id FROM card WHERE deck_id IN ({placeholders})"
            );
            let mut q = sqlx::query(&sql);
            for id in chunk {
                q = q.bind(id);
            }
            let rows = q.fetch_all(self.executor()).await?;
            card_count += rows.len();
            for r in rows {
                note_ids.insert(r.get::<String, _>(0));
            }
        }
        Ok(Some(DeckImpact {
            decks: ids.len() as i32,
            cards: card_count as i32,
            notes: note_ids.len() as i32,
        }))
    }

    pub async fn delete_deck_tree(
        &self,
        root_id: &str,
        action: DeckDeleteAction,
        now: i64,
    ) -> Result<&'static str> {
        let decks = self.list_decks().await?;
        let ids = crate::core::deck_paths::subtree_ids(&decks, root_id);
        if ids.is_empty() {
            return Ok("not_found");
        }
        match action {
            DeckDeleteAction::Move { target_deck_id } => {
                if !decks.iter().any(|d| d.id == target_deck_id) {
                    return Ok("target_not_found");
                }
                if ids.contains(&target_deck_id) {
                    return Ok("target_in_subtree");
                }
                for chunk in chunks(&ids) {
                    let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!("UPDATE card SET deck_id = ? WHERE deck_id IN ({placeholders})");
                    let mut q = sqlx::query(&sql).bind(&target_deck_id);
                    for id in chunk {
                        q = q.bind(id);
                    }
                    q.execute(self.executor()).await?;
                }
            }
            DeckDeleteAction::Trash => {
                let note_ids: Vec<String> = {
                    let mut all = Vec::new();
                    for chunk in chunks(&ids) {
                        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                        let sql = format!(
                            "SELECT DISTINCT note_id FROM card WHERE deck_id IN ({placeholders})"
                        );
                        let mut q = sqlx::query(&sql);
                        for id in chunk {
                            q = q.bind(id);
                        }
                        for r in q.fetch_all(self.executor()).await? {
                            all.push(r.get(0));
                        }
                    }
                    all
                };
                for chunk in chunks(&note_ids) {
                    let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!(
                        "UPDATE note SET deleted_at = ?, updated_at = ? WHERE id IN ({placeholders}) AND deleted_at IS NULL"
                    );
                    let mut q = sqlx::query(&sql).bind(now).bind(now);
                    for id in chunk {
                        q = q.bind(id);
                    }
                    q.execute(self.executor()).await?;
                }
            }
        }
        let depth: std::collections::HashMap<_, _> = ids
            .iter()
            .filter_map(|id| decks.iter().find(|d| d.id == *id).map(|d| (id.clone(), crate::core::deck_paths::depth_of(&d.path))))
            .collect();
        let mut ordered = ids.clone();
        ordered.sort_by_key(|id| std::cmp::Reverse(depth.get(id).copied().unwrap_or(0)));
        for chunk in chunks(&ordered) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("DELETE FROM deck WHERE id IN ({placeholders})");
            let mut q = sqlx::query(&sql);
            for id in chunk {
                q = q.bind(id);
            }
            q.execute(self.executor()).await?;
        }
        Ok("ok")
    }

    // --- note types ---

    pub async fn list_note_types(&self) -> Result<Vec<NoteTypeWithTemplates>> {
        let types = sqlx::query("SELECT * FROM note_type ORDER BY name")
            .fetch_all(self.executor())
            .await?;
        let templates = sqlx::query("SELECT * FROM card_template")
            .fetch_all(self.executor())
            .await?;
        let mut out = Vec::new();
        for t in types {
            let nt = rows::row_to_note_type(&t)?;
            let mut tpls: Vec<TemplateRow> = templates
                .iter()
                .filter_map(|r| {
                    let tpl = rows::row_to_template(r).ok()?;
                    if tpl.note_type_id == nt.id {
                        Some(tpl)
                    } else {
                        None
                    }
                })
                .collect();
            tpls.sort_by_key(|x| x.ordinal);
            out.push(NoteTypeWithTemplates::from_parts(nt, tpls));
        }
        Ok(out)
    }

    pub async fn get_note_type(&self, id: &str) -> Result<Option<NoteTypeWithTemplates>> {
        let row = sqlx::query("SELECT * FROM note_type WHERE id = ?")
            .bind(id)
            .fetch_optional(self.executor())
            .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let nt = rows::row_to_note_type(&row)?;
        let templates = sqlx::query("SELECT * FROM card_template WHERE note_type_id = ?")
            .bind(id)
            .fetch_all(self.executor())
            .await?;
        let mut tpls: Vec<_> = templates.iter().map(rows::row_to_template).collect::<Result<_>>()?;
        tpls.sort_by_key(|x| x.ordinal);
        Ok(Some(NoteTypeWithTemplates::from_parts(nt, tpls)))
    }

    pub async fn insert_note_type(
        &self,
        row: &NoteTypeRow,
        templates: &[TemplateRow],
    ) -> Result<&'static str> {
        let clash: Option<String> = sqlx::query_scalar("SELECT id FROM note_type WHERE name = ?")
            .bind(&row.name)
            .fetch_optional(self.executor())
            .await?;
        if clash.is_some() {
            return Ok("name_taken");
        }
        let fields = serde_json::to_string(&row.fields)?;
        match sqlx::query(
            "INSERT INTO note_type (id, name, fields, css_class, sort_field_idx) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&row.id)
        .bind(&row.name)
        .bind(fields)
        .bind(&row.css_class)
        .bind(row.sort_field_idx)
        .execute(self.executor())
        .await
        {
            Ok(_) => {}
            Err(e) if rows::is_unique_violation(&e) => return Ok("name_taken"),
            Err(e) => return Err(e.into()),
        }
        for t in templates {
            sqlx::query(
                "INSERT INTO card_template (id, note_type_id, name, ordinal, front_tpl, back_tpl) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&t.id)
            .bind(&t.note_type_id)
            .bind(&t.name)
            .bind(t.ordinal)
            .bind(&t.front_tpl)
            .bind(&t.back_tpl)
            .execute(self.executor())
            .await?;
        }
        Ok("ok")
    }

    pub async fn delete_note_type_unless_used(&self, id: &str) -> Result<&'static str> {
        if self.get_note_type(id).await?.is_none() {
            return Ok("not_found");
        }
        let used: Option<String> = sqlx::query_scalar("SELECT id FROM note WHERE note_type_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(self.executor())
            .await?;
        if used.is_some() {
            return Ok("in_use");
        }
        sqlx::query("DELETE FROM note_type WHERE id = ?")
            .bind(id)
            .execute(self.executor())
            .await?;
        Ok("deleted")
    }

    // --- notes & cards ---

    pub async fn insert_note(
        &self,
        note: &NoteRow,
        tags: &[String],
        cards: &[CardDraft],
        now: i64,
    ) -> Result<()> {
        let fields = serde_json::to_string(&note.fields)?;
        let mut tx = self.begin_tx().await?;
        sqlx::query(
            r#"INSERT INTO note (id, note_type_id, guid, fields, created_at, updated_at, checksum, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&note.id)
        .bind(&note.note_type_id)
        .bind(&note.guid)
        .bind(fields)
        .bind(note.created_at)
        .bind(note.updated_at)
        .bind(&note.checksum)
        .bind(note.deleted_at)
        .execute(&mut *tx)
        .await?;
        for tag in tags {
            sqlx::query("INSERT INTO note_tag (note_id, tag) VALUES (?, ?)")
                .bind(&note.id)
                .bind(tag)
                .execute(&mut *tx)
                .await?;
        }
        let position: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM card")
            .fetch_one(&mut *tx)
            .await?;
        let mut pos = position;
        for draft in cards {
            sqlx::query(
                r#"INSERT INTO card (id, note_id, template_id, ordinal, deck_id, state, due, stability, difficulty,
                   last_review, reps, lapses, position, buried_until, flags, sched_state, learning_step)
                   VALUES (?, ?, ?, ?, ?, 'new', ?, 0, 0, NULL, 0, 0, ?, NULL, 0, 'new', 0)"#,
            )
            .bind(&draft.id)
            .bind(&note.id)
            .bind(&draft.template_id)
            .bind(draft.ordinal)
            .bind(&draft.deck_id)
            .bind(now)
            .bind(pos)
            .execute(&mut *tx)
            .await?;
            pos += 1;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn get_note_state(&self, id: &str) -> Result<Option<NoteState>> {
        let row = sqlx::query("SELECT * FROM note WHERE id = ?")
            .bind(id)
            .fetch_optional(self.executor())
            .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let note = rows::row_to_note(&row)?;
        let tags: Vec<String> = sqlx::query_scalar(
            "SELECT tag FROM note_tag WHERE note_id = ? ORDER BY tag",
        )
        .bind(id)
        .fetch_all(self.executor())
        .await?;
        let card_rows = sqlx::query("SELECT * FROM card WHERE note_id = ? ORDER BY position")
            .bind(id)
            .fetch_all(self.executor())
            .await?;
        let cards: Vec<_> = card_rows.iter().map(rows::row_to_card).collect::<Result<_>>()?;
        Ok(Some(NoteState { note, tags, cards }))
    }

    pub async fn move_cards(&self, card_ids: &[String], deck_id: &str) -> Result<&'static str> {
        let ids: Vec<_> = card_ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        if !self.deck_exists(deck_id).await? {
            return Ok("deck_not_found");
        }
        let mut found = 0;
        for chunk in chunks(&ids) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("SELECT id FROM card WHERE id IN ({placeholders})");
            let mut q = sqlx::query(&sql);
            for id in chunk {
                q = q.bind(id);
            }
            found += q.fetch_all(self.executor()).await?.len();
        }
        if found != ids.len() {
            return Ok("card_not_found");
        }
        for chunk in chunks(&ids) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("UPDATE card SET deck_id = ? WHERE id IN ({placeholders})");
            let mut q = sqlx::query(&sql).bind(deck_id);
            for id in chunk {
                q = q.bind(id);
            }
            q.execute(self.executor()).await?;
        }
        Ok("ok")
    }

    pub async fn trash_note(&self, id: &str, now: i64) -> Result<bool> {
        let r = sqlx::query(
            "UPDATE note SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(self.executor())
        .await?;
        Ok(r.rows_affected() > 0)
    }

    pub async fn restore_note(
        &self,
        id: &str,
        deck_id: Option<&str>,
        now: i64,
    ) -> Result<&'static str> {
        let row = sqlx::query("SELECT * FROM note WHERE id = ?")
            .bind(id)
            .fetch_optional(self.executor())
            .await?;
        let Some(row) = row else {
            return Ok("not_found");
        };
        let note = rows::row_to_note(&row)?;
        if note.deleted_at.is_none() {
            return Ok("not_trashed");
        }
        let homeless: Option<String> = sqlx::query_scalar(
            "SELECT id FROM card WHERE note_id = ? AND deck_id IS NULL LIMIT 1",
        )
        .bind(id)
        .fetch_optional(self.executor())
        .await?;
        if homeless.is_some() {
            let Some(deck_id) = deck_id else {
                return Ok("deck_required");
            };
            if !self.deck_exists(deck_id).await? {
                return Ok("deck_not_found");
            }
            sqlx::query("UPDATE card SET deck_id = ? WHERE note_id = ? AND deck_id IS NULL")
                .bind(deck_id)
                .bind(id)
                .execute(self.executor())
                .await?;
        }
        sqlx::query("UPDATE note SET deleted_at = NULL, updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(id)
            .execute(self.executor())
            .await?;
        Ok("ok")
    }

    pub async fn list_trashed_notes(&self) -> Result<Vec<TrashedNoteSummary>> {
        let rows = sqlx::query(
            "SELECT id, fields, deleted_at FROM note WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id",
        )
        .fetch_all(self.executor())
        .await?;
        let mut out = Vec::new();
        for r in rows {
            let id: String = r.get("id");
            let fields_s: String = r.get("fields");
            let deleted_at: i64 = r.get("deleted_at");
            let fields: Vec<String> = serde_json::from_str(&fields_s).unwrap_or_default();
            let first = fields.first().map(String::as_str).unwrap_or("");
            let preview = if first.len() > 80 {
                first[..80].to_string()
            } else {
                first.to_string()
            };
            out.push(TrashedNoteSummary {
                id,
                preview,
                deleted_at,
            });
        }
        Ok(out)
    }

    pub async fn purge_trash(&self, older_than: i64) -> Result<i64> {
        let r = sqlx::query("DELETE FROM note WHERE deleted_at IS NOT NULL AND deleted_at <= ?")
            .bind(older_than)
            .execute(self.executor())
            .await?;
        Ok(r.rows_affected() as i64)
    }

    pub async fn get_cards_by_ids(&self, ids: &[String]) -> Result<Vec<CardRow>> {
        let unique: Vec<_> = ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let mut cards = Vec::new();
        for chunk in chunks(&unique) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("SELECT * FROM card WHERE id IN ({placeholders}) ORDER BY id");
            let mut q = sqlx::query(&sql);
            for id in chunk {
                q = q.bind(id);
            }
            for r in q.fetch_all(self.executor()).await? {
                cards.push(rows::row_to_card(&r)?);
            }
        }
        cards.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(cards)
    }

    pub async fn apply_card_state_updates(&self, updates: &[CardStateUpdate]) -> Result<()> {
        for u in updates {
            sqlx::query("UPDATE card SET state = ?, buried_until = ? WHERE id = ?")
                .bind(&u.state)
                .bind(u.buried_until)
                .bind(&u.id)
                .execute(self.executor())
                .await?;
        }
        Ok(())
    }

    // --- media ---

    pub async fn insert_media_if_absent(&self, row: &MediaRow) -> Result<MediaRow> {
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO media (id, sha256, mime, size, original_name) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&row.id)
        .bind(&row.sha256)
        .bind(&row.mime)
        .bind(row.size)
        .bind(&row.original_name)
        .execute(self.executor())
        .await?;
        self.get_media_by_sha(&row.sha256)
            .await?
            .context("media row missing after insert")
    }

    pub async fn get_media_by_sha(&self, sha: &str) -> Result<Option<MediaRow>> {
        let row = sqlx::query("SELECT * FROM media WHERE sha256 = ?")
            .bind(sha)
            .fetch_optional(self.executor())
            .await?;
        row.map(rows::row_to_media).transpose()
    }

    pub async fn find_missing_media(&self, shas: &[String]) -> Result<Vec<String>> {
        let wanted: Vec<_> = shas.iter().cloned().collect::<HashSet<_>>().into_iter().collect();
        let mut found = HashSet::new();
        for chunk in chunks(&wanted) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!("SELECT sha256 FROM media WHERE sha256 IN ({placeholders})");
            let mut q = sqlx::query(&sql);
            for s in chunk {
                q = q.bind(s);
            }
            for r in q.fetch_all(self.executor()).await? {
                found.insert(r.get::<String, _>(0));
            }
        }
        Ok(wanted.into_iter().filter(|s| !found.contains(s)).collect())
    }

    async fn deck_exists(&self, id: &str) -> Result<bool> {
        let row: Option<String> = sqlx::query_scalar("SELECT id FROM deck WHERE id = ?")
            .bind(id)
            .fetch_optional(self.executor())
            .await?;
        Ok(row.is_some())
    }

    async fn begin_tx(&self) -> Result<Transaction<'_, Sqlite>> {
        match self.pool {
            DbPool::Sqlite(p) => Ok(p.begin().await?),
            DbPool::Postgres(p) => {
                // Use sqlite transaction type erasure via anyhow — postgres uses same SQL in tests separately
                let _ = p;
                anyhow::bail!("transactions unified in sqlite tests");
            }
        }
    }
}

fn chunks<T: Clone>(items: &[T]) -> Vec<Vec<T>> {
    items
        .chunks(ID_CHUNK)
        .map(|c| c.to_vec())
        .collect()
}

pub async fn change_card_states<F>(
    store: &DomainStore<'_>,
    card_ids: &[String],
    compute: F,
) -> Result<Result<(), ApiFailure>>
where
    F: FnOnce(&[CardRow]) -> Result<Vec<CardStateUpdate>, ApiFailure>,
{
    let ids: Vec<_> = card_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let cards = store.get_cards_by_ids(&ids).await?;
    if cards.len() != ids.len() {
        return Ok(Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found")));
    }
    let updates = compute(&cards)?;
    store.apply_card_state_updates(&updates).await?;
    Ok(Ok(()))
}
