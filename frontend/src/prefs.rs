use leptos::prelude::*;
use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::spawn_local;

use crate::api;
use crate::client_js;
use crate::themes::{self, ThemeHandle};

#[derive(Clone, Copy)]
pub struct KeybindHandle {
    pub binds: RwSignal<JsValue>,
}

impl KeybindHandle {
    pub fn new(initial: JsValue) -> Self {
        Self {
            binds: RwSignal::new(initial),
        }
    }

    pub fn open_hint(&self) -> String {
        client_js::open_hint(&self.binds.get_untracked())
    }

    pub fn close_hint(&self) -> String {
        client_js::close_hint(&self.binds.get_untracked())
    }
}

#[derive(Clone, Copy)]
pub struct DisplayHandle {
    pub extra_root_class: RwSignal<String>,
}

impl DisplayHandle {
    pub fn new() -> Self {
        Self {
            extra_root_class: RwSignal::new(String::new()),
        }
    }

    pub fn apply_js(&self, font_size: u32, reduced_motion: bool) {
        let class = client_js::display_root_class(font_size, reduced_motion);
        self.extra_root_class.set(class);
    }
}

#[derive(Clone, Copy)]
pub struct KeyCaptureHandle {
    pub active: RwSignal<bool>,
}

impl KeyCaptureHandle {
    pub fn new() -> Self {
        Self {
            active: RwSignal::new(false),
        }
    }
}

#[derive(Deserialize)]
struct KeybindsBody {
    keybinds: serde_json::Value,
}

#[derive(Deserialize)]
struct ThemeBody {
    id: String,
}

#[derive(Deserialize)]
struct DisplayBody {
  display: DisplayPrefsJson,
}

#[derive(Deserialize)]
struct DisplayPrefsJson {
    font_size: u32,
    reduced_motion: bool,
}

pub fn load_signed_in_prefs(theme: ThemeHandle, keybinds: KeybindHandle, display: DisplayHandle) {
    spawn_local(async move {
        let _ = api::get_json::<serde_json::Value>("/api/auth/status").await;
        if let Ok(body) = api::get_json::<ThemeBody>("/api/settings/theme").await {
            let id = themes::normalize_theme_id(&body.id).to_string();
            theme.id.set(id.clone());
            themes::persist_theme(&id);
        }
        if let Ok(body) = api::get_json::<KeybindsBody>("/api/settings/keybinds").await {
            keybinds.binds.set(client_js::to_js(&body.keybinds));
        }
        if let Ok(body) = api::get_json::<DisplayBody>("/api/settings/display").await {
            display.apply_js(body.display.font_size, body.display.reduced_motion);
        }
    });
}
