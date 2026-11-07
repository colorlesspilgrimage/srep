use leptos::either::Either;
use leptos::prelude::*;
use leptos_router::hooks::use_query_map;
use serde::Deserialize;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, error_code_from_body, message_for, ApiError};
use crate::themes::ThemeHandle;
use crate::webauthn_client::{self, enroll_credential};

async fn rename_credential_via_client(id: &str, nickname: &str) -> Result<(), String> {
    use js_sys::{Function, Promise, Reflect};
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;

    let window = web_sys::window().ok_or_else(|| "no window".to_string())?;
    let client = Reflect::get(&window, &JsValue::from_str("srepClient"))
        .map_err(|_| "no client".to_string())?;
    let f = Reflect::get(&client, &JsValue::from_str("renameCredential"))
        .map_err(|_| "no rename".to_string())?;
    let f: Function = f.dyn_into().map_err(|_| "bad rename fn".to_string())?;
    let p = f
        .call2(
            &client,
            &JsValue::from_str(id),
            &JsValue::from_str(nickname),
        )
        .map_err(|_| "rename call failed".to_string())?;
    let v = JsFuture::from(Promise::from(p))
        .await
        .map_err(|_| "rename promise failed".to_string())?;
    let ok = Reflect::get(&v, &JsValue::from_str("ok"))
        .ok()
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Reflect::get(&v, &JsValue::from_str("message"))
            .ok()
            .and_then(|x| x.as_string())
            .ok_or_else(|| "rename failed".to_string())
            .and_then(Err)
    }
}

fn read_rename_input_value() -> Option<String> {
    let document = web_sys::window()?.document()?;
    let input = document
        .get_element_by_id("cred-rename-input")?
        .dyn_into::<web_sys::HtmlInputElement>()
        .ok()?;
    Some(input.value())
}

const SECTIONS: &[(&str, &str)] = &[
    ("appearance", "Appearance"),
    ("display", "Display"),
    ("study-day", "Study day"),
    ("presets", "Presets"),
    ("security", "Security"),
    ("pair-app", "Pair app"),
    ("data", "Data"),
];

fn section_from_param(raw: Option<&str>) -> &'static str {
    match raw {
        Some("display") => "display",
        Some("study-day") => "study-day",
        Some("presets") => "presets",
        Some("security") => "security",
        Some("pair-app") => "pair-app",
        Some("data") => "data",
        _ => "appearance",
    }
}

#[component]
pub fn SettingsScreen() -> impl IntoView {
    let query = use_query_map();
    let section = RwSignal::new("appearance".to_string());
    Effect::new(move |_| {
        let param = query.with(|q| q.get("section").map(|s| s.to_string()));
        section.set(section_from_param(param.as_deref()).to_string());
    });

    let _theme = expect_context::<ThemeHandle>();

    view! {
        <main class="app-screen">
            <header class="app-page-header">
                <p class="tui-eyebrow">"Preferences"</p>
                <h1>"Settings"</h1>
                <p class="app-lead">
                    "Theme, keys, study day, presets, security, and data for this instance."
                </p>
            </header>
            <div class="tui-layout">
                <div class="tui-side" role="tablist" aria-label="Settings sections">
                    {SECTIONS
                        .iter()
                        .map(|(id, label)| {
                            let section_id = id.to_string();
                            let selected = {
                                let section_id = section_id.clone();
                                move || section.get() == section_id
                            };
                            view! {
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected=selected
                                    on:click=move |_| section.set(section_id.clone())
                                >
                                    {*label}
                                </button>
                            }
                        })
                        .collect_view()}
                </div>
                <div class="tui-main">
                    <Show when=move || section.get() == "appearance">
                        <div role="tabpanel" aria-label="Appearance">
                            <h2>"Appearance"</h2>
                        </div>
                    </Show>
                    <Show when=move || section.get() == "display">
                        <div role="tabpanel" aria-label="Display">
                            <h2>"Display"</h2>
                        </div>
                    </Show>
                    <Show when=move || section.get() == "study-day">
                        <div role="tabpanel" aria-label="Study day">
                            <h2>"Study day"</h2>
                        </div>
                    </Show>
                    <Show when=move || section.get() == "presets">
                        <div role="tabpanel" aria-label="Presets">
                            <h2>"Presets"</h2>
                        </div>
                    </Show>
                    <Show when=move || section.get() == "security">
                        <div role="tabpanel" aria-label="Security">
                            <SecurityPanel />
                        </div>
                    </Show>
                    <Show when=move || section.get() == "pair-app">
                        <div role="tabpanel" aria-label="Pair app">
                            <h2>"Pair app"</h2>
                        </div>
                    </Show>
                    <Show when=move || section.get() == "data">
                        <div role="tabpanel" aria-label="Data">
                            <h2>"Data"</h2>
                        </div>
                    </Show>
                </div>
            </div>
        </main>
    }
}

#[derive(Clone, Deserialize)]
struct CredentialRow {
    id: String,
    nickname: String,
}

#[component]
fn SecurityPanel() -> impl IntoView {
    let credentials = RwSignal::new(Vec::<CredentialRow>::new());
    let error = RwSignal::new(String::new());
    let confirming_id = RwSignal::new(None::<String>);
    let editing_id = RwSignal::new(None::<String>);
    let edit_value = RwSignal::new(String::new());
    let new_nickname = RwSignal::new(String::new());
    let busy = RwSignal::new(false);
    let ready = RwSignal::new(false);

    let reload = Callback::new(move |_| {
        spawn_local(async move {
            webauthn_client::sync_csrf_from_status().await;
            #[derive(Deserialize)]
            struct CredsBody {
                credentials: Vec<CredentialRow>,
            }
            if let Ok(body) = api::get_json::<CredsBody>("/api/auth/credentials").await {
                credentials.set(body.credentials);
            }
            ready.set(true);
        });
    });

    Effect::new(move |_| reload.run(()));

    view! {
        <Show when=move || ready.get() fallback=|| view! { <p>"Loading security…"</p> }>
            {move || {
                (credentials.get().len() == 1).then(|| {
                    view! { <p role="status">"You have one credential. Add a second one."</p> }
                })
            }}
            <ul aria-label="Credentials">
                <For
                    each=move || credentials.get()
                    key=|cred| cred.id.clone()
                    children=move |cred| {
                        view! {
                            <CredentialRow
                                cred=cred
                                editing_id=editing_id
                                edit_value=edit_value
                                confirming_id=confirming_id
                                error=error
                                on_reload=reload
                            />
                        }
                    }
                />
            </ul>
            {move || {
                (!error.get().is_empty())
                    .then(|| view! {
                        <p class="error" role="alert" data-srep-security-error="">{error.get()}</p>
                    })
            }}
            <div class="tui-form">
                <label for="settings-cred-nickname">"Nickname for the new credential"</label>
                <input
                    id="settings-cred-nickname"
                    type="text"
                    autocomplete="off"
                    maxlength="64"
                    prop:value=move || new_nickname.get()
                    on:input=move |ev| new_nickname.set(event_target_value(&ev))
                />
                <button
                    type="button"
                    disabled=move || busy.get()
                    on:click=move |_| {
                        let nick = new_nickname.get();
                        busy.set(true);
                        spawn_local(async move {
                            let result = enroll_credential(nick, "security_key").await;
                            busy.set(false);
                            if result.ok {
                                new_nickname.set(String::new());
                                reload.run(());
                            } else {
                                error.set(result.message);
                            }
                        });
                    }
                >
                    <span>"Add a security key"</span>
                </button>
                <button
                    type="button"
                    on:click=move |_| {
                        spawn_local(async move {
                            webauthn_client::sign_out(false).await;
                            let window = web_sys::window().unwrap();
                            let _ = window.location().set_href("/login");
                        });
                    }
                >
                    <span>"Log out"</span>
                </button>
                <button
                    type="button"
                    on:click=move |_| {
                        spawn_local(async move {
                            webauthn_client::sign_out(true).await;
                            let window = web_sys::window().unwrap();
                            let _ = window.location().set_href("/login");
                        });
                    }
                >
                    <span>"Log out everywhere"</span>
                </button>
            </div>
        </Show>
    }
}

#[component]
fn CredentialRow(
    cred: CredentialRow,
    editing_id: RwSignal<Option<String>>,
    edit_value: RwSignal<String>,
    confirming_id: RwSignal<Option<String>>,
    error: RwSignal<String>,
    on_reload: Callback<()>,
) -> impl IntoView {
    let cred_id = StoredValue::new(cred.id);
    let nickname = StoredValue::new(cred.nickname);

    view! {
        <li role="listitem">
            {move || {
                let id = cred_id.with_value(|s| s.clone());
                if editing_id.get().as_deref() == Some(&id) {
                    Either::Left(view! {
                        <label>
                            "New nickname"
                            <input
                                id="cred-rename-input"
                                type="text"
                                maxlength="64"
                                aria-label="New nickname"
                                prop:value=move || edit_value.get()
                                on:input=move |ev| edit_value.set(event_target_value(&ev))
                            />
                        </label>
                        <button type="button" class="srep-rename-save" id=format!("rename-btn-{id}")>
                            "Save"
                        </button>
                        <button type="button" on:click=move |_| editing_id.set(None)>
                            "Cancel"
                        </button>
                    })
                } else {
                    let nick = nickname.with_value(|s| s.clone());
                    let confirm = confirming_id.get().as_deref() == Some(&id);
                    Either::Right(view! {
                        <span>{nick.clone()}</span>
                        <button
                            type="button"
                            aria-label=format!("Rename {nick}")
                            on:click=move |_| {
                                let nick = nickname.with_value(|s| s.clone());
                                editing_id.set(Some(cred_id.with_value(|s| s.clone())));
                                edit_value.set(nick.clone());
                                spawn_local(async move {
                                    let _ = wasm_bindgen_futures::JsFuture::from(
                                        js_sys::Promise::resolve(&JsValue::UNDEFINED),
                                    )
                                    .await;
                                    if let Some(input) = web_sys::window()
                                        .and_then(|w| w.document())
                                        .and_then(|d| d.get_element_by_id("cred-rename-input"))
                                        .and_then(|el| {
                                            el.dyn_into::<web_sys::HtmlInputElement>().ok()
                                        })
                                    {
                                        let _ = input.set_value(&nick);
                                    }
                                });
                            }
                        >
                            "Rename"
                        </button>
                        <button
                            type="button"
                            aria-label=if confirm {
                                format!("Confirm revoke {nick}")
                            } else {
                                format!("Revoke {nick}")
                            }
                            on:click=move |_| {
                                let row_id = cred_id.with_value(|s| s.clone());
                                if confirming_id.get_untracked().as_deref() != Some(&row_id) {
                                    confirming_id.set(Some(row_id));
                                    return;
                                }
                                confirming_id.set(None);
                                let path_id = cred_id.with_value(|s| s.clone());
                                spawn_local(async move {
                                        let path = format!("/api/auth/credentials/{path_id}");
                                        match api::delete_json::<serde_json::Value, serde_json::Value>(
                                            &path,
                                            &serde_json::json!({}),
                                        )
                                        .await
                                        {
                                            Ok(_) => on_reload.run(()),
                                            Err(ApiError { body, .. }) => {
                                                error.set(message_for(&error_code_from_body(&body)));
                                            }
                                        }
                                });
                            }
                        >
                            {if confirm { "Confirm revoke" } else { "Revoke" }}
                        </button>
                    })
                }
            }}
        </li>
    }
}
