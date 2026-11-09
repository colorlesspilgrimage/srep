mod common;

use common::{app_state, now_ms, seed_deck, test_pool};
use srep_db::DbPool;
use srep_study::{pack, service, validation};

async fn set_state(pool: &DbPool, card_id: &str, state: &str, due: i64) {
    match pool {
        DbPool::Sqlite(p) => {
            sqlx::query("UPDATE card SET state = ?, due = ? WHERE id = ?")
                .bind(state)
                .bind(due)
                .bind(card_id)
                .execute(p)
                .await
                .unwrap();
        }
        DbPool::Postgres(p) => {
            sqlx::query("UPDATE card SET state = $1, due = $2 WHERE id = $3")
                .bind(state)
                .bind(due)
                .bind(card_id)
                .execute(p)
                .await
                .unwrap();
        }
    }
}

#[tokio::test]
async fn pack_gate() {
    let (pool, dir) = test_pool().await;
    let state = app_state(&pool, dir.path().join("media"));
    let now = now_ms();

    // 1. Due learning/review and new cards have full content and snapshot metadata.
    let seeded = seed_deck(&pool, 5, 50, 50).await;
    set_state(&pool, &seeded.card_ids[0], "learning", now - 100).await;
    set_state(&pool, &seeded.card_ids[1], "review", now - 100).await;
    let reply = pack::study_pack(&state, Some(&seeded.deck_id), 50)
        .await
        .unwrap();
    assert_eq!(reply.cards.len(), 5);
    assert_eq!(reply.cards[0].card_id, seeded.card_ids[0]);
    assert!(reply.generated_at > 0);
    assert!(!reply.server_revision.is_empty());
    assert_eq!(reply.generated_at, reply.server_time_ms);
    uuid::Uuid::parse_str(&reply.pack_id).unwrap();
    assert_eq!(reply.counts.new, 3);
    assert_eq!(reply.counts.review, 1);
    assert_eq!(reply.counts.learning, 1);
    let body = serde_json::to_value(&reply).unwrap();
    assert!(body["window"].is_object());
    for (ordinal, card) in reply.cards.iter().enumerate() {
        assert_eq!(card.ordinal, ordinal);
        assert_eq!(card.card_id, card.payload.id);
        assert_eq!(card.reps, card.payload.reps);
        assert!(!card.payload.front.is_empty());
        assert!(!card.payload.back.is_empty());
        assert!(!card.payload.previews.is_null());
    }

    // 2. Limits are bounded, absent means 50, and malformed input is rejected.
    let limited = pack::study_pack(&state, Some(&seeded.deck_id), 2)
        .await
        .unwrap();
    assert!(limited.cards.len() <= 2);
    assert_eq!(validation::parse_pack_limit(None), Some(50));
    assert_eq!(validation::parse_pack_limit(Some("0")), None);
    assert_eq!(validation::parse_pack_limit(Some("999")), None);
    assert!(validation::parse_uuid("not-a-uuid").is_none());

    // 3. A valid but unknown deck is NotFound.
    let unknown = uuid::Uuid::new_v4().to_string();
    let err = pack::study_pack(&state, Some(&unknown), 50)
        .await
        .unwrap_err();
    assert!(matches!(err, service::StudyError::NotFound));

    // 4. The pack agrees with study_next and the seeded added-order queue.
    let ordered = seed_deck(&pool, 4, 50, 50).await;
    let next = service::study_next(&state, Some(&ordered.deck_id))
        .await
        .unwrap();
    if let service::NextReply::Card { card, .. } = next {
        assert_eq!(card.id, ordered.card_ids[0]);
    } else {
        panic!("expected first study card");
    }
    let ordered_pack = pack::study_pack(&state, Some(&ordered.deck_id), 50)
        .await
        .unwrap();
    let ids: Vec<_> = ordered_pack
        .cards
        .iter()
        .map(|card| card.card_id.clone())
        .collect();
    assert_eq!(ids, ordered.card_ids);

    // 5. New and review daily quotas bound the snapshot without reserving it.
    let quota = seed_deck(&pool, 4, 2, 1).await;
    let new_pack = pack::study_pack(&state, Some(&quota.deck_id), 50)
        .await
        .unwrap();
    assert_eq!(new_pack.cards.len(), 2);
    assert!(new_pack.cards.iter().all(|card| card.payload.source == "new"));
    for card_id in &quota.card_ids {
        set_state(&pool, card_id, "review", now - 100).await;
    }
    let review_pack = pack::study_pack(&state, Some(&quota.deck_id), 50)
        .await
        .unwrap();
    assert_eq!(review_pack.cards.len(), 1);
    assert_eq!(review_pack.cards[0].payload.source, "review");

    // 6. An exhausted queue is a successful empty pack with counts and window.
    let empty = seed_deck(&pool, 0, 50, 50).await;
    let empty_pack = pack::study_pack(&state, Some(&empty.deck_id), 50)
        .await
        .unwrap();
    assert!(empty_pack.cards.is_empty());
    assert_eq!(empty_pack.counts, Default::default());
    assert!(serde_json::to_value(&empty_pack).unwrap()["window"].is_object());
}
