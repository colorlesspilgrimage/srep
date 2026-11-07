use leptos::prelude::*;
use leptos_router::components::A;
use leptos_router::hooks::{use_location, use_navigate};
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;

use crate::command_palette::{palette_key_action, tab_key_index, CommandPalette};
use crate::deck::tree_keys::target_is_text_field;
use crate::themes::{self, ThemeHandle};

const NAV: [(&str, &str); 5] = [
    ("/", "Decks"),
    ("/study", "Study"),
    ("/browse", "Browse"),
    ("/stats", "Stats"),
    ("/settings", "Settings"),
];

#[component]
pub fn AppShell(children: Children) -> impl IntoView {
    let theme = expect_context::<ThemeHandle>();
    let location = use_location();
    let navigate = use_navigate();
    let go = navigate.clone();
    let palette_open = RwSignal::new(false);
    let modal_open = RwSignal::new(false);
    let return_focus = RwSignal::new(None::<web_sys::HtmlElement>);
    provide_context(modal_open);
    provide_context(palette_open);

    let close_palette = Callback::new(move |_| {
        palette_open.set(false);
        let el = return_focus.get_untracked();
        return_focus.set(None);
        if let Some(el) = el {
            let _ = el.focus();
        }
    });

    let path = move || location.pathname.get();

    let mode = move || {
        let p = path();
        if p.starts_with("/study") {
            "STUDY"
        } else if p.starts_with("/settings") {
            "SETTINGS"
        } else if p.starts_with("/browse") {
            "BROWSE"
        } else if p.starts_with("/stats") {
            "STATS"
        } else if p.starts_with("/gallery") {
            "GALLERY"
        } else {
            "DECKS"
        }
    };

    let root_class = move || "tui-root app-root".to_string();

    Effect::new(move |_| {
        themes::apply_body_theme(&theme.id.get());
    });

    let nav_active = move |href: &str| {
        let current = path();
        if href == "/" {
            current == "/" || current.is_empty()
        } else {
            current.starts_with(href)
        }
    };

    Effect::new(move |_| {
        let doc = web_sys::window().and_then(|w| w.document());
        if let Some(doc) = doc {
            if let Some(body) = doc.body() {
                let _ = body.class_list().add_1("tui-page");
            }
        }
    });

    Effect::new(move |_| {
            let window = web_sys::window().expect("window");
            let closure = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
                let in_field = ev
                    .target()
                    .map(|t| target_is_text_field(&t))
                    .unwrap_or(false);
                if let Some(action) =
                    palette_key_action(&ev, palette_open.get(), modal_open.get(), in_field)
                {
                    ev.prevent_default();
                    ev.stop_propagation();
                    match action {
                        "open" => {
                            if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
                                if let Some(el) = doc.active_element() {
                                    if let Ok(html) = el.dyn_into::<web_sys::HtmlElement>() {
                                        return_focus.set(Some(html));
                                    }
                                }
                            }
                            palette_open.set(true);
                        }
                        "close" => {
                            palette_open.set(false);
                            let el = return_focus.get_untracked();
                            return_focus.set(None);
                            if let Some(el) = el {
                                let _ = el.focus();
                            }
                        }
                        _ => {}
                    }
                }
            }) as Box<dyn FnMut(_)>);
            let cb = closure.as_ref().unchecked_ref();
            let _ = window.add_event_listener_with_callback("keydown", cb);
            closure.forget();
        });

    view! {
        <div class=root_class>
            <header class="app-topbar">
                <A href="/" attr:class="app-brand">
                    <span class="app-icon" aria-hidden="true">"◆"</span>
                    <span>"srep"</span>
                </A>
                <nav class="app-nav tui-only-desktop" aria-label="Primary">
                    {NAV
                        .into_iter()
                        .map(|(href, label)| {
                            let href = href.to_string();
                            let go = go.clone();
                            let active = {
                                let href = href.clone();
                                move || nav_active(&href)
                            };
                            view! {
                                <button
                                    type="button"
                                    class="app-nav-item"
                                    aria-current=move || active().then_some("page")
                                    on:click=move |_| {
                                        go(&href, Default::default());
                                    }
                                >
                                    {label}
                                </button>
                            }
                        })
                        .collect_view()}
                </nav>
                <div class="app-topbar-tools tui-only-desktop">
                    <A href="/gallery" attr:class="app-tool-link">
                        <span>"Gallery"</span>
                    </A>
                    <A href="/settings?section=security" attr:class="app-tool-link">
                        <span>"Security"</span>
                    </A>
                </div>
            </header>
            <div class="tui-tabbar" role="tablist" aria-label="App sections">
                {NAV
                    .into_iter()
                    .map(|(href, label)| {
                        let href = href.to_string();
                        let go = go.clone();
                        let active = {
                            let href = href.clone();
                            move || nav_active(&href)
                        };
                        view! {
                            <button
                                type="button"
                                class="app-tab"
                                role="tab"
                                aria-selected=active
                                on:click=move |_| {
                                    go(&href, Default::default());
                                }
                                on:keydown=move |ev| {
                                    let tab = ev.current_target().unwrap();
                                    let tab: web_sys::Element = tab.dyn_into().unwrap();
                                    let list = tab
                                        .closest("[role=\"tablist\"]")
                                        .ok()
                                        .flatten()
                                        .unwrap();
                                    let nodes = list.query_selector_all("[role=\"tab\"]").unwrap();
                                    let mut tabs: Vec<web_sys::Element> = Vec::new();
                                    for i in 0..nodes.length() {
                                        if let Some(node) = nodes.item(i) {
                                            if let Ok(el) = node.dyn_into::<web_sys::Element>() {
                                                tabs.push(el);
                                            }
                                        }
                                    }
                                    let current = tabs
                                        .iter()
                                        .position(|t| t.is_same_node(Some(&tab)))
                                        .unwrap_or(0);
                                    let next = tab_key_index(tabs.len(), current, &ev.key());
                                    if let Some(idx) = next {
                                        ev.prevent_default();
                                        if let Some(el) = tabs.get(idx) {
                                            let html: &web_sys::HtmlElement = el.unchecked_ref();
                                            let _ = html.focus();
                                        }
                                    }
                                }
                            >
                                <span>{label}</span>
                            </button>
                        }
                    })
                    .collect_view()}
            </div>
            {children()}
            <CommandPalette open=palette_open on_close=close_palette />
            <footer class="tui-status" role="contentinfo" aria-label="Status line">
                {move || {
                    let m = mode();
                    format!("{m} | Ctrl+K palette | Esc close")
                }}
            </footer>
        </div>
    }
}

#[component]
pub fn AuthShell(children: Children) -> impl IntoView {
    Effect::new(move |_| {
        themes::apply_body_theme(themes::DEFAULT_THEME_ID);
    });
    view! {
        <div class="auth-shell">
            {children()}
        </div>
    }
}
