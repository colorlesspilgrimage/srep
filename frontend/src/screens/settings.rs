use leptos::either::Either;
use leptos::prelude::*;
use leptos_router::hooks::use_query_map;
use serde::Deserialize;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, error_code_from_body, message_for, ApiError};
use crate::client_js;
use crate::prefs::{DisplayHandle, KeybindHandle, KeyCaptureHandle};
use crate::screens::settings_panels::{DataPanel, PresetsPanel};
use crate::themes::{self, ThemeHandle};
use crate::tui::keymap_form::KeymapForm;
use crate::tui::theme_pane::ThemeSettingsPane;
use crate::tui::tui_list::TuiList;
use crate::webauthn_client::{self, enroll_credential};

async fn rename_credential_via_client(id: &str, nickname: &str) -> Result<(), String> {
    use js_sys::{Function, Promise, Reflect};
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

    let theme = expect_context::<ThemeHandle>();
    let keybinds = expect_context::<KeybindHandle>();
    let display = expect_context::<DisplayHandle>();
    let _capture = expect_context::<KeyCaptureHandle>();

    let section_labels: Vec<String> = SECTIONS.iter().map(|(_, l)| (*l).to_string()).collect();
    let section_index = RwSignal::new(0usize);
    Effect::new(move |_| {
        let current = section.get();
        let idx = SECTIONS
            .iter()
            .position(|(id, _)| *id == current.as_str())
            .unwrap_or(0);
        section_index.set(idx);
    });

    let picked_theme = RwSignal::new(String::new());
    Effect::new(move |_| {
        let saved = theme.id.get();
        if picked_theme.get_untracked().is_empty() {
            picked_theme.set(saved);
        }
    });

    let active_theme = move || {
        let id = picked_theme.get();
        themes::normalize_theme_id(&id).to_string()
    };

    let theme_names: Vec<String> = themes::THEME_IDS
        .iter()
        .map(|id| themes::theme_label(id).to_string())
        .collect();
    let theme_list_index = RwSignal::new(0usize);
    Effect::new(move |_| {
        let id = active_theme();
        let idx = themes::THEME_IDS
            .iter()
            .position(|tid| *tid == id.as_str())
            .unwrap_or(0);
        theme_list_index.set(idx);
    });

    Effect::new(move |_| {
        let id = active_theme();
        themes::apply_body_theme(&id);
        theme.id.set(id);
    });

    let theme_status = RwSignal::new(String::new());
    let theme_pending = RwSignal::new(false);
    let save_serial = RwSignal::new(0u32);

    let choose_theme = Callback::new(move |index: usize| {
        let next = themes::THEME_IDS.get(index).copied().unwrap_or(themes::DEFAULT_THEME_ID);
        if next != active_theme().as_str() {
            save_serial.update(|s| *s += 1);
            theme_status.set(String::new());
        }
        picked_theme.set(next.to_string());
    });

    let save_theme = Callback::new(move |_| {
        if theme_pending.get_untracked() {
            return;
        }
        let id = active_theme();
        let serial = save_serial.get_untracked() + 1;
        save_serial.set(serial);
        theme_pending.set(true);
        let theme_status = theme_status;
        let theme = theme;
        let save_serial = save_serial;
        spawn_local(async move {
            #[derive(Deserialize, serde::Serialize)]
            struct Body {
                id: String,
            }
            let saved = match api::put_json::<Body, Body>(
                "/api/settings/theme",
                &Body { id: id.clone() },
            )
            .await
            {
                Ok(body) => body.id == id,
                Err(_) => false,
            };
            if save_serial.get_untracked() == serial {
                theme_status.set(if saved {
                    themes::persist_theme(&id);
                    theme.id.set(id);
                    "Saved.".to_string()
                } else {
                    "Could not save the theme.".to_string()
                });
            }
            theme_pending.set(false);
        });
    });

    let draft_keys = RwSignal::new(keybinds.binds.get_untracked());
    Effect::new(move |_| {
        keybinds.binds.track();
        if draft_keys.get_untracked().is_null() {
            draft_keys.set(keybinds.binds.get());
        }
    });

    let on_keys_saved = Callback::new(move |map: JsValue| {
        keybinds.binds.set(map.clone());
        draft_keys.set(map);
    });

    let timezone = RwSignal::new("UTC".to_string());
    let rollover_text = RwSignal::new("4".to_string());
    let study_status = RwSignal::new(String::new());
    let study_pending = RwSignal::new(false);
    let study_ready = RwSignal::new(false);

    Effect::new(move |_| {
        spawn_local(async move {
            #[derive(Deserialize)]
            struct StudySettings {
                rollover_hour: u32,
                timezone: String,
            }
            #[derive(Deserialize)]
            struct Body {
                settings: StudySettings,
            }
            match api::get_json::<Body>("/api/settings/study").await {
                Ok(body) => {
                    timezone.set(body.settings.timezone);
                    rollover_text.set(body.settings.rollover_hour.to_string());
                }
                Err(_) => study_status.set("Could not load the study day.".to_string()),
            }
            study_ready.set(true);
        });
    });

    let font_size_text = RwSignal::new("16".to_string());
    let reduced_motion = RwSignal::new(false);
    let display_status = RwSignal::new(String::new());
    let display_pending = RwSignal::new(false);
    let display_ready = RwSignal::new(false);

    Effect::new(move |_| {
        spawn_local(async move {
            #[derive(Deserialize)]
            struct DisplayPrefs {
                font_size: u32,
                reduced_motion: bool,
            }
            #[derive(Deserialize)]
            struct Body {
                display: DisplayPrefs,
            }
            match api::get_json::<Body>("/api/settings/display").await {
                Ok(body) => {
                    font_size_text.set(body.display.font_size.to_string());
                    reduced_motion.set(body.display.reduced_motion);
                    display.apply_js(body.display.font_size, body.display.reduced_motion);
                }
                Err(_) => display_status.set("Could not load display settings.".to_string()),
            }
            display_ready.set(true);
        });
    });

    let preview_display = move || {
        if let Ok((size, motion)) =
            client_js::accept_display_fields(&font_size_text.get_untracked(), reduced_motion.get_untracked())
        {
            display.apply_js(size, motion);
        }
    };

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
                <div class="tui-side">
                    <TuiList
                        label="Settings sections"
                        items=section_labels.clone()
                        selected_index=section_index
                        on_select=Callback::new(move |i: usize| {
                            let id = SECTIONS.get(i).map(|p| p.0).unwrap_or("appearance");
                            section.set(id.to_string());
                        })
                    />
                </div>
                <div class="tui-main">
                    <div
                        role="tabpanel"
                        aria-label="Appearance"
                        hidden=move || section.get() != "appearance"
                    >
                        <ThemeSettingsPane
                            theme_names=theme_names.clone()
                            selected_index=theme_list_index
                            on_select=choose_theme
                            on_save=save_theme
                            save_pending=theme_pending
                            status_text=theme_status
                        />
                        <KeymapForm map=draft_keys on_saved=on_keys_saved />
                    </div>
                    <div
                        role="tabpanel"
                        aria-label="Display"
                        hidden=move || section.get() != "display"
                    >
                        <Show when=move || display_ready.get() fallback=|| view! { <p>"Loading display…"</p> }>
                            <form
                                class="tui-form"
                                method="post"
                                on:submit=move |ev| {
                                    ev.prevent_default();
                                    if display_pending.get_untracked() {
                                        return;
                                    }
                                    let Ok((font_size, motion)) = client_js::accept_display_fields(
                                        &font_size_text.get_untracked(),
                                        reduced_motion.get_untracked(),
                                    ) else {
                                        display_status.set("Could not save display settings.".to_string());
                                        return;
                                    };
                                    display_pending.set(true);
                                    let display = display;
                                    let display_status = display_status;
                                    spawn_local(async move {
                                        #[derive(serde::Serialize)]
                                        #[serde(rename_all = "camelCase")]
                                        struct Put {
                                            font_size: u32,
                                            reduced_motion: bool,
                                            scanline: bool,
                                            cursor_blink: bool,
                                        }
                                        let ok = api::put_json::<serde_json::Value, Put>(
                                            "/api/settings/display",
                                            &Put {
                                                font_size,
                                                reduced_motion: motion,
                                                scanline: false,
                                                cursor_blink: false,
                                            },
                                        )
                                        .await
                                        .is_ok();
                                        if ok {
                                            display.apply_js(font_size, motion);
                                            display_status.set("Saved.".to_string());
                                        } else {
                                            display_status.set("Could not save display settings.".to_string());
                                        }
                                        display_pending.set(false);
                                    });
                                }
                            >
                                <label for="settings-display-font-size">"Font size"</label>
                                <input
                                    id="settings-display-font-size"
                                    name="fontSize"
                                    type="text"
                                    inputmode="numeric"
                                    autocomplete="off"
                                    prop:value=move || font_size_text.get()
                                    on:input=move |ev| {
                                        font_size_text.set(event_target_value(&ev));
                                        preview_display();
                                    }
                                    disabled=move || display_pending.get()
                                />
                                <label>
                                    <input
                                        type="checkbox"
                                        name="reducedMotion"
                                        prop:checked=move || reduced_motion.get()
                                        on:change=move |ev| {
                                            reduced_motion.set(event_target_checked(&ev));
                                            preview_display();
                                        }
                                        disabled=move || display_pending.get()
                                    />
                                    " Reduced motion"
                                </label>
                                <button type="submit" aria-busy=move || display_pending.get()>
                                    "Save display"
                                </button>
                            </form>
                            <Show when=move || !display_status.get().is_empty()>
                                <p role="status" aria-label="Display status">
                                    {move || display_status.get()}
                                </p>
                            </Show>
                        </Show>
                    </div>
                    <div
                        role="tabpanel"
                        aria-label="Study day"
                        hidden=move || section.get() != "study-day"
                    >
                        <Show when=move || study_ready.get() fallback=|| view! { <p>"Loading study day…"</p> }>
                            <form
                                class="tui-form"
                                method="post"
                                on:submit=move |ev| {
                                    ev.prevent_default();
                                    if study_pending.get_untracked() {
                                        return;
                                    }
                                    match client_js::accept_study_day(
                                        &timezone.get_untracked(),
                                        &rollover_text.get_untracked(),
                                    ) {
                                        Ok((tz, hour)) => {
                                            study_pending.set(true);
                                            let timezone = timezone;
                                            let rollover_text = rollover_text;
                                            let study_status = study_status;
                                            spawn_local(async move {
                                                #[derive(serde::Serialize)]
                                                #[serde(rename_all = "camelCase")]
                                                struct Put {
                                                    timezone: String,
                                                    rollover_hour: u32,
                                                }
                                                let ok = api::put_json::<serde_json::Value, Put>(
                                                    "/api/settings/study",
                                                    &Put {
                                                        timezone: tz.clone(),
                                                        rollover_hour: hour,
                                                    },
                                                )
                                                .await
                                                .is_ok();
                                                if ok {
                                                    timezone.set(tz);
                                                    rollover_text.set(hour.to_string());
                                                    study_status.set("Saved.".to_string());
                                                } else {
                                                    study_status.set("Could not save the study day.".to_string());
                                                }
                                                study_pending.set(false);
                                            });
                                        }
                                        Err(msg) => study_status.set(msg),
                                    }
                                }
                            >
                                <label for="settings-study-timezone">"Timezone"</label>
                                <input
                                    id="settings-study-timezone"
                                    name="timezone"
                                    type="text"
                                    autocomplete="off"
                                    aria-label="Timezone"
                                    prop:value=move || timezone.get()
                                    on:input=move |ev| timezone.set(event_target_value(&ev))
                                    disabled=move || study_pending.get()
                                />
                                <label for="settings-study-rollover">"Rollover hour"</label>
                                <input
                                    id="settings-study-rollover"
                                    name="rolloverHour"
                                    type="text"
                                    inputmode="numeric"
                                    autocomplete="off"
                                    aria-label="Rollover hour"
                                    prop:value=move || rollover_text.get()
                                    on:input=move |ev| rollover_text.set(event_target_value(&ev))
                                    disabled=move || study_pending.get()
                                />
                                <button type="submit" aria-busy=move || study_pending.get()>
                                    "Save study day"
                                </button>
                            </form>
                            <Show when=move || !study_status.get().is_empty()>
                                <p role="status" aria-label="Study day status">
                                    {move || study_status.get()}
                                </p>
                            </Show>
                        </Show>
                    </div>
                    <div
                        role="tabpanel"
                        aria-label="Presets"
                        hidden=move || section.get() != "presets"
                    >
                        <PresetsPanel />
                    </div>
                    <div
                        role="tabpanel"
                        aria-label="Security"
                        hidden=move || section.get() != "security"
                    >
                        <SecurityPanel />
                    </div>
                    <div
                        role="tabpanel"
                        aria-label="Pair app"
                        hidden=move || section.get() != "pair-app"
                    >
                        <h2>"Pair app"</h2>
                    </div>
                    <div role="tabpanel" aria-label="Data" hidden=move || section.get() != "data">
                        <DataPanel />
                    </div>
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
    let unused_count = RwSignal::new(None::<u32>);
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
            #[derive(Deserialize)]
            struct RecoveryBody {
                unused_count: u32,
            }
            if let Ok(body) = api::get_json::<CredsBody>("/api/auth/credentials").await {
                credentials.set(body.credentials);
            }
            if let Ok(body) = api::get_json::<RecoveryBody>("/api/auth/recovery").await {
                unused_count.set(Some(body.unused_count));
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
                unused_count
                    .get()
                    .map(|n| view! {
                        <p role="status" aria-label="Recovery codes">
                            {format!("Unused recovery codes: {n}")}
                        </p>
                    })
            }}
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
                            let result = enroll_credential(nick, "passkey").await;
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
                    <span>"Add a passkey"</span>
                </button>
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
