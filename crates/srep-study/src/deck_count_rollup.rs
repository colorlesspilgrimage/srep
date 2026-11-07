//! Deck study counts rolled up across deck subtrees (parity: `deck-count-rollup.ts`).

use serde::Serialize;

use crate::queue_choice::{remaining_quota, DeckQuota, DeckSnapshot, NewOrder};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountTriple {
    pub new: u32,
    pub learning: u32,
    pub due: u32,
}

#[derive(Debug, Clone)]
pub struct RollupDeck {
    pub id: String,
    pub parent_id: Option<String>,
    pub new_per_day: u32,
    pub reviews_per_day: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckCountRecord {
    pub id: String,
    pub parent_id: Option<String>,
    pub own: CountTriple,
    pub subtree: CountTriple,
}

fn zero() -> CountTriple {
    CountTriple {
        new: 0,
        learning: 0,
        due: 0,
    }
}

fn add(left: CountTriple, right: CountTriple) -> CountTriple {
    CountTriple {
        new: left.new + right.new,
        learning: left.learning + right.learning,
        due: left.due + right.due,
    }
}

fn own_counts(deck: &RollupDeck, snapshot: Option<&DeckSnapshot>) -> CountTriple {
    let Some(snapshot) = snapshot else {
        return zero();
    };
    let quota = DeckQuota {
        deck_id: deck.id.clone(),
        new_per_day: deck.new_per_day,
        reviews_per_day: deck.reviews_per_day,
        new_order: NewOrder::Added,
    };
    let (new_left, review_left) = remaining_quota(snapshot, Some(&quota));
    CountTriple {
        new: new_left,
        learning: snapshot.learning_today_count,
        due: review_left,
    }
}

fn children_by_parent(decks: &[RollupDeck]) -> std::collections::HashMap<String, Vec<String>> {
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for deck in decks {
        if let Some(ref parent) = deck.parent_id {
            map.entry(parent.clone()).or_default().push(deck.id.clone());
        }
    }
    map
}

fn subtree_of(
    id: &str,
    own: &std::collections::HashMap<String, CountTriple>,
    children: &std::collections::HashMap<String, Vec<String>>,
    memo: &mut std::collections::HashMap<String, CountTriple>,
    seen: &mut std::collections::HashSet<String>,
) -> CountTriple {
    if let Some(cached) = memo.get(id) {
        return *cached;
    }
    if !seen.insert(id.to_string()) {
        return zero();
    }
    let mut total = own.get(id).copied().unwrap_or(zero());
    for child in children.get(id).map(Vec::as_slice).unwrap_or(&[]) {
        total = add(total, subtree_of(child, own, children, memo, seen));
    }
    memo.insert(id.to_string(), total);
    total
}

pub fn rollup_deck_counts(decks: &[RollupDeck], snapshots: &[DeckSnapshot]) -> Vec<DeckCountRecord> {
    let by_snapshot: std::collections::HashMap<_, _> =
        snapshots.iter().map(|s| (s.deck_id.clone(), s)).collect();
    let own: std::collections::HashMap<_, _> = decks
        .iter()
        .map(|d| (d.id.clone(), own_counts(d, by_snapshot.get(&d.id).copied())))
        .collect();
    let children = children_by_parent(decks);
    let mut memo = std::collections::HashMap::new();
    decks
        .iter()
        .map(|deck| DeckCountRecord {
            id: deck.id.clone(),
            parent_id: deck.parent_id.clone(),
            own: own.get(&deck.id).copied().unwrap_or(zero()),
            subtree: subtree_of(&deck.id, &own, &children, &mut memo, &mut std::collections::HashSet::new()),
        })
        .collect()
}

pub fn to_rollup_decks(
    decks: &[srep_domain::types::DeckRow],
    presets: &[srep_domain::types::PresetRow],
) -> Vec<RollupDeck> {
    let by_id: std::collections::HashMap<_, _> = presets.iter().map(|p| (p.id.as_str(), p)).collect();
    decks
        .iter()
        .filter(|d| d.archived_at.is_none())
        .filter_map(|deck| {
            let preset = by_id.get(deck.preset_id.as_str())?;
            Some(RollupDeck {
                id: deck.id.clone(),
                parent_id: deck.parent_id.clone(),
                new_per_day: preset.new_per_day.max(0) as u32,
                reviews_per_day: preset.reviews_per_day.max(0) as u32,
            })
        })
        .collect()
}

pub fn random_order_deck_ids(
    decks: &[srep_domain::types::DeckRow],
    presets: &[srep_domain::types::PresetRow],
) -> Vec<String> {
    let random_ids: std::collections::HashSet<_> = presets
        .iter()
        .filter(|p| p.new_order == "random")
        .map(|p| p.id.as_str())
        .collect();
    decks
        .iter()
        .filter(|d| d.archived_at.is_none() && random_ids.contains(d.preset_id.as_str()))
        .map(|d| d.id.clone())
        .collect()
}
