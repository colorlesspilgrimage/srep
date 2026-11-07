use leptos::prelude::*;
use leptos_router::components::A;
use leptos_router::hooks::use_location;

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
        } else {
            "DECKS"
        }
    };

    let root_class = move || format!("tui-root app-root {}", themes::theme_class(&theme.id.get()));

    view! {
        <div class=root_class>
            <header class="app-topbar">
                <A href="/">
                    <span class="app-brand">
                        <span class="app-icon" aria-hidden="true">"◆"</span>
                        <span>"srep"</span>
                    </span>
                </A>
                <nav class="app-nav" aria-label="Main">
                    {NAV
                        .into_iter()
                        .map(|(href, label)| {
                            let href = href.to_string();
                            let active = {
                                let href = href.clone();
                                move || {
                                    let current = path();
                                    if href == "/" {
                                        current == "/" || current.is_empty()
                                    } else {
                                        current.starts_with(&href)
                                    }
                                }
                            };
                            view! {
                                <A href=href.clone() attr:class=move || {
                                    if active() {
                                        "app-nav-item is-active".to_string()
                                    } else {
                                        "app-nav-item".to_string()
                                    }
                                }>
                                    {label}
                                </A>
                            }
                        })
                        .collect_view()}
                </nav>
            </header>
            <div class="app-main">{children()}</div>
            <footer class="app-status">
                <span class="tui-eyebrow">{mode}</span>
            </footer>
        </div>
    }
}

#[component]
pub fn AuthShell(children: Children) -> impl IntoView {
    view! {
        <div class="auth-shell">
            {children()}
        </div>
    }
}
