use std::fmt;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    api,
    repository::{ClientRepository, NewReview, OutboxRecord, PackCardData, PackData, StoredPack},
    study_controller::StudyCard,
};

const STALE_AFTER_MS: i64 = 86_400_000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackResponse {
    pub pack_id: String,
    pub generated_at: i64,
    pub server_time_ms: i64,
    pub server_revision: String,
    pub counts: Value,
    pub window: Value,
    pub cards: Vec<PackCardResponse>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackCardResponse {
    pub card_id: String,
    pub ordinal: u32,
    pub reps: u32,
    pub payload: Value,
}

#[derive(Debug)]
pub enum PackError {
    FetchFailed(String),
    RepositoryUnavailable(String),
    InvalidPayload(String),
}

impl fmt::Display for PackError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FetchFailed(message) => {
                write!(formatter, "Could not fetch offline pack: {message}")
            }
            Self::RepositoryUnavailable(message) => {
                write!(formatter, "Offline repository is unavailable: {message}")
            }
            Self::InvalidPayload(message) => write!(formatter, "Invalid offline pack: {message}"),
        }
    }
}

impl PackResponse {
    fn into_pack_data(self, client_now_ms: i64) -> Result<PackData, PackError> {
        if self.server_revision.trim().is_empty() {
            return Err(PackError::InvalidPayload(
                "serverRevision must not be empty".to_string(),
            ));
        }

        let server_time_offset_ms = self.server_time_ms.saturating_sub(client_now_ms);
        let mut cards = Vec::with_capacity(self.cards.len());
        for (index, card) in self.cards.into_iter().enumerate() {
            let expected_ordinal = u32::try_from(index)
                .map_err(|_| PackError::InvalidPayload("too many pack cards".to_string()))?;
            if card.ordinal != expected_ordinal {
                return Err(PackError::InvalidPayload(format!(
                    "card ordinals must be contiguous from zero (index {index}, ordinal {})",
                    card.ordinal
                )));
            }
            cards.push(PackCardData {
                card_id: card.card_id,
                ordinal: card.ordinal,
                reps: card.reps,
                payload: card.payload,
            });
        }

        Ok(PackData {
            pack_id: self.pack_id,
            server_revision: self.server_revision,
            server_time_ms: self.server_time_ms,
            server_time_offset_ms,
            payload: json!({
                "counts": self.counts,
                "window": self.window,
                "generatedAt": self.generated_at,
            }),
            cards,
        })
    }
}

pub fn study_card_from_payload(payload: &Value) -> Result<StudyCard, PackError> {
    serde_json::from_value(payload.clone()).map_err(|error| {
        PackError::InvalidPayload(format!("Card payload is not a study card: {error}"))
    })
}

pub async fn fetch_and_store_pack(deck: Option<String>) -> Result<String, PackError> {
    let mut path = "/api/study/offline-pack?limit=50".to_string();
    if let Some(deck) = deck {
        path.push_str("&deckId=");
        path.push_str(&deck);
    }

    let response: PackResponse = api::get_json(&path)
        .await
        .map_err(|error| PackError::FetchFailed(error.body))?;
    let client_now_ms = js_sys::Date::now() as i64;
    let pack = response.into_pack_data(client_now_ms)?;
    let pack_id = pack.pack_id.clone();
    let (repository, _) = ClientRepository::open()
        .await
        .map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    let stored = repository.store_pack(pack).await;
    // Close our connection: a lingering connection blocks IndexedDB deletion
    // (the E2E suite wipes the database between tests) and holds the version
    // lock. The stored pack is durable as soon as the transaction commits.
    repository.close();
    stored.map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    Ok(pack_id)
}

pub async fn queue_offline_answer(
    pack_id: &str,
    card: &StudyCard,
    rating: u8,
    elapsed_ms: u64,
) -> Result<OutboxRecord, PackError> {
    let (repository, _) = ClientRepository::open()
        .await
        .map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    let result = repository
        .queue_review(NewReview {
            pack_id: pack_id.to_string(),
            card_id: card.id.clone(),
            rating,
            expected_reps: card.reps,
            elapsed_ms,
            client_occurred_at_ms: js_sys::Date::now() as i64,
        })
        .await;
    repository.close();
    result.map_err(|error| PackError::RepositoryUnavailable(error.to_string()))
}

pub async fn pending_answer_state(pack_id: &str) -> Result<(usize, bool), PackError> {
    let (repository, _) = ClientRepository::open()
        .await
        .map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    let result = repository.pending_outbox().await;
    repository.close();
    let records = result.map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    let pending = records
        .iter()
        .filter(|record| record.pack_id == pack_id)
        .count();
    let can_cancel = records
        .iter()
        .max_by_key(|record| record.seq)
        .is_some_and(|record| record.pack_id == pack_id);
    Ok((pending, can_cancel))
}

pub async fn cancel_latest_answer(pack_id: &str) -> Result<Option<OutboxRecord>, PackError> {
    let (repository, _) = ClientRepository::open()
        .await
        .map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    let result = repository.cancel_latest_unsent(pack_id).await;
    repository.close();
    result.map_err(|error| PackError::RepositoryUnavailable(error.to_string()))
}

pub async fn load_latest_pack() -> Result<Option<StoredPack>, PackError> {
    let (repository, _) = ClientRepository::open()
        .await
        .map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    let packs = repository
        .list_packs()
        .await
        .map_err(|error| PackError::RepositoryUnavailable(error.to_string()))?;
    let newest = packs.into_iter().next();
    let result = match newest {
        Some(record) => repository.get_pack(&record.pack_id).await,
        None => Ok(None),
    };
    // See fetch_and_store_pack: close so a later database wipe is not blocked.
    repository.close();
    result.map_err(|error| PackError::RepositoryUnavailable(error.to_string()))
}

pub fn is_stale(server_time_ms: i64, now_ms: i64) -> bool {
    now_ms.saturating_sub(server_time_ms) >= STALE_AFTER_MS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(server_time_ms: i64) -> PackResponse {
        serde_json::from_value(json!({
            "packId": "pack-1",
            "generatedAt": 1_900,
            "serverTimeMs": server_time_ms,
            "serverRevision": "12",
            "counts": {
                "new": 1,
                "learning": 2,
                "review": 3
            },
            "window": {
                "dayNumber": 1,
                "startMs": 0,
                "endMs": 86_400_000_i64
            },
            "cards": [
                {
                    "cardId": "card-a",
                    "ordinal": 0,
                    "reps": 0,
                    "payload": { "id": "card-a" }
                },
                {
                    "cardId": "card-b",
                    "ordinal": 1,
                    "reps": 7,
                    "payload": { "id": "card-b" }
                }
            ]
        }))
        .expect("valid pack response")
    }

    #[test]
    fn stale_boundary_is_inclusive_and_future_packs_are_fresh() {
        let server_time_ms = 10_000;
        assert!(is_stale(server_time_ms, server_time_ms + STALE_AFTER_MS));
        assert!(!is_stale(
            server_time_ms,
            server_time_ms + STALE_AFTER_MS - 1
        ));
        assert!(!is_stale(server_time_ms, server_time_ms - 1));
    }

    #[test]
    fn pack_response_conversion_preserves_repository_fields() {
        let pack = response(2_000)
            .into_pack_data(1_500)
            .expect("conversion succeeds");

        assert_eq!(pack.pack_id, "pack-1");
        assert_eq!(pack.server_revision, "12");
        assert_eq!(pack.server_time_offset_ms, 500);
        assert_eq!(
            pack.cards
                .iter()
                .map(|card| card.ordinal)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert_eq!(pack.cards[0].reps, 0);
        assert_eq!(pack.cards[1].reps, 7);
        assert_eq!(pack.payload["generatedAt"], json!(1_900));
        assert_eq!(pack.payload["window"]["dayNumber"], json!(1));

        let earlier = response(1_000)
            .into_pack_data(1_500)
            .expect("conversion succeeds");
        assert_eq!(earlier.server_time_offset_ms, -500);
    }

    #[test]
    fn study_card_payload_ignores_additional_server_fields() {
        let payload = json!({
            "id": "card-a",
            "noteId": "note-a",
            "reps": 4,
            "front": "<b>Q</b>",
            "back": "A",
            "state": "review",
            "schedState": "review",
            "previews": {
                "1": [0, 1],
                "2": [0, 10]
            }
        });

        let card = study_card_from_payload(&payload).expect("study card conversion succeeds");
        assert_eq!(card.id, "card-a");
        assert_eq!(card.reps, 4);
        assert_eq!(card.previews.get("2").map(|preview| preview[1]), Some(10.0));
    }

    #[test]
    fn conversion_rejects_noncontiguous_ordinals() {
        let mut response = response(2_000);
        response.cards[1].ordinal = 3;
        let error = response
            .into_pack_data(1_500)
            .expect_err("noncontiguous ordinals must fail");
        assert!(matches!(error, PackError::InvalidPayload(_)));
    }
}
