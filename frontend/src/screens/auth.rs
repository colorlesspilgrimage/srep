use leptos::prelude::*;
use leptos_router::components::{A, Redirect};
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;

use crate::webauthn_client::{self, AuthStatus};

#[component]
pub fn LoginScreen() -> impl IntoView {
    let busy = RwSignal::new(false);
    let error = RwSignal::new(String::new());
    let code = RwSignal::new(String::new());
    let authenticated = RwSignal::new(false);

    Effect::new(move |_| {
        spawn_local(async move {
            webauthn_client::sync_csrf_from_status().await;
            if let Ok(s) = crate::api::get_json::<AuthStatus>("/api/auth/status").await {
                if s.authenticated {
                    authenticated.set(true);
                }
            }
        });
    });

    async fn do_login(kind: &str, busy: RwSignal<bool>, error: RwSignal<String>) {
        busy.set(true);
        error.set(String::new());
        let result = webauthn_client::login_with(kind).await;
        busy.set(false);
        if result.ok {
            let window = web_sys::window().unwrap();
            let _ = window.location().set_href("/");
        } else {
            error.set(result.message);
        }
    }

    view! {
        {move || authenticated.get().then(|| view! { <Redirect path="/" /> })}
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
                <button
                    type="button"
                    class="auth-primary"
                    disabled=move || busy.get()
                    on:click=move |_| {
                        let busy = busy;
                        let error = error;
                        spawn_local(async move {
                            do_login("passkey", busy, error).await;
                        });
                    }
                >
                    <span>"Log in with a passkey"</span>
                </button>
                <button
                    type="button"
                    disabled=move || busy.get()
                    on:click=move |_| {
                        let busy = busy;
                        let error = error;
                        spawn_local(async move {
                            do_login("security_key", busy, error).await;
                        });
                    }
                >
                    <span>"Log in with a security key"</span>
                </button>
            </div>
            {move || {
                (!error.get().is_empty()).then(|| {
                    view! { <p class="error" role="alert">{error.get()}</p> }
                })
            }}
            <details class="auth-details">
                <summary>"Use a recovery code"</summary>
                <form
                    on:submit=move |ev| {
                        ev.prevent_default();
                        let busy = busy;
                        let error = error;
                        let code = code.get();
                        spawn_local(async move {
                            busy.set(true);
                            error.set(String::new());
                            let result = webauthn_client::recovery_login(code).await;
                            busy.set(false);
                            if result.ok {
                                let window = web_sys::window().unwrap();
                                let _ = window.location().set_href("/");
                            } else {
                                error.set(result.message);
                            }
                        });
                    }
                >
                    <label class="field">
                        "Recovery code"
                        <input
                            type="text"
                            autocomplete="off"
                            maxlength="64"
                            prop:value=move || code.get()
                            on:input=move |ev| {
                                code.set(event_target_value(&ev));
                            }
                        />
                    </label>
                    <button type="submit" disabled=move || busy.get()>
                        "Log in with code"
                    </button>
                </form>
            </details>
        </main>
    }
}

#[component]
pub fn SetupScreen() -> impl IntoView {
    let setup_token = RwSignal::new(String::new());
    let nickname = RwSignal::new(String::new());
    let kind = RwSignal::new("passkey".to_string());
    let busy = RwSignal::new(false);
    let error = RwSignal::new(String::new());
    let recovery_codes = RwSignal::new(Vec::<String>::new());
    let setup_complete = RwSignal::new(false);

    Effect::new(move |_| {
        spawn_local(async move {
            if let Ok(s) = crate::api::get_json::<AuthStatus>("/api/auth/status").await {
                if s.setup_complete {
                    setup_complete.set(true);
                }
            }
        });
    });

    view! {
        {move || setup_complete.get().then(|| view! { <Redirect path="/" /> })}
        <main class="auth-panel">
            <p class="auth-brand">
                <span class="app-icon" aria-hidden="true">"◆"</span>
                <span>"srep"</span>
            </p>
            <p class="auth-eyebrow">"First run"</p>
            <h1>"Set up srep"</h1>
            <p class="auth-lead">"Enroll the first credential with the setup token from the server log."</p>
            {move || {
                if recovery_codes.get().is_empty() {
                    view! {
                        <form
                            on:submit=move |ev| {
                                ev.prevent_default();
                                let token = setup_token.get();
                                let nick = nickname.get();
                                let k = kind.get();
                                let busy = busy;
                                let error = error;
                                let recovery_codes = recovery_codes;
                                spawn_local(async move {
                                    busy.set(true);
                                    error.set(String::new());
                                    let result =
                                        webauthn_client::enroll_setup(token, nick, &k).await;
                                    busy.set(false);
                                    if result.ok {
                                        if let Some(codes) = recovery_codes_from_body(&result.body) {
                                            recovery_codes.set(codes);
                                        }
                                        setup_token.set(String::new());
                                    } else {
                                        error.set(result.message);
                                    }
                                });
                            }
                        >
                            <label class="field">
                                "Setup token"
                                <input
                                    type="password"
                                    autocomplete="off"
                                    required
                                    prop:value=move || setup_token.get()
                                    on:input=move |ev| setup_token.set(event_target_value(&ev))
                                />
                            </label>
                            <label class="field">
                                "Nickname"
                                <input
                                    type="text"
                                    autocomplete="off"
                                    required
                                    maxlength="64"
                                    prop:value=move || nickname.get()
                                    on:input=move |ev| nickname.set(event_target_value(&ev))
                                />
                            </label>
                            <fieldset class="auth-fieldset">
                                <legend>"Credential type"</legend>
                                <label>
                                    <input
                                        type="radio"
                                        name="kind"
                                        value="passkey"
                                        checked=move || kind.get() == "passkey"
                                        on:change=move |_| kind.set("passkey".to_string())
                                    />
                                    " Passkey"
                                </label>
                                <label>
                                    <input
                                        type="radio"
                                        name="kind"
                                        value="security_key"
                                        checked=move || kind.get() == "security_key"
                                        on:change=move |_| kind.set("security_key".to_string())
                                    />
                                    " Security key"
                                </label>
                            </fieldset>
                            <p class="auth-actions">
                                <button type="submit" class="auth-primary" disabled=move || busy.get()>
                                    <span>"Create"</span>
                                </button>
                            </p>
                        </form>
                        {move || {
                            (!error.get().is_empty()).then(|| {
                                view! { <p class="error" role="alert">{error.get()}</p> }
                            })
                        }}
                    }
                    .into_any()
                } else {
                    view! {
                        <p role="status">"Save these codes now. They are shown once."</p>
                        <pre class="auth-codes" aria-label="Recovery codes">
                            {recovery_codes
                                .get()
                                .join("\n")}
                        </pre>
                        <p class="auth-lead">
                            "Add a second credential on the security page, so you cannot lose access."
                        </p>
                        <A href="/settings?section=security">
                            <button type="button" class="auth-primary">
                                "Continue"
                            </button>
                        </A>
                    }
                    .into_any()
                }
            }}
            <p>
                <A href="/login">"Already enrolled? Log in"</A>
            </p>
        </main>
    }
}

fn recovery_codes_from_body(body: &wasm_bindgen::JsValue) -> Option<Vec<String>> {
    let codes = js_sys::Reflect::get(body, &wasm_bindgen::JsValue::from_str("recoveryCodes"))
        .ok()?;
    let arr = codes.dyn_ref::<js_sys::Array>()?;
    let mut out = Vec::new();
    for v in arr.iter() {
        if let Some(s) = v.as_string() {
            out.push(s);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}
