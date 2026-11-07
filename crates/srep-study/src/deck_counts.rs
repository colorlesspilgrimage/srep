use anyhow::Result;
use serde_json::json;
use srep_auth::AppState;
use srep_domain::store::DomainStore;

use crate::day_clock::study_window;
use crate::deck_count_rollup::{random_order_deck_ids, rollup_deck_counts, to_rollup_decks};
use crate::store::{StudySnapshotInput, StudyStore};
use crate::study_settings::get_settings_default;

pub async fn get_deck_counts(state: &AppState) -> Result<Vec<crate::deck_count_rollup::DeckCountRecord>> {
    let study = StudyStore::new(&state.db);
    let raw = study.get_study_settings().await?;
    let settings =
        get_settings_default(raw.as_ref()).map_err(|_| anyhow::anyhow!("settings"))?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let window = study_window(now_ms, &settings);
    let domain = DomainStore::new(&state.db);
    domain.ensure_seeded().await?;
    let decks = domain.list_decks().await?;
    let presets = domain.list_presets().await?;
    let rollup_decks = to_rollup_decks(&decks, &presets);
    let snapshots = study
        .read_study_snapshots(StudySnapshotInput {
            deck_ids: rollup_decks.iter().map(|d| d.id.clone()).collect(),
            now_ms,
            window,
            shuffle_deck_ids: random_order_deck_ids(&decks, &presets),
        })
        .await?;
    Ok(rollup_deck_counts(&rollup_decks, &snapshots))
}

pub fn counts_json(records: &[crate::deck_count_rollup::DeckCountRecord]) -> serde_json::Value {
    json!({ "counts": records })
}
