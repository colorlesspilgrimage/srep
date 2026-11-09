mod common;

use anyhow::Result;
use common::{
    app_state, card_reps, now_ms, review_log_count, reviewed_at_for_cards, seed_card, seed_deck,
    test_pool, Arg,
};
use serde_json::{json, Value};
use srep_study::service::{study_rebuild, study_sync, study_undo, study_verify};
use srep_study::validation::{parse_sync_body, SyncItem};
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
async fn sync_gate() -> Result<()> {
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let occurred_at = now_ms() - 60_000;
    let device_one = Uuid::new_v4().to_string();

    // 1. Happy path.
    let seed = seed_deck(&pool, 2, 20, 200).await;
    let card_a = seed.card_ids[0].clone();
    let card_b = seed.card_ids[1].clone();
    let review_a = Uuid::new_v4();
    let review_b = Uuid::new_v4();
    let before_sync = now_ms();
    let first = study_sync(
        &state,
        &device_one,
        vec![
            item(review_a, &card_a, 3, 0, occurred_at),
            item(review_b, &card_b, 4, 0, occurred_at),
        ],
    )
    .await
    .expect("scenario 1: happy-path sync must succeed");
    let after_sync = now_ms();
    assert_eq!(
        first["results"].as_array().map(Vec::len),
        Some(2),
        "scenario 1: two results"
    );
    assert_eq!(status(&first, 0), "accepted", "scenario 1: card A");
    assert_eq!(status(&first, 1), "accepted", "scenario 1: card B");
    let log_a = log_id(&first, 0);
    let log_b = log_id(&first, 1);
    assert_eq!(
        first["results"][0]["card"]["reps"].as_u64(),
        Some(1),
        "scenario 1: returned card A reps"
    );
    assert_eq!(
        first["results"][1]["card"]["reps"].as_u64(),
        Some(1),
        "scenario 1: returned card B reps"
    );
    assert_eq!(
        review_log_count(&pool, &[card_a.clone(), card_b.clone()]).await,
        2,
        "scenario 1: exactly two review_log rows"
    );
    assert_eq!(card_reps(&pool, &card_a).await, 1, "scenario 1: A reps");
    assert_eq!(card_reps(&pool, &card_b).await, 1, "scenario 1: B reps");
    let first_reviewed_at = reviewed_at_for_cards(&pool, &[card_a.clone(), card_b.clone()]).await;
    assert_eq!(first_reviewed_at.len(), 2, "scenario 1: reviewed_at rows");
    let log_head = first["logHead"]
        .as_i64()
        .expect("scenario 1: logHead must be present");
    assert!(
        first_reviewed_at
            .iter()
            .all(|reviewed_at| log_head >= *reviewed_at),
        "scenario 1: logHead must cover accepted reviews"
    );
    let server_time = first["serverTime"]
        .as_i64()
        .expect("scenario 1: serverTime must be an integer");
    assert!(
        server_time >= before_sync - 1_000 && server_time <= after_sync + 1_000,
        "scenario 1: plausible serverTime"
    );

    // 2. Duplicate retry of the byte-for-byte logical batch.
    let duplicate = study_sync(
        &state,
        &device_one,
        vec![
            item(review_a, &card_a, 3, 0, occurred_at),
            item(review_b, &card_b, 4, 0, occurred_at),
        ],
    )
    .await
    .expect("scenario 2: duplicate retry must succeed");
    assert_eq!(status(&duplicate, 0), "duplicate", "scenario 2: A status");
    assert_eq!(status(&duplicate, 1), "duplicate", "scenario 2: B status");
    assert_eq!(
        duplicate["results"][0]["outcome"].as_str(),
        Some("accepted"),
        "scenario 2: A outcome"
    );
    assert_eq!(
        duplicate["results"][1]["outcome"].as_str(),
        Some("accepted"),
        "scenario 2: B outcome"
    );
    assert_eq!(log_id(&duplicate, 0), log_a, "scenario 2: stable A logId");
    assert_eq!(log_id(&duplicate, 1), log_b, "scenario 2: stable B logId");
    assert_eq!(
        review_log_count(&pool, &[card_a.clone(), card_b.clone()]).await,
        2,
        "scenario 2: duplicate retry must not append reviews"
    );
    assert_eq!(card_reps(&pool, &card_a).await, 1, "scenario 2: A reps");
    assert_eq!(card_reps(&pool, &card_b).await, 1, "scenario 2: B reps");

    // 3. Same receipt key with a different payload.
    let mismatch = study_sync(
        &state,
        &device_one,
        vec![item(review_a, &card_a, 2, 0, occurred_at)],
    )
    .await
    .expect("scenario 3: mismatch response must succeed");
    assert_eq!(
        status(&mismatch, 0),
        "idempotency_mismatch",
        "scenario 3: changed payload"
    );
    assert_eq!(
        review_log_count(&pool, &[card_a.clone(), card_b.clone()]).await,
        2,
        "scenario 3: mismatch must not append a review"
    );

    // 4. A stale item does not prevent later independent items from applying.
    let card_c = seed_card(
        &pool,
        &seed.deck_id,
        &seed.note_id,
        &seed.template_id,
        "new",
        "new",
        0,
        2,
    )
    .await;
    let card_d = seed_card(
        &pool,
        &seed.deck_id,
        &seed.note_id,
        &seed.template_id,
        "new",
        "new",
        0,
        3,
    )
    .await;
    let review_c_stale = Uuid::new_v4();
    let review_a_second = Uuid::new_v4();
    let review_d = Uuid::new_v4();
    let a_d_before = review_log_count(&pool, &[card_a.clone(), card_d.clone()]).await;
    let partial = study_sync(
        &state,
        &device_one,
        vec![
            item(review_c_stale, &card_c, 3, 99, occurred_at),
            item(review_a_second, &card_a, 3, 1, occurred_at),
            item(review_d, &card_d, 3, 0, occurred_at),
        ],
    )
    .await
    .expect("scenario 4: partial batch must succeed");
    assert_eq!(status(&partial, 0), "stale_card", "scenario 4: C stale");
    assert_eq!(status(&partial, 1), "accepted", "scenario 4: A accepted");
    assert_eq!(status(&partial, 2), "accepted", "scenario 4: D accepted");
    assert_eq!(
        partial["results"][0]["card"]["reps"].as_u64(),
        Some(0),
        "scenario 4: stale result carries current card snapshot"
    );
    assert_eq!(
        review_log_count(&pool, &[card_a.clone(), card_d.clone()]).await - a_d_before,
        2,
        "scenario 4: exactly A and D gain review rows"
    );
    assert_eq!(
        review_log_count(&pool, &[card_c.clone()]).await,
        0,
        "scenario 4: stale C gains no review row"
    );
    assert_eq!(
        receipt_count(&pool, &device_one, review_c_stale, "stale_card").await,
        1,
        "scenario 4: stale outcome must be receipted"
    );

    // 5. Only items following a stale result for the same card are blocked.
    let blocked = study_sync(
        &state,
        &device_one,
        vec![
            item(Uuid::new_v4(), &card_c, 3, 99, occurred_at),
            item(Uuid::new_v4(), &card_c, 3, 0, occurred_at),
        ],
    )
    .await
    .expect("scenario 5: blocked batch must succeed");
    assert_eq!(status(&blocked, 0), "stale_card", "scenario 5: first C");
    assert_eq!(status(&blocked, 1), "blocked", "scenario 5: second C");
    assert_eq!(
        review_log_count(&pool, &[card_c.clone()]).await,
        0,
        "scenario 5: stale/blocked C gains no rows"
    );

    // 6. Accepted-then-stale is not blocked.
    let seed_e = seed_deck(&pool, 1, 20, 200).await;
    let card_e = seed_e.card_ids[0].clone();
    let accepted_then_stale = study_sync(
        &state,
        &device_one,
        vec![
            item(Uuid::new_v4(), &card_e, 3, 0, occurred_at),
            item(Uuid::new_v4(), &card_e, 3, 0, occurred_at),
        ],
    )
    .await
    .expect("scenario 6: accepted-then-stale batch must succeed");
    assert_eq!(
        status(&accepted_then_stale, 0),
        "accepted",
        "scenario 6: first E"
    );
    assert_eq!(
        status(&accepted_then_stale, 1),
        "stale_card",
        "scenario 6: second E is stale, not blocked"
    );
    assert_eq!(
        review_log_count(&pool, &[card_e]).await,
        1,
        "scenario 6: only first E applies"
    );

    // 7. Unknown and suspended cards are invalid.
    let invalid_seed = seed_deck(&pool, 1, 20, 200).await;
    let unknown_card = Uuid::new_v4().to_string();
    let suspended_card = seed_card(
        &pool,
        &invalid_seed.deck_id,
        &invalid_seed.note_id,
        &invalid_seed.template_id,
        "suspended",
        "new",
        0,
        1,
    )
    .await;
    let invalid = study_sync(
        &state,
        &device_one,
        vec![
            item(Uuid::new_v4(), &unknown_card, 3, 0, occurred_at),
            item(Uuid::new_v4(), &suspended_card, 3, 0, occurred_at),
        ],
    )
    .await
    .expect("scenario 7: invalid batch must succeed");
    assert_eq!(status(&invalid, 0), "invalid", "scenario 7: unknown status");
    assert_eq!(
        invalid["results"][0]["reason"].as_str(),
        Some("card_not_found"),
        "scenario 7: unknown reason"
    );
    assert_eq!(
        status(&invalid, 1),
        "invalid",
        "scenario 7: suspended status"
    );
    assert_eq!(
        invalid["results"][1]["reason"].as_str(),
        Some("card_not_studyable"),
        "scenario 7: suspended reason"
    );
    assert_eq!(
        review_log_count(&pool, &[unknown_card, suspended_card]).await,
        0,
        "scenario 7: invalid items gain no rows"
    );

    // 8. Quota exhaustion never rejects an uploaded review.
    let quota_seed = seed_deck(&pool, 1, 0, 0).await;
    let card_f = quota_seed.card_ids[0].clone();
    let quota = study_sync(
        &state,
        &device_one,
        vec![item(Uuid::new_v4(), &card_f, 3, 0, occurred_at)],
    )
    .await
    .expect("scenario 8: quota batch must succeed");
    assert_eq!(
        status(&quota, 0),
        "accepted",
        "scenario 8: exhausted quota is ignored"
    );

    // 9. Concurrent devices receive unique, strictly monotonic timestamps.
    let concurrent_seed = seed_deck(&pool, 8, 20, 200).await;
    let mut tasks = Vec::new();
    for card_id in concurrent_seed.card_ids.iter().cloned() {
        let task_state = state.clone();
        let device_id = Uuid::new_v4().to_string();
        tasks.push(tokio::spawn(async move {
            study_sync(
                &task_state,
                &device_id,
                vec![item(Uuid::new_v4(), &card_id, 3, 0, occurred_at)],
            )
            .await
        }));
    }
    for (index, task) in tasks.into_iter().enumerate() {
        let response = task
            .await
            .expect("scenario 9: sync task must join")
            .expect("scenario 9: concurrent sync must succeed");
        assert_eq!(
            status(&response, 0),
            "accepted",
            "scenario 9: concurrent result {index}"
        );
    }
    assert_eq!(
        review_log_count(&pool, &concurrent_seed.card_ids).await,
        8,
        "scenario 9: eight review rows"
    );
    let mut concurrent_times = reviewed_at_for_cards(&pool, &concurrent_seed.card_ids).await;
    concurrent_times.sort_unstable();
    assert_eq!(concurrent_times.len(), 8, "scenario 9: eight timestamps");
    assert!(
        concurrent_times.windows(2).all(|pair| pair[0] < pair[1]),
        "scenario 9: reviewed_at values must be strictly increasing and unique"
    );

    // 10. Undo keeps the receipt, so retry returns the original accepted result.
    let undo_seed = seed_deck(&pool, 1, 20, 200).await;
    let card_g = undo_seed.card_ids[0].clone();
    let undo_device = Uuid::new_v4().to_string();
    let undo_review = Uuid::new_v4();
    let undo_occurred_at = now_ms() - 60_000;
    let accepted_g = study_sync(
        &state,
        &undo_device,
        vec![item(undo_review, &card_g, 3, 0, undo_occurred_at)],
    )
    .await
    .expect("scenario 10: initial G sync must succeed");
    assert_eq!(status(&accepted_g, 0), "accepted", "scenario 10: accept G");
    let log_g = log_id(&accepted_g, 0);
    let undone = study_undo(&state)
        .await
        .expect("scenario 10: undo must succeed");
    assert_eq!(undone["ok"].as_bool(), Some(true), "scenario 10: undo ok");
    assert_eq!(
        undone["undone"]["reviewId"].as_str(),
        Some(log_g.as_str()),
        "scenario 10: global latest review is G"
    );
    assert_eq!(
        undone["undone"]["cardId"].as_str(),
        Some(card_g.as_str()),
        "scenario 10: undone card is G"
    );
    assert_eq!(
        card_reps(&pool, &card_g).await,
        0,
        "scenario 10: G restored"
    );
    assert_eq!(
        review_log_count(&pool, &[card_g.clone()]).await,
        0,
        "scenario 10: undo removes G review"
    );
    let retry_g = study_sync(
        &state,
        &undo_device,
        vec![item(undo_review, &card_g, 3, 0, undo_occurred_at)],
    )
    .await
    .expect("scenario 10: retry after undo must succeed");
    assert_eq!(
        status(&retry_g, 0),
        "duplicate",
        "scenario 10: retry status"
    );
    assert_eq!(
        retry_g["results"][0]["outcome"].as_str(),
        Some("accepted"),
        "scenario 10: retry outcome"
    );
    assert_eq!(log_id(&retry_g, 0), log_g, "scenario 10: retry logId");
    assert_eq!(
        review_log_count(&pool, &[card_g]).await,
        0,
        "scenario 10: retry does not reapply undone review"
    );

    // 11. Verification and rebuild agree that all scenario state is canonical.
    let report = study_verify(&state)
        .await
        .expect("scenario 11: verify must succeed");
    assert!(report.checked > 0, "scenario 11: verify checked cards");
    assert!(
        report.mismatches.is_empty(),
        "scenario 11: verify mismatches: {:?}",
        report.mismatches
    );
    assert!(
        report.chain_mismatches.is_empty(),
        "scenario 11: verify chain mismatches: {:?}",
        report.chain_mismatches
    );
    let rebuilt = study_rebuild(&state)
        .await
        .expect("scenario 11: rebuild must succeed");
    assert_eq!(
        rebuilt["changed"].as_u64(),
        Some(0),
        "scenario 11: rebuild must be a no-op"
    );

    Ok(())
}

fn device_id() -> String {
    Uuid::new_v4().to_string()
}

fn valid_json_item() -> Value {
    json!({
        "reviewId": Uuid::new_v4(),
        "cardId": Uuid::new_v4(),
        "rating": 3,
        "reps": 0,
        "elapsedMs": 1_000,
        "clientOccurredAt": 0
    })
}

fn valid_items(count: usize) -> Vec<Value> {
    (0..count).map(|_| valid_json_item()).collect()
}

#[test]
fn parse_sync_body_accepts_valid_body() {
    assert!(parse_sync_body(&device_id(), &[valid_json_item()]).is_some());
}

#[test]
fn parse_sync_body_rejects_empty_items() {
    assert!(parse_sync_body(&device_id(), &[]).is_none());
}

#[test]
fn parse_sync_body_rejects_51_items() {
    assert!(parse_sync_body(&device_id(), &valid_items(51)).is_none());
}

#[test]
fn parse_sync_body_accepts_exactly_50_items() {
    assert!(parse_sync_body(&device_id(), &valid_items(50)).is_some());
}

#[test]
fn parse_sync_body_rejects_bad_device_uuid() {
    assert!(parse_sync_body("not-a-uuid", &[valid_json_item()]).is_none());
}

#[test]
fn parse_sync_body_rejects_bad_review_id_uuid() {
    let mut value = valid_json_item();
    value["reviewId"] = json!("not-a-uuid");
    assert!(parse_sync_body(&device_id(), &[value]).is_none());
}

#[test]
fn parse_sync_body_rejects_rating_zero() {
    let mut value = valid_json_item();
    value["rating"] = json!(0);
    assert!(parse_sync_body(&device_id(), &[value]).is_none());
}

#[test]
fn parse_sync_body_rejects_rating_five() {
    let mut value = valid_json_item();
    value["rating"] = json!(5);
    assert!(parse_sync_body(&device_id(), &[value]).is_none());
}

#[test]
fn parse_sync_body_rejects_excessive_reps() {
    let mut value = valid_json_item();
    value["reps"] = json!(1_000_001);
    assert!(parse_sync_body(&device_id(), &[value]).is_none());
}

#[test]
fn parse_sync_body_rejects_excessive_elapsed_ms() {
    let mut value = valid_json_item();
    value["elapsedMs"] = json!(3_600_001);
    assert!(parse_sync_body(&device_id(), &[value]).is_none());
}

#[test]
fn parse_sync_body_rejects_negative_client_occurred_at() {
    let mut value = valid_json_item();
    value["clientOccurredAt"] = json!(-1);
    assert!(parse_sync_body(&device_id(), &[value]).is_none());
}

#[test]
fn parse_sync_body_rejects_missing_client_occurred_at() {
    let mut value = valid_json_item();
    value.as_object_mut().unwrap().remove("clientOccurredAt");
    assert!(parse_sync_body(&device_id(), &[value]).is_none());
}
