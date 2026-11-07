use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::store::{SettingsStore, KEY_KEYBINDS};

#[allow(dead_code)]
pub const PALETTE_OPEN: &str = "palette.open";
#[allow(dead_code)]
pub const PALETTE_OPEN_COLON: &str = "palette.open-colon";
#[allow(dead_code)]
pub const PALETTE_CLOSE: &str = "palette.close";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindMap {
    #[serde(rename = "palette.open")]
    pub palette_open: String,
    #[serde(rename = "palette.open-colon")]
    pub palette_open_colon: String,
    #[serde(rename = "palette.close")]
    pub palette_close: String,
}

impl Default for KeybindMap {
    fn default() -> Self {
        Self {
            palette_open: "Ctrl+K".into(),
            palette_open_colon: ":".into(),
            palette_close: "Escape".into(),
        }
    }
}

fn canonical_chord(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 32 {
        return None;
    }
    Some(trimmed.to_string())
}

fn reserved_chord(chord: &str) -> bool {
    const RESERVED: &[&str] = &[
        "D", "F", "H", "J", "L", "N", "O", "P", "Q", "R", "S", "T", "U", "W", "Tab", "0", "1",
        "2", "3", "4", "5", "6", "7", "8", "9",
    ];
    RESERVED.contains(&chord)
}

fn validate_map(map: &KeybindMap) -> bool {
    let chords = [
        canonical_chord(&map.palette_open),
        canonical_chord(&map.palette_open_colon),
        canonical_chord(&map.palette_close),
    ];
    if chords.iter().any(|c| c.is_none()) {
        return false;
    }
    let values: HashSet<_> = chords.into_iter().flatten().collect();
    if values.len() != 3 {
        return false;
    }
    !values.iter().any(|c| reserved_chord(c))
}

pub async fn get_keybinds(store: &SettingsStore<'_>) -> Result<KeybindMap, &'static str> {
    let stored = store
        .get_json(KEY_KEYBINDS)
        .await
        .map_err(|_| "settings_corrupt")?;
    let Some(value) = stored else {
        return Ok(KeybindMap::default());
    };
    let map: KeybindMap = serde_json::from_value(value).map_err(|_| "settings_corrupt")?;
    if !validate_map(&map) {
        return Err("settings_corrupt");
    }
    Ok(map)
}

pub async fn put_keybinds(
    store: &SettingsStore<'_>,
    value: serde_json::Value,
) -> Result<KeybindMap, &'static str> {
    let map: KeybindMap = serde_json::from_value(value).map_err(|_| "bad_request")?;
    if !validate_map(&map) {
        return Err("bad_request");
    }
    store
        .put_json(KEY_KEYBINDS, &serde_json::to_value(&map).unwrap())
        .await
        .map_err(|_| "bad_request")?;
    Ok(map)
}
