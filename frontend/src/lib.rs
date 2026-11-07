use leptos::prelude::*;
use leptos_router::components::{Route, Router, Routes};
use leptos_router::hooks::use_navigate;
use leptos_router::path;
use wasm_bindgen::prelude::*;

mod api;
mod command_palette;
mod deck;
mod dialog_focus;
mod screens;
mod shell;
mod themes;
mod webauthn_client;

pub use themes::ThemeHandle;

use screens::{DecksHome, LoginScreen, SettingsScreen, SetupScreen, StudyScreen};
use shell::{AppShell, AuthShell};

#[component]
fn BrowseScreen() -> impl IntoView {
    view! {
        <section class="screen-placeholder">
            <h1 class="screen-title">"Browse"</h1>
        </section>
    }
}

#[component]
fn StatsScreen() -> impl IntoView {
    view! {
        <section class="screen-placeholder">
            <h1 class="screen-title">"Stats"</h1>
        </section>
    }
}

#[component]
fn GalleryScreen() -> impl IntoView {
    view! {
        <main class="app-screen">
            <h1>"Gallery"</h1>
        </main>
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
    view! {
        <AppShell>
            <GalleryScreen />
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
            <main class="app-screen">
                <h1>"New note"</h1>
            </main>
        </AppShell>
    }
}

#[component]
fn NoteDetailPage() -> impl IntoView {
    view! {
        <AppShell>
            <main class="app-screen">
                <h1>"Note"</h1>
            </main>
        </AppShell>
    }
}

#[wasm_bindgen]
pub fn hydrate() {
    console_error_panic_hook::set_once();
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
