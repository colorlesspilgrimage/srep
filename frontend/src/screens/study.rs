use leptos::{prelude::*, task::spawn_local};
use leptos_router::hooks::use_query_map;
use serde::{Deserialize, Serialize};
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{HtmlElement, KeyboardEvent};

use crate::{
    api, sanitize,
    study_controller::{NextReply, OnlineStudyController, StudyCard, StudyController},
};

#[derive(Clone, Debug)]
enum StudyLoad {
    Loading,
    Ready(NextReply),
    Error(String),
}

#[derive(Clone, Copy)]
struct StudySignals {
    state: RwSignal<StudyLoad>,
    revealed: RwSignal<bool>,
    submitting: RwSignal<bool>,
    shown_at: RwSignal<f64>,
    refresh: RwSignal<u32>,
    status_message: RwSignal<Option<String>>,
    last_next: RwSignal<Option<String>>,
    edit_open: RwSignal<bool>,
    edit_loading: RwSignal<bool>,
    edit_saving: RwSignal<bool>,
    edit_error: RwSignal<Option<String>>,
    edit_fields: RwSignal<Vec<String>>,
    edit_note_id: RwSignal<Option<String>>,
    commands_open: RwSignal<bool>,
}

#[derive(Debug, Deserialize)]
struct NoteReply {
    note: NoteData,
}

#[derive(Debug, Deserialize)]
struct NoteData {
    fields: Vec<String>,
}

#[derive(Serialize)]
struct UpdateNoteRequest {
    fields: Vec<String>,
}

#[derive(Clone, Copy)]
enum CardOperation {
    Suspend,
    Bury,
}

#[derive(Clone, Copy)]
enum StudyCommand {
    Reveal,
    Rate(u8),
    Undo,
    Suspend,
    Bury,
    Edit,
}

const COMMANDS: [(StudyCommand, &str); 9] = [
    (StudyCommand::Reveal, "Reveal Space"),
    (StudyCommand::Rate(1), "Again 1"),
    (StudyCommand::Rate(2), "Hard 2"),
    (StudyCommand::Rate(3), "Good 3"),
    (StudyCommand::Rate(4), "Easy 4"),
    (StudyCommand::Undo, "Undo u"),
    (StudyCommand::Suspend, "Suspend s"),
    (StudyCommand::Bury, "Bury b"),
    (StudyCommand::Edit, "Edit e"),
];

fn current_card(state: &StudyLoad) -> Option<StudyCard> {
    match state {
        StudyLoad::Ready(NextReply::Card { card, .. }) => Some(card.clone()),
        _ => None,
    }
}

#[component]
pub fn StudyScreen() -> impl IntoView {
    let query = use_query_map();
    let controller = OnlineStudyController;
    let signals = StudySignals {
        state: RwSignal::new(StudyLoad::Loading),
        revealed: RwSignal::new(false),
        submitting: RwSignal::new(false),
        shown_at: RwSignal::new(0.0),
        refresh: RwSignal::new(0u32),
        status_message: RwSignal::new(None),
        last_next: RwSignal::new(None),
        edit_open: RwSignal::new(false),
        edit_loading: RwSignal::new(false),
        edit_saving: RwSignal::new(false),
        edit_error: RwSignal::new(None),
        edit_fields: RwSignal::new(Vec::new()),
        edit_note_id: RwSignal::new(None),
        commands_open: RwSignal::new(false),
    };
    let edit_dialog = NodeRef::<leptos::html::Div>::new();
    let edit_button = NodeRef::<leptos::html::Button>::new();

    Effect::new(move |_| {
        signals.refresh.get();
        let deck = query.with(|query| query.get("deck"));

        if let Some(deck) = deck.as_deref() {
            if !is_valid_uuid(deck) {
                signals.revealed.set(false);
                signals.submitting.set(false);
                signals
                    .state
                    .set(StudyLoad::Error("That deck id is not valid.".to_string()));
                return;
            }
        }

        signals.revealed.set(false);
        signals.submitting.set(false);
        signals.commands_open.set(false);
        signals.status_message.set(None);
        signals.state.set(StudyLoad::Loading);

        spawn_local(async move {
            match controller.next(deck).await {
                Ok(reply) => {
                    signals.shown_at.set(js_sys::Date::now());
                    signals.state.set(StudyLoad::Ready(reply));
                }
                Err(_) => {
                    signals
                        .state
                        .set(StudyLoad::Error("Could not load study cards.".to_string()));
                }
            }
        });
    });

    Effect::new(move |_| {
        let handle = window_event_listener(leptos::ev::keydown, move |event| {
            handle_study_key(event, controller, signals, edit_dialog, edit_button);
        });
        on_cleanup(move || handle.remove());
    });

    Effect::new(move |_| {
        if signals.edit_open.get() && !signals.edit_loading.get() {
            focus_first(edit_dialog);
        }
    });

    view! {
        <section class="screen-study">
            <h1>"Study"</h1>
            {move || match signals.state.get() {
                StudyLoad::Loading => view! { <p>"Loading..."</p> }.into_any(),
                StudyLoad::Error(message) => {
                    view! { <p role="alert">{message}</p> }.into_any()
                }
                StudyLoad::Ready(reply) => ready_view(reply, controller, signals, edit_button),
            }}
            {move || signals.status_message.get().map(|message| {
                view! { <p role="status">{message}</p> }
            })}
            {move || commands_view(controller, signals)}
            {move || edit_view(signals, edit_dialog, edit_button)}
        </section>
    }
}

fn ready_view(
    reply: NextReply,
    controller: OnlineStudyController,
    signals: StudySignals,
    edit_button: NodeRef<leptos::html::Button>,
) -> AnyView {
    let counts = reply.counts().clone();
    let body = match reply {
        NextReply::Done { .. } => {
            let next = signals.last_next.get();
            view! {
                <div>
                    <p>"No cards left."</p>
                    {next.map(|interval| view! { <p>{format!("Next due in {interval}")}</p> })}
                </div>
            }
            .into_any()
        }
        NextReply::Wait { until, .. } => {
            view! { <p>{format!("Available at {}.", format_date(until))}</p> }.into_any()
        }
        NextReply::Card { card, .. } => card_view(card, controller, signals, edit_button),
    };

    view! {
        <div class="study-counts">
            <span>{format!("New {}", counts.new)}</span>
            <span>{format!("Learning {}", counts.learning)}</span>
            <span>{format!("Due {}", counts.review)}</span>
        </div>
        {body}
    }
    .into_any()
}

fn card_view(
    card: StudyCard,
    controller: OnlineStudyController,
    signals: StudySignals,
    edit_button: NodeRef<leptos::html::Button>,
) -> AnyView {
    // Fields are raw HTML by server contract. Sanitize with a deliberately small
    // allowlist: BASIC's <hr> and formatting survive; active content does not.
    let front = sanitize::card_html(&card.front);
    let back = sanitize::card_html(&card.back);
    let rating_buttons = [1u8, 2, 3, 4]
        .into_iter()
        .map(|rating| {
            let name = match rating {
                1 => "Again",
                2 => "Hard",
                3 => "Good",
                _ => "Easy",
            };
            let label = format!("{name} {}", preview_interval(&card, rating));
            let answer_card = card.clone();
            view! {
                <button
                    type="button"
                    class="study-rate"
                    disabled=move || signals.submitting.get() || signals.edit_open.get()
                    on:click=move |_| {
                        submit_answer(answer_card.clone(), rating, controller, signals)
                    }
                >
                    {label}
                </button>
            }
        })
        .collect_view();
    let undo_card = card.clone();
    let suspend_card = card.clone();
    let edit_card = card.clone();

    view! {
        <div class="study-card">
            <div class="study-front" inner_html=front></div>
            {move || {
                if signals.revealed.get() {
                    view! {
                        <div class="study-back" inner_html=back.clone()></div>
                        <div class="study-ratings">{rating_buttons.clone()}</div>
                    }
                    .into_any()
                } else {
                    ().into_any()
                }
            }}
            <div class="study-actions">
                {move || {
                    if signals.revealed.get() {
                        ().into_any()
                    } else {
                        view! {
                            <button type="button" on:click=move |_| signals.revealed.set(true)>
                                "Reveal"
                            </button>
                        }
                        .into_any()
                    }
                }}
                <button
                    type="button"
                    disabled=move || signals.submitting.get() || signals.edit_open.get()
                    on:click=move |_| {
                        let _ = &undo_card;
                        undo_answer(controller, signals);
                    }
                >
                    "Undo"
                </button>
                <button
                    type="button"
                    disabled=move || signals.submitting.get() || signals.edit_open.get()
                    on:click=move |_| operate_card(
                        suspend_card.clone(),
                        CardOperation::Suspend,
                        controller,
                        signals,
                    )
                >
                    "Suspend"
                </button>
                <button
                    node_ref=edit_button
                    type="button"
                    disabled=move || signals.submitting.get() || signals.edit_open.get()
                    on:click=move |_| open_edit(edit_card.note_id.clone(), signals)
                >
                    "Edit"
                </button>
            </div>
        </div>
    }
    .into_any()
}

fn commands_view(controller: OnlineStudyController, signals: StudySignals) -> AnyView {
    if !signals.commands_open.get() {
        return ().into_any();
    }

    let buttons = COMMANDS
        .into_iter()
        .map(|(command, label)| {
            view! {
                <button
                    type="button"
                    disabled=move || command_disabled(command, signals)
                    on:click=move |_| run_command(command, controller, signals)
                >
                    {label}
                </button>
            }
        })
        .collect_view();

    view! {
        <div class="study-dialog-backdrop">
            <div class="study-dialog commands-dialog" role="dialog" aria-modal="true" aria-label="Commands">
                <h2>"Commands"</h2>
                <div class="command-list">{buttons}</div>
            </div>
        </div>
    }
    .into_any()
}

fn command_disabled(command: StudyCommand, signals: StudySignals) -> bool {
    let card = current_card(&signals.state.get());
    match command {
        StudyCommand::Reveal => card.is_none() || signals.revealed.get(),
        StudyCommand::Rate(_) => {
            card.is_none() || !signals.revealed.get() || signals.submitting.get()
        }
        StudyCommand::Undo => signals.submitting.get(),
        StudyCommand::Suspend | StudyCommand::Bury | StudyCommand::Edit => {
            card.is_none() || signals.submitting.get()
        }
    }
}

fn run_command(command: StudyCommand, controller: OnlineStudyController, signals: StudySignals) {
    signals.commands_open.set(false);
    let card = current_card(&signals.state.get_untracked());
    match command {
        StudyCommand::Reveal => {
            if card.is_some() {
                signals.revealed.set(true);
            }
        }
        StudyCommand::Rate(rating) => {
            if signals.revealed.get_untracked() {
                if let Some(card) = card {
                    submit_answer(card, rating, controller, signals);
                }
            }
        }
        StudyCommand::Undo => undo_answer(controller, signals),
        StudyCommand::Suspend => {
            if let Some(card) = card {
                operate_card(card, CardOperation::Suspend, controller, signals);
            }
        }
        StudyCommand::Bury => {
            if let Some(card) = card {
                operate_card(card, CardOperation::Bury, controller, signals);
            }
        }
        StudyCommand::Edit => {
            if let Some(card) = card {
                open_edit(card.note_id, signals);
            }
        }
    }
}

fn edit_view(
    signals: StudySignals,
    edit_dialog: NodeRef<leptos::html::Div>,
    edit_button: NodeRef<leptos::html::Button>,
) -> AnyView {
    if !signals.edit_open.get() {
        return ().into_any();
    }

    view! {
        <div class="study-dialog-backdrop">
            <div
                node_ref=edit_dialog
                class="study-dialog edit-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Edit note"
            >
                <h2>"Edit note"</h2>
                {move || signals.edit_loading.get().then(|| view! { <p>"Loading..."</p> })}
                {move || signals.edit_error.get().map(|error| {
                    view! { <p role="alert">{error}</p> }
                })}
                <div class="edit-fields">
                    {move || signals.edit_fields.get().into_iter().enumerate().map(|(index, value)| {
                        view! {
                            <label>
                                {format!("Field {}", index + 1)}
                                <input
                                    type="text"
                                    prop:value=value
                                    on:input=move |event| {
                                        let value = event_target_value(&event);
                                        signals.edit_fields.update(|fields| {
                                            if let Some(field) = fields.get_mut(index) {
                                                *field = value;
                                            }
                                        });
                                    }
                                />
                            </label>
                        }
                    }).collect_view()}
                </div>
                <button
                    type="button"
                    disabled=move || signals.edit_loading.get() || signals.edit_saving.get()
                    on:click=move |_| save_edit(signals, edit_button)
                >
                    "Save"
                </button>
            </div>
        </div>
    }
    .into_any()
}

fn handle_study_key(
    event: KeyboardEvent,
    controller: OnlineStudyController,
    signals: StudySignals,
    edit_dialog: NodeRef<leptos::html::Div>,
    edit_button: NodeRef<leptos::html::Button>,
) {
    let key = event.key();
    if signals.commands_open.get_untracked() {
        if key == "Escape" {
            event.prevent_default();
            signals.commands_open.set(false);
        }
        return;
    }
    if signals.edit_open.get_untracked() {
        match key.as_str() {
            "Escape" => {
                event.prevent_default();
                close_edit(signals, edit_button);
            }
            "Tab" => trap_focus(&event, edit_dialog),
            "Enter" => {
                event.prevent_default();
                save_edit(signals, edit_button);
            }
            _ => {
                // Ctrl+K is a control chord (it never types text), so it opens
                // the commands overlay even from inside a field. ':' is a
                // printable character: it opens commands only when the user is
                // not typing in a field.
                if event.ctrl_key() && key.eq_ignore_ascii_case("k") {
                    event.prevent_default();
                    signals.commands_open.set(true);
                } else if key == ":" && !event_target_is_text_input(&event) {
                    event.prevent_default();
                    signals.commands_open.set(true);
                }
            }
        }
        return;
    }
    if event_target_is_form_control(&event) || signals.submitting.get_untracked() {
        return;
    }
    if event.ctrl_key() && key.eq_ignore_ascii_case("k") {
        event.prevent_default();
        signals.commands_open.set(true);
        return;
    }
    if event.ctrl_key() || event.meta_key() || event.alt_key() {
        return;
    }

    let card = current_card(&signals.state.get_untracked());
    match key.as_str() {
        " " | "Spacebar" | "Enter" => {
            if card.is_some() && !signals.revealed.get_untracked() {
                event.prevent_default();
                signals.revealed.set(true);
            }
        }
        "1" | "2" | "3" | "4" => {
            if signals.revealed.get_untracked() {
                if let Some(card) = card {
                    let rating = key.parse::<u8>().unwrap_or(1);
                    submit_answer(card, rating, controller, signals);
                }
            }
        }
        "u" => undo_answer(controller, signals),
        "s" => {
            if let Some(card) = card {
                operate_card(card, CardOperation::Suspend, controller, signals);
            }
        }
        "b" => {
            if let Some(card) = card {
                operate_card(card, CardOperation::Bury, controller, signals);
            }
        }
        "e" => {
            if let Some(card) = card {
                open_edit(card.note_id, signals);
            }
        }
        ":" => signals.commands_open.set(true),
        "Escape" => {
            signals.commands_open.set(false);
            signals.edit_open.set(false);
        }
        _ => {}
    }
}

fn submit_answer(
    card: StudyCard,
    rating: u8,
    controller: OnlineStudyController,
    signals: StudySignals,
) {
    if signals.submitting.get_untracked() {
        return;
    }
    signals.submitting.set(true);
    signals.last_next.set(Some(preview_interval(&card, rating)));
    let elapsed_ms = (js_sys::Date::now() - signals.shown_at.get_untracked())
        .max(0.0)
        .round() as u64;

    spawn_local(async move {
        if controller
            .answer(&card.id, rating, card.reps, elapsed_ms)
            .await
            .is_err()
        {
            signals.submitting.set(false);
            signals.last_next.set(None);
            signals
                .state
                .set(StudyLoad::Error("Could not save your answer.".to_string()));
            return;
        }
        signals.submitting.set(false);
        signals.refresh.update(|value| *value += 1);
    });
}

fn undo_answer(controller: OnlineStudyController, signals: StudySignals) {
    if signals.submitting.get_untracked() {
        return;
    }
    signals.submitting.set(true);
    signals.status_message.set(None);
    spawn_local(async move {
        match controller.undo().await {
            Ok(()) => {
                signals.last_next.set(None);
                signals.submitting.set(false);
                signals.refresh.update(|value| *value += 1);
            }
            Err(error) if error.status == 404 => {
                signals.submitting.set(false);
                signals
                    .status_message
                    .set(Some("Nothing to undo.".to_string()));
            }
            Err(_) => {
                signals.submitting.set(false);
                signals
                    .state
                    .set(StudyLoad::Error("Could not undo your answer.".to_string()));
            }
        }
    });
}

fn operate_card(
    card: StudyCard,
    operation: CardOperation,
    controller: OnlineStudyController,
    signals: StudySignals,
) {
    if signals.submitting.get_untracked() {
        return;
    }
    signals.submitting.set(true);
    spawn_local(async move {
        let result = match operation {
            CardOperation::Suspend => controller.suspend(&card.id).await,
            CardOperation::Bury => controller.bury(&card.id).await,
        };
        if result.is_err() {
            signals.submitting.set(false);
            signals
                .state
                .set(StudyLoad::Error("Could not update the card.".to_string()));
            return;
        }
        signals.last_next.set(None);
        signals.submitting.set(false);
        signals.refresh.update(|value| *value += 1);
    });
}

fn open_edit(note_id: String, signals: StudySignals) {
    if signals.edit_open.get_untracked() {
        return;
    }
    signals.edit_open.set(true);
    signals.edit_loading.set(true);
    signals.edit_error.set(None);
    signals.edit_fields.set(Vec::new());
    signals.edit_note_id.set(Some(note_id.clone()));

    spawn_local(async move {
        match api::get_json::<NoteReply>(&format!("/api/notes/{note_id}")).await {
            Ok(reply) => {
                signals.edit_fields.set(reply.note.fields);
                signals.edit_loading.set(false);
            }
            Err(_) => {
                signals.edit_loading.set(false);
                signals
                    .edit_error
                    .set(Some("Could not load the note.".to_string()));
            }
        }
    });
}

fn save_edit(signals: StudySignals, edit_button: NodeRef<leptos::html::Button>) {
    if signals.edit_loading.get_untracked() || signals.edit_saving.get_untracked() {
        return;
    }
    let Some(note_id) = signals.edit_note_id.get_untracked() else {
        return;
    };
    signals.edit_saving.set(true);
    signals.edit_error.set(None);
    let request = UpdateNoteRequest {
        fields: signals.edit_fields.get_untracked(),
    };

    spawn_local(async move {
        match api::patch_json_csrf::<NoteReply, _>(&format!("/api/notes/{note_id}"), &request).await
        {
            Ok(_) => {
                close_edit(signals, edit_button);
                signals.status_message.set(Some("Note saved.".to_string()));
                signals.refresh.update(|value| *value += 1);
            }
            Err(_) => {
                signals.edit_saving.set(false);
                signals
                    .edit_error
                    .set(Some("Could not save the note.".to_string()));
            }
        }
    });
}

fn close_edit(signals: StudySignals, edit_button: NodeRef<leptos::html::Button>) {
    signals.edit_open.set(false);
    signals.edit_loading.set(false);
    signals.edit_saving.set(false);
    signals.edit_error.set(None);

    if let Some(button) = edit_button.get() {
        if let Ok(button) = button.dyn_into::<HtmlElement>() {
            let _ = button.focus();
        }
    }
}

fn focus_first(dialog: NodeRef<leptos::html::Div>) {
    let Some(dialog) = dialog.get() else {
        return;
    };
    let Ok(dialog) = dialog.dyn_into::<HtmlElement>() else {
        return;
    };

    if let Ok(Some(first)) = dialog.query_selector("input:not([disabled]), button:not([disabled])")
    {
        if let Ok(first) = first.dyn_into::<HtmlElement>() {
            let _ = first.focus();
        }
    }
}

fn trap_focus(event: &KeyboardEvent, dialog: NodeRef<leptos::html::Div>) {
    let Some(dialog) = dialog.get() else {
        return;
    };
    let Ok(dialog) = dialog.dyn_into::<HtmlElement>() else {
        return;
    };
    let Ok(elements) =
        dialog.query_selector_all("input:not([disabled]), button:not([disabled]), [tabindex='0']")
    else {
        return;
    };
    if elements.length() == 0 {
        return;
    }

    let Some(first) = elements
        .item(0)
        .and_then(|element| element.dyn_into::<HtmlElement>().ok())
    else {
        return;
    };
    let Some(last) = elements
        .item(elements.length() - 1)
        .and_then(|element| element.dyn_into::<HtmlElement>().ok())
    else {
        return;
    };
    let active = web_sys::window()
        .and_then(|window| window.document())
        .and_then(|document| document.active_element());

    let at_first = active
        .as_ref()
        .is_some_and(|active| JsValue::from(active.clone()) == JsValue::from(first.clone()));
    let at_last = active
        .as_ref()
        .is_some_and(|active| JsValue::from(active.clone()) == JsValue::from(last.clone()));

    if event.shift_key() && at_first {
        event.prevent_default();
        let _ = last.focus();
    } else if !event.shift_key() && at_last {
        event.prevent_default();
        let _ = first.focus();
    }
}

fn event_target_is_text_input(event: &KeyboardEvent) -> bool {
    event
        .target()
        .and_then(|target| target.dyn_into::<HtmlElement>().ok())
        .is_some_and(|element| {
            matches!(element.tag_name().as_str(), "INPUT" | "TEXTAREA" | "SELECT")
                || element.is_content_editable()
        })
}

fn event_target_is_form_control(event: &KeyboardEvent) -> bool {
    // Buttons and links keep working with shortcuts (Space/Enter still
    // activate the focused button via its default click); only text-entry
    // targets swallow keys.
    event_target_is_text_input(event)
}

fn preview_interval(card: &StudyCard, rating: u8) -> String {
    // Previews are [due_timestamp_ms, interval_minutes] (see
    // preview_answers in crates/srep-study/src/fsrs_adapter.rs).
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
    let date = js_sys::Date::new(&JsValue::from_f64(milliseconds));
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
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}
