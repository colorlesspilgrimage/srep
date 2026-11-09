//! R17 product-semantics + hardening tests.
//!
//! OQ1/OQ2 (upload-time scheduling, arrival-day quota), the undo-tombstone
//! reconciliation signal, and the online-answer write lock. All tests run
//! against the real service functions with real server time (no clock
//! freezing exists in this crate); assertions are relative, never absolute.

mod common;

use anyhow::Result;
use common::{
    app_state, card_reps, now_ms, review_log_count, reviewed_at_for_cards, seed_deck, test_pool,
    Arg,
};
use serde_json::{json, Value};
use srep_study::day_clock::study_window;
use srep_study::service::{
    study_answer, study_next, study_sync, study_undo, study_undo_events, study_verify,
};
use srep_study::types::StudySettings;
use srep_study::validation::{AnswerBody, SyncItem};
use uuid::Uuid;

fn item(
    review_id: Uuid,
    card_id: &str,
    rating: u8,
    reps: u32,
    client_occurred_at: i64,
) -> SyncItem {
    SyncItem {
        review_id,
        card_id: Uuid::parse_str(card_id).expect("seeded card id must be a UUID"),
        rating,
        reps,
        elapsed_ms: 1_000,
        client_occurred_at,
    }
}

fn status(response: &Value, index: usize) -> &str {
    response["results"][index]["status"]
        .as_str()
        .expect("sync result status must be a string")
}

fn log_id(response: &Value, index: usize) -> String {
    response["results"][index]["logId"]
        .as_str()
        .expect("sync result logId must be a string")
        .to_string()
}

fn counts(next: &srep_study::service::NextReply) -> (u32, u32, u32) {
    use srep_study::service::NextReply;
    match next {
        NextReply::Card { counts, .. }
        | NextReply::Wait { counts, .. }
        | NextReply::Done { counts, .. } => (counts.new, counts.learning, counts.review),
    }
}

async fn receipt_count(
    pool: &srep_db::DbPool,
    device_id: &str,
    review_id: Uuid,
    outcome: &str,
) -> i64 {
    let sql = match pool.dialect() {
        "sqlite" => {
            "SELECT COUNT(*) FROM sync_receipts WHERE device_id = ? AND review_id = ? AND outcome = ?"
        }
        "postgres" => {
            "SELECT COUNT(*) FROM sync_receipts WHERE device_id = $1 AND review_id = $2 AND outcome = $3"
        }
        other => panic!("unsupported test dialect: {other}"),
    };
    common::fetch_i64(
        pool,
        sql,
        vec![
            Arg::Text(device_id.to_string()),
            Arg::Text(review_id.to_string()),
            Arg::Text(outcome.to_string()),
        ],
    )
    .await
}

#[tokio::test]
async fn r17_upload_time_scheduling_ignores_client_occurred_at() -> Result<()> {
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let seed = seed_deck(&pool, 2, 20, 200).await;
    let device = Uuid::new_v4().to_string();
    let now = now_ms();
    let day = 86_400_000i64;

    // One review the client claims happened two days ago, one it claims
    // happens two days from now. OQ1: both must be scheduled at upload
    // time (server now), never at the client's claimed time.
    let review_a = Uuid::new_v4();
    let review_b = Uuid::new_v4();
    let before = now_ms();
    let response = study_sync(
        &state,
        &device,
        vec![
            item(review_a, &seed.card_ids[0], 3, 0, now - 2 * day),
            item(review_b, &seed.card_ids[1], 3, 0, now + 2 * day),
        ],
    )
    .await
    .expect("skewed sync must succeed");
    let after = now_ms();
    assert_eq!(status(&response, 0), "accepted");
    assert_eq!(status(&response, 1), "accepted");

    let reviewed = reviewed_at_for_cards(&pool, &seed.card_ids).await;
    assert_eq!(reviewed.len(), 2, "both reviews must be logged");
    for reviewed_at in &reviewed {
        assert!(
            (*reviewed_at >= before) && (*reviewed_at <= after),
            "reviewed_at {reviewed_at} must be server upload time [{before}, {after}]"
        );
    }
    // The +2d-skewed review must not be anywhere near its claimed time.
    assert!(
        reviewed[1] < now + day,
        "skewed-future review must not be scheduled at client time"
    );
    assert!(
        reviewed[0] > now - day,
        "skewed-past review must not be scheduled at client time"
    );

    // Due values are server-derived too: a Good on a new card lands in
    // learning with a short step, not two days out (or two days ago).
    let due_a = common::fetch_i64(
        &pool,
        match pool.dialect() {
            "sqlite" => "SELECT due FROM card WHERE id = ?",
            "postgres" => "SELECT due FROM card WHERE id = $1",
            other => panic!("unsupported test dialect: {other}"),
        },
        vec![Arg::Text(seed.card_ids[0].clone())],
    )
    .await;
    assert!(
        due_a >= before && due_a <= after + 3_600_000,
        "due {due_a} must be a server-derived near-future step"
    );
    Ok(())
}

#[tokio::test]
async fn r17_arrival_day_quota() -> Result<()> {
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let seed = seed_deck(&pool, 20, 20, 200).await;
    let device = Uuid::new_v4().to_string();
    let day = 86_400_000i64;

    let before = study_next(&state, Some(&seed.deck_id))
        .await
        .expect("study_next before must succeed");
    assert_eq!(counts(&before).0, 20, "all 20 new cards must be due");

    // A review the client claims happened two days ago, synced today.
    // OQ2: it counts on its arrival day and consumes today's quota.
    let review = Uuid::new_v4();
    let response = study_sync(
        &state,
        &device,
        vec![item(review, &seed.card_ids[0], 3, 0, now_ms() - 2 * day)],
    )
    .await
    .expect("late review sync must succeed");
    assert_eq!(status(&response, 0), "accepted");

    let after = study_next(&state, Some(&seed.deck_id))
        .await
        .expect("study_next after must succeed");
    assert_eq!(
        counts(&after).0,
        19,
        "the late review must consume one of today's 20 new-card slots"
    );

    // And the log row itself falls in today's study window.
    let reviewed = reviewed_at_for_cards(&pool, &seed.card_ids[..1]).await;
    assert_eq!(reviewed.len(), 1);
    let window = study_window(now_ms(), &StudySettings::default());
    assert!(
        reviewed[0] >= window.start_ms && reviewed[0] < window.end_ms,
        "reviewed_at {} must fall in today's window [{}, {})",
        reviewed[0],
        window.start_ms,
        window.end_ms
    );
    Ok(())
}

#[tokio::test]
async fn r17_rollover_boundary() {
    // The study day starts at the rollover hour (default 04:00 UTC):
    // one millisecond before it belongs to the previous day.
    let settings = StudySettings::default();
    let window = study_window(now_ms(), &settings);
    let just_before = study_window(window.start_ms - 1, &settings);
    assert_eq!(
        just_before.start_ms,
        window.start_ms - 86_400_000,
        "1ms before rollover must start the previous study day"
    );
    let at_rollover = study_window(window.start_ms, &settings);
    assert_eq!(
        at_rollover.start_ms, window.start_ms,
        "at rollover the new study day must start"
    );
    assert_eq!(
        window.end_ms - window.start_ms,
        86_400_000,
        "a study day is exactly 24h"
    );
}

#[tokio::test]
async fn r17_undo_tombstone_replay_safe() -> Result<()> {
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let seed = seed_deck(&pool, 1, 20, 200).await;
    let device = Uuid::new_v4().to_string();

    let review = Uuid::new_v4();
    let response = study_sync(
        &state,
        &device,
        vec![item(review, &seed.card_ids[0], 3, 0, now_ms())],
    )
    .await
    .expect("tombstone test sync must succeed");
    assert_eq!(status(&response, 0), "accepted");
    let synced_log_id = log_id(&response, 0);
    assert_eq!(card_reps(&pool, &seed.card_ids[0]).await, 1);

    // Undo the synced review: the log row goes, the tombstone stays, the
    // receipt survives (a retry must return it, not reapply).
    let undone = study_undo(&state).await.expect("undo must succeed");
    assert_eq!(
        undone["undone"]["reviewId"].as_str(),
        Some(synced_log_id.as_str()),
        "undo must report the synced review's log id"
    );
    assert_eq!(
        review_log_count(&pool, &seed.card_ids).await,
        0,
        "the undone review must leave the log"
    );
    assert_eq!(card_reps(&pool, &seed.card_ids[0]).await, 0);

    let events = study_undo_events(&state, 0)
        .await
        .expect("undo-events must succeed");
    assert_eq!(
        events["undoneLogIds"],
        json!([synced_log_id]),
        "first reconcile must return the tombstone"
    );
    let replay = study_undo_events(&state, 0)
        .await
        .expect("undo-events replay must succeed");
    assert_eq!(
        replay["undoneLogIds"],
        json!([synced_log_id]),
        "replaying the same cursor must return the same tombstone"
    );
    assert_eq!(
        receipt_count(&pool, &device, review, "accepted").await,
        1,
        "the sync receipt must survive the undo"
    );

    // Rebuild still agrees with the (now empty) log: no mismatches.
    let report = study_verify(&state)
        .await
        .expect("verify must succeed");
    assert!(
        report.mismatches.is_empty(),
        "verify after undo must be clean: {:?}",
        report.mismatches
    );
    Ok(())
}

#[tokio::test]
async fn r17_undo_events_since_filters_by_cursor() -> Result<()> {
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let seed = seed_deck(&pool, 2, 20, 200).await;
    let device = Uuid::new_v4().to_string();

    let first = Uuid::new_v4();
    let response = study_sync(
        &state,
        &device,
        vec![item(first, &seed.card_ids[0], 3, 0, now_ms())],
    )
    .await
    .expect("first sync must succeed");
    assert_eq!(status(&response, 0), "accepted");
    let first_log = log_id(&response, 0);

    let second = Uuid::new_v4();
    let response = study_sync(
        &state,
        &device,
        vec![item(second, &seed.card_ids[1], 3, 0, now_ms())],
    )
    .await
    .expect("second sync must succeed");
    assert_eq!(status(&response, 0), "accepted");
    let second_log = log_id(&response, 0);

    // Undo removes the latest review (the second one).
    let undone = study_undo(&state).await.expect("undo must succeed");
    assert_eq!(
        undone["undone"]["reviewId"].as_str(),
        Some(second_log.as_str())
    );

    let events = study_undo_events(&state, 0)
        .await
        .expect("undo-events must succeed");
    assert_eq!(
        events["undoneLogIds"],
        json!([second_log]),
        "only the undone review's tombstone must be returned"
    );
    assert_ne!(first_log, second_log);

    // A cursor past the undo time sees nothing.
    let future = study_undo_events(&state, now_ms() + 60_000)
        .await
        .expect("future-cursor undo-events must succeed");
    assert_eq!(
        future["undoneLogIds"],
        json!([]),
        "a future cursor must return no tombstones"
    );
    Ok(())
}

#[tokio::test]
async fn r17_online_answer_and_sync_share_write_lock() -> Result<()> {
    // The online answer path had the same SQLITE_BUSY_SNAPSHOT collision
    // the R13 merger fixed for sync (answer has no retry loop, so without
    // the shared process-wide mutex concurrent answers fail). 16
    // concurrent answers on distinct cards must all commit.
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let seed = seed_deck(&pool, 16, 20, 200).await;

    let mut handles = Vec::new();
    for card_id in seed.card_ids.clone() {
        let state = state.clone();
        handles.push(tokio::spawn(async move {
            study_answer(
                &state,
                AnswerBody {
                    card_id: Uuid::parse_str(&card_id).expect("seeded card id"),
                    rating: 3,
                    reps: 0,
                    elapsed_ms: 1_000,
                },
            )
            .await
        }));
    }
    let mut failures = 0;
    for handle in handles {
        if handle.await.expect("answer task panicked").is_err() {
            failures += 1;
        }
    }
    assert_eq!(failures, 0, "all 16 concurrent online answers must commit");
    assert_eq!(
        review_log_count(&pool, &seed.card_ids).await,
        16,
        "all 16 answers must be logged exactly once"
    );
    Ok(())
}
