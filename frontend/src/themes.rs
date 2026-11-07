use leptos::prelude::*;

pub const DEFAULT_THEME_ID: &str = "xai-dark";
pub const STORAGE_KEY: &str = "srep-theme";

pub const THEME_IDS: &[&str] = &["xai-dark", "xai-light", "high-contrast"];

pub fn theme_class(id: &str) -> String {
    format!("tui-theme-{id}")
}

pub fn theme_label(id: &str) -> &'static str {
    match id {
        "xai-light" => "xAI Light",
        "high-contrast" => "High Contrast",
        _ => "xAI Dark",
    }
}

pub fn normalize_theme_id(id: &str) -> &str {
    if THEME_IDS.contains(&id) {
        id
    } else {
        DEFAULT_THEME_ID
    }
}

pub fn theme_from_storage() -> String {
    web_sys::window()
        .and_then(|w| w.local_storage().ok().flatten())
        .and_then(|s| s.get_item(STORAGE_KEY).ok().flatten())
        .map(|id| normalize_theme_id(&id).to_string())
        .unwrap_or_else(|| DEFAULT_THEME_ID.to_string())
}

pub fn persist_theme(id: &str) {
    if let Some(storage) = web_sys::window().and_then(|w| w.local_storage().ok().flatten()) {
        let _ = storage.set_item(STORAGE_KEY, id);
    }
}

#[derive(Clone, Copy)]
pub struct ThemeHandle {
    pub id: RwSignal<String>,
}

impl ThemeHandle {
    pub fn new(initial: String) -> Self {
        Self {
            id: RwSignal::new(initial),
        }
    }

    pub fn set(&self, id: &str) {
        self.id.set(id.to_string());
    }
}

pub fn apply_body_theme(id: &str) {
    let class = theme_class(id);
    if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
        if let Some(body) = doc.body() {
            let _ = body.class_list().remove_1("tui-page");
            let _ = body.class_list().add_1("tui-page");
            for tid in THEME_IDS {
                let _ = body.class_list().remove_1(&theme_class(tid));
            }
            let _ = body.class_list().add_1(&class);
        }
    }
}
