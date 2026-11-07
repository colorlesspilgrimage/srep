use std::collections::{HashMap, HashSet};

use super::screen::DeckView;
use super::tree_keys::DeckTreeKeyAction;

pub fn visible_deck_rows(decks: &[DeckView], expanded_ids: &HashSet<String>) -> Vec<DeckView> {
    let by_id: HashMap<_, _> = decks.iter().map(|d| (d.id.as_str(), d)).collect();
    decks
        .iter()
        .filter(|deck| ancestors_open(&by_id, deck, expanded_ids))
        .cloned()
        .collect()
}

fn ancestors_open<'a>(
    by_id: &HashMap<&str, &'a DeckView>,
    deck: &'a DeckView,
    expanded_ids: &HashSet<String>,
) -> bool {
    let mut seen = HashSet::from([deck.id.clone()]);
    let mut parent_id = deck.parent_id.as_deref();
    while let Some(pid) = parent_id {
        if seen.contains(pid) {
            return false;
        }
        seen.insert(pid.to_string());
        let Some(parent) = by_id.get(pid) else {
            return true;
        };
        if !expanded_ids.contains(&parent.id) {
            return false;
        }
        parent_id = parent.parent_id.as_deref();
    }
    true
}

pub fn toggle_expanded(expanded_ids: &HashSet<String>, id: &str, has_children: bool) -> HashSet<String> {
    let mut next = expanded_ids.clone();
    if !has_children {
        return next;
    }
    if next.contains(id) {
        next.remove(id);
    } else {
        next.insert(id.to_string());
    }
    next
}

pub fn row_from_move(rows_len: usize, index: usize, key: &str) -> Option<usize> {
    if rows_len == 0 {
        return None;
    }
    match key {
        "Home" => Some(0),
        "End" => Some(rows_len - 1),
        "ArrowDown" | "j" => Some((index + 1).min(rows_len - 1)),
        "ArrowUp" | "k" => Some(index.saturating_sub(1)),
        _ => None,
    }
}

pub fn deck_level(decks: &[DeckView], id: &str) -> u32 {
    let by_id: HashMap<_, _> = decks.iter().map(|d| (d.id.as_str(), d)).collect();
    let mut level = 1u32;
    let mut seen = HashSet::from([id.to_string()]);
    let mut parent_id = by_id.get(id).and_then(|d| d.parent_id.as_deref());
    while let Some(pid) = parent_id {
        if seen.contains(pid) {
            break;
        }
        seen.insert(pid.to_string());
        level += 1;
        parent_id = by_id.get(pid).and_then(|d| d.parent_id.as_deref());
    }
    level
}

#[derive(Debug, Clone)]
pub enum TreeEffect {
    Ignore,
    Prevent,
    FocusName,
    Select {
        id: String,
        expanded_ids: HashSet<String>,
    },
}

pub fn effect_for_tree_key(action: DeckTreeKeyAction, state: TreeKeyState<'_>) -> TreeEffect {
    match action {
        DeckTreeKeyAction::None | DeckTreeKeyAction::Tab { .. } => TreeEffect::Ignore,
        DeckTreeKeyAction::Prevent => TreeEffect::Prevent,
        DeckTreeKeyAction::FocusName => TreeEffect::FocusName,
        DeckTreeKeyAction::Move { key } => {
            let id = moved_id(state.visible, state.index, &key);
            id.map_or(TreeEffect::Ignore, |id| {
                TreeEffect::Select {
                    id,
                    expanded_ids: state.expanded_ids.clone(),
                }
            })
        }
        DeckTreeKeyAction::Expand | DeckTreeKeyAction::Collapse => {
            let expanded_ids = toggle_expanded(&state.expanded_ids, &state.row_id, true);
            TreeEffect::Select {
                id: state.row_id.clone(),
                expanded_ids,
            }
        }
        DeckTreeKeyAction::Child => {
            let child = state
                .decks
                .iter()
                .find(|d| d.parent_id.as_deref() == Some(&state.row_id));
            child.map_or(TreeEffect::Ignore, |child| TreeEffect::Select {
                id: child.id.clone(),
                expanded_ids: state.expanded_ids.clone(),
            })
        }
        DeckTreeKeyAction::Parent => {
            if state.parent_id.is_none() {
                return TreeEffect::Ignore;
            }
            TreeEffect::Select {
                id: state.parent_id.clone().unwrap(),
                expanded_ids: state.expanded_ids.clone(),
            }
        }
    }
}

fn moved_id(visible: &[DeckView], index: usize, key: &str) -> Option<String> {
    let next = row_from_move(visible.len(), index, key)?;
    visible.get(next).map(|r| r.id.clone())
}

pub struct TreeKeyState<'a> {
    pub visible: &'a [DeckView],
    pub index: usize,
    pub expanded_ids: HashSet<String>,
    pub row_id: String,
    pub parent_id: Option<String>,
    pub decks: &'a [DeckView],
}
