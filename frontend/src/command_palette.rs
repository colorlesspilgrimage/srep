use leptos::prelude::*;
use leptos_router::hooks::use_navigate;

pub const APP_COMMANDS: &[&str] = &[
    "Open Decks",
    "Open Study",
    "Open Browse",
    "Open Stats",
    "Open Settings",
    "Open Gallery",
    "Open Security",
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
pub fn CommandPalette(open: RwSignal<bool>) -> impl IntoView {
    let filter = RwSignal::new(String::new());
    let navigate = use_navigate();
    let go = navigate.clone();

    let close = move || {
        open.set(false);
        filter.set(String::new());
    };

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
                    prop:value=move || filter.get()
                    on:input=move |ev| filter.set(event_target_value(&ev))
                    on:keydown={
                        let go = go.clone();
                        move |ev| {
                            if ev.key() == "Escape" {
                                ev.prevent_default();
                                close();
                            }
                            if ev.key() == "Enter" {
                                let needle = filter.get().trim().to_lowercase();
                                for name in APP_COMMANDS {
                                    if name.to_lowercase().contains(&needle) {
                                        if let Some(path) = command_target(name) {
                                            go(path, Default::default());
                                        }
                                        close();
                                        break;
                                    }
                                }
                            }
                        }
                    }
                />
                <div role="listbox" aria-label="Commands"></div>
                <button type="button" on:click=move |_| close()>"Close"</button>
            </div>
        </Show>
    }
}

pub fn palette_key_action(
    ev: &web_sys::KeyboardEvent,
    palette_open: bool,
    modal_open: bool,
) -> Option<&'static str> {
    if modal_open && !palette_open {
        return None;
    }
    let key = ev.key();
    let ctrl = ev.ctrl_key() || ev.meta_key();
    if !palette_open && ctrl && key == "k" {
        return Some("open");
    }
    if !palette_open && key == ":" {
        return Some("open");
    }
    if palette_open && key == "Escape" {
        return Some("close");
    }
    None
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
