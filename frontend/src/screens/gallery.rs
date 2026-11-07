use leptos::html::{Button, Div, Input};
use leptos::prelude::*;
use leptos_router::hooks::{use_location, use_query_map};
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;

use crate::api;
use crate::client_js;
use crate::command_palette::{palette_key_action_js, CommandPalette};
use crate::deck::tree_keys::target_is_text_field;
use crate::prefs::{KeybindHandle, KeyCaptureHandle};
use crate::tui::form_value::{accept_form_value, form_ids_ok, FormValueResult};
use crate::tui::keymap_form::KeymapForm;
use crate::tui::theme_pane::ThemeSettingsPane;
use crate::tui::tui_list::TuiList;
use crate::themes::{self, ThemeHandle};
use wasm_bindgen_futures::spawn_local;

const SECTIONS: &[(&str, &str)] = &[
    ("panes", "Panes"),
    ("list", "List"),
    ("form", "Form"),
    ("modal", "Modal"),
    ("settings", "Settings"),
];

const SAMPLE_ITEMS: &[&str] = &["Alpha", "Beta", "Gamma"];

#[component]
fn GalleryForm(on_submit: Callback<String>) -> impl IntoView {
    let value = RwSignal::new(String::new());
    let error = RwSignal::new(String::new());
    let input_id = "tui-form-gallery-sample";
    let error_id = "tui-form-gallery-sample-error";
    let fields_ok = form_ids_ok("gallery", "sample");
    let submit = move |ev: leptos::ev::SubmitEvent| {
        ev.prevent_default();
        match accept_form_value(&value.get()) {
            FormValueResult::Ok(v) => {
                error.set(String::new());
                on_submit.run(v);
            }
            FormValueResult::Err(msg) => error.set(msg.to_string()),
        }
    };
    view! {
        {fields_ok.then(|| view! {
            <form class="tui-form" method="post" on:submit=submit>
                <label for=input_id>"Value"</label>
                <input
                    id=input_id
                    type="text"
                    name="sample"
                    maxlength="80"
                    autocomplete="off"
                    prop:value=move || value.get()
                    on:input=move |ev| value.set(event_target_value(&ev))
                    aria-invalid=move || (!error.get().is_empty()).then(|| "true")
                    aria-describedby=move || (!error.get().is_empty()).then_some(error_id)
                />
                {move || {
                    (!error.get().is_empty()).then(|| {
                        view! {
                            <p id=error_id role="alert">{error.get()}</p>
                        }
                    })
                }}
                <button type="submit">"Submit"</button>
            </form>
        })}
    }
}

#[component]
fn GalleryModal(
    open: RwSignal<bool>,
    open_button: NodeRef<Button>,
    on_close: Callback<()>,
) -> impl IntoView {
    let modal_ref = NodeRef::<Div>::new();
    Effect::new(move |_| {
        if !open.get() {
            return;
        }
        if let Some(el) = modal_ref.get() {
            let _ = el.focus();
        }
        let window = web_sys::window().expect("window");
        let on_close = on_close.clone();
        let open_button = open_button;
        let closure = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
            if ev.key() == "Escape" {
                ev.prevent_default();
                ev.stop_propagation();
                on_close.run(());
                if let Some(btn) = open_button.get() {
                    let _ = btn.focus();
                }
            }
        }) as Box<dyn FnMut(_)>);
        let cb = closure.as_ref().unchecked_ref();
        let _ = window.add_event_listener_with_callback("keydown", cb);
        closure.forget();
    });
    view! {
        <Show when=move || open.get()>
            <div
                class="tui-modal"
                role="dialog"
                tabindex="-1"
                aria-modal="true"
                aria-labelledby="tui-modal-title"
                node_ref=modal_ref
            >
                <h2 id="tui-modal-title">"Sample modal"</h2>
                <p>"Modal body"</p>
                <button type="button" on:click=move |_| on_close.run(())>"Close"</button>
            </div>
        </Show>
    }
}

#[component]
pub fn GalleryScreen() -> impl IntoView {
    let theme = expect_context::<ThemeHandle>();
    let keybinds = expect_context::<KeybindHandle>();
    let key_capture = expect_context::<KeyCaptureHandle>();
    let draft_keys = RwSignal::new(keybinds.binds.get_untracked());
    let theme_status = RwSignal::new(String::new());
    let theme_pending = RwSignal::new(false);
    let save_serial = RwSignal::new(0u32);
    let query = use_query_map();
    let location = use_location();
    let section = RwSignal::new("panes".to_string());
    let section_index = RwSignal::new(0usize);
    let sample_index = RwSignal::new(0usize);
    let form_value = RwSignal::new(String::new());
    let modal_open = RwSignal::new(false);
    let palette_open = RwSignal::new(false);
    let modal_open_flag = RwSignal::new(false);
    let return_focus = RwSignal::new(None::<web_sys::HtmlElement>);
    let open_modal_button = NodeRef::<Button>::new();

    Effect::new(move |_| {
        modal_open_flag.set(modal_open.get());
    });

    let picked_theme = RwSignal::new(String::new());
    Effect::new(move |_| {
        let q = query.get();
        if let Some(t) = q.get("theme") {
            picked_theme.set(themes::theme_from_query(&t));
        } else if picked_theme.get_untracked().is_empty() {
            picked_theme.set(theme.id.get_untracked());
        }
    });

    let active_theme = move || {
        let id = picked_theme.get();
        themes::normalize_theme_id(&id).to_string()
    };

    let theme_index = move || {
        themes::THEME_IDS
            .iter()
            .position(|id| *id == active_theme().as_str())
            .unwrap_or(0)
    };

    let theme_names: Vec<String> = themes::THEME_IDS
        .iter()
        .map(|id| themes::theme_label(id).to_string())
        .collect();
    let theme_list_index = RwSignal::new(0usize);
    Effect::new(move |_| {
        theme_list_index.set(theme_index());
    });

    Effect::new(move |_| {
        let id = active_theme();
        themes::apply_body_theme(&id);
        theme.id.set(id);
    });

    Effect::new(move |_| {
        if location.pathname.get().starts_with("/gallery") {
            if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
                doc.set_title("srep gallery");
            }
        }
    });

    let close_palette = Callback::new(move |_| {
        palette_open.set(false);
        let el = return_focus.get_untracked();
        return_focus.set(None);
        if let Some(el) = el {
            let _ = el.focus();
        }
    });

    let save_theme = Callback::new(move |_| {
        if theme_pending.get_untracked() {
            return;
        }
        let id = active_theme();
        let serial = save_serial.get_untracked() + 1;
        save_serial.set(serial);
        theme_pending.set(true);
        let theme_status = theme_status;
        let theme = theme;
        spawn_local(async move {
            #[derive(serde::Deserialize, serde::Serialize)]
            struct ThemeBody {
                id: String,
            }
            let saved = match api::put_json::<ThemeBody, ThemeBody>(
                "/api/settings/theme",
                &ThemeBody { id: id.clone() },
            )
                .await
            {
                Ok(body) => body.id == id,
                Err(_) => false,
            };
            if save_serial.get_untracked() == serial {
                theme_status.set(if saved {
                    themes::persist_theme(&id);
                    theme.id.set(id);
                    "Saved.".to_string()
                } else {
                    "Could not save the theme.".to_string()
                });
            }
            theme_pending.set(false);
        });
    });

    let on_keys_saved = Callback::new(move |map: wasm_bindgen::JsValue| {
        keybinds.binds.set(map.clone());
        draft_keys.set(map);
    });

    let run_gallery_command = Callback::new(move |name: String| {
        let section_id = match name.as_str() {
            "Show Panes" => "panes",
            "Show List" => "list",
            "Show Form" => "form",
            "Show Modal" => "modal",
            "Show Settings" => "settings",
            _ => return,
        };
        if let Some(idx) = SECTIONS.iter().position(|(id, _)| *id == section_id) {
            section_index.set(idx);
            section.set(section_id.to_string());
        }
    });

    Effect::new(move |_| {
        let window = web_sys::window().expect("window");
        let closure = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
            if key_capture.active.get_untracked() {
                return;
            }
            let in_field = ev
                .target()
                .map(|t| target_is_text_field(&t))
                .unwrap_or(false);
            let binds = client_js::copy_keybind_map(&keybinds.binds.get_untracked());
            if let Some(action) = palette_key_action_js(
                &ev,
                palette_open.get(),
                modal_open_flag.get(),
                in_field,
                &binds,
            ) {
                ev.prevent_default();
                ev.stop_propagation();
                match action {
                    "open" => {
                        if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
                            if let Some(active) = doc.active_element() {
                                if let Ok(html) = active.dyn_into::<web_sys::HtmlElement>() {
                                    return_focus.set(Some(html));
                                }
                            }
                        }
                        palette_open.set(true);
                    }
                    "close" => close_palette.run(()),
                    _ => {}
                }
            }
        }) as Box<dyn FnMut(_)>);
        let cb = closure.as_ref().unchecked_ref();
        let _ = window.add_event_listener_with_callback_and_bool("keydown", cb, true);
        closure.forget();
    });

    let choose_section = move |index: usize| {
        section_index.set(index);
        if let Some((id, _)) = SECTIONS.get(index) {
            section.set(id.to_string());
        }
    };

    let choose_theme = Callback::new(move |index: usize| {
        if let Some(id) = themes::THEME_IDS.get(index) {
            if id.to_string() != active_theme() {
                save_serial.update(|s| *s += 1);
                theme_status.set(String::new());
            }
            picked_theme.set(id.to_string());
        }
    });

    let close_modal = Callback::new(move |_| {
        modal_open.set(false);
        if let Some(btn) = open_modal_button.get() {
            let _ = btn.focus();
        }
    });

    let section_labels: Vec<String> = SECTIONS.iter().map(|(_, l)| (*l).to_string()).collect();
    let sample_items: Vec<String> = SAMPLE_ITEMS.iter().map(|s| (*s).to_string()).collect();

    let root_class = move || format!("tui-root {}", themes::theme_class(&active_theme()));

    view! {
        <div class=root_class>
            <main class="app-screen">
                <header class="app-page-header">
                    <p class="tui-eyebrow">"UI kit"</p>
                    <h1>"Gallery"</h1>
                    <p class="app-lead">"Specimen panes, lists, forms, and themes for the product chrome."</p>
                </header>
                <div class="tui-tabbar" role="tablist" aria-label="Gallery sections">
                    {SECTIONS
                        .iter()
                        .enumerate()
                        .map(|(index, (id, label))| {
                            let id = *id;
                            let selected = move || section.get() == id.to_string();
                            view! {
                                <button
                                    type="button"
                                    role="tab"
                                    id=format!("tui-tab-{id}")
                                    attr:aria-controls=format!("tui-panel-{id}")
                                    aria-selected=selected
                                    on:click=move |_| choose_section(index)
                                >
                                    {*label}
                                </button>
                            }
                        })
                        .collect_view()}
                </div>
                <div class="tui-layout">
                    <div class="tui-side tui-only-desktop">
                        <TuiList
                            label="Specimens"
                            items=section_labels.clone()
                            selected_index=section_index
                            on_select=Callback::new(move |i| choose_section(i))
                        />
                    </div>
                    <div class="tui-main">
                        <div
                            id="tui-panel-panes"
                            role="tabpanel"
                            attr:aria-labelledby="tui-tab-panes"
                            hidden=move || section.get().as_str() != "panes"
                        >
                            <section aria-label="Sample pane">
                                <div class="tui-frame" role="group">
                                    <p class="tui-frame-title">"Pane"</p>
                                    <div class="tui-frame-slot">"Pane body"</div>
                                </div>
                            </section>
                            <TuiList
                                label="Themes"
                                items=theme_names.clone()
                                selected_index=theme_list_index
                                on_select=choose_theme.clone()
                            />
                        </div>
                        <div
                            id="tui-panel-list"
                            role="tabpanel"
                            attr:aria-labelledby="tui-tab-list"
                            hidden=move || section.get().as_str() != "list"
                        >
                            <TuiList
                                label="Sample list"
                                items=sample_items.clone()
                                selected_index=sample_index
                            />
                        </div>
                        <div
                            id="tui-panel-form"
                            role="tabpanel"
                            attr:aria-labelledby="tui-tab-form"
                            hidden=move || section.get().as_str() != "form"
                        >
                            <GalleryForm on_submit=Callback::new(move |v| form_value.set(v)) />
                            <p>"Value: " {move || form_value.get()}</p>
                        </div>
                        <div
                            id="tui-panel-modal"
                            role="tabpanel"
                            attr:aria-labelledby="tui-tab-modal"
                            hidden=move || section.get().as_str() != "modal"
                        >
                            <button
                                type="button"
                                id="tui-open-modal"
                                node_ref=open_modal_button
                                on:click=move |_| modal_open.set(true)
                            >
                                "Open modal"
                            </button>
                            <GalleryModal open=modal_open open_button=open_modal_button on_close=close_modal />
                        </div>
                        <div
                            id="tui-panel-settings"
                            role="tabpanel"
                            attr:aria-labelledby="tui-tab-settings"
                            hidden=move || section.get().as_str() != "settings"
                        >
                            <ThemeSettingsPane
                                theme_names=theme_names.clone()
                                selected_index=theme_list_index
                                on_select=choose_theme
                                on_save=save_theme
                                save_pending=theme_pending
                                status_text=theme_status
                            />
                            <KeymapForm map=draft_keys on_saved=on_keys_saved />
                        </div>
                    </div>
                </div>
            </main>
            <CommandPalette
                open=palette_open
                on_close=close_palette
                gallery=true
                on_run=run_gallery_command
            />
            <footer class="tui-status" role="contentinfo" aria-label="Status line">
                {move || {
                    let open = keybinds.open_hint();
                    let close = keybinds.close_hint();
                    let name = themes::theme_label(&active_theme());
                    format!("GALLERY | {open} | {close} | {name}")
                }}
            </footer>
        </div>
    }
}
