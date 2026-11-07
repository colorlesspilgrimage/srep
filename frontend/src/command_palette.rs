use leptos::html::Button;
use leptos::prelude::*;
use leptos_router::hooks::use_navigate;

use crate::client_js;
use crate::tui::list_state::list_key_index;

pub const APP_COMMANDS: &[&str] = &[
    "Open Decks",
    "Open Study",
    "Open Browse",
    "Open Stats",
    "Open Settings",
    "Open Gallery",
    "Open Security",
];

pub const GALLERY_COMMANDS: &[&str] = &[
    "Show Panes",
    "Show List",
    "Show Form",
    "Show Modal",
    "Show Settings",
];

fn command_target(name: &str) -> Option<&'static str> {
    match name {
        "Open Decks" => Some("/"),
        "Open Study" => Some("/study"),
        "Open Browse" => Some("/browse"),
        "Open Stats" => Some("/stats"),
        "Open Settings" => Some("/settings"),
        "Open Gallery" => Some("/gallery"),
        "Open Security" => Some("/settings?section=security"),
        _ => None,
    }
}

#[component]
pub fn CommandPalette(
    open: RwSignal<bool>,
    on_close: Callback<()>,
    #[prop(optional)] gallery: bool,
    #[prop(optional)] on_run: Option<Callback<String>>,
) -> impl IntoView {
    let filter = RwSignal::new(String::new());
    let picked = RwSignal::new(0usize);
    let navigate = use_navigate();
    let go = navigate.clone();
    let filter_ref = NodeRef::<leptos::html::Input>::new();

    let names = move || {
        let f = filter.get();
        if gallery {
            client_js::gallery_command_names(&f)
        } else {
            client_js::filter_command_names(APP_COMMANDS, &f)
        }
    };

    let row_index = move || {
        let list = names();
        if list.is_empty() {
            0
        } else {
            picked.get().min(list.len() - 1)
        }
    };

    Effect::new(move |_| {
        if open.get() {
            filter.set(String::new());
            picked.set(0);
            if let Some(el) = filter_ref.get() {
                let _ = el.focus();
            }
        }
    });

    Effect::new(move |_| {
        filter.track();
        picked.set(0);
    });

    let close = move || {
        filter.set(String::new());
        picked.set(0);
        on_close.run(());
    };

    let choose = Callback::new(move |index: usize| {
        let list = names();
        let Some(name) = list.get(index).cloned() else {
            return;
        };
        if gallery {
            if let Some(cb) = on_run {
                cb.run(name);
            }
        } else if let Some(path) = command_target(&name) {
            go(path, Default::default());
        }
        close();
    });

    view! {
        <Show when=move || open.get()>
            <div
                class="tui-palette tui-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tui-command-title"
            >
                <h2 id="tui-command-title">"Commands"</h2>
                <label for="tui-command-filter">"Command"</label>
                <input
                    id="tui-command-filter"
                    type="text"
                    maxlength="40"
                    autocomplete="off"
                    node_ref=filter_ref
                    prop:value=move || filter.get()
                    on:input=move |ev| filter.set(event_target_value(&ev))
                    on:keydown=move |ev| {
                        if ev.key() == "Escape" {
                            ev.prevent_default();
                            close();
                            return;
                        }
                        if ev.key() == "Enter" {
                            let list = names();
                            if list.is_empty() {
                                return;
                            }
                            ev.prevent_default();
                            choose.run(row_index());
                        }
                    }
                />
                <div
                    class="tui-list"
                    role="listbox"
                    aria-label="Commands"
                    tabindex="0"
                    on:keydown=move |ev| {
                        let list = names();
                        let count = list.len();
                        if count == 0 {
                            return;
                        }
                        let next = list_key_index(count, row_index(), &ev.key());
                        if let Some(idx) = next {
                            ev.prevent_default();
                            ev.stop_propagation();
                            picked.set(idx);
                        }
                        if ev.key() == "Enter" {
                            ev.prevent_default();
                            ev.stop_propagation();
                            choose.run(row_index());
                        }
                    }
                >
                    <For
                        each=move || {
                            names()
                                .into_iter()
                                .enumerate()
                                .collect::<Vec<(usize, String)>>()
                        }
                        key=|(_, name)| name.clone()
                        children=move |(index, name)| {
                            let is_active = move || row_index() == index;
                            let row_ref = NodeRef::<Button>::new();
                            Effect::new(move |_| {
                                if is_active() {
                                    if let Some(el) = row_ref.get() {
                                        let _ = el.focus();
                                    }
                                }
                            });
                            let choose = choose.clone();
                            view! {
                                <button
                                    type="button"
                                    class="tui-option"
                                    role="option"
                                    node_ref=row_ref
                                    on:click=move |_| {
                                        picked.set(index);
                                        choose.run(index);
                                    }
                                >
                                    {name}
                                </button>
                            }
                        }
                    />
                </div>
                <button type="button" on:click=move |_| close()>"Close"</button>
            </div>
        </Show>
    }
}

pub fn palette_key_action_js(
    ev: &web_sys::KeyboardEvent,
    palette_open: bool,
    modal_open: bool,
    target_is_field: bool,
    binds: &wasm_bindgen::JsValue,
) -> Option<&'static str> {
    let action = client_js::palette_action_js(ev, palette_open, modal_open, target_is_field, binds);
    match action.as_str() {
        "open" => Some("open"),
        "close" => Some("close"),
        _ => None,
    }
}

pub fn palette_key_action(
    ev: &web_sys::KeyboardEvent,
    palette_open: bool,
    modal_open: bool,
    target_is_field: bool,
) -> Option<&'static str> {
    palette_key_action_js(
        ev,
        palette_open,
        modal_open,
        target_is_field,
        &client_js::default_keybinds(),
    )
}

pub fn tab_key_index(length: usize, index: usize, key: &str) -> Option<usize> {
    if length == 0 {
        return None;
    }
    match key {
        "Home" => Some(0),
        "End" => Some(length - 1),
        "ArrowRight" => Some((index + 1).min(length - 1)),
        "ArrowLeft" => Some(index.saturating_sub(1)),
        _ => None,
    }
}
