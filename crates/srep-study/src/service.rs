use crate::answer_plan::{plan_answer, plan_undo, sched_fields_of, PlanFailure};
use crate::card_state_plan::{plan_bury, plan_suspend, plan_unsuspend, CardStateFailure};
use crate::day_clock::study_window;
use crate::fsrs_adapter::{preview_answers, SchedulerPreset};
use crate::parked::is_parked_state;
use crate::queue_choice::{choose_next, study_counts, DeckQuota, NewOrder, QueueSource};
use crate::replay::{compare_sched, replay_card};
use crate::store::{
    AnswerCardResult, CardRebuildUpdate, ChangeCardStatesResult, StudySnapshotInput, StudyStore,
    REPLAY_PAGE_SIZE,
};
use crate::study_settings::get_settings_default;
use crate::types::{StudySettings, StudyWindow};
use crate::validation::AnswerBody;
use anyhow::Result;
use serde::Serialize;
use sqlx::Row;
use srep_auth::AppState;
use srep_domain::builtin::{builtin_preset, DEFAULT_PRESET_ID};
use srep_domain::core::deck_paths::subtree_ids;
use srep_domain::store::DomainStore;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyCard {
    pub id: String,
    pub note_id: String,
    pub deck_id: Option<String>,
    pub state: String,
    pub sched_state: String,
    pub reps: u32,
    pub lapses: u32,
    pub due: i64,
    pub front: String,
    pub back: String,
    pub source: String,
    pub previews: serde_json::Value,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum NextReply {
    Card {
        card: StudyCard,
        counts: crate::queue_choice::StudyCounts,
        window: StudyWindow,
    },
    Wait {
        until: i64,
        counts: crate::queue_choice::StudyCounts,
        window: StudyWindow,
    },
    Done {
        counts: crate::queue_choice::StudyCounts,
        window: StudyWindow,
    },
}

pub enum StudyError {
    Unauthorized,
    BadRequest,
    NotFound,
    StaleCard,
    BadPreset,
    NothingToUndo,
    Internal,
}

async fn load_settings(store: &StudyStore<'_>) -> Result<StudySettings, StudyError> {
    let raw = store
        .get_study_settings()
        .await
        .map_err(|_| StudyError::Internal)?;
    get_settings_default(raw.as_ref()).map_err(|_| StudyError::BadRequest)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub async fn study_next(state: &AppState, deck_id: Option<&str>) -> Result<NextReply, StudyError> {
    let study = StudyStore::new(&state.db);
    let domain = DomainStore::new(&state.db);
    let settings = load_settings(&study).await?;
    let now = now_ms();
    let window = study_window(now, &settings);
    study
        .unbury_expired(now)
        .await
        .map_err(|_| StudyError::Internal)?;
    let decks = domain
        .list_decks()
        .await
        .map_err(|_| StudyError::Internal)?;
    let presets = domain
        .list_presets()
        .await
        .map_err(|_| StudyError::Internal)?;
    if let Some(id) = deck_id {
        if !decks.iter().any(|d| d.id == id) {
            return Err(StudyError::NotFound);
        }
    }
    let scope_ids: std::collections::HashSet<_> = if let Some(id) = deck_id {
        subtree_ids(&decks, id).into_iter().collect()
    } else {
        decks.iter().map(|d| d.id.clone()).collect()
    };
    let mut scope_decks = Vec::new();
    let mut quotas = Vec::new();
    for deck in &decks {
        let Some(p) = presets.iter().find(|p| p.id == deck.preset_id) else {
            continue;
        };
        if scope_ids.contains(&deck.id) && deck.archived_at.is_none() {
            scope_decks.push(deck.id.clone());
            quotas.push(DeckQuota {
                deck_id: deck.id.clone(),
                new_per_day: p.new_per_day as u32,
                reviews_per_day: p.reviews_per_day as u32,
                new_order: if p.new_order == "random" {
                    NewOrder::Random
                } else {
                    NewOrder::Added
                },
            });
        }
    }
    let snapshots = study
        .read_study_snapshots(StudySnapshotInput {
            deck_ids: scope_decks,
            now_ms: now,
            window: window.clone(),
            shuffle_deck_ids: quotas
                .iter()
                .filter(|q| q.new_order == NewOrder::Random)
                .map(|q| q.deck_id.clone())
                .collect(),
        })
        .await
        .map_err(|_| StudyError::Internal)?;
    let counts = study_counts(&snapshots, &quotas);
    let choice = choose_next(&snapshots, &quotas, now);
    match choice {
        crate::queue_choice::QueueChoice::Wait { until } => Ok(NextReply::Wait {
            until,
            counts,
            window,
        }),
        crate::queue_choice::QueueChoice::Done => Ok(NextReply::Done { counts, window }),
        crate::queue_choice::QueueChoice::Card { card_id, source } => {
            let card = build_study_card(state, &study, &card_id, source, now)
                .await?
                .ok_or(StudyError::NotFound)?;
            Ok(NextReply::Card {
                card,
                counts,
                window,
            })
        }
    }
}

async fn build_study_card(
    state: &AppState,
    study: &StudyStore<'_>,
    card_id: &str,
    source: QueueSource,
    now_ms: i64,
) -> Result<Option<StudyCard>, StudyError> {
    let read = study
        .read_card(card_id)
        .await
        .map_err(|_| StudyError::Internal)?;
    let Some((card, preset_row)) = read else {
        return Ok(None);
    };
    let domain = DomainStore::new(&state.db);
    let note_id = card.note_id.clone();
    let (note_type_id, fields_json) = match &state.db {
        srep_db::DbPool::Sqlite(p) => {
            let note = sqlx::query(
                "SELECT note_type_id, fields FROM note WHERE id = ? AND deleted_at IS NULL",
            )
            .bind(&note_id)
            .fetch_optional(p)
            .await
            .map_err(|_| StudyError::Internal)?;
            let Some(note) = note else {
                return Ok(None);
            };
            let note_type_id: String = note
                .try_get("note_type_id")
                .map_err(|_| StudyError::Internal)?;
            let fields_json: String = note.try_get("fields").map_err(|_| StudyError::Internal)?;
            (note_type_id, fields_json)
        }
        srep_db::DbPool::Postgres(p) => {
            let note = sqlx::query(
                "SELECT note_type_id, fields FROM note WHERE id = $1 AND deleted_at IS NULL",
            )
            .bind(&note_id)
            .fetch_optional(p)
            .await
            .map_err(|_| StudyError::Internal)?;
            let Some(note) = note else {
                return Ok(None);
            };
            let note_type_id: String = note
                .try_get("note_type_id")
                .map_err(|_| StudyError::Internal)?;
            let fields_json: String = note.try_get("fields").map_err(|_| StudyError::Internal)?;
            (note_type_id, fields_json)
        }
    };
    let note_type = domain
        .get_note_type(&note_type_id)
        .await
        .map_err(|_| StudyError::Internal)?
        .ok_or(StudyError::NotFound)?;
    let fields: Vec<String> = serde_json::from_str(&fields_json).unwrap_or_default();
    let template_id: Option<String> = match &state.db {
        srep_db::DbPool::Sqlite(p) => {
            sqlx::query_scalar("SELECT template_id FROM card WHERE id = ?")
                .bind(card_id)
                .fetch_optional(p)
                .await
                .ok()
                .flatten()
        }
        srep_db::DbPool::Postgres(p) => {
            sqlx::query_scalar("SELECT template_id FROM card WHERE id = $1")
                .bind(card_id)
                .fetch_optional(p)
                .await
                .ok()
                .flatten()
        }
    };
    let template = template_id
        .as_deref()
        .and_then(|tid| note_type.templates.iter().find(|t| t.id == *tid));
    let (front, back) = template
        .map(|t| render_pair(t, &note_type.fields, &fields))
        .unwrap_or_default();
    let preset = preset_row
        .as_ref()
        .map(crate::store::convert::to_answer_preset);
    let previews = match preset {
        Some(p) => {
            let sched = SchedulerPreset {
                desired_retention: p.desired_retention,
                learning_steps: p.learning_steps.clone(),
                relearning_steps: p.relearning_steps.clone(),
                max_interval: p.max_interval,
                fsrs_params: p.fsrs_params.clone(),
            };
            preview_answers(&sched, &sched_fields_of(&card), now_ms)
                .map(|p| serde_json::to_value(p).unwrap_or_default())
                .unwrap_or(serde_json::Value::Null)
        }
        None => serde_json::Value::Null,
    };
    if previews.is_null() {
        return Err(StudyError::BadPreset);
    }
    let source_s = match source {
        QueueSource::Learning => "learning",
        QueueSource::Review => "review",
        QueueSource::New => "new",
    };
    Ok(Some(StudyCard {
        id: card.id,
        note_id,
        deck_id: card.deck_id.clone(),
        state: crate::store::convert::card_state_to_str(card.state).to_string(),
        sched_state: crate::store::convert::sched_state_to_str(card.sched_state).to_string(),
        reps: card.reps,
        lapses: card.lapses,
        due: card.due,
        front,
        back,
        source: source_s.to_string(),
        previews,
    }))
}

fn render_pair(
    template: &srep_domain::types::TemplateRow,
    names: &[String],
    values: &[String],
) -> (String, String) {
    let pairs: Vec<_> = names.iter().zip(values.iter()).collect();
    let mut front = template.front_tpl.clone();
    let mut back = template.back_tpl.clone();
    for (n, v) in pairs {
        let token = format!("{{{{{}}}}}", n);
        front = front.replace(&token, v);
        back = back.replace(&token, v);
    }
    (front, back)
}

pub async fn study_answer(
    state: &AppState,
    body: AnswerBody,
) -> Result<serde_json::Value, StudyError> {
    let study = StudyStore::new(&state.db);
    let settings = load_settings(&study).await?;
    let now = now_ms();
    let window = study_window(now, &settings);
    study
        .unbury_expired(now)
        .await
        .map_err(|_| StudyError::Internal)?;
    let log_id = uuid::Uuid::new_v4().to_string();
    let card_id = body.card_id.to_string();
    let result = study
        .answer_card(&card_id, |ctx| {
            plan_answer(
                &ctx.card,
                &ctx.deck_preset,
                &ctx.siblings,
                ctx.last_reviewed_at_max,
                body.rating,
                body.reps,
                body.elapsed_ms,
                now,
                &window,
                log_id,
            )
        })
        .await
        .map_err(|_| StudyError::Internal)?;
    match result {
        AnswerCardResult::NotFound => Err(StudyError::NotFound),
        AnswerCardResult::Failure(PlanFailure::StaleCard) => Err(StudyError::StaleCard),
        AnswerCardResult::Failure(_) => Err(StudyError::BadRequest),
        AnswerCardResult::Ok(plan) => {
            let log = &plan.log;
            let u = &plan.card_update;
            Ok(serde_json::json!({
                "ok": true,
                "review": {
                    "id": log.id,
                    "reviewedAt": log.reviewed_at,
                    "intervalMinutes": log.interval_after,
                },
                "card": {
                    "id": log.card_id,
                    "state": crate::store::convert::sched_state_to_str(u.sched_state),
                    "due": u.due,
                    "reps": u.reps,
                    "lapses": u.lapses,
                    "stability": u.stability,
                    "difficulty": u.difficulty,
                }
            }))
        }
    }
}

pub async fn study_undo(state: &AppState) -> Result<serde_json::Value, StudyError> {
    let study = StudyStore::new(&state.db);
    study
        .unbury_expired(now_ms())
        .await
        .map_err(|_| StudyError::Internal)?;
    let result = study
        .undo_last_review(|ctx| plan_undo(&ctx.log, &ctx.card, &ctx.buried))
        .await
        .map_err(|_| StudyError::Internal)?;
    match result {
        crate::store::review::UndoResult::NothingToUndo => Err(StudyError::NothingToUndo),
        crate::store::review::UndoResult::Ok(log) => Ok(serde_json::json!({
            "ok": true,
            "undone": { "reviewId": log.id, "cardId": log.card_id }
        })),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub checked: u32,
    pub skipped: u32,
    pub mismatches: Vec<Mismatch>,
    pub chain_mismatches: Vec<ChainMismatch>,
}

#[derive(Serialize)]
pub struct Mismatch {
    pub card_id: String,
    pub fields: Vec<String>,
}

#[derive(Serialize)]
pub struct ChainMismatch {
    pub card_id: String,
    pub log_indexes: Vec<usize>,
}

pub async fn study_verify(state: &AppState) -> Result<VerifyReport, StudyError> {
    let study = StudyStore::new(&state.db);
    let domain = DomainStore::new(&state.db);
    let presets = domain
        .list_presets()
        .await
        .map_err(|_| StudyError::Internal)?;
    let decks = domain
        .list_decks()
        .await
        .map_err(|_| StudyError::Internal)?;
    let fallback = presets
        .iter()
        .find(|p| p.id == DEFAULT_PRESET_ID)
        .cloned()
        .unwrap_or_else(builtin_preset);
    let mut report = VerifyReport {
        checked: 0,
        skipped: 0,
        mismatches: vec![],
        chain_mismatches: vec![],
    };
    let mut after: Option<String> = None;
    loop {
        let batch = study
            .read_replay_batch(after.as_deref(), REPLAY_PAGE_SIZE)
            .await
            .map_err(|_| StudyError::Internal)?;
        for item in &batch {
            report.checked += 1;
            let preset = preset_for_card(&decks, &presets, &fallback, &item.card);
            let sched = SchedulerPreset {
                desired_retention: preset.desired_retention,
                learning_steps: preset.learning_steps.iter().map(|&x| x as u32).collect(),
                relearning_steps: preset.relearning_steps.iter().map(|&x| x as u32).collect(),
                max_interval: preset.max_interval,
                fsrs_params: preset.fsrs_params.clone(),
            };
            let replay = replay_card(&item.logs, &sched);
            let Some(replay) = replay else {
                report.skipped += 1;
                continue;
            };
            let fields: Vec<String> = compare_sched(&sched_fields_of(&item.card), &replay.fields)
                .into_iter()
                .map(|s| s.to_string())
                .collect();
            let mut all_fields = fields;
            if !is_parked_state(item.card.state)
                && crate::store::convert::sched_state_to_str(item.card.sched_state)
                    != crate::store::convert::sched_state_to_str(replay.fields.sched_state)
            {
                all_fields.push("state".to_string());
            }
            if !all_fields.is_empty() {
                report.mismatches.push(Mismatch {
                    card_id: item.card.id.clone(),
                    fields: all_fields,
                });
            }
            if !replay.chain_mismatches.is_empty() {
                report.chain_mismatches.push(ChainMismatch {
                    card_id: item.card.id.clone(),
                    log_indexes: replay.chain_mismatches,
                });
            }
        }
        if batch.len() < REPLAY_PAGE_SIZE as usize {
            break;
        }
        after = batch.last().map(|b| b.card.id.clone());
    }
    Ok(report)
}

pub async fn study_rebuild(state: &AppState) -> Result<serde_json::Value, StudyError> {
    let study = StudyStore::new(&state.db);
    let domain = DomainStore::new(&state.db);
    let presets = domain
        .list_presets()
        .await
        .map_err(|_| StudyError::Internal)?;
    let decks = domain
        .list_decks()
        .await
        .map_err(|_| StudyError::Internal)?;
    let fallback = presets
        .iter()
        .find(|p| p.id == DEFAULT_PRESET_ID)
        .cloned()
        .unwrap_or_else(builtin_preset);
    let (checked, changed) = study
        .rebuild_cards(|batch| {
            let mut updates = Vec::new();
            for item in batch {
                let preset = preset_for_card(&decks, &presets, &fallback, &item.card);
                let sched = SchedulerPreset {
                    desired_retention: preset.desired_retention,
                    learning_steps: preset.learning_steps.iter().map(|&x| x as u32).collect(),
                    relearning_steps: preset.relearning_steps.iter().map(|&x| x as u32).collect(),
                    max_interval: preset.max_interval,
                    fsrs_params: preset.fsrs_params.clone(),
                };
                let Some(replay) = replay_card(&item.logs, &sched) else {
                    continue;
                };
                let fields = compare_sched(&sched_fields_of(&item.card), &replay.fields);
                let state_mismatch = !is_parked_state(item.card.state)
                    && crate::store::convert::sched_state_to_str(item.card.sched_state)
                        != crate::store::convert::sched_state_to_str(replay.fields.sched_state);
                if fields.is_empty() && !state_mismatch {
                    continue;
                }
                updates.push(CardRebuildUpdate {
                    id: item.card.id.clone(),
                    fields: replay.fields,
                });
            }
            updates
        })
        .await
        .map_err(|_| StudyError::Internal)?;
    let skipped = 0u32;
    Ok(serde_json::json!({
        "checked": checked,
        "changed": changed,
        "skipped": skipped,
    }))
}

fn preset_for_card(
    decks: &[srep_domain::types::DeckRow],
    presets: &[srep_domain::types::PresetRow],
    fallback: &srep_domain::types::PresetRow,
    card: &crate::answer_plan::CardRow,
) -> srep_domain::types::PresetRow {
    card.deck_id
        .as_ref()
        .and_then(|id| decks.iter().find(|d| &d.id == id))
        .and_then(|d| presets.iter().find(|p| p.id == d.preset_id))
        .cloned()
        .unwrap_or_else(|| fallback.clone())
}

pub async fn change_cards_suspend(state: &AppState, ids: &[String]) -> Result<(), StudyError> {
    change_cards(state, ids, |cards| Ok(plan_suspend(cards))).await
}

pub async fn change_cards_unsuspend(state: &AppState, ids: &[String]) -> Result<(), StudyError> {
    change_cards(state, ids, |cards| plan_unsuspend(cards).map_err(|e| e)).await
}

pub async fn change_cards_bury(state: &AppState, ids: &[String]) -> Result<(), StudyError> {
    let settings = {
        let study = StudyStore::new(&state.db);
        load_settings(&study).await?
    };
    let until = study_window(now_ms(), &settings).end_ms;
    change_cards(state, ids, move |cards| Ok(plan_bury(cards, until))).await
}

async fn change_cards<F>(state: &AppState, ids: &[String], plan: F) -> Result<(), StudyError>
where
    F: FnOnce(
        &[crate::answer_plan::CardRow],
    ) -> Result<Vec<crate::card_state_plan::CardStateUpdate>, CardStateFailure>,
{
    let study = StudyStore::new(&state.db);
    let ids: Vec<String> = ids.iter().map(|s| s.to_lowercase()).collect();
    let result = study
        .change_card_states(&ids, plan)
        .await
        .map_err(|_| StudyError::Internal)?;
    match result {
        ChangeCardStatesResult::CardNotFound => Err(StudyError::NotFound),
        ChangeCardStatesResult::Failure(_) => Err(StudyError::BadRequest),
        ChangeCardStatesResult::Ok => Ok(()),
    }
}

pub async fn get_study_settings(state: &AppState) -> Result<StudySettings, StudyError> {
    let study = StudyStore::new(&state.db);
    let raw = study
        .get_study_settings()
        .await
        .map_err(|_| StudyError::Internal)?;
    get_settings_default(raw.as_ref()).map_err(|_| StudyError::BadRequest)
}

pub async fn put_study_settings(
    state: &AppState,
    settings: StudySettings,
) -> Result<StudySettings, StudyError> {
    let study = StudyStore::new(&state.db);
    study
        .put_study_settings(&settings)
        .await
        .map_err(|_| StudyError::Internal)?;
    Ok(settings)
}
