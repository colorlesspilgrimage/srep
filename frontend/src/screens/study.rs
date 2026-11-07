use leptos::either::Either;
use leptos::prelude::*;
use leptos_router::hooks::use_query_map;
use serde::Deserialize;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, error_code_from_body, message_for, ApiError};
use crate::card_html::CardHtml;
use crate::client_js;
use crate::deck::tree_keys::target_is_text_field;
use crate::dialog_focus::{dialog_key_action, next_trap_index, focusable_items, activates_control, DialogKeyAction};
use crate::id_util::is_uuid;
use crate::study_keys::{study_key_action, StudyKeyAction};
use crate::webauthn_client;

#[derive(Debug, Clone, Deserialize)]
struct StudyCounts {
    #[serde(rename = "new")]
    new_count: u32,
    learning: u32,
    review: u32,
}

#[derive(Debug, Clone, Deserialize)]
struct PreviewInterval {
    #[serde(rename = "intervalMinutes")]
    interval_minutes: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct StudyCard {
    id: String,
    #[serde(rename = "noteId")]
    note_id: String,
    reps: u32,
    front: String,
    back: String,
    previews: serde_json::Value,
}

#[derive(Clone)]
enum Phase {
    Loading,
    BadDeck,
    Error(String),
    Card {
        card: StudyCard,
        side: String,
        labels: [String; 4],
    },
    Wait { until_text: String, counts: StudyCounts },
    Done { due_text: String, counts: StudyCounts },
}

#[component]
pub fn StudyScreen() -> impl IntoView {
    let query = use_query_map();
    let phase = RwSignal::new(Phase::Loading);
    let counts = RwSignal::new(None::<StudyCounts>);
    let message = RwSignal::new(String::new());
    let busy = RwSignal::new(false);
    let edit_open = RwSignal::new(false);
    let edit_fields = RwSignal::new(Vec::<String>::new());
    let edit_card_id = RwSignal::new(String::new());
    let edit_note_id = RwSignal::new(String::new());
    let reveal_start = RwSignal::new(0f64);
    let generation = RwSignal::new(0u32);
    let last_interval = RwSignal::new(0f64);

    let deck_param = move || query.with(|q| q.get("deck").map(|s| s.to_string()));

    let load_next = move |deck: Option<String>| {
        generation.update(|g| *g += 1);
        let gen = generation.get_untracked();
        if let Some(ref d) = deck {
            if !is_uuid(d) {
                phase.set(Phase::BadDeck);
                return;
            }
        }
        phase.set(Phase::Loading);
        spawn_local(async move {
            webauthn_client::sync_csrf_from_status().await;
            let path = match deck {
                Some(d) => format!("/api/study/next?deckId={d}"),
                None => "/api/study/next".to_string(),
            };
            if gen != generation.get_untracked() {
                return;
            }
            let body = api::get_json::<serde_json::Value>(&path).await;
            if gen != generation.get_untracked() {
                return;
            }
            match body {
                Ok(v) => {
                    let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("");
                    if let Some(c) = v.get("counts") {
                        if let Ok(parsed) = serde_json::from_value::<StudyCounts>(c.clone()) {
                            counts.set(Some(parsed));
                        }
                    }
                    match status {
                        "card" => {
                            let Ok(card) =
                                serde_json::from_value::<StudyCard>(v.get("card").cloned().unwrap_or_default())
                            else {
                                phase.set(Phase::Error(message_for("bad_request")));
                                return;
                            };
                            let mut labels = [
                                "0m".to_string(),
                                "0m".to_string(),
                                "0m".to_string(),
                                "0m".to_string(),
                            ];
                            if let Some(prev) = card.previews.as_object() {
                                for rating in 1..=4 {
                                    if let Some(entry) = prev.get(&rating.to_string()) {
                                        if let Ok(iv) = serde_json::from_value::<PreviewInterval>(entry.clone()) {
                                            labels[rating as usize - 1] =
                                                client_js::format_interval(iv.interval_minutes);
                                        }
                                    }
                                }
                            }
                            reveal_start.set(js_sys::Date::now());
                            phase.set(Phase::Card {
                                card,
                                side: "front".to_string(),
                                labels,
                            });
                        }
                        "wait" => {
                            let until = v.get("until").and_then(|x| x.as_f64()).unwrap_or(0.0);
                            let until_text = client_js::format_until(until);
                            let parsed_counts = v
                                .get("counts")
                                .and_then(|c| serde_json::from_value::<StudyCounts>(c.clone()).ok())
                                .unwrap_or(StudyCounts { new_count: 0, learning: 0, review: 0 });
                            phase.set(Phase::Wait {
                                until_text,
                                counts: parsed_counts,
                            });
                        }
                        "done" => {
                            let parsed_counts = v
                                .get("counts")
                                .and_then(|c| serde_json::from_value::<StudyCounts>(c.clone()).ok())
                                .unwrap_or(StudyCounts { new_count: 0, learning: 0, review: 0 });
                            let due_text =
                                client_js::format_interval(last_interval.get_untracked());
                            phase.set(Phase::Done {
                                due_text,
                                counts: parsed_counts,
                            });
                        }
                        _ => phase.set(Phase::Error(message_for("bad_request"))),
                    }
                }
                Err(ApiError { body, .. }) => phase.set(Phase::Error(message_for(&error_code_from_body(&body)))),
            }
        });
    };

    Effect::new(move |_| {
        let deck = deck_param();
        load_next(deck);
    });

    let rate = {
        move |rating: u8| {
            let Phase::Card { card, .. } = phase.get_untracked() else {
                return;
            };
            if busy.get_untracked() {
                return;
            }
            busy.set(true);
            let elapsed = (js_sys::Date::now() - reveal_start.get_untracked()).max(0.0) as u64;
            let card_id = card.id.clone();
            let reps = card.reps;
            let deck = deck_param();
            spawn_local(async move {
                let body = serde_json::json!({
                    "cardId": card_id,
                    "rating": rating,
                    "reps": reps,
                    "elapsedMs": elapsed,
                });
                let result = api::post_json::<serde_json::Value, serde_json::Value>("/api/study/answer", &body).await;
                busy.set(false);
                match result {
                    Ok(ans) => {
                        if let Some(review) = ans.get("review") {
                            if let Ok(iv) = serde_json::from_value::<PreviewInterval>(review.clone()) {
                                last_interval.set(iv.interval_minutes);
                            }
                        }
                    }
                    Err(_) => {}
                }
                load_next(deck);
            });
        }
    };

    let undo = move || {
        if busy.get_untracked() {
            return;
        }
        busy.set(true);
        let deck = deck_param();
        spawn_local(async move {
            let _ = api::post_json::<serde_json::Value, serde_json::Value>("/api/study/undo", &serde_json::json!({})).await;
            busy.set(false);
            load_next(deck);
        });
    };

    let suspend = move || {
        let Phase::Card { card, .. } = phase.get_untracked() else {
            return;
        };
        if busy.get_untracked() {
            return;
        }
        busy.set(true);
        let deck = deck_param();
        let card_id = card.id.clone();
        spawn_local(async move {
            let _ = api::post_json::<serde_json::Value, serde_json::Value>(
                "/api/cards/suspend",
                &serde_json::json!({ "cardIds": [card_id] }),
            )
            .await;
            busy.set(false);
            load_next(deck);
        });
    };

    Effect::new(move |_| {
        let window = web_sys::window().expect("window");
        let closure = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
            if ev.alt_key() || ev.ctrl_key() || ev.meta_key() {
                return;
            }
            let target_is_field = ev.target().map(|t| target_is_text_field(&t)).unwrap_or(false);
            let target_is_button = ev
                .target()
                .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
                .map(|e| e.tag_name() == "BUTTON")
                .unwrap_or(false);
            let (side, status) = match phase.get_untracked() {
                Phase::Card { side, .. } => (side, "card"),
                Phase::Wait { .. } => (String::new(), "wait"),
                Phase::Done { .. } => (String::new(), "done"),
                _ => (String::new(), "other"),
            };
            let action = study_key_action(
                &ev.key(),
                &side,
                target_is_field,
                target_is_button,
                edit_open.get_untracked(),
                false,
                busy.get_untracked(),
                status,
            );
            match action {
                StudyKeyAction::None => {}
                StudyKeyAction::Reveal => {
                    ev.prevent_default();
                    if let Phase::Card { card, side, labels } = phase.get_untracked() {
                        if side == "front" {
                            reveal_start.set(js_sys::Date::now());
                            phase.set(Phase::Card {
                                card,
                                side: "back".to_string(),
                                labels,
                            });
                        }
                    }
                }
                StudyKeyAction::Rate(r) => {
                    ev.prevent_default();
                    rate(r);
                }
                StudyKeyAction::Undo => {
                    ev.prevent_default();
                    if status == "card" || matches!(phase.get_untracked(), Phase::Wait { .. } | Phase::Done { .. }) {
                        if message.get_untracked().is_empty() && status == "card" {
                            message.set("Nothing to undo.".to_string());
                        } else {
                            undo();
                        }
                    } else {
                        undo();
                    }
                }
                StudyKeyAction::Suspend => {
                    ev.prevent_default();
                    suspend();
                }
                StudyKeyAction::Edit => {
                    ev.prevent_default();
                    if let Phase::Card { card, .. } = phase.get_untracked() {
                        edit_card_id.set(card.id.clone());
                        edit_note_id.set(card.note_id.clone());
                        edit_fields.set(vec![card.front.clone(), card.back.clone()]);
                        edit_open.set(true);
                    }
                }
            }
        }) as Box<dyn FnMut(_)>);
        let _ = window.add_event_listener_with_callback("keydown", closure.as_ref().unchecked_ref());
        closure.forget();
    });

    view! {
        <main class="app-screen">
            <header class="app-page-header">
                <h1>"Study"</h1>
            </header>
            {move || {
                (!message.get().is_empty())
                    .then(|| view! { <p role="alert">{message.get()}</p> })
            }}
            <Show when=move || matches!(phase.get(), Phase::BadDeck)>
                <p role="alert">"That deck id is not valid."</p>
            </Show>
            <Show when=move || matches!(phase.get(), Phase::Loading)>
                <p class="app-lead">"Loading the next card…"</p>
            </Show>
            <Show when=move || matches!(phase.get(), Phase::Error(_)) fallback=|| view! {}>
                {move || match phase.get() {
                    Phase::Error(msg) => view! { <p role="alert">{msg}</p> }.into_any(),
                    _ => ().into_any(),
                }}
            </Show>
            {move || match phase.get() {
                Phase::Card { card, side, labels } => {
                    let text = if side == "front" { card.front.clone() } else { card.back.clone() };
                    let text_sig = RwSignal::new(text);
                    let note_link = card.note_id.clone();
                    view! {
                        {move || counts.get().map(|c| view! {
                            <div class="study-progress" aria-label="Queue counts">
                                <span class="app-chip app-chip-new">"New " {c.new_count}</span>
                                <span class="app-chip app-chip-learn">"Learning " {c.learning}</span>
                                <span class="app-chip app-chip-due">"Due " {c.review}</span>
                            </div>
                        })}
                        <CardHtml text=Signal::derive(move || text_sig.get()) />
                        {if side == "front" {
                            Either::Left(view! {
                                <div class="study-actions">
                                    <button
                                        type="button"
                                        class="app-action-strong"
                                        disabled=move || busy.get() || edit_open.get()
                                        on:click=move |_| {
                                            reveal_start.set(js_sys::Date::now());
                                            phase.update(|p| {
                                                if let Phase::Card { card, labels, .. } = p {
                                                    *p = Phase::Card { card: card.clone(), side: "back".into(), labels: labels.clone() };
                                                }
                                            });
                                        }
                                    >
                                        "Reveal"
                                    </button>
                                </div>
                            })
                        } else {
                            Either::Right(view! {
                                <p class="study-meta">"Rate"</p>
                                <div class="study-rate">
                                    <button type="button" disabled=move || busy.get() on:click=move |_| rate(1)>
                                        {format!("Again {}", labels[0])}
                                    </button>
                                    <button type="button" disabled=move || busy.get() on:click=move |_| rate(2)>
                                        {format!("Hard {}", labels[1])}
                                    </button>
                                    <button type="button" disabled=move || busy.get() on:click=move |_| rate(3)>
                                        {format!("Good {}", labels[2])}
                                    </button>
                                    <button type="button" disabled=move || busy.get() on:click=move |_| rate(4)>
                                        {format!("Easy {}", labels[3])}
                                    </button>
                                </div>
                            })
                        }}
                        <div class="study-toolbar" role="group" aria-label="Card tools">
                            <button type="button" disabled=move || busy.get() on:click=move |_| undo()>"Undo"</button>
                            <button type="button" disabled=move || busy.get() on:click=move |_| suspend()>"Suspend"</button>
                            <button type="button" disabled=move || busy.get() on:click=move |_| {
                                edit_card_id.set(card.id.clone());
                                edit_note_id.set(card.note_id.clone());
                                edit_fields.set(vec![card.front.clone(), card.back.clone()]);
                                edit_open.set(true);
                            }>"Edit"</button>
                            {is_uuid(&note_link).then(|| {
                                let href = format!("/notes/{note_link}");
                                view! { <a class="app-action" href=href>"Full editor"</a> }
                            })}
                        </div>
                    }
                    .into_any()
                }
                Phase::Wait { until_text, .. } => view! {
                    <section class="app-empty" aria-live="polite">
                        <h2 class="app-empty-title">"Next card soon"</h2>
                        <p class="app-lead">{format!("Available at {until_text}.")}</p>
                        <button type="button" on:click=move |_| undo()>"Undo"</button>
                    </section>
                }
                .into_any(),
                Phase::Done { due_text, .. } => view! {
                    <section class="app-empty" aria-live="polite">
                        <h2 class="app-empty-title">"No cards left."</h2>
                        <p class="app-lead">{format!("Next due in {due_text}.")}</p>
                        <button type="button" on:click=move |_| undo()>"Undo"</button>
                    </section>
                }
                .into_any(),
                _ => ().into_any(),
            }}
        </main>
        <Show when=move || edit_open.get()>
            <EditNoteDialog
                fields=edit_fields
                note_id=edit_note_id
                card_id=edit_card_id
                on_close=Callback::new(move |_| edit_open.set(false))
                on_saved=Callback::new(move |_| {
                    edit_open.set(false);
                    load_next(deck_param());
                })
            />
        </Show>
    }
}

#[component]
fn EditNoteDialog(
    fields: RwSignal<Vec<String>>,
    note_id: RwSignal<String>,
    card_id: RwSignal<String>,
    on_close: Callback<()>,
    on_saved: Callback<()>,
) -> impl IntoView {
    view! {
        <div
            class="tui-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit note"
            tabindex="-1"
            on:keydown=move |ev: web_sys::KeyboardEvent| {
                match dialog_key_action(&ev.key(), ev.shift_key(), activates_control(&ev.target().unwrap())) {
                    DialogKeyAction::Close => {
                        ev.prevent_default();
                        on_close.run(());
                    }
                    DialogKeyAction::Tab { shift } => {
                        ev.prevent_default();
                    }
                    DialogKeyAction::Prevent => ev.prevent_default(),
                    DialogKeyAction::None => {}
                }
            }
        >
            <label for="edit-field-0">"Field 1"</label>
            <textarea
                id="edit-field-0"
                aria-label="Field 1"
                prop:value=move || fields.get().first().cloned().unwrap_or_default()
                on:input=move |ev| {
                    let v = event_target_value(&ev);
                    fields.update(|f| {
                        if f.is_empty() { f.push(v); } else { f[0] = v; }
                    });
                }
            />
            <button
                type="button"
                on:click=move |_| {
                    let nid = note_id.get_untracked();
                    let snapshot = fields.get_untracked();
                    spawn_local(async move {
                        let _ = api::patch_json::<serde_json::Value, serde_json::Value>(
                            &format!("/api/notes/{nid}"),
                            &serde_json::json!({ "fields": snapshot }),
                        )
                        .await;
                        on_saved.run(());
                    });
                }
            >
                "Save"
            </button>
            <button type="button" on:click=move |_| on_close.run(())>"Cancel"</button>
        </div>
    }
}
