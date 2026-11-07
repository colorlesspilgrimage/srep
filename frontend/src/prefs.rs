use leptos::prelude::*;
use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::spawn_local;

use crate::api;
use crate::client_js;
use crate::themes::{self, ThemeHandle};

#[derive(Deserialize)]
pub struct ShellPrefsJson {
    pub theme_id: String,
    pub keybinds: serde_json::Value,
}

pub fn take_shell_prefs_from_document() -> Option<ShellPrefsJson> {
    let Some(body) = web_sys::window().and_then(|w| w.document()).and_then(|d| d.body()) else {
        return None;
    };
    let nodes = body.child_nodes();
    for i in 0..nodes.length() {
        let Some(node) = nodes.item(i) else {
            continue;
        };
        if node.node_type() != 8 {
            continue;
        }
        let Some(text) = node.text_content() else {
            continue;
        };
        let Some(json) = text
            .strip_prefix("srep-prefs:")
            .or_else(|| text.trim_start().strip_prefix("srep-prefs:"))
        else {
            continue;
        };
        if let Ok(body) = serde_json::from_str::<ShellPrefsJson>(json.trim()) {
            return Some(body);
        }
    }
    None
}

pub fn apply_shell_prefs_from_document(theme: ThemeHandle, keybinds: KeybindHandle) {
    let Some(body) = web_sys::window().and_then(|w| w.document()).and_then(|d| d.body()) else {
        return;
    };
    let nodes = body.child_nodes();
    for i in 0..nodes.length() {
        let Some(node) = nodes.item(i) else {
            continue;
        };
        if node.node_type() != 8 {
            continue;
        }
        let Some(text) = node.text_content() else {
            continue;
        };
        let Some(json) = text
            .strip_prefix("srep-prefs:")
            .or_else(|| text.trim_start().strip_prefix("srep-prefs:"))
        else {
            continue;
        };
        if let Ok(body) = serde_json::from_str::<ShellPrefsJson>(json.trim()) {
            let id = themes::normalize_theme_id(&body.theme_id).to_string();
            theme.id.set(id);
            keybinds.binds.set(client_js::copy_keybind_map(&client_js::to_js(
                &body.keybinds,
            )));
            return;
        }
    }
}

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
        let binds = self.binds.get();
        client_js::open_hint(&binds)
    }

    pub fn close_hint(&self) -> String {
        let binds = self.binds.get();
        client_js::close_hint(&binds)
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
            keybinds.binds.set(client_js::copy_keybind_map(&client_js::to_js(
                &body.keybinds,
            )));
        }
        if let Ok(body) = api::get_json::<DisplayBody>("/api/settings/display").await {
            display.apply_js(body.display.font_size, body.display.reduced_motion);
        }
    });
}
