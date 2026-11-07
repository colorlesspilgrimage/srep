use leptos::prelude::*;
use leptos_router::components::{Route, Router, Routes};
use leptos_router::hooks::use_navigate;
use leptos_router::path;
use wasm_bindgen::prelude::*;

mod api;
mod card_html;
mod client_js;
mod command_palette;
mod prefs;
mod deck;
mod dialog_focus;
mod id_util;
mod study_keys;
mod screens;
mod shell;
mod themes;
mod tui;
mod webauthn_client;

pub use prefs::{DisplayHandle, KeybindHandle, KeyCaptureHandle};
pub use themes::ThemeHandle;

use screens::{
    BrowseScreen, DecksHome, GalleryScreen, LoginScreen, NoteEditScreen, NotesNewScreen,
    SettingsScreen, SetupScreen, StudyScreen,
};
use std::sync::OnceLock;

use shell::{AppShell, AuthShell};

static SHELL_PREFS: OnceLock<prefs::ShellPrefsJson> = OnceLock::new();

#[component]
fn StatsScreen() -> impl IntoView {
    view! {
        <section class="screen-placeholder">
            <h1 class="screen-title">"Stats"</h1>
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
fn GalleryPage() -> impl IntoView {
    view! { <GalleryScreen /> }
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

#[component]
fn SecurityRedirect() -> impl IntoView {
    let navigate = use_navigate();
    Effect::new(move |_| {
        navigate("/settings?section=security", Default::default());
    });
    view! { <main class="tui-dim" aria-busy="true">"Loading…"</main> }
}

#[component]
fn PairRedirect() -> impl IntoView {
    let navigate = use_navigate();
    Effect::new(move |_| {
        navigate("/settings?section=pair-app", Default::default());
    });
    view! { <main class="tui-dim" aria-busy="true">"Loading…"</main> }
}

#[component]
fn NotesNewPage() -> impl IntoView {
    view! {
        <AppShell>
            <NotesNewScreen />
        </AppShell>
    }
}

#[component]
fn NoteDetailPage() -> impl IntoView {
    view! {
        <AppShell>
            <NoteEditScreen />
        </AppShell>
    }
}

#[wasm_bindgen]
pub fn hydrate() {
    console_error_panic_hook::set_once();
    let initial = themes::theme_from_storage();
    themes::apply_body_theme(&initial);
    if let Some(prefs) = prefs::take_shell_prefs_from_document() {
        let _ = SHELL_PREFS.set(prefs);
    }
    mount_to_body(|| view! { <App /> });
}

#[component]
fn App() -> impl IntoView {
    let theme = ThemeHandle::new(themes::theme_from_storage());
    let keybinds = KeybindHandle::new(client_js::copy_keybind_map(&client_js::default_keybinds()));
    let display = DisplayHandle::new();
    let key_capture = KeyCaptureHandle::new();
    let palette_open = RwSignal::new(false);
    let modal_open = RwSignal::new(false);
    let palette_return_focus = RwSignal::new(None::<web_sys::HtmlElement>);
    provide_context(theme);
    provide_context(keybinds);
    provide_context(display);
    provide_context(key_capture);
    provide_context(palette_open);
    provide_context(modal_open);
    provide_context(palette_return_focus);
    if let Some(body) = SHELL_PREFS.get() {
        let id = themes::normalize_theme_id(&body.theme_id).to_string();
        theme.id.set(id);
        keybinds
            .binds
            .set(client_js::copy_keybind_map(&client_js::to_js(&body.keybinds)));
    }
    prefs::load_signed_in_prefs(theme, keybinds, display);

    view! {
        <Router>
            <Routes fallback=NotFound>
                <Route path=path!("/") view=DecksPage />
                <Route path=path!("/study") view=StudyPage />
                <Route path=path!("/browse") view=BrowsePage />
                <Route path=path!("/stats") view=StatsPage />
                <Route path=path!("/settings") view=SettingsPage />
                <Route path=path!("/gallery") view=GalleryPage />
                <Route path=path!("/login") view=LoginPage />
                <Route path=path!("/setup") view=SetupPage />
                <Route path=path!("/security") view=SecurityRedirect />
                <Route path=path!("/pair") view=PairRedirect />
                <Route path=path!("/notes/new") view=NotesNewPage />
                <Route path=path!("/notes/:id") view=NoteDetailPage />
            </Routes>
        </Router>
    }
}
