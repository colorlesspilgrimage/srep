use serde::{Deserialize, Serialize};

use crate::store::{SettingsStore, KEY_DISPLAY};

pub const MIN_FONT_SIZE: i32 = 12;
pub const MAX_FONT_SIZE: i32 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPrefs {
    pub font_size: i32,
    pub reduced_motion: bool,
    pub scanline: bool,
    pub cursor_blink: bool,
}

impl Default for DisplayPrefs {
    fn default() -> Self {
        Self {
            font_size: 16,
            reduced_motion: false,
            scanline: false,
            cursor_blink: false,
        }
    }
}

fn valid_display(prefs: &DisplayPrefs) -> bool {
    (MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&prefs.font_size)
}

pub async fn get_display(store: &SettingsStore<'_>) -> Result<DisplayPrefs, &'static str> {
    let stored = store
        .get_json(KEY_DISPLAY)
        .await
        .map_err(|_| "settings_corrupt")?;
    let Some(value) = stored else {
        return Ok(DisplayPrefs::default());
    };
    let prefs: DisplayPrefs = serde_json::from_value(value).map_err(|_| "settings_corrupt")?;
    if !valid_display(&prefs) {
        return Err("settings_corrupt");
    }
    Ok(prefs)
}

pub async fn put_display(
    store: &SettingsStore<'_>,
    prefs: &DisplayPrefs,
) -> Result<DisplayPrefs, &'static str> {
    if !valid_display(prefs) {
        return Err("bad_request");
    }
    store
        .put_json(KEY_DISPLAY, &serde_json::to_value(prefs).unwrap())
        .await
        .map_err(|_| "bad_request")?;
    Ok(prefs.clone())
}
