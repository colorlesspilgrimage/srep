use leptos::prelude::*;
use leptos_router::components::{Route, Router, Routes};
use leptos_router::path;
use wasm_bindgen::prelude::*;

mod api;
mod offline_pack;
mod repository;
mod sanitize;
mod screens;
mod service_worker;
mod shell;
mod study_controller;
mod sync;
mod themes;

pub use themes::ThemeHandle;

use screens::{DecksHome, LoginScreen, SettingsScreen, SetupScreen, StudyScreen};
use shell::{AppShell, AuthShell};

#[component]
fn BrowseScreen() -> impl IntoView {
    view! {
        <section class="screen-placeholder">
            <p class="tui-eyebrow">"Browse"</p>
            <h1 class="screen-title">"Browse"</h1>
            <p class="tui-dim">"Grid view port in progress for the Rust WASM client."</p>
        </section>
    }
}

#[component]
fn StatsScreen() -> impl IntoView {
    view! {
        <section class="screen-placeholder">
            <p class="tui-eyebrow">"Stats"</p>
            <h1 class="screen-title">"Stats"</h1>
            <p class="tui-dim">"Charts and retention tables arrive with R7."</p>
        </section>
    }
}

#[component]
fn DecksPage() -> impl IntoView {
    view! {
        <AppShell>
            <DecksHome />
        </AppShell>
    }
}

#[component]
fn StudyPage() -> impl IntoView {
    view! {
        <AppShell>
            <StudyScreen />
        </AppShell>
    }
}

#[component]
fn BrowsePage() -> impl IntoView {
    view! {
        <AppShell>
            <BrowseScreen />
        </AppShell>
    }
}

#[component]
fn StatsPage() -> impl IntoView {
    view! {
        <AppShell>
            <StatsScreen />
        </AppShell>
    }
}

#[component]
fn SettingsPage() -> impl IntoView {
    view! {
        <AppShell>
            <SettingsScreen />
        </AppShell>
    }
}

#[component]
fn LoginPage() -> impl IntoView {
    view! {
        <AuthShell>
            <LoginScreen />
        </AuthShell>
    }
}

#[component]
fn NotFound() -> impl IntoView {
    view! {
        <main class="auth-panel">
            <h1>"Not found"</h1>
            <p class="tui-dim">"No route matches this URL."</p>
        </main>
    }
}

#[component]
fn SetupPage() -> impl IntoView {
    view! {
        <AuthShell>
            <SetupScreen />
        </AuthShell>
    }
}

#[wasm_bindgen]
pub fn hydrate() {
    service_worker::register();
    console_error_panic_hook::set_once();
    repository::test_hook::install_test_handle();
    let initial = themes::theme_from_storage();
    themes::apply_body_theme(&initial);
    mount_to_body(|| view! { <App /> });
}

#[component]
fn App() -> impl IntoView {
    provide_context(ThemeHandle::new(themes::theme_from_storage()));

    view! {
        <Router>
            <Routes fallback=NotFound>
                <Route path=path!("/") view=DecksPage />
                <Route path=path!("/study") view=StudyPage />
                <Route path=path!("/browse") view=BrowsePage />
                <Route path=path!("/stats") view=StatsPage />
                <Route path=path!("/settings") view=SettingsPage />
                <Route path=path!("/login") view=LoginPage />
                <Route path=path!("/setup") view=SetupPage />
            </Routes>
        </Router>
    }
}
