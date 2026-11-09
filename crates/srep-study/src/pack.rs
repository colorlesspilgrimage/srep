use crate::day_clock::study_window;
use crate::queue_choice::{choose_pack, study_counts, DeckQuota, NewOrder, StudyCounts};
use crate::service::{build_study_card, load_settings, StudyCard, StudyError};
use crate::store::{StudySnapshotInput, StudyStore};
use crate::types::StudyWindow;
use serde::Serialize;
use srep_auth::AppState;
use srep_domain::core::deck_paths::subtree_ids;
use srep_domain::store::DomainStore;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackCard {
    pub card_id: String,
    pub ordinal: usize,
    pub reps: u32,
    pub payload: StudyCard,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackReply {
    pub pack_id: String,
    pub generated_at: i64,
    pub server_time_ms: i64,
    pub server_revision: String,
    pub counts: StudyCounts,
    pub window: StudyWindow,
    pub cards: Vec<PackCard>,
}

pub async fn study_pack(
    state: &AppState,
    deck_id: Option<&str>,
    limit: usize,
) -> Result<PackReply, StudyError> {
    let study = StudyStore::new(&state.db);
    let domain = DomainStore::new(&state.db);
    let settings = load_settings(&study).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let window = study_window(now, &settings);
    // Match /study/next: restore cards whose bury expired before selecting,
    // so the pack serves exactly what the online queue would serve.
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
    let scope_ids: HashSet<_> = if let Some(id) = deck_id {
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
    let snapshot_input = StudySnapshotInput {
        deck_ids: scope_decks,
        now_ms: now,
        window: window.clone(),
        shuffle_deck_ids: quotas
            .iter()
            .filter(|q| q.new_order == NewOrder::Random)
            .map(|q| q.deck_id.clone())
            .collect(),
    };
    let snapshots = study
        .read_study_snapshots(snapshot_input.clone())
        .await
        .map_err(|_| StudyError::Internal)?;
    let counts = study_counts(&snapshots, &quotas);
    let queues = study
        .read_pack_queues(&snapshot_input, limit)
        .await
        .map_err(|_| StudyError::Internal)?;
    let picks = choose_pack(&snapshots, &quotas, &queues, limit, now);
    let server_revision = study
        .review_log_head()
        .await
        .map_err(|_| StudyError::Internal)?
        .unwrap_or(0)
        .to_string();
    let mut cards = Vec::with_capacity(picks.len());
    for (card_id, source) in picks {
        let card = build_study_card(state, &study, &card_id, source, now).await?;
        let Some(card) = card else {
            continue;
        };
        let ordinal = cards.len();
        cards.push(PackCard {
            card_id,
            ordinal,
            reps: card.reps,
            payload: card,
        });
    }
    Ok(PackReply {
        pack_id: uuid::Uuid::new_v4().to_string(),
        generated_at: now,
        server_time_ms: now,
        server_revision,
        counts,
        window,
        cards,
    })
}
