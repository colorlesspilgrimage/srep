use js_sys::Reflect;
use leptos::prelude::*;
use leptos_router::components::{Route, Router, Routes};
use leptos_router::hooks::use_navigate;
use leptos_router::path;
use leptos::mount::mount_to_body;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

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

use crate::command_palette::palette_key_action_js;
use crate::deck::tree_keys::target_is_text_field;
use shell::{AppShell, AuthShell};

static SHELL_PREFS: OnceLock<prefs::ShellPrefsJson> = OnceLock::new();
static PALETTE_OPEN: OnceLock<RwSignal<bool>> = OnceLock::new();

pub fn palette_open_signal() -> Option<RwSignal<bool>> {
    PALETTE_OPEN.get().copied()
}
static KEYBIND_HANDLE: OnceLock<KeybindHandle> = OnceLock::new();

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
pub fn palette_set_open(open: bool) {
    if let Some(sig) = PALETTE_OPEN.get() {
        sig.set(open);
    }
}

#[wasm_bindgen]
pub fn gallery_palette_set_open(open: bool) {
    screens::gallery::gallery_palette_set_open(open);
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
    let _ = KEYBIND_HANDLE.get_or_init(|| keybinds);
    let display = DisplayHandle::new();
    let key_capture = KeyCaptureHandle::new();
    let palette_open = RwSignal::new(false);
    let _ = PALETTE_OPEN.get_or_init(|| palette_open);
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
    prefs::apply_shell_prefs_from_document(theme, keybinds);
    prefs::load_signed_in_prefs(theme, keybinds, display);

    let close_palette = Callback::new(move |_| {
        palette_open.set(false);
        let el = palette_return_focus.get_untracked();
        palette_return_focus.set(None);
        if let Some(el) = el {
            let _ = el.focus();
        }
    });
    Effect::new(move |_| {
        let window = web_sys::window().expect("window");
        let closure = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
            let path = web_sys::window()
                .and_then(|w| w.location().pathname().ok())
                .unwrap_or_default();
            if path.starts_with("/gallery") {
                return;
            }
            if key_capture.active.get_untracked() {
                return;
            }
            let in_field = ev
                .target()
                .map(|t| target_is_text_field(&t))
                .unwrap_or(false);
            let binds = client_js::copy_keybind_map(&keybinds.binds.get_untracked());
            let action = client_js::palette_key_action_local(
                &ev,
                palette_open.get_untracked(),
                modal_open.get_untracked(),
                in_field,
                &binds,
            );
            if action == "none" {
                return;
            }
            ev.prevent_default();
            let _ = ev.stop_immediate_propagation();
            match action.as_str() {
                "open" => {
                    if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
                        if let Some(el) = doc.active_element() {
                            if let Ok(html) = el.dyn_into::<web_sys::HtmlElement>() {
                                palette_return_focus.set(Some(html));
                            }
                        }
                    }
                    palette_open.set(true);
                }
                "close" => close_palette.run(()),
                _ => {}
            }
        }) as Box<dyn FnMut(_)>);
        let cb = closure.as_ref().unchecked_ref();
        let _ = window.add_event_listener_with_callback_and_bool("keydown", cb, true);
        closure.forget();
    });

    Effect::new(move |_| {
        keybinds.binds.track();
        if let Some(window) = web_sys::window() {
            let flat = client_js::copy_keybind_map(&keybinds.binds.get_untracked());
            let _ = Reflect::set(
                &window,
                &JsValue::from_str("__srepKeybinds"),
                &flat,
            );
        }
    });

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
