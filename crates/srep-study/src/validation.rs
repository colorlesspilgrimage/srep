//! Request validation (parity: `core/validation.ts`).

use regex::Regex;
use std::sync::OnceLock;
use uuid::Uuid;

use crate::types::Rating;

pub const MAX_ELAPSED_MS: u64 = 3_600_000;
pub const MAX_REPS: u32 = 1_000_000;
pub const MAX_CARDS_PER_MOVE: usize = 500;

pub fn parse_uuid(raw: &str) -> Option<Uuid> {
    Uuid::parse_str(raw).ok()
}

pub fn is_valid_timezone(name: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| Regex::new(r"^[A-Za-z0-9_/+-]{1,64}$").unwrap());
    if !pattern.is_match(name) {
        return false;
    }
    name.parse::<chrono_tz::Tz>().is_ok()
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnswerBody {
    pub card_id: Uuid,
    pub rating: u8,
    pub reps: u32,
    pub elapsed_ms: u64,
}

pub fn parse_answer_body(
    card_id: &str,
    rating: u8,
    reps: u32,
    elapsed_ms: u64,
) -> Option<AnswerBody> {
    if !(1..=4).contains(&rating) || reps > MAX_REPS || elapsed_ms > MAX_ELAPSED_MS {
        return None;
    }
    Some(AnswerBody {
        card_id: parse_uuid(card_id)?,
        rating,
        reps,
        elapsed_ms,
    })
}

pub fn parse_card_ids(ids: &[String]) -> Option<Vec<Uuid>> {
    if ids.is_empty() || ids.len() > MAX_CARDS_PER_MOVE {
        return None;
    }
    ids.iter().map(|id| parse_uuid(id)).collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct SyncItem {
    pub review_id: Uuid,
    pub card_id: Uuid,
    pub rating: Rating,
    pub reps: u32,
    pub elapsed_ms: u64,
    pub client_occurred_at: i64,
}

pub fn parse_sync_body(
    device_id: &str,
    items: &[serde_json::Value],
) -> Option<(Uuid, Vec<SyncItem>)> {
    let device_id = parse_uuid(device_id)?;
    if items.is_empty() || items.len() > 50 {
        return None;
    }

    let mut parsed = Vec::with_capacity(items.len());
    for item in items {
        let review_id = parse_uuid(item.get("reviewId")?.as_str()?)?;
        let card_id = parse_uuid(item.get("cardId")?.as_str()?)?;
        let rating = u8::try_from(item.get("rating")?.as_u64()?).ok()?;
        let reps = u32::try_from(item.get("reps")?.as_u64()?).ok()?;
        let elapsed_ms = item.get("elapsedMs")?.as_u64()?;
        let client_occurred_at = item.get("clientOccurredAt")?.as_i64()?;

        if !(1..=4).contains(&rating)
            || reps > MAX_REPS
            || elapsed_ms > MAX_ELAPSED_MS
            || client_occurred_at < 0
        {
            return None;
        }

        parsed.push(SyncItem {
            review_id,
            card_id,
            rating,
            reps,
            elapsed_ms,
            client_occurred_at,
        });
    }

    Some((device_id, parsed))
}

#[derive(Debug, Clone, PartialEq)]
pub struct StudySettingsInput {
    pub rollover_hour: u8,
    pub timezone: String,
}

pub fn parse_study_settings(rollover_hour: u8, timezone: &str) -> Option<StudySettingsInput> {
    if rollover_hour > 23 || !is_valid_timezone(timezone) {
        return None;
    }
    Some(StudySettingsInput {
        rollover_hour,
        timezone: timezone.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timezone_validation() {
        assert!(is_valid_timezone("UTC"));
        assert!(is_valid_timezone("Europe/Berlin"));
        assert!(!is_valid_timezone(""));
        assert!(!is_valid_timezone(&"A".repeat(65)));
    }
}
