use leptos::html::Button;
use leptos::prelude::*;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::spawn_local;

use crate::client_js;
use crate::prefs::KeyCaptureHandle;

const PALETTE_OPEN: &str = "palette.open";
const PALETTE_OPEN_COLON: &str = "palette.open-colon";
const PALETTE_CLOSE: &str = "palette.close";

struct KeyRow {
    id: &'static str,
    label: &'static str,
    change: &'static str,
}

const ROWS: &[KeyRow] = &[
    KeyRow {
        id: PALETTE_OPEN,
        label: "Open palette",
        change: "Change Open palette",
    },
    KeyRow {
        id: PALETTE_OPEN_COLON,
        label: "Open palette with colon",
        change: "Change Open palette with colon",
    },
    KeyRow {
        id: PALETTE_CLOSE,
        label: "Close palette",
        change: "Change Close palette",
    },
];

fn map_chord(map: &JsValue, id: &str) -> String {
    js_sys::Reflect::get(map, &JsValue::from_str(id))
        .ok()
        .and_then(|v| v.as_string())
        .unwrap_or_default()
}

#[component]
pub fn KeymapForm(map: RwSignal<JsValue>, on_saved: Callback<JsValue>) -> impl IntoView {
    let capture = expect_context::<KeyCaptureHandle>();
    let capturing = RwSignal::new(None::<&'static str>);
    let status = RwSignal::new(String::new());
    let snapshot = StoredValue::new(JsValue::NULL);
    let cancel_ref = NodeRef::<Button>::new();

    let end_capture = move || {
        capturing.set(None);
        capture.active.set(false);
    };

    Effect::new(move |_| {
        let Some(action) = capturing.get() else {
            return;
        };
        let map = map;
        let capturing = capturing;
        let status = status;
        let snapshot = snapshot;
        let cancel_ref = cancel_ref;
        let capture = capture;
        let window = web_sys::window().expect("window");
        let closure = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
            if capturing.get_untracked().is_none() {
                return;
            }
            let on_cancel = cancel_ref
                .get_untracked()
                .map(|btn| {
                    ev.target().and_then(|t| t.dyn_into::<web_sys::Node>().ok()).map_or(
                        false,
                        |node| node.is_same_node(Some(&btn)),
                    )
                })
                .unwrap_or(false);
            if !on_cancel {
                return;
            }
            let effect = client_js::capture_key_effect(&ev.key());
            if effect == "pass" {
                return;
            }
            if effect == "cancel" {
                ev.prevent_default();
                ev.stop_propagation();
                map.set(snapshot.with_value(|s| s.clone()));
                end_capture();
                status.set(String::new());
                return;
            }
            if let Some(chord) = client_js::chord_from_event(&ev) {
                ev.prevent_default();
                ev.stop_propagation();
                let current = map.get_untracked();
                match client_js::remap_keybind(&current, action, &chord) {
                    Ok(next) => {
                        map.set(next);
                        end_capture();
                        status.set(String::new());
                    }
                    Err(msg) => status.set(msg),
                }
            }
        }) as Box<dyn FnMut(_)>);
        let cb = closure.as_ref().unchecked_ref();
        let _ = window.add_event_listener_with_callback("keydown", cb);
        closure.forget();
    });

    Effect::new(move |_| {
        if let (Some(_), Some(btn)) = (capturing.get(), cancel_ref.get()) {
            let _ = btn.focus();
        }
    });

    let begin = move |action: &'static str| {
        snapshot.set_value(client_js::copy_keybind_map(&map.get_untracked()));
        capturing.set(Some(action));
        capture.active.set(true);
        status.set("Press a key.".to_string());
    };

    view! {
        <div class="tui-keymap">
            {ROWS
                .iter()
                .map(|row| {
                    let id = row.id;
                    let change = row.change;
                    view! {
                        <p>
                            {row.label}
                            " "
                            {move || map_chord(&map.get(), id)}
                        </p>
                        <button type="button" on:click=move |_| begin(id)>
                            {change}
                        </button>
                    }
                })
                .collect_view()}
            <Show when=move || capturing.get().is_some()>
                <button
                    type="button"
                    node_ref=cancel_ref
                    on:click=move |_| {
                        map.set(snapshot.with_value(|s| s.clone()));
                        end_capture();
                        status.set(String::new());
                    }
                >
                    "Cancel change"
                </button>
            </Show>
            <button
                type="button"
                on:click=move |_| {
                    if capturing.get_untracked().is_some() {
                        end_capture();
                    }
                    let current = map.get_untracked();
                    let status = status;
                    let on_saved = on_saved.clone();
                    spawn_local(async move {
                        let v = client_js::keybinds_json_from_js(&current);
                        let ok = crate::api::put_json::<serde_json::Value, serde_json::Value>(
                            "/api/settings/keybinds",
                            &v,
                        )
                        .await
                        .is_ok();
                        if ok {
                            on_saved.run(client_js::copy_keybind_map(&current));
                        }
                        status.set(if ok {
                            "Saved.".to_string()
                        } else {
                            "Could not save the keys.".to_string()
                        });
                    });
                }
            >
                "Save keys"
            </button>
            <Show when=move || !status.get().is_empty()>
                <p role="status" aria-label="Key save status">
                    {move || status.get()}
                </p>
            </Show>
        </div>
    }
}
