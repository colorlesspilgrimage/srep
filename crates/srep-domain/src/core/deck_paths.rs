use crate::core::validation::validate_deck_name;
use crate::error::{fail, ApiFailure, ApiResult};
use crate::types::DeckRow;

pub const DECK_SEPARATOR: &str = "::";
pub const MAX_DECK_DEPTH: usize = 20;

#[derive(Debug, Default, Clone)]
pub struct DeckPatch {
    pub name: Option<String>,
    pub parent_id: Option<Option<String>>,
    pub preset_id: Option<String>,
    pub description: Option<String>,
}

pub fn path_of(parent: Option<&DeckRow>, name: &str) -> String {
    match parent {
        None => name.to_string(),
        Some(p) => format!("{}{}{}", p.path, DECK_SEPARATOR, name),
    }
}

pub fn depth_of(path: &str) -> usize {
    path.split(DECK_SEPARATOR).count()
}

pub fn subtree_ids(decks: &[DeckRow], root_id: &str) -> Vec<String> {
    let Some(root) = decks.iter().find(|d| d.id == root_id) else {
        return vec![];
    };
    let prefix = format!("{}{}", root.path, DECK_SEPARATOR);
    let mut ids = vec![root.id.clone()];
    for d in decks {
        if d.path.starts_with(&prefix) {
            ids.push(d.id.clone());
        }
    }
    ids
}

pub struct DeckCreatePlan {
    pub parent: Option<DeckRow>,
    pub path: String,
}

pub fn plan_deck_create(
    decks: &[DeckRow],
    name: &str,
    parent_id: Option<&str>,
) -> ApiResult<DeckCreatePlan> {
    let parent: Option<DeckRow> = match parent_id {
        None => None,
        Some(pid) => Some(
            decks
                .iter()
                .find(|d| d.id == pid)
                .cloned()
                .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?,
        ),
    };
    let path = path_of(parent.as_ref(), name);
    if depth_of(&path) > MAX_DECK_DEPTH {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "bad_request"));
    }
    if decks.iter().any(|d| d.path == path) {
        return Err(fail(axum::http::StatusCode::CONFLICT, "deck_name_taken"));
    }
    Ok(DeckCreatePlan { parent, path })
}

struct MovePlan {
    target: DeckRow,
    parent: Option<DeckRow>,
    name: String,
    subtree: Vec<DeckRow>,
}

fn resolve_move(decks: &[DeckRow], id: &str, patch: &DeckPatch) -> Result<MovePlan, ApiFailure> {
    let target = decks
        .iter()
        .find(|d| d.id == id)
        .cloned()
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    let name = match &patch.name {
        None => target.name.clone(),
        Some(raw) => validate_deck_name(raw)
            .ok_or_else(|| fail(axum::http::StatusCode::BAD_REQUEST, "bad_request"))?,
    };
    let ids: std::collections::HashSet<_> = subtree_ids(decks, id).into_iter().collect();
    let parent_id = patch.parent_id.clone().unwrap_or(target.parent_id.clone());
    let parent: Option<DeckRow> = match &parent_id {
        None => None,
        Some(pid) => Some(
            decks
                .iter()
                .find(|d| d.id == *pid)
                .cloned()
                .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?,
        ),
    };
    if let Some(ref p) = parent {
        if ids.contains(&p.id) {
            return Err(fail(axum::http::StatusCode::CONFLICT, "deck_cycle"));
        }
    }
    let subtree: Vec<_> = decks
        .iter()
        .filter(|d| ids.contains(&d.id))
        .cloned()
        .collect();
    Ok(MovePlan {
        target,
        parent,
        name,
        subtree,
    })
}

pub fn plan_deck_update(
    decks: &[DeckRow],
    id: &str,
    patch: &DeckPatch,
) -> Result<Vec<DeckRow>, ApiFailure> {
    let mv = resolve_move(decks, id, patch)?;
    let root_path = path_of(mv.parent.as_ref(), &mv.name);
    let inside: std::collections::HashSet<_> = mv.subtree.iter().map(|d| d.id.clone()).collect();
    let taken: std::collections::HashSet<_> = decks
        .iter()
        .filter(|d| !inside.contains(&d.id))
        .map(|d| d.path.clone())
        .collect();
    let mut updates = Vec::new();
    for deck in &mv.subtree {
        let is_target = deck.id == mv.target.id;
        let path = if is_target {
            root_path.clone()
        } else {
            root_path.clone() + &deck.path[mv.target.path.len()..]
        };
        if depth_of(&path) > MAX_DECK_DEPTH {
            return Err(fail(axum::http::StatusCode::BAD_REQUEST, "bad_request"));
        }
        if taken.contains(&path) {
            return Err(fail(axum::http::StatusCode::CONFLICT, "deck_name_taken"));
        }
        let mut next = deck.clone();
        if is_target {
            next.name = mv.name.clone();
            next.path = path.clone();
            next.parent_id = mv.parent.as_ref().map(|p| p.id.clone());
            if let Some(ref preset_id) = patch.preset_id {
                next.preset_id = preset_id.clone();
            }
            if let Some(ref desc) = patch.description {
                next.description = desc.clone();
            }
        } else {
            next.path = path;
        }
        if next != *deck {
            updates.push(next);
        }
    }
    Ok(updates)
}
