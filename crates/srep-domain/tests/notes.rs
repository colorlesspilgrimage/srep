mod common;

use srep_domain::builtin::{BASIC_ID, CLOZE_ID};
use srep_domain::core::validation::{DeckCreateInput, NoteCreateInput, NotePatchInput};
use srep_domain::deps::DomainCtx;
use srep_domain::service::{decks, notes};
use srep_domain::store::DomainStore;

const UNKNOWN: &str = "123e4567-e89b-42d3-a456-426614174000";

#[tokio::test]
async fn create_read_and_render_cloze() {
    let (pool, _dir) = common::test_pool().await;
    let store = DomainStore::new(&pool);
    store.ensure_seeded().await.unwrap();
    let state = common::app_state(&pool, std::path::PathBuf::from("/tmp/media"));
    let ctx = DomainCtx::new(&state);
    let deck = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Main".into(),
            parent_id: None,
            preset_id: None,
            description: None,
        },
    )
    .await
    .unwrap();

    let note = notes::create_note(
        &ctx,
        NoteCreateInput {
            note_type_id: CLOZE_ID.into(),
            deck_id: deck.id.clone(),
            fields: vec![
                "{{c1::Tokyo}} is the capital of {{c2::Japan}}".into(),
                String::new(),
            ],
            tags: vec!["Zoo".into(), "animals".into()],
        },
    )
    .await
    .unwrap();
    assert_eq!(note.tags, vec!["animals", "zoo"]);
    assert_eq!(note.cards.len(), 2);
    assert!(note.cards[0].front.contains("cloze"));

    let again = notes::get_note(&ctx, &note.id).await.unwrap();
    assert_eq!(again.id, note.id);
}

#[tokio::test]
async fn patch_trash_restore_and_errors() {
    let (pool, _dir) = common::test_pool().await;
    let store = DomainStore::new(&pool);
    store.ensure_seeded().await.unwrap();
    let state = common::app_state(&pool, std::path::PathBuf::from("/tmp/media"));
    let ctx = DomainCtx::new(&state);
    let deck = decks::create_deck(
        &ctx,
        DeckCreateInput {
            name: "Main".into(),
            parent_id: None,
            preset_id: None,
            description: None,
        },
    )
    .await
    .unwrap();

    let note = notes::create_note(
        &ctx,
        NoteCreateInput {
            note_type_id: BASIC_ID.into(),
            deck_id: deck.id.clone(),
            fields: vec!["dog".into(), "Hund".into()],
            tags: vec![],
        },
    )
    .await
    .unwrap();

    let edited = notes::update_note(
        &ctx,
        &note.id,
        NotePatchInput {
            fields: Some(vec!["cat".into(), "Katze".into()]),
            tags: None,
            deck_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(edited.cards[0].front, "cat");

    notes::trash_note(&ctx, &note.id).await.unwrap();
    assert!(notes::update_note(
        &ctx,
        &note.id,
        NotePatchInput {
            fields: None,
            tags: Some(vec![]),
            deck_id: None,
        },
    )
    .await
    .is_err());

    let restored = notes::restore_note(&ctx, &note.id, None).await.unwrap();
    assert!(restored.deleted_at.is_none());
    assert!(notes::restore_note(&ctx, &note.id, None).await.is_err());

    let bad_field = notes::create_note(
        &ctx,
        NoteCreateInput {
            note_type_id: BASIC_ID.into(),
            deck_id: deck.id.clone(),
            fields: vec!["only".into()],
            tags: vec![],
        },
    )
    .await;
    assert!(bad_field.is_err());

    let bad_tag = notes::create_note(
        &ctx,
        NoteCreateInput {
            note_type_id: BASIC_ID.into(),
            deck_id: deck.id.clone(),
            fields: vec!["a".into(), "b".into()],
            tags: vec!["a b".into()],
        },
    )
    .await;
    assert!(bad_tag.is_err());

    assert!(notes::get_note(&ctx, UNKNOWN).await.is_err());
}
