mod common;

use anyhow::Result;
use common::{app_state, now_ms, seed_deck, test_pool};
use srep_study::service::study_sync;
use srep_study::validation::SyncItem;
use uuid::Uuid;

// Regression test for the CI sync_gate scenario-9 failure (Nov 9, 2026):
// 8 concurrent devices failed twice on CI with `not_accepted` after the
// bounded SQLite-busy retry was exhausted. 32 concurrent devices make the
// contention likely enough to fail without the in-process SQLite write
// serialization in `StudyStore::sync_apply_item`; with it, all are accepted.
#[tokio::test]
async fn sync_many_concurrent_devices_serialize() -> Result<()> {
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let occurred_at = now_ms() - 60_000;
    let n = 32;
    let seed = seed_deck(&pool, n, 20, 200).await;
    let mut tasks = Vec::new();
    for card_id in seed.card_ids.iter().cloned() {
        let task_state = state.clone();
        let device_id = Uuid::new_v4().to_string();
        tasks.push(tokio::spawn(async move {
            study_sync(
                &task_state,
                &device_id,
                vec![SyncItem {
                    review_id: Uuid::new_v4(),
                    card_id: Uuid::parse_str(&card_id).unwrap(),
                    rating: 3,
                    reps: 0,
                    elapsed_ms: 1_000,
                    client_occurred_at: occurred_at,
                }],
            )
            .await
        }));
    }
    let mut not_accepted = 0;
    for (index, task) in tasks.into_iter().enumerate() {
        let response = task
            .await
            .expect("task must join")
            .expect("sync must succeed");
        let status = response["results"][0]["status"].as_str().unwrap_or("?");
        if status != "accepted" {
            not_accepted += 1;
            eprintln!("task {index}: status={status}");
        }
    }
    eprintln!("not_accepted={not_accepted}/{n}");
    assert_eq!(not_accepted, 0, "all concurrent syncs must be accepted");
    Ok(())
}
