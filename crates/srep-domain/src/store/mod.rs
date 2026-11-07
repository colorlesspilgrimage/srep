pub mod rows;

use crate::builtin::builtin_seed;
use crate::core::card_state::CardStateUpdate;
use crate::error::{fail, ApiFailure};
use crate::types::*;
use anyhow::Result;
use sqlx::{Pool, Postgres, Row, Sqlite};
use srep_db::DbPool;
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
        let n: i64 = match self.pool {
            DbPool::Sqlite(p) => {
                sqlx::query_scalar("SELECT COUNT(*) FROM deck_preset")
                    .fetch_one(p)
                    .await?
            }
            DbPool::Postgres(p) => {
                sqlx::query_scalar("SELECT COUNT(*) FROM deck_preset")
                    .fetch_one(p)
                    .await?
            }
        };
        if n == 0 {
            self.seed_defaults(&builtin_seed()).await?;
        }
        Ok(())
    }

    pub async fn seed_defaults(&self, seed: &SeedInput) -> Result<()> {
        let json = rows::preset_to_db(&seed.preset)?;
        match self.pool {
            DbPool::Sqlite(p) => {
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
                .bind(&json.learning_steps)
                .bind(&json.relearning_steps)
                .bind(seed.preset.max_interval)
                .bind(&json.fsrs_params)
                .bind(seed.preset.bury_siblings)
                .bind(&seed.preset.new_order)
                .execute(p)
                .await?;
            }
            DbPool::Postgres(p) => {
                sqlx::query(
                    r#"INSERT INTO deck_preset
                    (id, name, new_per_day, reviews_per_day, desired_retention, learning_steps, relearning_steps,
                     max_interval, fsrs_params, bury_siblings, new_order)
                    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11)
                    ON CONFLICT (id) DO NOTHING"#,
                )
                .bind(&seed.preset.id)
                .bind(&seed.preset.name)
                .bind(seed.preset.new_per_day)
                .bind(seed.preset.reviews_per_day)
                .bind(seed.preset.desired_retention)
                .bind(&json.learning_steps)
                .bind(&json.relearning_steps)
                .bind(seed.preset.max_interval)
                .bind(&json.fsrs_params)
                .bind(seed.preset.bury_siblings)
                .bind(&seed.preset.new_order)
                .execute(p)
                .await?;
            }
        }
        for nt in &seed.note_types {
            let fields = serde_json::to_string(&nt.fields)?;
            match self.pool {
                DbPool::Sqlite(p) => {
                    let _ = sqlx::query(
                        "INSERT OR IGNORE INTO note_type (id, name, fields, css_class, sort_field_idx) VALUES (?, ?, ?, ?, ?)",
                    )
                    .bind(&nt.id)
                    .bind(&nt.name)
                    .bind(&fields)
                    .bind(&nt.css_class)
                    .bind(nt.sort_field_idx)
                    .execute(p)
                    .await?;
                }
                DbPool::Postgres(p) => {
                    let _ = sqlx::query(
                        "INSERT INTO note_type (id, name, fields, css_class, sort_field_idx) VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT (id) DO NOTHING",
                    )
                    .bind(&nt.id)
                    .bind(&nt.name)
                    .bind(&fields)
                    .bind(&nt.css_class)
                    .bind(nt.sort_field_idx)
                    .execute(p)
                    .await?;
                }
            }
            for t in &nt.templates {
                match self.pool {
                    DbPool::Sqlite(p) => {
                        let _ = sqlx::query(
                            "INSERT OR IGNORE INTO card_template (id, note_type_id, name, ordinal, front_tpl, back_tpl) VALUES (?, ?, ?, ?, ?, ?)",
                        )
                        .bind(&t.id)
                        .bind(&t.note_type_id)
                        .bind(&t.name)
                        .bind(t.ordinal)
                        .bind(&t.front_tpl)
                        .bind(&t.back_tpl)
                        .execute(p)
                        .await?;
                    }
                    DbPool::Postgres(p) => {
                        let _ = sqlx::query(
                            "INSERT INTO card_template (id, note_type_id, name, ordinal, front_tpl, back_tpl) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
                        )
                        .bind(&t.id)
                        .bind(&t.note_type_id)
                        .bind(&t.name)
                        .bind(t.ordinal)
                        .bind(&t.front_tpl)
                        .bind(&t.back_tpl)
                        .execute(p)
                        .await?;
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn list_presets(&self) -> Result<Vec<PresetRow>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let rows = sqlx::query("SELECT * FROM deck_preset ORDER BY name")
                    .fetch_all(p)
                    .await?;
                rows.iter().map(rows::row_to_preset).collect()
            }
            DbPool::Postgres(p) => {
                let rows = sqlx::query("SELECT * FROM deck_preset ORDER BY name")
                    .fetch_all(p)
                    .await?;
                rows.iter().map(rows::row_to_preset_pg).collect()
            }
        }
    }

    pub async fn get_preset(&self, id: &str) -> Result<Option<PresetRow>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let row = sqlx::query("SELECT * FROM deck_preset WHERE id = ?")
                    .bind(id)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| rows::row_to_preset(&r)).transpose()
            }
            DbPool::Postgres(p) => {
                let row = sqlx::query("SELECT * FROM deck_preset WHERE id = $1")
                    .bind(id)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| rows::row_to_preset_pg(&r)).transpose()
            }
        }
    }

    pub async fn insert_preset(&self, row: &PresetRow) -> Result<&'static str> {
        let json = rows::preset_to_db(row)?;
        match self.pool {
            DbPool::Sqlite(p) => sqlite_preset_insert(p, row, &json).await,
            DbPool::Postgres(p) => postgres_preset_insert(p, row, &json).await,
        }
    }

    pub async fn update_preset(&self, row: &PresetRow) -> Result<&'static str> {
        if self.get_preset(&row.id).await?.is_none() {
            return Ok("not_found");
        }
        let json = rows::preset_to_db(row)?;
        match self.pool {
            DbPool::Sqlite(p) => {
                let clash: Option<String> =
                    sqlx::query_scalar("SELECT id FROM deck_preset WHERE name = ? AND id != ?")
                        .bind(&row.name)
                        .bind(&row.id)
                        .fetch_optional(p)
                        .await?;
                if clash.is_some() {
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
                .execute(p)
                .await?;
            }
            DbPool::Postgres(p) => {
                let clash: Option<String> =
                    sqlx::query_scalar("SELECT id FROM deck_preset WHERE name = $1 AND id != $2")
                        .bind(&row.name)
                        .bind(&row.id)
                        .fetch_optional(p)
                        .await?;
                if clash.is_some() {
                    return Ok("name_taken");
                }
                sqlx::query(
                    r#"UPDATE deck_preset SET name = $1, new_per_day = $2, reviews_per_day = $3, desired_retention = $4,
                       learning_steps = $5::jsonb, relearning_steps = $6::jsonb, max_interval = $7, fsrs_params = $8::jsonb,
                       bury_siblings = $9, new_order = $10 WHERE id = $11"#,
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
                .execute(p)
                .await?;
            }
        }
        Ok("ok")
    }

    pub async fn delete_preset_unless_used(&self, id: &str) -> Result<&'static str> {
        if self.get_preset(id).await?.is_none() {
            return Ok("not_found");
        }
        let in_use: Option<String> = match self.pool {
            DbPool::Sqlite(p) => {
                sqlx::query_scalar("SELECT id FROM deck WHERE preset_id = ? LIMIT 1")
                    .bind(id)
                    .fetch_optional(p)
                    .await?
            }
            DbPool::Postgres(p) => {
                sqlx::query_scalar("SELECT id FROM deck WHERE preset_id = $1 LIMIT 1")
                    .bind(id)
                    .fetch_optional(p)
                    .await?
            }
        };
        if in_use.is_some() {
            return Ok("in_use");
        }
        match self.pool {
            DbPool::Sqlite(p) => {
                sqlx::query("DELETE FROM deck_preset WHERE id = ?")
                    .bind(id)
                    .execute(p)
                    .await?;
            }
            DbPool::Postgres(p) => {
                sqlx::query("DELETE FROM deck_preset WHERE id = $1")
                    .bind(id)
                    .execute(p)
                    .await?;
            }
        }
        Ok("deleted")
    }

    pub async fn list_decks(&self) -> Result<Vec<DeckRow>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let rows = sqlx::query("SELECT * FROM deck ORDER BY path")
                    .fetch_all(p)
                    .await?;
                rows.iter().map(rows::row_to_deck).collect()
            }
            DbPool::Postgres(p) => {
                let rows = sqlx::query("SELECT * FROM deck ORDER BY path")
                    .fetch_all(p)
                    .await?;
                rows.iter().map(rows::row_to_deck_pg).collect()
            }
        }
    }

    pub async fn get_deck(&self, id: &str) -> Result<Option<DeckRow>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let row = sqlx::query("SELECT * FROM deck WHERE id = ?")
                    .bind(id)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| rows::row_to_deck(&r)).transpose()
            }
            DbPool::Postgres(p) => {
                let row = sqlx::query("SELECT * FROM deck WHERE id = $1")
                    .bind(id)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| rows::row_to_deck_pg(&r)).transpose()
            }
        }
    }

    pub async fn insert_deck(&self, row: &DeckRow) -> Result<&'static str> {
        match self.pool {
            DbPool::Sqlite(p) => {
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
                .execute(p)
                .await
                {
                    Ok(_) => Ok("ok"),
                    Err(e) if rows::is_unique_violation(&e) => Ok("name_taken"),
                    Err(e) => Err(e.into()),
                }
            }
            DbPool::Postgres(p) => {
                match sqlx::query(
                    r#"INSERT INTO deck (id, parent_id, name, path, preset_id, description, archived_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7)"#,
                )
                .bind(&row.id)
                .bind(&row.parent_id)
                .bind(&row.name)
                .bind(&row.path)
                .bind(&row.preset_id)
                .bind(&row.description)
                .bind(row.archived_at)
                .execute(p)
                .await
                {
                    Ok(_) => Ok("ok"),
                    Err(e) if rows::is_unique_violation(&e) => Ok("name_taken"),
                    Err(e) => Err(e.into()),
                }
            }
        }
    }

    pub async fn apply_deck_updates(&self, updates: &[DeckRow]) -> Result<()> {
        for deck in updates {
            match self.pool {
                DbPool::Sqlite(p) => {
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
                    .execute(p)
                    .await?;
                }
                DbPool::Postgres(p) => {
                    sqlx::query(
                        r#"UPDATE deck SET parent_id = $1, name = $2, path = $3, preset_id = $4, description = $5
                           WHERE id = $6"#,
                    )
                    .bind(&deck.parent_id)
                    .bind(&deck.name)
                    .bind(&deck.path)
                    .bind(&deck.preset_id)
                    .bind(&deck.description)
                    .bind(&deck.id)
                    .execute(p)
                    .await?;
                }
            }
        }
        Ok(())
    }

    pub async fn deck_impact(&self, root_id: &str) -> Result<Option<DeckImpact>> {
        let decks = self.list_decks().await?;
        let ids = crate::core::deck_paths::subtree_ids(&decks, root_id);
        if ids.is_empty() {
            return Ok(None);
        }
        let mut card_count = 0i32;
        let mut note_ids = HashSet::new();
        for chunk in chunks(&ids) {
            match self.pool {
                DbPool::Sqlite(p) => {
                    let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!("SELECT note_id FROM card WHERE deck_id IN ({placeholders})");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    let rows = q.fetch_all(p).await?;
                    card_count += rows.len() as i32;
                    for r in rows {
                        note_ids.insert(r.get::<String, _>(0));
                    }
                }
                DbPool::Postgres(p) => {
                    let placeholders = (1..=chunk.len())
                        .map(|i| format!("${i}"))
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!("SELECT note_id FROM card WHERE deck_id IN ({placeholders})");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    let rows = q.fetch_all(p).await?;
                    card_count += rows.len() as i32;
                    for r in rows {
                        note_ids.insert(r.get::<String, _>(0));
                    }
                }
            }
        }
        Ok(Some(DeckImpact {
            decks: ids.len() as i32,
            cards: card_count,
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
                    match self.pool {
                        DbPool::Sqlite(p) => {
                            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                            let sql =
                                format!("UPDATE card SET deck_id = ? WHERE deck_id IN ({ph})");
                            let mut q = sqlx::query(&sql).bind(&target_deck_id);
                            for id in &chunk {
                                q = q.bind(id);
                            }
                            q.execute(p).await?;
                        }
                        DbPool::Postgres(p) => {
                            let ph = (2..=chunk.len() + 1)
                                .map(|i| format!("${i}"))
                                .collect::<Vec<_>>()
                                .join(",");
                            let sql =
                                format!("UPDATE card SET deck_id = $1 WHERE deck_id IN ({ph})");
                            let mut q = sqlx::query(&sql).bind(&target_deck_id);
                            for id in &chunk {
                                q = q.bind(id);
                            }
                            q.execute(p).await?;
                        }
                    }
                }
            }
            DeckDeleteAction::Trash => {
                let mut note_ids = Vec::new();
                for chunk in chunks(&ids) {
                    match self.pool {
                        DbPool::Sqlite(p) => {
                            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                            let sql = format!(
                                "SELECT DISTINCT note_id FROM card WHERE deck_id IN ({ph})"
                            );
                            let mut q = sqlx::query(&sql);
                            for id in &chunk {
                                q = q.bind(id);
                            }
                            for r in q.fetch_all(p).await? {
                                note_ids.push(r.get::<String, _>(0));
                            }
                        }
                        DbPool::Postgres(p) => {
                            let ph = (1..=chunk.len())
                                .map(|i| format!("${i}"))
                                .collect::<Vec<_>>()
                                .join(",");
                            let sql = format!(
                                "SELECT DISTINCT note_id FROM card WHERE deck_id IN ({ph})"
                            );
                            let mut q = sqlx::query(&sql);
                            for id in &chunk {
                                q = q.bind(id);
                            }
                            for r in q.fetch_all(p).await? {
                                note_ids.push(r.get::<String, _>(0));
                            }
                        }
                    }
                }
                note_ids.sort();
                note_ids.dedup();
                for chunk in chunks(&note_ids) {
                    match self.pool {
                        DbPool::Sqlite(p) => {
                            let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                            let sql = format!(
                                "UPDATE note SET deleted_at = ?, updated_at = ? WHERE id IN ({ph}) AND deleted_at IS NULL"
                            );
                            let mut q = sqlx::query(&sql).bind(now).bind(now);
                            for id in &chunk {
                                q = q.bind(id);
                            }
                            q.execute(p).await?;
                        }
                        DbPool::Postgres(p) => {
                            let ph = (3..=chunk.len() + 2)
                                .map(|i| format!("${i}"))
                                .collect::<Vec<_>>()
                                .join(",");
                            let sql = format!(
                                "UPDATE note SET deleted_at = $1, updated_at = $2 WHERE id IN ({ph}) AND deleted_at IS NULL"
                            );
                            let mut q = sqlx::query(&sql).bind(now).bind(now);
                            for id in &chunk {
                                q = q.bind(id);
                            }
                            q.execute(p).await?;
                        }
                    }
                }
            }
        }
        let depth: std::collections::HashMap<_, _> = ids
            .iter()
            .filter_map(|id| {
                decks
                    .iter()
                    .find(|d| d.id == *id)
                    .map(|d| (id.clone(), crate::core::deck_paths::depth_of(&d.path)))
            })
            .collect();
        let mut ordered = ids;
        ordered.sort_by_key(|id| std::cmp::Reverse(depth.get(id).copied().unwrap_or(0)));
        for chunk in chunks(&ordered) {
            match self.pool {
                DbPool::Sqlite(p) => {
                    let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!("DELETE FROM deck WHERE id IN ({ph})");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    q.execute(p).await?;
                }
                DbPool::Postgres(p) => {
                    let ph = (1..=chunk.len())
                        .map(|i| format!("${i}"))
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!("DELETE FROM deck WHERE id IN ({ph})");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    q.execute(p).await?;
                }
            }
        }
        Ok("ok")
    }

    pub async fn list_note_types(&self) -> Result<Vec<NoteTypeWithTemplates>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let types = sqlx::query("SELECT * FROM note_type ORDER BY name")
                    .fetch_all(p)
                    .await?;
                let templates = sqlx::query("SELECT * FROM card_template")
                    .fetch_all(p)
                    .await?;
                let mut out = Vec::new();
                for t in &types {
                    let nt = rows::row_to_note_type_sqlite(t)?;
                    let mut tpls: Vec<TemplateRow> = templates
                        .iter()
                        .filter_map(|r| {
                            let tpl = rows::row_to_template_sqlite(r).ok()?;
                            (tpl.note_type_id == nt.id).then_some(tpl)
                        })
                        .collect();
                    tpls.sort_by_key(|x| x.ordinal);
                    out.push(NoteTypeWithTemplates::from_parts(nt, tpls));
                }
                Ok(out)
            }
            DbPool::Postgres(p) => {
                let types = sqlx::query("SELECT * FROM note_type ORDER BY name")
                    .fetch_all(p)
                    .await?;
                let templates = sqlx::query("SELECT * FROM card_template")
                    .fetch_all(p)
                    .await?;
                let mut out = Vec::new();
                for t in &types {
                    let nt = rows::row_to_note_type_pg(t)?;
                    let mut tpls: Vec<TemplateRow> = templates
                        .iter()
                        .filter_map(|r| {
                            let tpl = rows::row_to_template_pg(r).ok()?;
                            (tpl.note_type_id == nt.id).then_some(tpl)
                        })
                        .collect();
                    tpls.sort_by_key(|x| x.ordinal);
                    out.push(NoteTypeWithTemplates::from_parts(nt, tpls));
                }
                Ok(out)
            }
        }
    }

    pub async fn get_note_type(&self, id: &str) -> Result<Option<NoteTypeWithTemplates>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let row = sqlx::query("SELECT * FROM note_type WHERE id = ?")
                    .bind(id)
                    .fetch_optional(p)
                    .await?;
                let Some(row) = row else {
                    return Ok(None);
                };
                let nt = rows::row_to_note_type_sqlite(&row)?;
                let templates = sqlx::query("SELECT * FROM card_template WHERE note_type_id = ?")
                    .bind(id)
                    .fetch_all(p)
                    .await?;
                let mut tpls: Vec<_> = templates
                    .iter()
                    .map(rows::row_to_template_sqlite)
                    .collect::<Result<_>>()?;
                tpls.sort_by_key(|x| x.ordinal);
                Ok(Some(NoteTypeWithTemplates::from_parts(nt, tpls)))
            }
            DbPool::Postgres(p) => {
                let row = sqlx::query("SELECT * FROM note_type WHERE id = $1")
                    .bind(id)
                    .fetch_optional(p)
                    .await?;
                let Some(row) = row else {
                    return Ok(None);
                };
                let nt = rows::row_to_note_type_pg(&row)?;
                let templates = sqlx::query("SELECT * FROM card_template WHERE note_type_id = $1")
                    .bind(id)
                    .fetch_all(p)
                    .await?;
                let mut tpls: Vec<_> = templates
                    .iter()
                    .map(rows::row_to_template_pg)
                    .collect::<Result<_>>()?;
                tpls.sort_by_key(|x| x.ordinal);
                Ok(Some(NoteTypeWithTemplates::from_parts(nt, tpls)))
            }
        }
    }

    pub async fn delete_note_type_unless_used(&self, id: &str) -> Result<&'static str> {
        if self.get_note_type(id).await?.is_none() {
            return Ok("not_found");
        }
        let used: Option<String> = match self.pool {
            DbPool::Sqlite(p) => {
                sqlx::query_scalar("SELECT id FROM note WHERE note_type_id = ? LIMIT 1")
                    .bind(id)
                    .fetch_optional(p)
                    .await?
            }
            DbPool::Postgres(p) => {
                sqlx::query_scalar("SELECT id FROM note WHERE note_type_id = $1 LIMIT 1")
                    .bind(id)
                    .fetch_optional(p)
                    .await?
            }
        };
        if used.is_some() {
            return Ok("in_use");
        }
        match self.pool {
            DbPool::Sqlite(p) => {
                sqlx::query("DELETE FROM note_type WHERE id = ?")
                    .bind(id)
                    .execute(p)
                    .await?;
            }
            DbPool::Postgres(p) => {
                sqlx::query("DELETE FROM note_type WHERE id = $1")
                    .bind(id)
                    .execute(p)
                    .await?;
            }
        }
        Ok("deleted")
    }

    pub async fn insert_note(
        &self,
        note: &NoteRow,
        tags: &[String],
        cards: &[CardDraft],
        now: i64,
    ) -> Result<()> {
        let fields = serde_json::to_string(&note.fields)?;
        match self.pool {
            DbPool::Sqlite(p) => {
                let mut tx = p.begin().await?;
                sqlx::query(
                    r#"INSERT INTO note (id, note_type_id, guid, fields, created_at, updated_at, checksum, deleted_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
                )
                .bind(&note.id)
                .bind(&note.note_type_id)
                .bind(&note.guid)
                .bind(&fields)
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
                let position: i32 =
                    sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM card")
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
            }
            DbPool::Postgres(p) => {
                let mut tx = p.begin().await?;
                sqlx::query(
                    r#"INSERT INTO note (id, note_type_id, guid, fields, created_at, updated_at, checksum, deleted_at)
                       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)"#,
                )
                .bind(&note.id)
                .bind(&note.note_type_id)
                .bind(&note.guid)
                .bind(&fields)
                .bind(note.created_at)
                .bind(note.updated_at)
                .bind(&note.checksum)
                .bind(note.deleted_at)
                .execute(&mut *tx)
                .await?;
                for tag in tags {
                    sqlx::query("INSERT INTO note_tag (note_id, tag) VALUES ($1, $2)")
                        .bind(&note.id)
                        .bind(tag)
                        .execute(&mut *tx)
                        .await?;
                }
                let position: i32 =
                    sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM card")
                        .fetch_one(&mut *tx)
                        .await?;
                let mut pos = position;
                for draft in cards {
                    sqlx::query(
                        r#"INSERT INTO card (id, note_id, template_id, ordinal, deck_id, state, due, stability, difficulty,
                           last_review, reps, lapses, position, buried_until, flags, sched_state, learning_step)
                           VALUES ($1,$2,$3,$4,$5,'new',$6,0,0,NULL,0,0,$7,NULL,0,'new',0)"#,
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
            }
        }
        Ok(())
    }

    pub async fn move_cards(&self, card_ids: &[String], deck_id: &str) -> Result<&'static str> {
        let ids: Vec<_> = card_ids
            .iter()
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        if self.get_deck(deck_id).await?.is_none() {
            return Ok("deck_not_found");
        }
        let mut found = 0;
        for chunk in chunks(&ids) {
            match self.pool {
                DbPool::Sqlite(p) => {
                    let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!("SELECT id FROM card WHERE id IN ({ph})");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    found += q.fetch_all(p).await?.len();
                }
                DbPool::Postgres(p) => {
                    let ph = (1..=chunk.len())
                        .map(|i| format!("${i}"))
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!("SELECT id FROM card WHERE id IN ({ph})");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    found += q.fetch_all(p).await?.len();
                }
            }
        }
        if found != ids.len() {
            return Ok("card_not_found");
        }
        for chunk in chunks(&ids) {
            match self.pool {
                DbPool::Sqlite(p) => {
                    let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!("UPDATE card SET deck_id = ? WHERE id IN ({ph})");
                    let mut q = sqlx::query(&sql).bind(deck_id);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    q.execute(p).await?;
                }
                DbPool::Postgres(p) => {
                    let ph = (2..=chunk.len() + 1)
                        .map(|i| format!("${i}"))
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!("UPDATE card SET deck_id = $1 WHERE id IN ({ph})");
                    let mut q = sqlx::query(&sql).bind(deck_id);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    q.execute(p).await?;
                }
            }
        }
        Ok("ok")
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
            match self.pool {
                DbPool::Sqlite(p) => {
                    let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!("SELECT * FROM card WHERE id IN ({ph}) ORDER BY id");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    for r in q.fetch_all(p).await? {
                        cards.push(rows::row_to_card_sqlite(&r)?);
                    }
                }
                DbPool::Postgres(p) => {
                    let ph = (1..=chunk.len())
                        .map(|i| format!("${i}"))
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!("SELECT * FROM card WHERE id IN ({ph}) ORDER BY id");
                    let mut q = sqlx::query(&sql);
                    for id in &chunk {
                        q = q.bind(id);
                    }
                    for r in q.fetch_all(p).await? {
                        cards.push(rows::row_to_card_pg(&r)?);
                    }
                }
            }
        }
        cards.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(cards)
    }

    pub async fn apply_card_state_updates(&self, updates: &[CardStateUpdate]) -> Result<()> {
        for u in updates {
            match self.pool {
                DbPool::Sqlite(p) => {
                    sqlx::query("UPDATE card SET state = ?, buried_until = ? WHERE id = ?")
                        .bind(&u.state)
                        .bind(u.buried_until)
                        .bind(&u.id)
                        .execute(p)
                        .await?;
                }
                DbPool::Postgres(p) => {
                    sqlx::query("UPDATE card SET state = $1, buried_until = $2 WHERE id = $3")
                        .bind(&u.state)
                        .bind(u.buried_until)
                        .bind(&u.id)
                        .execute(p)
                        .await?;
                }
            }
        }
        Ok(())
    }

    pub async fn insert_media_if_absent(&self, row: &MediaRow) -> Result<MediaRow> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let _ = sqlx::query(
                    "INSERT OR IGNORE INTO media (id, sha256, mime, size, original_name) VALUES (?, ?, ?, ?, ?)",
                )
                .bind(&row.id)
                .bind(&row.sha256)
                .bind(&row.mime)
                .bind(row.size)
                .bind(&row.original_name)
                .execute(p)
                .await?;
            }
            DbPool::Postgres(p) => {
                let _ = sqlx::query(
                    "INSERT INTO media (id, sha256, mime, size, original_name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sha256) DO NOTHING",
                )
                .bind(&row.id)
                .bind(&row.sha256)
                .bind(&row.mime)
                .bind(row.size)
                .bind(&row.original_name)
                .execute(p)
                .await?;
            }
        }
        self.get_media_by_sha(&row.sha256)
            .await?
            .ok_or_else(|| anyhow::anyhow!("missing media"))
    }

    pub async fn get_media_by_sha(&self, sha: &str) -> Result<Option<MediaRow>> {
        match self.pool {
            DbPool::Sqlite(p) => {
                let row = sqlx::query("SELECT * FROM media WHERE sha256 = ?")
                    .bind(sha)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| rows::row_to_media_sqlite(&r)).transpose()
            }
            DbPool::Postgres(p) => {
                let row = sqlx::query("SELECT * FROM media WHERE sha256 = $1")
                    .bind(sha)
                    .fetch_optional(p)
                    .await?;
                row.map(|r| rows::row_to_media_pg(&r)).transpose()
            }
        }
    }
}

async fn sqlite_preset_insert(
    p: &Pool<Sqlite>,
    row: &PresetRow,
    json: &rows::PresetDbJson,
) -> Result<&'static str> {
    let clash: Option<String> =
        sqlx::query_scalar("SELECT id FROM deck_preset WHERE name = ? AND id != ?")
            .bind(&row.name)
            .bind(&row.id)
            .fetch_optional(p)
            .await?;
    if clash.is_some() {
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
    .execute(p)
    .await
    {
        Ok(_) => Ok("ok"),
        Err(e) if rows::is_unique_violation(&e) => Ok("name_taken"),
        Err(e) => Err(e.into()),
    }
}

async fn postgres_preset_insert(
    p: &Pool<Postgres>,
    row: &PresetRow,
    json: &rows::PresetDbJson,
) -> Result<&'static str> {
    let clash: Option<String> =
        sqlx::query_scalar("SELECT id FROM deck_preset WHERE name = $1 AND id != $2")
            .bind(&row.name)
            .bind(&row.id)
            .fetch_optional(p)
            .await?;
    if clash.is_some() {
        return Ok("name_taken");
    }
    match sqlx::query(
        r#"INSERT INTO deck_preset (id, name, new_per_day, reviews_per_day, desired_retention,
            learning_steps, relearning_steps, max_interval, fsrs_params, bury_siblings, new_order)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10,$11)"#,
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
    .execute(p)
    .await
    {
        Ok(_) => Ok("ok"),
        Err(e) if rows::is_unique_violation(&e) => Ok("name_taken"),
        Err(e) => Err(e.into()),
    }
}

fn chunks<T: Clone>(items: &[T]) -> Vec<Vec<T>> {
    items.chunks(ID_CHUNK).map(|c| c.to_vec()).collect()
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
    let updates = match compute(&cards) {
        Ok(u) => u,
        Err(f) => return Ok(Err(f)),
    };
    store.apply_card_state_updates(&updates).await?;
    Ok(Ok(()))
}
