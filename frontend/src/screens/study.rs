use std::collections::HashMap;

use leptos::{prelude::*, task::spawn_local};
use leptos_router::hooks::use_query_map;
use serde::{Deserialize, Serialize};

use crate::api;

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum NextReply {
    Card { card: StudyCard },
    Wait { until: f64 },
    Done,
}

#[derive(Clone, Debug, Deserialize)]
struct StudyCard {
    id: String,
    reps: u32,
    front: String,
    back: String,
    previews: HashMap<String, [f64; 2]>,
}

#[derive(Clone, Debug)]
enum StudyLoad {
    Loading,
    Ready(NextReply),
    Error(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnswerRequest {
    card_id: String,
    rating: u8,
    reps: u32,
    elapsed_ms: u64,
}

#[component]
pub fn StudyScreen() -> impl IntoView {
    let query = use_query_map();
    let state = RwSignal::new(StudyLoad::Loading);
    let revealed = RwSignal::new(false);
    let submitting = RwSignal::new(false);
    let shown_at = RwSignal::new(0.0);
    let refresh = RwSignal::new(0u32);

    Effect::new(move |_| {
        refresh.get();
        let deck = query.with(|query| query.get("deck"));

        if let Some(deck) = deck.as_deref() {
            if !is_valid_uuid(deck) {
                revealed.set(false);
                submitting.set(false);
                state.set(StudyLoad::Error("That deck id is not valid.".to_string()));
                return;
            }
        }

        let path = match deck {
            Some(deck) => format!("/api/study/next?deckId={deck}"),
            None => "/api/study/next".to_string(),
        };

        revealed.set(false);
        submitting.set(false);
        state.set(StudyLoad::Loading);

        spawn_local(async move {
            match api::get_json::<NextReply>(&path).await {
                Ok(reply) => {
                    shown_at.set(js_sys::Date::now());
                    state.set(StudyLoad::Ready(reply));
                }
                Err(_) => state.set(StudyLoad::Error("Could not load study cards.".to_string())),
            }
        });
    });

    view! {
        <section class="screen-study">
            <h1>"Study"</h1>
            {move || match state.get() {
                StudyLoad::Loading => view! { <p>"Loading..."</p> }.into_any(),
                StudyLoad::Error(message) => {
                    view! { <p role="alert">{message}</p> }.into_any()
                }
                StudyLoad::Ready(NextReply::Done) => {
                    view! { <p>"No cards left."</p> }.into_any()
                }
                StudyLoad::Ready(NextReply::Wait { until }) => {
                    view! { <p>{format!("Available at {}", format_date(until))}</p> }
                        .into_any()
                }
                StudyLoad::Ready(NextReply::Card { card }) => {
                    let front = card.front.clone();
                    let back = card.back.clone();
                    let rating_buttons = [1u8, 2, 3, 4]
                        .into_iter()
                        .map(|rating| {
                            let name = match rating {
                                1 => "Again",
                                2 => "Hard",
                                3 => "Good",
                                _ => "Easy",
                            };
                            let label = format!(
                                "{name} {}",
                                preview_interval(&card, rating)
                            );
                            let answer_card = card.clone();
                            view! {
                                <button
                                    type="button"
                                    class="study-rate"
                                    disabled=move || submitting.get()
                                    on:click=move |_| submit_answer(
                                        answer_card.clone(),
                                        rating,
                                        submitting,
                                        shown_at,
                                        refresh,
                                        state,
                                    )
                                >
                                    {label}
                                </button>
                            }
                        })
                        .collect_view();
                    view! {
                        <div class="study-card">
                            // Card front/back are HTML fragments by server contract:
                            // the BASIC template renders the back as
                            // `{{Front}}<hr>{{Back}}` (Anki-style), and field values
                            // are substituted raw. Rendering as text would show
                            // users literal `<hr>` markup. This matches the v1 UI.
                            // NOTE: no sanitization — a field containing markup
                            // executes, same trust model as v1; R11 proper should
                            // decide on sanitizing (server escape or client-side).
                            <div class="study-front" inner_html={front}></div>
                            {move || {
                                if revealed.get() {
                                    view! {
                                        <div class="study-back" inner_html={back.clone()}></div>
                                        <div class="study-ratings">{rating_buttons.clone()}</div>
                                    }
                                    .into_any()
                                } else {
                                    view! {
                                        <button
                                            type="button"
                                            on:click=move |_| revealed.set(true)
                                        >
                                            "Reveal"
                                        </button>
                                    }
                                    .into_any()
                                }
                            }}
                        </div>
                    }
                    .into_any()
                }
            }}
        </section>
    }
}

fn submit_answer(
    card: StudyCard,
    rating: u8,
    submitting: RwSignal<bool>,
    shown_at: RwSignal<f64>,
    refresh: RwSignal<u32>,
    state: RwSignal<StudyLoad>,
) {
    if submitting.get_untracked() {
        return;
    }

    submitting.set(true);
    let elapsed_ms = (js_sys::Date::now() - shown_at.get_untracked())
        .max(0.0)
        .round() as u64;
    let request = AnswerRequest {
        card_id: card.id,
        rating,
        reps: card.reps,
        elapsed_ms,
    };

    spawn_local(async move {
        match api::post_json_csrf::<serde_json::Value, _>("/api/study/answer", &request).await {
            Ok(_) => {}
            Err(error) if error.status == 409 => {}
            Err(_) => {
                submitting.set(false);
                state.set(StudyLoad::Error("Could not save your answer.".to_string()));
                return;
            }
        }

        submitting.set(false);
        refresh.update(|value| *value += 1);
    });
}

fn preview_interval(card: &StudyCard, rating: u8) -> String {
    card.previews
        .get(&rating.to_string())
        .map(|preview| {
            let minutes = preview[1];
            if !minutes.is_finite() || minutes < 0.0 {
                "0m".to_string()
            } else {
                format_interval(minutes as u32)
            }
        })
        .unwrap_or_else(|| "0m".to_string())
}

fn format_interval(minutes: u32) -> String {
    if minutes < 60 {
        format!("{minutes}m")
    } else if minutes < 1440 {
        if minutes % 60 == 0 {
            format!("{}h", minutes / 60)
        } else {
            format!("{minutes}m")
        }
    } else if minutes % 1440 == 0 {
        format!("{}d", minutes / 1440)
    } else {
        format!("{minutes}m")
    }
}

fn format_date(milliseconds: f64) -> String {
    let date = js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(milliseconds));
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let month = months[date.get_month() as usize];
    let hours = date.get_hours();
    let suffix = if hours < 12 { "AM" } else { "PM" };
    let hour = match hours % 12 {
        0 => 12,
        hour => hour,
    };

    format!(
        "{} {}, {}, {}:{:02} {}",
        month,
        date.get_date(),
        date.get_full_year(),
        hour,
        date.get_minutes(),
        suffix
    )
}

fn is_valid_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}
