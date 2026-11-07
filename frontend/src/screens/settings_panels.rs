use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, error_code_from_body, message_for, ApiError};
use crate::tui::tui_list::TuiList;

#[derive(Clone, Deserialize)]
pub struct PresetRow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub new_per_day: u32,
    #[serde(default)]
    pub reviews_per_day: u32,
    #[serde(default)]
    pub desired_retention: f64,
    #[serde(default)]
    pub learning_steps: Vec<u32>,
    #[serde(default)]
    pub relearning_steps: Vec<u32>,
    #[serde(default)]
    pub max_interval: u32,
    #[serde(default)]
    pub bury_siblings: bool,
    #[serde(default)]
    pub new_order: String,
    pub fsrs_params: Option<Vec<f64>>,
}

#[derive(Serialize)]
struct PresetInput {
    name: String,
    new_per_day: u32,
    reviews_per_day: u32,
    desired_retention: f64,
    learning_steps: Vec<u32>,
    relearning_steps: Vec<u32>,
    max_interval: u32,
    bury_siblings: bool,
    new_order: String,
    fsrs_params: Option<Vec<f64>>,
}

fn preset_message(code: &str) -> &'static str {
    match code {
        "builtin_protected" => "The default preset cannot be deleted.",
        "in_use" => "That preset is in use by a deck.",
        "name_taken" => "That preset name is already used.",
        _ => "The request failed.",
    }
}

#[component]
pub fn PresetsPanel() -> impl IntoView {
    let presets = RwSignal::new(Vec::<PresetRow>::new());
    let selected_index = RwSignal::new(0usize);
    let editing_id = RwSignal::new(None::<String>);
    let name = RwSignal::new(String::new());
    let new_per_day = RwSignal::new("20".to_string());
    let reviews_per_day = RwSignal::new("200".to_string());
    let desired_retention = RwSignal::new("0.9".to_string());
    let learning_steps = RwSignal::new("1, 10".to_string());
    let relearning_steps = RwSignal::new("10".to_string());
    let max_interval = RwSignal::new("36500".to_string());
    let bury_siblings = RwSignal::new(false);
    let new_order = RwSignal::new("added".to_string());
    let status = RwSignal::new(String::new());
    let pending = RwSignal::new(false);
    let ready = RwSignal::new(false);

    let apply_row = move |row: &PresetRow| {
        editing_id.set(Some(row.id.clone()));
        name.set(row.name.clone());
        new_per_day.set(row.new_per_day.to_string());
        reviews_per_day.set(row.reviews_per_day.to_string());
        desired_retention.set(row.desired_retention.to_string());
        learning_steps.set(
            row.learning_steps
                .iter()
                .map(|n| n.to_string())
                .collect::<Vec<_>>()
                .join(", "),
        );
        relearning_steps.set(
            row.relearning_steps
                .iter()
                .map(|n| n.to_string())
                .collect::<Vec<_>>()
                .join(", "),
        );
        max_interval.set(row.max_interval.to_string());
        bury_siblings.set(row.bury_siblings);
        new_order.set(row.new_order.clone());
    };

    let reload = Callback::new(move |prefer: Option<String>| {
        spawn_local(async move {
            #[derive(Deserialize)]
            struct Body {
                presets: Vec<PresetRow>,
            }
            let Ok(body) = api::get_json::<Body>("/api/presets").await else {
                status.set("Could not load presets.".to_string());
                ready.set(true);
                return;
            };
            presets.set(body.presets.clone());
            if body.presets.is_empty() {
                editing_id.set(None);
                selected_index.set(0);
                ready.set(true);
                return;
            }
            let index = prefer
                .as_ref()
                .and_then(|id| body.presets.iter().position(|p| &p.id == id))
                .unwrap_or_else(|| {
                    selected_index
                        .get_untracked()
                        .min(body.presets.len().saturating_sub(1))
                });
            selected_index.set(index);
            if let Some(row) = body.presets.get(index) {
                apply_row(row);
            }
            ready.set(true);
        });
    });

    Effect::new(move |_| reload.run(None));

    let parse_input = move || -> Option<PresetInput> {
        let name_v = name.get().trim().to_string();
        if name_v.is_empty() || name_v.len() > 100 {
            return None;
        }
        let new_pd = new_per_day.get().trim().parse().ok()?;
        let rev_pd = reviews_per_day.get().trim().parse().ok()?;
        let desired: f64 = desired_retention.get().trim().parse().ok()?;
        let max_i: u32 = max_interval.get().trim().parse().ok()?;
        let parse_steps = |raw: String| -> Option<Vec<u32>> {
            let t = raw.trim();
            if t.is_empty() {
                return Some(vec![]);
            }
            let mut out = Vec::new();
            for p in t.split(',') {
                out.push(p.trim().parse().ok()?);
            }
            Some(out)
        };
        Some(PresetInput {
            name: name_v,
            new_per_day: new_pd,
            reviews_per_day: rev_pd,
            desired_retention: desired,
            learning_steps: parse_steps(learning_steps.get())?,
            relearning_steps: parse_steps(relearning_steps.get())?,
            max_interval: max_i,
            bury_siblings: bury_siblings.get(),
            new_order: new_order.get(),
            fsrs_params: None,
        })
    };

    let preset_names = Memo::new(move |_| {
        presets
            .get()
            .iter()
            .map(|p| p.name.clone())
            .collect::<Vec<_>>()
    });

    view! {
        <Show when=move || ready.get() fallback=|| view! { <p>"Loading presets…"</p> }>
            <TuiList
                label="Presets"
                items=preset_names.get()
                selected_index=selected_index
                on_select=Callback::new(move |i| {
                    selected_index.set(i);
                    status.set(String::new());
                    if let Some(row) = presets.get_untracked().get(i) {
                        apply_row(row);
                    }
                })
            />
            <button
                type="button"
                disabled=move || pending.get()
                on:click=move |_| {
                    editing_id.set(None);
                    selected_index.set(usize::MAX);
                    name.set(String::new());
                    new_per_day.set("20".to_string());
                    reviews_per_day.set("200".to_string());
                    status.set(String::new());
                }
            >
                "New preset"
            </button>
            <form
                class="tui-form"
                method="post"
                on:submit=move |ev| {
                    ev.prevent_default();
                    if pending.get_untracked() {
                        return;
                    }
                    let Some(input) = parse_input() else {
                        status.set("Could not save the preset.".to_string());
                        return;
                    };
                    pending.set(true);
                    let editing_id = editing_id.get_untracked();
                    let reload = reload.clone();
                    let status = status;
                    spawn_local(async move {
                        let result = if let Some(id) = editing_id {
                            api::put_json::<serde_json::Value, PresetInput>(
                                &format!("/api/presets/{id}"),
                                &input,
                            )
                            .await
                        } else {
                            api::post_json::<serde_json::Value, PresetInput>("/api/presets", &input)
                                .await
                        };
                        pending.set(false);
                        match result {
                            Ok(body) => {
                                #[derive(Deserialize)]
                                struct PresetBody {
                                    preset: PresetRow,
                                }
                                let saved_id = serde_json::from_value::<PresetBody>(body)
                                    .ok()
                                    .map(|b| b.preset.id);
                                status.set("Saved.".to_string());
                                reload.run(saved_id);
                            }
                            Err(ApiError { body, .. }) => {
                                status.set(
                                    preset_message(&error_code_from_body(&body)).to_string(),
                                );
                            }
                        }
                    });
                }
            >
                <label for="settings-preset-name">"Name"</label>
                <input
                    id="settings-preset-name"
                    type="text"
                    maxlength="100"
                    prop:value=move || name.get()
                    on:input=move |ev| name.set(event_target_value(&ev))
                    disabled=move || pending.get()
                />
                <label for="settings-preset-new-per-day">"New per day"</label>
                <input
                    id="settings-preset-new-per-day"
                    type="text"
                    inputmode="numeric"
                    prop:value=move || new_per_day.get()
                    on:input=move |ev| new_per_day.set(event_target_value(&ev))
                    disabled=move || pending.get()
                />
                <label for="settings-preset-reviews-per-day">"Reviews per day"</label>
                <input
                    id="settings-preset-reviews-per-day"
                    type="text"
                    inputmode="numeric"
                    prop:value=move || reviews_per_day.get()
                    on:input=move |ev| reviews_per_day.set(event_target_value(&ev))
                    disabled=move || pending.get()
                />
                <button type="submit" aria-busy=move || pending.get()>"Save preset"</button>
                <button
                    type="button"
                    disabled=move || pending.get() || editing_id.get().is_none()
                    on:click=move |_| {
                        let Some(id) = editing_id.get_untracked() else {
                            return;
                        };
                        pending.set(true);
                        let reload = reload.clone();
                        let status = status;
                        spawn_local(async move {
                            match api::delete_json::<serde_json::Value, serde_json::Value>(
                                &format!("/api/presets/{id}"),
                                &serde_json::json!({}),
                            )
                            .await
                            {
                                Ok(_) => {
                                    status.set("Deleted.".to_string());
                                    reload.run(None);
                                }
                                Err(ApiError { body, .. }) => {
                                    status.set(
                                        preset_message(&error_code_from_body(&body)).to_string(),
                                    );
                                }
                            }
                            pending.set(false);
                        });
                    }
                >
                    "Delete preset"
                </button>
            </form>
            <Show when=move || !status.get().is_empty()>
                <p role="status" aria-label="Presets status">
                    {move || status.get()}
                </p>
            </Show>
        </Show>
    }
}

#[derive(Clone, Deserialize)]
struct TrashNote {
    id: String,
    preview: String,
}

#[component]
pub fn DataPanel() -> impl IntoView {
    let notes = RwSignal::new(Vec::<TrashNote>::new());
    let status = RwSignal::new(String::new());
    let pending = RwSignal::new(false);
    let ready = RwSignal::new(false);

    let reload = Callback::new(move |_| {
        spawn_local(async move {
            #[derive(Deserialize)]
            struct Body {
                notes: Vec<TrashNote>,
            }
            match api::get_json::<Body>("/api/notes/trash").await {
                Ok(body) => notes.set(body.notes),
                Err(_) => status.set("Could not load the trash.".to_string()),
            }
            ready.set(true);
        });
    });

    Effect::new(move |_| reload.run(()));

    view! {
        <Show when=move || ready.get() fallback=|| view! { <p>"Loading data…"</p> }>
            <h2>"Trash"</h2>
            <Show
                when=move || notes.get().is_empty()
                fallback=move || {
                    view! {
                        <ul aria-label="Trashed notes">
                            <For
                                each=move || notes.get()
                                key=|n| n.id.clone()
                                children=move |note| {
                                    let preview = note.preview.clone();
                                    let label = if preview.is_empty() {
                                        format!("Restore {}", note.id)
                                    } else {
                                        format!("Restore {preview}")
                                    };
                                    let id = note.id.clone();
                                    let reload = reload.clone();
                                    let status = status;
                                    view! {
                                        <li>
                                            <span>
                                                {if preview.is_empty() {
                                                    "(empty)".to_string()
                                                } else {
                                                    preview.clone()
                                                }}
                                            </span>
                                            <button
                                                type="button"
                                                disabled=move || pending.get()
                                                aria-label=label.clone()
                                                on:click=move |_| {
                                                    pending.set(true);
                                                    let note_id = id.clone();
                                                    spawn_local(async move {
                                                        status.set(String::new());
                                                        let path =
                                                            format!("/api/notes/{note_id}/restore");
                                                        match api::post_json::<serde_json::Value, serde_json::Value>(
                                                            &path,
                                                            &serde_json::json!({}),
                                                        )
                                                        .await
                                                        {
                                                            Ok(_) => {
                                                                status.set("Restored.".to_string());
                                                                reload.run(());
                                                            }
                                                            Err(ApiError { body, .. }) => {
                                                                let code = error_code_from_body(&body);
                                                                status.set(if code == "deck_required" {
                                                                    "Pick a deck before restoring this note.".to_string()
                                                                } else {
                                                                    "The request failed.".to_string()
                                                                });
                                                            }
                                                        }
                                                        pending.set(false);
                                                    });
                                                }
                                            >
                                                "Restore"
                                            </button>
                                        </li>
                                    }
                                }
                            />
                        </ul>
                    }
                }
            >
                <p role="status">"Trash is empty."</p>
            </Show>
            <h2>"Import / export"</h2>
            <div aria-label="Export formats">
                <button
                    type="button"
                    disabled=move || pending.get()
                    on:click=move |_| {
                        spawn_local(async move {
                            let window = web_sys::window().unwrap();
                            let resp = wasm_bindgen_futures::JsFuture::from(
                                window.fetch_with_str("/api/export?format=native"),
                            )
                            .await;
                            if resp.is_err() {
                                status.set("Export failed.".to_string());
                            } else {
                                status.set("Export started.".to_string());
                            }
                        });
                    }
                >
                    "Export native (.zip)"
                </button>
            </div>
            <Show when=move || !status.get().is_empty()>
                <p role="status" aria-label="Data status">
                    {move || status.get()}
                </p>
            </Show>
        </Show>
    }
}
