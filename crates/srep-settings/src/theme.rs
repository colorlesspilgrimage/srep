use serde::{Deserialize, Serialize};

use crate::store::{SettingsStore, KEY_THEME};

pub const DEFAULT_THEME_ID: &str = "xai-dark";
pub const THEME_IDS: &[&str] = &["xai-dark", "xai-light", "high-contrast"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeSettings {
    pub id: String,
}

pub fn valid_theme(id: &str) -> Option<&'static str> {
    THEME_IDS.iter().copied().find(|t| *t == id)
}

pub fn migrate_theme_id(id: &str) -> &str {
    match id {
        "xai" => DEFAULT_THEME_ID,
        other => valid_theme(other).unwrap_or(DEFAULT_THEME_ID),
    }
}

pub async fn get_theme(store: &SettingsStore<'_>) -> Result<String, &'static str> {
    let stored = store.get_json(KEY_THEME).await.map_err(|_| "settings_corrupt")?;
    let Some(value) = stored else {
        return Ok(DEFAULT_THEME_ID.to_string());
    };
    let parsed: ThemeSettings = serde_json::from_value(value).map_err(|_| "settings_corrupt")?;
    let id = migrate_theme_id(&parsed.id);
    if valid_theme(id).is_none() {
        return Err("settings_corrupt");
    }
    Ok(id.to_string())
}

pub async fn put_theme(store: &SettingsStore<'_>, id: &str) -> Result<String, &'static str> {
    if valid_theme(id).is_none() {
        return Err("bad_request");
    }
    let body = serde_json::json!({ "id": id });
    store.put_json(KEY_THEME, &body).await.map_err(|_| "bad_request")?;
    Ok(id.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ThemeResponse {
    pub id: String,
}
