//! Study queue builder (parity: `core/queue-choice.ts`).

use serde::{Deserialize, Serialize};

pub const SHUFFLE_MULTIPLIER: u32 = 2_654_435_761;
pub const SHUFFLE_MODULUS: u64 = 4_294_967_296;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NewOrder {
    Added,
    Random,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeckQuota {
    pub deck_id: String,
    pub new_per_day: u32,
    pub reviews_per_day: u32,
    pub new_order: NewOrder,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HeadCard {
    pub card_id: String,
    pub due: i64,
    pub position: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeckSnapshot {
    pub deck_id: String,
    pub new_done: u32,
    pub review_done: u32,
    pub learning_due_count: u32,
    pub learning_today_count: u32,
    pub learning_head: Option<HeadCard>,
    pub next_learning_due: Option<i64>,
    pub review_due_count: u32,
    pub review_head: Option<HeadCard>,
    pub new_count: u32,
    pub new_head: Option<HeadCard>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum QueueChoice {
    Card {
        card_id: String,
        source: QueueSource,
    },
    Wait {
        until: i64,
    },
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueSource {
    Learning,
    Review,
    New,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct StudyCounts {
    pub new: u32,
    pub learning: u32,
    pub review: u32,
}

pub fn shuffle_key(position: u32) -> u32 {
    position.wrapping_mul(SHUFFLE_MULTIPLIER)
}

pub fn remaining_quota(snapshot: &DeckSnapshot, quota: Option<&DeckQuota>) -> (u32, u32) {
    let new_per_day = quota.map(|q| q.new_per_day).unwrap_or(0);
    let reviews_per_day = quota.map(|q| q.reviews_per_day).unwrap_or(0);
    let new_left = snapshot
        .new_count
        .min(new_per_day.saturating_sub(snapshot.new_done));
    let review_left = snapshot
        .review_due_count
        .min(reviews_per_day.saturating_sub(snapshot.review_done));
    (new_left, review_left)
}

pub fn study_counts(snapshots: &[DeckSnapshot], quotas: &[DeckQuota]) -> StudyCounts {
    let by_deck: std::collections::HashMap<_, _> = quotas.iter().map(|q| (&q.deck_id, q)).collect();
    let mut counts = StudyCounts::default();
    for snapshot in snapshots {
        let quota = by_deck.get(&snapshot.deck_id).copied();
        let (new_left, review_left) = remaining_quota(snapshot, quota);
        counts.new += new_left;
        counts.review += review_left;
        counts.learning += snapshot.learning_today_count;
    }
    counts
}

#[derive(Clone)]
struct RankedCandidate {
    keys: Vec<i64>,
    card_id: String,
}

fn less_than(a: &RankedCandidate, b: &RankedCandidate) -> bool {
    for i in 0..a.keys.len().max(b.keys.len()) {
        let ak = a.keys.get(i).copied().unwrap_or(0);
        let bk = b.keys.get(i).copied().unwrap_or(0);
        if ak != bk {
            return ak < bk;
        }
    }
    a.card_id < b.card_id
}

fn pick_min(candidates: &[RankedCandidate]) -> Option<String> {
    let mut best: Option<&RankedCandidate> = None;
    for candidate in candidates {
        match best {
            None => best = Some(candidate),
            Some(b) if less_than(candidate, b) => best = Some(candidate),
            _ => {}
        }
    }
    best.map(|b| b.card_id.clone())
}

struct DeckState<'a> {
    snapshot: &'a DeckSnapshot,
    quota: Option<&'a DeckQuota>,
    new_left: u32,
    review_left: u32,
}

fn pick_learning(snapshots: &[DeckSnapshot]) -> Option<String> {
    let candidates: Vec<_> = snapshots
        .iter()
        .filter_map(|s| {
            s.learning_head.as_ref().map(|h| RankedCandidate {
                keys: vec![h.due],
                card_id: h.card_id.clone(),
            })
        })
        .collect();
    pick_min(&candidates)
}

fn pick_review(decks: &[DeckState<'_>]) -> Option<String> {
    let candidates: Vec<_> = decks
        .iter()
        .filter_map(|d| {
            if d.review_left > 0 {
                d.snapshot.review_head.as_ref().map(|h| RankedCandidate {
                    keys: vec![h.due, h.position as i64],
                    card_id: h.card_id.clone(),
                })
            } else {
                None
            }
        })
        .collect();
    pick_min(&candidates)
}

fn pick_new(decks: &[DeckState<'_>]) -> Option<String> {
    let candidates: Vec<_> = decks
        .iter()
        .filter_map(|d| {
            let head = d.snapshot.new_head.as_ref()?;
            if d.new_left == 0 {
                return None;
            }
            let order_key = match d.quota.map(|q| q.new_order) {
                Some(NewOrder::Random) => shuffle_key(head.position) as i64,
                _ => head.position as i64,
            };
            Some(RankedCandidate {
                keys: vec![order_key, head.position as i64],
                card_id: head.card_id.clone(),
            })
        })
        .collect();
    pick_min(&candidates)
}

pub fn choose_next(snapshots: &[DeckSnapshot], quotas: &[DeckQuota], now_ms: i64) -> QueueChoice {
    if let Some(card_id) = pick_learning(snapshots) {
        return QueueChoice::Card {
            card_id,
            source: QueueSource::Learning,
        };
    }
    let by_deck: std::collections::HashMap<_, _> = quotas.iter().map(|q| (&q.deck_id, q)).collect();
    let decks: Vec<DeckState<'_>> = snapshots
        .iter()
        .map(|snapshot| {
            let quota = by_deck.get(&snapshot.deck_id).copied();
            let (new_left, review_left) = remaining_quota(snapshot, quota);
            DeckState {
                snapshot,
                quota,
                new_left,
                review_left,
            }
        })
        .collect();

    let sum = |f: fn(&DeckState<'_>) -> u32| -> u32 { decks.iter().map(f).sum() };
    let new_left = sum(|d| d.new_left);
    let reviews_left = sum(|d| d.review_left);
    if new_left == 0 && reviews_left == 0 {
        let waits: Vec<i64> = snapshots
            .iter()
            .filter_map(|s| s.next_learning_due.filter(|&d| d > now_ms))
            .collect();
        return if waits.is_empty() {
            QueueChoice::Done
        } else {
            QueueChoice::Wait {
                until: *waits.iter().min().unwrap(),
            }
        };
    }
    let new_done = sum(|d| d.snapshot.new_done);
    let rev_done = sum(|d| d.snapshot.review_done);
    let take_new = reviews_left == 0
        || (new_left > 0
            && new_done as u64 * (rev_done as u64 + reviews_left as u64)
                <= rev_done as u64 * (new_done as u64 + new_left as u64));
    let card_id = if take_new {
        pick_new(&decks)
    } else {
        pick_review(&decks)
    };
    match card_id {
        None => QueueChoice::Done,
        Some(card_id) => QueueChoice::Card {
            card_id,
            source: if take_new {
                QueueSource::New
            } else {
                QueueSource::Review
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_000_000;

    fn snap(deck_id: &str, patch: impl FnOnce(DeckSnapshot) -> DeckSnapshot) -> DeckSnapshot {
        patch(DeckSnapshot {
            deck_id: deck_id.to_string(),
            new_done: 0,
            review_done: 0,
            learning_due_count: 0,
            learning_today_count: 0,
            learning_head: None,
            next_learning_due: None,
            review_due_count: 0,
            review_head: None,
            new_count: 0,
            new_head: None,
        })
    }

    fn quota(deck_id: &str) -> DeckQuota {
        DeckQuota {
            deck_id: deck_id.to_string(),
            new_per_day: 20,
            reviews_per_day: 200,
            new_order: NewOrder::Added,
        }
    }

    fn head(card_id: &str, due: i64, position: u32) -> HeadCard {
        HeadCard {
            card_id: card_id.to_string(),
            due,
            position,
        }
    }

    #[test]
    fn learning_first() {
        let snapshots = vec![
            snap("a", |mut s| {
                s.learning_head = Some(head("l2", NOW, 0));
                s.new_count = 1;
                s.new_head = Some(head("n", 0, 0));
                s
            }),
            snap("b", |mut s| {
                s.learning_head = Some(head("l1", NOW - 5, 0));
                s.review_due_count = 1;
                s.review_head = Some(head("r", 0, 0));
                s
            }),
        ];
        let quotas = vec![quota("a"), quota("b")];
        assert!(matches!(
            choose_next(&snapshots, &quotas, NOW),
            QueueChoice::Card {
                card_id,
                source: QueueSource::Learning
            } if card_id == "l1"
        ));
    }

    #[test]
    fn shuffle_key_matches_imul() {
        assert_eq!(shuffle_key(0), 0);
        assert_eq!(shuffle_key(1), SHUFFLE_MULTIPLIER);
        let big = shuffle_key(2_000_000);
        assert!(u64::from(big) < SHUFFLE_MODULUS);
    }

    #[test]
    fn study_counts_sums_decks() {
        let snapshots = vec![
            snap("a", |mut s| {
                s.new_count = 10;
                s.review_due_count = 3;
                s.learning_today_count = 2;
                s
            }),
            snap("b", |mut s| {
                s.new_count = 1;
                s.review_due_count = 30;
                s.learning_today_count = 1;
                s
            }),
        ];
        let quotas = vec![
            DeckQuota {
                new_per_day: 4,
                ..quota("a")
            },
            DeckQuota {
                reviews_per_day: 10,
                ..quota("b")
            },
        ];
        assert_eq!(
            study_counts(&snapshots, &quotas),
            StudyCounts {
                new: 5,
                learning: 3,
                review: 13
            }
        );
    }
}
