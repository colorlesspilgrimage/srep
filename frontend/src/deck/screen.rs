use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize)]
pub struct DeckListRow {
    pub id: String,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    pub name: String,
    #[serde(rename = "archivedAt", default)]
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct CountTriple {
    pub new: u32,
    pub learning: u32,
    pub due: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CountRow {
    pub id: String,
    pub subtree: CountTripleJson,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CountTripleJson {
    #[serde(default)]
    pub new: i64,
    #[serde(default)]
    pub learning: i64,
    #[serde(default)]
    pub due: i64,
}

#[derive(Debug, Clone)]
pub struct DeckView {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub subtree: CountTriple,
}

pub fn shown_count(value: i64) -> u32 {
    if value >= 0 { value as u32 } else { 0 }
}

fn copy_counts(value: &CountTripleJson) -> CountTriple {
    CountTriple {
        new: shown_count(value.new),
        learning: shown_count(value.learning),
        due: shown_count(value.due),
    }
}

pub fn join_deck_views(decks: &[DeckListRow], counts: &[CountRow]) -> Vec<DeckView> {
    let by_id: HashMap<_, _> = counts
        .iter()
        .map(|row| (row.id.as_str(), &row.subtree))
        .collect();
    let mut views = Vec::new();
    for deck in decks {
        if deck.archived_at.is_some() {
            continue;
        }
        let subtree = by_id
            .get(deck.id.as_str())
            .map(|c| copy_counts(c))
            .unwrap_or_default();
        views.push(DeckView {
            id: deck.id.clone(),
            parent_id: deck.parent_id.clone(),
            name: deck.name.clone(),
            subtree,
        });
    }
    views
}

pub fn children_by_parent(decks: &[DeckView]) -> HashMap<String, Vec<String>> {
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for deck in decks {
        let Some(parent) = &deck.parent_id else {
            continue;
        };
        children
            .entry(parent.clone())
            .or_default()
            .push(deck.id.clone());
    }
    children
}

pub fn subtree_id_set(decks: &[DeckView], root_id: &str) -> HashSet<String> {
    let children = children_by_parent(decks);
    let mut ids = HashSet::new();
    let mut stack = vec![root_id.to_string()];
    while let Some(id) = stack.pop() {
        if !ids.insert(id.clone()) {
            continue;
        }
        if let Some(kids) = children.get(&id) {
            for kid in kids {
                stack.push(kid.clone());
            }
        }
    }
    ids
}

pub fn move_target_ids(decks: &[DeckView], root_id: &str) -> Vec<String> {
    let blocked = subtree_id_set(decks, root_id);
    decks
        .iter()
        .filter(|d| !blocked.contains(&d.id))
        .map(|d| d.id.clone())
        .collect()
}

pub fn kept_selection(decks: &[DeckView], selected_id: Option<&str>) -> Option<String> {
    if let Some(id) = selected_id {
        if decks.iter().any(|d| d.id == id) {
            return Some(id.to_string());
        }
    }
    decks.first().map(|d| d.id.clone())
}

pub fn expanded_with_parent(expanded: &HashSet<String>, parent_id: Option<&str>) -> HashSet<String> {
    let mut next = expanded.clone();
    if let Some(pid) = parent_id {
        next.insert(pid.to_string());
    }
    next
}

pub fn after_mutation(
    decks: &[DeckView],
    expanded: &HashSet<String>,
    selected_id: Option<&str>,
    parent_id: Option<&str>,
) -> (Option<String>, HashSet<String>) {
    (
        kept_selection(decks, selected_id),
        expanded_with_parent(expanded, parent_id),
    )
}

pub fn deck_row_dom_id(id: &str) -> String {
    format!("deck-row-{id}")
}
