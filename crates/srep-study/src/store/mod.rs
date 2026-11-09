mod card_state;
pub mod convert;
mod pack;
mod replay;
pub mod review;
mod settings;
mod snapshot;
mod sync;

pub use replay::REPLAY_PAGE_SIZE;
pub use settings::STUDY_SETTINGS_KEY;

use crate::answer_plan::{AnswerPlan, CardRow, PlanFailure, UndoPlan};
use crate::card_state_plan::CardStateFailure;
use crate::card_state_plan::CardStateUpdate;
use crate::queue_choice::DeckSnapshot;
use crate::types::StudyWindow;
use crate::types::{ReviewLogRow, StudySettings};
use crate::validation::SyncItem;
use anyhow::Result;
use srep_db::DbPool;

pub struct StudyStore<'a> {
    pool: &'a DbPool,
}

pub enum AnswerCardResult {
    NotFound,
    Failure(PlanFailure),
    Ok(AnswerPlan),
}

pub enum ChangeCardStatesResult {
    CardNotFound,
    Failure(CardStateFailure),
    Ok,
}

#[derive(Clone)]
pub struct StudySnapshotInput {
    pub deck_ids: Vec<String>,
    pub now_ms: i64,
    pub window: StudyWindow,
    pub shuffle_deck_ids: Vec<String>,
}

pub struct ReplayBatchItem {
    pub card: CardRow,
    pub logs: Vec<ReviewLogRow>,
}

pub struct CardRebuildUpdate {
    pub id: String,
    pub fields: crate::types::SchedFields,
}

impl<'a> StudyStore<'a> {
    pub fn new(pool: &'a DbPool) -> Self {
        Self { pool }
    }

    pub async fn read_study_snapshots(
        &self,
        input: StudySnapshotInput,
    ) -> Result<Vec<DeckSnapshot>> {
        snapshot::read_snapshots(self.pool, &input).await
    }

    pub async fn read_card(
        &self,
        card_id: &str,
    ) -> Result<Option<(CardRow, Option<srep_domain::types::PresetRow>)>> {
        review::read_card(self.pool, card_id).await
    }

    pub async fn answer_card<F>(&self, card_id: &str, compute: F) -> Result<AnswerCardResult>
    where
        F: FnOnce(review::AnswerContext) -> Result<AnswerPlan, PlanFailure>,
    {
        review::answer_card(self.pool, card_id, compute).await
    }

    pub async fn sync_apply_item(
        &self,
        device_id: &str,
        item: &SyncItem,
        now_ms: i64,
        window: &StudyWindow,
    ) -> Result<serde_json::Value> {
        // SQLite uses deferred transactions, so two concurrent writers can
        // collide with SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT even though a busy
        // timeout is configured (the snapshot error is not retried by it).
        // Retrying the whole item is safe: the receipt lookup inside the
        // transaction makes a re-run after a committed first attempt return
        // the stored duplicate outcome instead of applying twice.
        let mut attempt = 0;
        loop {
            match sync::sync_apply_item(self.pool, device_id, item, now_ms, window).await {
                Ok(value) => return Ok(value),
                Err(e) if is_sqlite_lock_error(&e) && attempt < 5 => {
                    attempt += 1;
                    tokio::time::sleep(std::time::Duration::from_millis(10 * (1 << attempt))).await;
                }
                Err(e) => return Err(e),
            }
        }
    }

    pub async fn review_log_head(&self) -> Result<Option<i64>> {
        sync::review_log_head(self.pool).await
    }

    pub async fn read_pack_queues(
        &self,
        input: &StudySnapshotInput,
        limit: usize,
    ) -> Result<Vec<crate::queue_choice::DeckPackQueue>> {
        pack::read_queues(self.pool, input, limit).await
    }

    pub async fn undo_last_review<F>(&self, compute: F) -> Result<review::UndoResult>
    where
        F: FnOnce(review::UndoContext) -> UndoPlan,
    {
        review::undo_last_review(self.pool, compute).await
    }

    pub async fn change_card_states<F>(
        &self,
        card_ids: &[String],
        compute: F,
    ) -> Result<ChangeCardStatesResult>
    where
        F: FnOnce(&[CardRow]) -> Result<Vec<CardStateUpdate>, CardStateFailure>,
    {
        card_state::change_card_states(self.pool, card_ids, compute).await
    }

    pub async fn unbury_expired(&self, now_ms: i64) -> Result<u64> {
        card_state::unbury_expired(self.pool, now_ms).await
    }

    pub async fn read_replay_batch(
        &self,
        after_card_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ReplayBatchItem>> {
        replay::read_replay_batch(self.pool, after_card_id, limit).await
    }

    pub async fn rebuild_cards<F>(&self, compute_batch: F) -> Result<(u64, u64)>
    where
        F: Fn(&[ReplayBatchItem]) -> Vec<CardRebuildUpdate>,
    {
        replay::rebuild_cards(self.pool, compute_batch).await
    }

    pub async fn get_study_settings(&self) -> Result<Option<serde_json::Value>> {
        settings::get_settings(self.pool).await
    }

    pub async fn put_study_settings(&self, value: &StudySettings) -> Result<()> {
        settings::put_settings(self.pool, value).await
    }
}

/// True when the error is a SQLite writer-lock collision (SQLITE_BUSY = 5,
/// SQLITE_BUSY_SNAPSHOT = 517). Postgres uses the per-item advisory lock to
/// serialize writers, so its errors are never lock collisions of this kind.
fn is_sqlite_lock_error(e: &anyhow::Error) -> bool {
    e.downcast_ref::<sqlx::Error>()
        .and_then(|sql_err| match sql_err {
            sqlx::Error::Database(db_err) => db_err.code().map(|code| code == "5" || code == "517"),
            _ => None,
        })
        .unwrap_or(false)
}
