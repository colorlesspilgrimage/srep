//! Study settings service logic (`study-settings.ts`).

use crate::types::{default_study_settings, StudySettings};
use crate::validation::parse_study_settings;

#[derive(Debug, Clone, PartialEq)]
pub enum SettingsError {
    Corrupt,
}

pub fn parse_stored_settings(json: &serde_json::Value) -> Result<StudySettings, SettingsError> {
    let rollover = json.get("rolloverHour").and_then(|v| v.as_u64());
    let timezone = json.get("timezone").and_then(|v| v.as_str());
    match (rollover, timezone) {
        (Some(h), Some(tz)) => parse_study_settings(h as u8, tz)
            .map(|p| StudySettings {
                rollover_hour: p.rollover_hour,
                timezone: p.timezone,
            })
            .ok_or(SettingsError::Corrupt),
        _ => Err(SettingsError::Corrupt),
    }
}

pub fn get_settings_default(stored: Option<&serde_json::Value>) -> Result<StudySettings, SettingsError> {
    match stored {
        None => Ok(default_study_settings()),
        Some(v) => parse_stored_settings(v),
    }
}
