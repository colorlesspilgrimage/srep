use wasm_bindgen::JsValue;

use super::model::RepositoryError;

pub fn js_to_value(js: &JsValue) -> Result<serde_json::Value, RepositoryError> {
    if js.is_undefined() || js.is_null() {
        return Err(RepositoryError::Serialization(
            "IndexedDB value is undefined or null".to_string(),
        ));
    }

    let json = js_sys::JSON::stringify(js).map_err(|error| {
        RepositoryError::Serialization(format!("Failed to stringify IndexedDB value: {:?}", error))
    })?;

    if json.is_undefined() || json.is_null() {
        return Err(RepositoryError::Serialization(
            "IndexedDB value is not JSON-serializable".to_string(),
        ));
    }

    let json = String::from(json);
    serde_json::from_str(&json).map_err(|error| {
        RepositoryError::Serialization(format!("Failed to parse IndexedDB JSON: {}", error))
    })
}

pub fn value_to_js(value: &serde_json::Value) -> Result<JsValue, RepositoryError> {
    let json = serde_json::to_string(value).map_err(|error| {
        RepositoryError::Serialization(format!("Failed to serialize JSON value: {}", error))
    })?;

    js_sys::JSON::parse(&json).map_err(|error| {
        RepositoryError::Serialization(format!(
            "Failed to convert serialized JSON to a JavaScript value: {:?}",
            error
        ))
    })
}

pub fn js_to_string(js: &JsValue) -> Option<String> {
    js.as_string()
}

pub fn value_to_js_string(value: &serde_json::Value) -> Result<String, RepositoryError> {
    serde_json::to_string(value).map_err(|error| {
        RepositoryError::Serialization(format!("Failed to serialize diagnostic JSON: {}", error))
    })
}
