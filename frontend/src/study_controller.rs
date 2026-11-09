#![allow(async_fn_in_trait)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::api::{self, ApiError};

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum NextReply {
    Card {
        card: StudyCard,
        counts: StudyCounts,
        #[serde(rename = "window")]
        _window: serde_json::Value,
    },
    Wait {
        until: f64,
        counts: StudyCounts,
        #[serde(rename = "window")]
        _window: serde_json::Value,
    },
    Done {
        counts: StudyCounts,
        #[serde(rename = "window")]
        _window: serde_json::Value,
    },
}

#[derive(Clone, Debug, Deserialize)]
pub struct StudyCard {
    pub id: String,
    pub note_id: String,
    pub deck_id: Option<String>,
    pub reps: u32,
    pub front: String,
    pub back: String,
    pub previews: HashMap<String, [f64; 2]>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct StudyCounts {
    pub new: u32,
    pub learning: u32,
    pub review: u32,
}

impl NextReply {
    pub fn counts(&self) -> &StudyCounts {
        match self {
            Self::Card { counts, .. } | Self::Wait { counts, .. } | Self::Done { counts, .. } => {
                counts
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnswerRequest {
    card_id: String,
    rating: u8,
    reps: u32,
    elapsed_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CardIdsRequest {
    card_ids: [String; 1],
}

/// R12's offline implementation should sit behind this small scheduling seam.
pub trait StudyController {
    async fn next(&self, deck: Option<String>) -> Result<NextReply, ApiError>;
    async fn answer(
        &self,
        card_id: &str,
        rating: u8,
        reps: u32,
        elapsed_ms: u64,
    ) -> Result<(), ApiError>;
    async fn undo(&self) -> Result<(), ApiError>;
    async fn suspend(&self, card_id: &str) -> Result<(), ApiError>;
    async fn bury(&self, card_id: &str) -> Result<(), ApiError>;
}

#[derive(Clone, Copy, Default)]
pub struct OnlineStudyController;

impl StudyController for OnlineStudyController {
    async fn next(&self, deck: Option<String>) -> Result<NextReply, ApiError> {
        let path = match deck {
            Some(deck) => format!("/api/study/next?deckId={deck}"),
            None => "/api/study/next".to_string(),
        };
        api::get_json(&path).await
    }

    async fn answer(
        &self,
        card_id: &str,
        rating: u8,
        reps: u32,
        elapsed_ms: u64,
    ) -> Result<(), ApiError> {
        let request = AnswerRequest {
            card_id: card_id.to_string(),
            rating,
            reps,
            elapsed_ms,
        };
        match api::post_json_csrf::<serde_json::Value, _>("/api/study/answer", &request).await {
            Ok(_) => Ok(()),
            Err(error) if error.status == 409 => Ok(()),
            Err(error) => Err(error),
        }
    }

    async fn undo(&self) -> Result<(), ApiError> {
        api::post_json_csrf::<serde_json::Value, _>("/api/study/undo", &serde_json::json!({}))
            .await
            .map(|_| ())
    }

    async fn suspend(&self, card_id: &str) -> Result<(), ApiError> {
        self.set_cards("/api/cards/suspend", card_id).await
    }

    async fn bury(&self, card_id: &str) -> Result<(), ApiError> {
        self.set_cards("/api/cards/bury", card_id).await
    }
}

impl OnlineStudyController {
    async fn set_cards(&self, path: &str, card_id: &str) -> Result<(), ApiError> {
        let request = CardIdsRequest {
            card_ids: [card_id.to_string()],
        };
        api::post_json_csrf::<serde_json::Value, _>(path, &request)
            .await
            .map(|_| ())
    }
}
