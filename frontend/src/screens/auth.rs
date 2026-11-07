use leptos::prelude::*;
use leptos_router::components::A;

#[component]
pub fn LoginScreen() -> impl IntoView {
    view! {
        <main class="auth-panel">
            <p class="auth-brand">
                <span class="app-icon" aria-hidden="true">"◆"</span>
                <span>"srep"</span>
            </p>
            <p class="auth-eyebrow">"Sign in"</p>
            <h1>"Log in"</h1>
            <p class="auth-lead">
                "Passwordless access with a passkey or security key for this instance."
            </p>
            <div class="auth-actions">
                <button type="button" class="auth-primary" disabled title="WebAuthn wiring in progress">
                    "Log in with a passkey"
                </button>
                <button type="button" disabled title="WebAuthn wiring in progress">
                    "Log in with a security key"
                </button>
            </div>
            <details class="auth-details">
                <summary>"Use a recovery code"</summary>
                <form class="auth-form" on:submit=|ev| ev.prevent_default()>
                    <label class="field">
                        "Recovery code"
                        <input type="text" autocomplete="off" maxlength="64" disabled=true />
                    </label>
                    <button type="submit" disabled=true>"Log in with code"</button>
                </form>
            </details>
            <p class="tui-dim">
                "Until WASM ceremonies land, use the v1 UI or API directly. "
                <A href="/setup">"Setup"</A>
            </p>
        </main>
    }
}

#[component]
pub fn SetupScreen() -> impl IntoView {
    view! {
        <main class="auth-panel">
            <p class="auth-brand">
                <span class="app-icon" aria-hidden="true">"◆"</span>
                <span>"srep"</span>
            </p>
            <p class="auth-eyebrow">"First run"</p>
            <h1>"Set up srep"</h1>
            <p class="auth-lead">"Enroll the first credential with the setup token from the server log."</p>
            <form class="auth-form" on:submit=|ev| ev.prevent_default()>
                <label class="field">
                    "Setup token"
                    <input type="password" autocomplete="off" disabled=true />
                </label>
                <label class="field">
                    "Nickname"
                    <input type="text" autocomplete="off" maxlength="64" disabled=true />
                </label>
                <p class="auth-actions">
                    <button type="submit" class="auth-primary" disabled=true>
                        "Create"
                    </button>
                </p>
            </form>
            <p class="tui-dim">
                "Run "
                <code>"srep reset-auth --yes"</code>
                " locally, then finish setup via API or the legacy SvelteKit UI."
            </p>
            <p>
                <A href="/login">"Already enrolled? Log in"</A>
            </p>
        </main>
    }
}
