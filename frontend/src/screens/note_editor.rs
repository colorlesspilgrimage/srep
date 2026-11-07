use leptos::prelude::*;
use leptos_router::hooks::{use_navigate, use_params_map, use_query_map};
use serde::Deserialize;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, error_code_from_body, message_for, ApiError};
use crate::client_js;
use crate::id_util::is_uuid;
use crate::webauthn_client;

const PREVIEW_DELAY_MS: i32 = 200;
const PREVIEW_FAILED: &str = "The preview failed.";
const DUPLICATE_TEXT: &str = "A note with this first field already exists.";
const INVALID_ID: &str = "That note id is not valid.";

#[derive(Debug, Clone, Deserialize)]
struct EditorDeck {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct EditorType {
    id: String,
    name: String,
    fields: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct PreviewCard {
    #[serde(rename = "templateName")]
    template_name: String,
    front: String,
    back: String,
}

#[derive(Debug, Clone, Deserialize)]
struct NoteBody {
    id: String,
    #[serde(rename = "noteTypeId")]
    note_type_id: String,
  fields: Vec<String>,
    tags: Vec<String>,
    #[serde(rename = "deckId")]
    deck_id: String,
    duplicates: Vec<String>,
}

fn split_tags(text: &str) -> Vec<String> {
    text.split_whitespace().map(|s| s.to_string()).collect()
}

fn pick_basic(types: &[EditorType]) -> Option<String> {
    types
        .iter()
        .find(|t| t.name == "Basic")
        .map(|t| t.id.clone())
        .or_else(|| types.first().map(|t| t.id.clone()))
}

fn deck_index(decks: &[EditorDeck], deck_id: Option<&str>) -> usize {
    let Some(id) = deck_id else {
        return 0;
    };
    decks
        .iter()
        .position(|d| d.id == id)
        .unwrap_or(0)
}

#[component]
pub fn NoteEditorScreen(
    #[prop(default = "new".to_string())] mode: String,
    #[prop(default = String::new())] note_id: String,
) -> impl IntoView {
    let query = use_query_map();
    let navigate = use_navigate();
    let types = RwSignal::new(Vec::<EditorType>::new());
    let decks = RwSignal::new(Vec::<EditorDeck>::new());
    let note_type_id = RwSignal::new(String::new());
    let fields = RwSignal::new(Vec::<String>::new());
    let tag_text = RwSignal::new(String::new());
    let deck_index_sig = RwSignal::new(0usize);
    let preview_cards = RwSignal::new(Vec::<PreviewCard>::new());
    let message = RwSignal::new(String::new());
    let preview_alert = RwSignal::new(String::new());
    let ready = RwSignal::new(false);
    let busy = RwSignal::new(false);
    let preview_serial = RwSignal::new(0i32);
    let active_field = RwSignal::new(0usize);
    let caret_start = RwSignal::new(0u32);
    let caret_end = RwSignal::new(0u32);

    let mode_store = StoredValue::new(mode);
    let note_id_store = StoredValue::new(note_id);
    let type_locked = mode_store.with_value(|m| m == "edit");
    let heading = move || {
        if mode_store.with_value(|m| m == "new") {
            "Add note"
        } else {
            "Edit note"
        }
    };

    let field_names = move || {
        types
            .get()
            .iter()
            .find(|t| t.id == note_type_id.get())
            .map(|t| t.fields.clone())
            .unwrap_or_default()
    };

    let schedule_preview = {
        let preview_serial = preview_serial;
        let preview_cards = preview_cards;
        let preview_alert = preview_alert;
        let note_type_id = note_type_id;
        let fields = fields;
        move || {
            preview_serial.update(|s| *s += 1);
            let mine = preview_serial.get_untracked();
            if let Some(window) = web_sys::window() {
                let cb = Closure::once(Box::new(move || {
                    spawn_local(async move {
                        if mine != preview_serial.get_untracked() {
                            return;
                        }
                        let field_count = fields.get_untracked().len();
                        let mut dom_fields = Vec::with_capacity(field_count);
                        if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
                            for index in 0..field_count {
                                let val = doc
                                    .get_element_by_id(&format!("note-field-{index}"))
                                    .and_then(|el| el.dyn_into::<web_sys::HtmlTextAreaElement>().ok())
                                    .map(|t| t.value())
                                    .unwrap_or_else(|| {
                                        fields
                                            .get_untracked()
                                            .get(index)
                                            .cloned()
                                            .unwrap_or_default()
                                    });
                                dom_fields.push(val);
                            }
                        } else {
                            dom_fields = fields.get_untracked();
                        }
                        let body = serde_json::json!({
                            "noteTypeId": note_type_id.get_untracked(),
                            "fields": dom_fields,
                        });
                        match api::post_json::<serde_json::Value, serde_json::Value>(
                            "/api/notes/preview",
                            &body,
                        )
                        .await
                        {
                            Ok(v) => {
                                if mine != preview_serial.get_untracked() {
                                    return;
                                }
                                let cards: Option<Vec<PreviewCard>> = v
                                    .get("cards")
                                    .and_then(|c| serde_json::from_value(c.clone()).ok());
                                if let Some(cards) = cards {
                                    preview_alert.set(String::new());
                                    preview_cards.set(cards);
                                } else {
                                    preview_alert.set(PREVIEW_FAILED.to_string());
                                }
                            }
                            Err(_) => {
                                if mine == preview_serial.get_untracked() {
                                    preview_alert.set(PREVIEW_FAILED.to_string());
                                }
                            }
                        }
                    });
                }) as Box<dyn FnMut()>);
                let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                    cb.as_ref().unchecked_ref(),
                    PREVIEW_DELAY_MS,
                );
                cb.forget();
            }
        }
    };

    Effect::new(move |_| {
        let mode = mode_store.with_value(|m| m.clone());
        let note_id = note_id_store.with_value(|m| m.clone());
        spawn_local(async move {
            webauthn_client::sync_csrf_from_status().await;
            #[derive(Deserialize)]
            struct DecksBody {
                decks: Vec<EditorDeck>,
            }
            #[derive(Deserialize)]
            struct TypesBody {
                #[serde(rename = "noteTypes")]
                note_types: Vec<EditorType>,
            }
            let listed = api::get_json::<DecksBody>("/api/decks").await;
            let typed = api::get_json::<TypesBody>("/api/note-types").await;
            if let (Ok(decks_body), Ok(types_body)) = (listed, typed) {
                let deck_rows = decks_body.decks.clone();
                decks.set(deck_rows.clone());
                types.set(types_body.note_types.clone());
                let initial_deck = query
                    .with_untracked(|q| q.get("deck").map(|s| s.to_string()))
                    .filter(|s| is_uuid(s));
                if mode == "new" {
                    let tid = pick_basic(&types_body.note_types).unwrap_or_default();
                    note_type_id.set(tid.clone());
                    let count = types_body
                        .note_types
                        .iter()
                        .find(|t| t.id == tid)
                        .map(|t| t.fields.len())
                        .unwrap_or(2);
                    fields.set(vec![String::new(); count]);
                    deck_index_sig.set(deck_index(&deck_rows, initial_deck.as_deref()));
                    schedule_preview();
                } else if !note_id.is_empty() {
                    let id = note_id.clone();
                    if is_uuid(&id) {
                        if let Ok(body) =
                            api::get_json::<serde_json::Value>(&format!("/api/notes/{id}")).await
                        {
                            if let Ok(note) =
                                serde_json::from_value::<NoteBody>(body.get("note").cloned().unwrap_or_default())
                            {
                                note_type_id.set(note.note_type_id);
                                fields.set(note.fields);
                                tag_text.set(note.tags.join(" "));
                                deck_index_sig.set(deck_index(&deck_rows, Some(&note.deck_id)));
                                if !note.duplicates.is_empty() {
                                    message.set(DUPLICATE_TEXT.to_string());
                                }
                                schedule_preview();
                            }
                        }
                    }
                }
            }
            ready.set(true);
        });
    });

    let on_field_input = move |index: usize, value: String| {
        if busy.get_untracked() {
            return;
        }
        fields.update(|f| {
            if index < f.len() {
                f[index] = value;
            }
        });
        schedule_preview();
    };

    let on_save = move |_| {
            let mode = mode_store.with_value(|m| m.clone());
            let note_id = note_id_store.with_value(|m| m.clone());
            let navigate = navigate.clone();
            if busy.get_untracked() || !ready.get_untracked() {
                return;
            }
            let deck = decks
                .get_untracked()
                .get(deck_index_sig.get_untracked())
                .map(|d| d.id.clone());
            let Some(deck_id) = deck else {
                message.set(message_for("bad_request"));
                return;
            };
            let tags = split_tags(&tag_text.get_untracked());
            busy.set(true);
            message.set(String::new());
            let fields_snapshot = fields.get_untracked();
            let note_type = note_type_id.get_untracked();
            spawn_local(async move {
                let result = if mode == "new" {
                    api::post_json::<serde_json::Value, serde_json::Value>(
                        "/api/notes",
                        &serde_json::json!({
                            "noteTypeId": note_type,
                            "deckId": deck_id,
                            "fields": fields_snapshot,
                            "tags": tags,
                        }),
                    )
                    .await
                } else if !note_id.is_empty() {
                    api::patch_json::<serde_json::Value, serde_json::Value>(
                        &format!("/api/notes/{note_id}"),
                        &serde_json::json!({
                            "fields": fields_snapshot,
                            "tags": tags,
                            "deckId": deck_id,
                        }),
                    )
                    .await
                } else {
                    Err(ApiError {
                        status: 0,
                        body: "bad_request".into(),
                    })
                };
                busy.set(false);
                match result {
                    Ok(body) => {
                        let Ok(note) = serde_json::from_value::<NoteBody>(
                            body.get("note").cloned().unwrap_or_default(),
                        ) else {
                            message.set(message_for("bad_request"));
                            return;
                        };
                        if mode == "new" {
                            navigate(&format!("/notes/{}", note.id), Default::default());
                            return;
                        }
                        fields.set(note.fields);
                        tag_text.set(note.tags.join(" "));
                        message.set(if note.duplicates.is_empty() {
                            String::new()
                        } else {
                            DUPLICATE_TEXT.to_string()
                        });
                        schedule_preview();
                    }
                    Err(ApiError { body, .. }) => {
                        message.set(message_for(&error_code_from_body(&body)));
                    }
                }
            });
    };

    view! {
        <main
            class="app-screen note-editor"
            on:input=move |ev| {
                if let Some(t) = ev
                    .target()
                    .and_then(|n| n.dyn_into::<web_sys::HtmlTextAreaElement>().ok())
                {
                    if t.id().starts_with("note-field-") {
                        schedule_preview();
                    }
                }
            }
        >
            <h1>{heading()}</h1>
            {move || {
                (!preview_alert.get().is_empty())
                    .then(|| view! { <p role="alert">{preview_alert.get()}</p> })
            }}
            {move || {
                (!message.get().is_empty())
                    .then(|| view! { <p role="status">{message.get()}</p> })
            }}
            {move || {
                (!ready.get() && message.get().is_empty())
                    .then(|| view! { <p>"Loading."</p> })
            }}
            <div class="note-preview" aria-live="polite">
                <For
                    each=move || preview_cards.get()
                    key=|c| format!("{}:{}", c.template_name, c.front.len())
                    children=move |card| {
                        let front_html = client_js::sanitize_card_html(&card.front);
                        let back_html = client_js::sanitize_card_html(&card.back);
                        let name = card.template_name.clone();
                        view! {
                            <p>{name}</p>
                            <div class="study-card" prop:inner_html=front_html />
                            <div class="study-card" prop:inner_html=back_html />
                        }
                    }
                />
            </div>
            <label for="note-type">"Note type"</label>
            <select
                id="note-type"
                prop:value=move || note_type_id.get()
                disabled=move || !ready.get() || busy.get() || type_locked
                on:change=move |ev| {
                    let val = event_target_value(&ev);
                    note_type_id.set(val.clone());
                    let count = types
                        .get_untracked()
                        .iter()
                        .find(|t| t.id == val)
                        .map(|t| t.fields.len())
                        .unwrap_or(2);
                    fields.set({
                        let old = fields.get_untracked();
                        (0..count)
                            .map(|i| old.get(i).cloned().unwrap_or_default())
                            .collect()
                    });
                    schedule_preview();
                }
            >
                <For
                    each=move || types.get()
                    key=|t| t.id.clone()
                    children=move |t| {
                        view! { <option value=t.id.clone()>{t.name.clone()}</option> }
                    }
                />
            </select>
            <For
                each=move || {
                    field_names()
                        .into_iter()
                        .enumerate()
                        .collect::<Vec<_>>()
                }
                key=|(i, _)| *i
                children=move |(index, name)| {
                    let id = format!("note-field-{index}");
                    view! {
                        <label for=id.clone()>{name.clone()}</label>
                        <textarea
                            id=id.clone()
                            rows="3"
                            maxlength="50000"
                            prop:value=move || {
                                fields
                                    .get()
                                    .get(index)
                                    .cloned()
                                    .unwrap_or_default()
                            }
                            disabled=move || !ready.get() || busy.get()
                            on:input=move |ev| {
                                on_field_input(index, event_target_value(&ev));
                            }
                            on:change=move |ev| on_field_input(index, event_target_value(&ev))
                            on:keydown=move |ev: web_sys::KeyboardEvent| {
                                if ev.alt_key() {
                                    let key = ev.key();
                                    if key == "c" || key == "C" {
                                        ev.prevent_default();
                                        let text = fields
                                            .get_untracked()
                                            .get(index)
                                            .cloned()
                                            .unwrap_or_default();
                                        if let Some(wrapped) = client_js::wrap_cloze(
                                            &text,
                                            caret_start.get_untracked(),
                                            caret_end.get_untracked(),
                                            1,
                                        ) {
                                            fields.update(|f| {
                                                if index < f.len() {
                                                    f[index] = wrapped;
                                                }
                                            });
                                            schedule_preview();
                                        }
                                    }
                                }
                            }
                            on:select=move |ev| remember_caret(index, &ev, active_field, caret_start, caret_end)
                            on:keyup=move |ev| remember_caret(index, &ev, active_field, caret_start, caret_end)
                            on:mouseup=move |ev| remember_caret(index, &ev, active_field, caret_start, caret_end)
                            on:focus=move |ev| remember_caret(index, &ev, active_field, caret_start, caret_end)
                        />
                    }
                }
            />
            <label for="note-tags">"Tags"</label>
            <input
                id="note-tags"
                type="text"
                autocomplete="off"
                prop:value=move || tag_text.get()
                disabled=move || !ready.get() || busy.get()
                on:input=move |ev| tag_text.set(event_target_value(&ev))
            />
            <NoteDeckList
                decks=decks
                deck_index=deck_index_sig
                locked=Signal::derive(move || !ready.get() || busy.get())
            />
            <button
                class="note-save"
                type="button"
                disabled=move || !ready.get() || busy.get()
                on:click=on_save
            >
                "Save"
            </button>
            <button
                type="button"
                disabled=move || !ready.get() || busy.get()
                on:click=move |_| {
                    let text = fields
                        .get_untracked()
                        .get(active_field.get_untracked())
                        .cloned()
                        .unwrap_or_default();
                    if let Some(wrapped) = client_js::wrap_cloze(
                        &text,
                        caret_start.get_untracked(),
                        caret_end.get_untracked(),
                        1,
                    ) {
                        let idx = active_field.get_untracked();
                        fields.update(|f| {
                            if idx < f.len() {
                                f[idx] = wrapped;
                            }
                        });
                        schedule_preview();
                    }
                }
            >
                "Cloze 1"
            </button>
            <button type="button" disabled=move || !ready.get() || busy.get()>"Cloze 2"</button>
            <button type="button" disabled=move || !ready.get() || busy.get()>"Next cloze"</button>
            <label for="note-upload">"Upload"</label>
            <input id="note-upload" class="note-upload" type="file" disabled=move || !ready.get() || busy.get() />
            <label for="note-camera">"Camera"</label>
            <input
                id="note-camera"
                class="note-camera"
                type="file"
                accept="image/*"
                capture="environment"
                disabled=move || !ready.get() || busy.get()
            />
        </main>
    }
}

fn remember_caret(
    index: usize,
    ev: &leptos::ev::Event,
    active_field: RwSignal<usize>,
    caret_start: RwSignal<u32>,
    caret_end: RwSignal<u32>,
) {
    active_field.set(index);
    if let Some(t) = ev
        .target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlTextAreaElement>().ok())
    {
        caret_start.set(t.selection_start().ok().flatten().unwrap_or(0));
        caret_end.set(t.selection_end().ok().flatten().unwrap_or(0));
    }
}

#[component]
fn NoteDeckList(
    decks: RwSignal<Vec<EditorDeck>>,
    deck_index: RwSignal<usize>,
    locked: Signal<bool>,
) -> impl IntoView {
    let on_key = move |ev: web_sys::KeyboardEvent| {
        if locked.get_untracked() || ev.alt_key() || ev.ctrl_key() || ev.meta_key() {
            return;
        }
        let len = decks.get_untracked().len();
        if len == 0 {
            return;
        }
        let idx = deck_index.get_untracked();
        let next = match ev.key().as_str() {
            "ArrowDown" | "j" => (idx + 1).min(len - 1),
            "ArrowUp" | "k" => idx.saturating_sub(1),
            "Home" => 0,
            "End" => len - 1,
            " " => {
                ev.prevent_default();
                return;
            }
            "Escape" => {
                ev.prevent_default();
                ev.stop_propagation();
                if let Some(t) = ev.target() {
                    if let Ok(el) = t.dyn_into::<web_sys::HtmlElement>() {
                        let _ = el.blur();
                    }
                }
                return;
            }
            "Enter" => return,
            _ => return,
        };
        ev.prevent_default();
        deck_index.set(next);
    };
    let active_id = move || {
        decks
            .get()
            .get(deck_index.get())
            .map(|d| format!("note-deck-{}", d.id))
    };
    view! {
        <div
            class="note-deck"
            role="listbox"
            aria-label="Deck"
            aria-disabled=move || locked.get().then_some("true")
            tabindex=move || if locked.get() { "-1" } else { "0" }
            aria-activedescendant=move || active_id()
            on:keydown=on_key
        >
            <For
                each=move || {
                    decks
                        .get()
                        .into_iter()
                        .enumerate()
                        .collect::<Vec<_>>()
                }
                key=|(_, d)| d.id.clone()
                children=move |(row, deck)| {
                    let selected = move || deck_index.get() == row;
                    let row_id = format!("note-deck-{}", deck.id);
                    view! {
                        <div
                            role="option"
                            id=row_id
                            tabindex="-1"
                            aria-selected=move || if selected() { "true" } else { "false" }
                            on:mousedown=move |ev| {
                                ev.prevent_default();
                                if locked.get_untracked() {
                                    return;
                                }
                                deck_index.set(row);
                            }
                        >
                            {deck.name.clone()}
                        </div>
                    }
                }
            />
        </div>
    }
}

#[component]
pub fn NotesNewScreen() -> impl IntoView {
    view! { <NoteEditorScreen mode="new".to_string() /> }
}

#[component]
pub fn NoteEditScreen() -> impl IntoView {
    let params = use_params_map();
    let id = move || params.with(|p| p.get("id").map(|s| s.to_string()).unwrap_or_default());
    view! {
        {move || {
            if !is_uuid(&id()) {
                view! {
                    <main class="app-screen note-editor">
                        <h1>"Edit note"</h1>
                        <p role="alert">{INVALID_ID}</p>
                    </main>
                }
                .into_any()
            } else {
                view! {
                    <NoteEditorScreen mode="edit".to_string() note_id=id() />
                }
                .into_any()
            }
        }}
    }
}
