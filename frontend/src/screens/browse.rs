use leptos::prelude::*;
use serde::Deserialize;
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, error_code_from_body, message_for, ApiError};

const BAD_QUERY: &str = "The search is not valid.";

fn browse_path(q: &str) -> String {
    let encoded: String = q
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            b' ' => "+".to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    format!("/api/browse?q={encoded}")
}
const EMPTY: &str = "No cards.";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowseRow {
    card_id: String,
    note_id: String,
    deck_id: String,
    deck_path: String,
    state: String,
    lapses: i32,
    front_text: String,
    tags: Vec<String>,
}

#[derive(Clone, Debug)]
struct BrowseView {
    row: BrowseRow,
    tags_text: String,
}

#[derive(Clone, Debug, Deserialize)]
struct DeckRow {
    id: String,
    path: String,
    #[serde(rename = "archivedAt")]
    archived_at: Option<i64>,
}

fn row_index_move(len: usize, active: usize, key: &str) -> Option<usize> {
    if len == 0 {
        return None;
    }
    match key {
        "ArrowDown" | "j" => Some((active + 1).min(len - 1)),
        "ArrowUp" | "k" => Some(active.saturating_sub(1)),
        "Home" => Some(0),
        "End" => Some(len - 1),
        _ => None,
    }
}

#[component]
pub fn BrowseScreen() -> impl IntoView {
    let query = RwSignal::new(String::new());
    let rows = RwSignal::new(Vec::<BrowseView>::new());
    let selected = RwSignal::new(Vec::<String>::new());
    let active = RwSignal::new(0usize);
    let decks = RwSignal::new(Vec::<DeckRow>::new());
    let deck_index = RwSignal::new(0usize);
    let tag_text = RwSignal::new(String::new());
    let message = RwSignal::new(String::new());
    let bad_query = RwSignal::new(false);
    let loaded = RwSignal::new(false);
    let busy = RwSignal::new(false);
    let ready = RwSignal::new(false);
    let modal_open = RwSignal::new(false);
    let pending_notes = RwSignal::new(Vec::<String>::new());
    let search_serial = RwSignal::new(0i32);

    let grid_ref = NodeRef::<leptos::html::Div>::new();

    let parse_rows = |body: &serde_json::Value| -> Result<Vec<BrowseView>, ()> {
        let items = body.get("rows").and_then(|v| v.as_array()).ok_or(())?;
        let mut out = Vec::new();
        for item in items {
            let row: BrowseRow = serde_json::from_value(item.clone()).map_err(|_| ())?;
            let tags_text = row.tags.join(" ");
            out.push(BrowseView { row, tags_text });
        }
        Ok(out)
    };

    let run_search = {
        move |q: String| {
            search_serial.update(|s| *s += 1);
            let mine = search_serial.get_untracked();
            spawn_local(async move {
                if !ready.get_untracked() {
                    return;
                }
                let path = browse_path(&q);
                let result = api::get_json::<serde_json::Value>(&path).await;
                if mine != search_serial.get_untracked() {
                    return;
                }
                match result {
                    Ok(body) => {
                        if let Ok(parsed) = parse_rows(&body) {
                            rows.set(parsed);
                            active.set(0);
                            selected.set(Vec::new());
                            bad_query.set(false);
                            message.set(String::new());
                            loaded.set(true);
                        } else {
                            bad_query.set(true);
                            rows.set(Vec::new());
                            loaded.set(true);
                        }
                    }
                    Err(ApiError { status, body }) => {
                        if status == 400 && body.contains("bad_query") {
                            bad_query.set(true);
                            rows.set(Vec::new());
                            loaded.set(true);
                            message.set(String::new());
                        } else {
                            message.set(message_for(&error_code_from_body(&body)));
                            loaded.set(true);
                        }
                    }
                }
            });
        }
    };

    Effect::new(move |_| {
        spawn_local(async move {
            #[derive(Deserialize)]
            struct DecksBody {
                decks: Vec<DeckRow>,
            }
            if let Ok(body) = api::get_json::<DecksBody>("/api/decks").await {
                let live: Vec<_> = body
                    .decks
                    .into_iter()
                    .filter(|d| d.archived_at.is_none())
                    .collect();
                decks.set(live);
            }
            ready.set(true);
            run_search(String::new());
        });
    });

    let toggle_card = move |card_id: String| {
        selected.update(|list| {
            if let Some(pos) = list.iter().position(|id| id == &card_id) {
                list.remove(pos);
            } else {
                list.push(card_id);
            }
        });
    };

    let do_search = {
        move || {
            bad_query.set(false);
            message.set(String::new());
            run_search(query.get_untracked());
        }
    };
    let on_search = move |_| do_search();

    let selected_cards = move || selected.get();
    let selected_note_ids = move || {
        let ids = selected_cards();
        let all = rows.get();
        let mut notes = Vec::new();
        for id in ids {
            if let Some(row) = all.iter().find(|r| r.row.card_id == id) {
                if !notes.contains(&row.row.note_id) {
                    notes.push(row.row.note_id.clone());
                }
            }
        }
        notes
    };

    let bulk_move = move |_| {
        let card_ids = selected_cards();
        let deck = decks.get_untracked().get(deck_index.get_untracked()).map(|d| d.id.clone());
        let Some(deck_id) = deck else {
            return;
        };
        if card_ids.is_empty() {
            return;
        }
        busy.set(true);
        spawn_local(async move {
            let body = serde_json::json!({ "cardIds": card_ids, "deckId": deck_id });
            let result = api::post_json::<serde_json::Value, _>("/api/cards/move", &body).await;
            busy.set(false);
            match result {
                Ok(_) => run_search(query.get_untracked()),
                Err(ApiError { body, .. }) => message.set(message_for(&error_code_from_body(&body))),
            }
        });
    };

    let bulk_suspend = move |_| {
        let card_ids = selected_cards();
        if card_ids.is_empty() {
            return;
        }
        busy.set(true);
        spawn_local(async move {
            let body = serde_json::json!({ "cardIds": card_ids });
            let result = api::post_json::<serde_json::Value, _>("/api/cards/suspend", &body).await;
            busy.set(false);
            match result {
                Ok(_) => run_search(query.get_untracked()),
                Err(ApiError { body, .. }) => message.set(message_for(&error_code_from_body(&body))),
            }
        });
    };

    let bulk_tag = move |add: bool| {
        let notes = selected_note_ids();
        let tag = tag_text.get_untracked().trim().to_string();
        if notes.is_empty() || tag.is_empty() || tag.len() > 200 {
            return;
        }
        busy.set(true);
        spawn_local(async move {
            let (add_tags, remove_tags) = if add {
                (vec![tag], vec![] as Vec<String>)
            } else {
                (vec![], vec![tag])
            };
            let body = serde_json::json!({
                "noteIds": notes,
                "add": add_tags,
                "remove": remove_tags,
            });
            let result = api::post_json::<serde_json::Value, _>("/api/notes/tags", &body).await;
            busy.set(false);
            match result {
                Ok(_) => run_search(query.get_untracked()),
                Err(ApiError { body, .. }) => message.set(message_for(&error_code_from_body(&body))),
            }
        });
    };

    let open_delete = move |_| {
        let notes = selected_note_ids();
        if notes.is_empty() {
            return;
        }
        pending_notes.set(notes);
        modal_open.set(true);
    };

    let confirm_delete = move |_| {
        let notes = pending_notes.get_untracked();
        if notes.is_empty() {
            return;
        }
        busy.set(true);
        spawn_local(async move {
            let body = serde_json::json!({ "noteIds": notes });
            let result = api::post_json::<serde_json::Value, _>("/api/notes/trash", &body).await;
            busy.set(false);
            modal_open.set(false);
            pending_notes.set(Vec::new());
            match result {
                Ok(_) => run_search(query.get_untracked()),
                Err(ApiError { body, .. }) => message.set(message_for(&error_code_from_body(&body))),
            }
        });
    };

    let on_grid_key = move |ev: web_sys::KeyboardEvent| {
        if busy.get_untracked() || modal_open.get_untracked() {
            return;
        }
        if ev.alt_key() || ev.ctrl_key() || ev.meta_key() {
            return;
        }
        let len = rows.with(|r| r.len());
        if len == 0 {
            return;
        }
        let key = ev.key();
        if let Some(next) = row_index_move(len, active.get_untracked(), &key) {
            ev.prevent_default();
            active.set(next);
            return;
        }
        let idx = active.get_untracked();
        let row = rows.with(|r| r.get(idx).cloned());
        let Some(row) = row else {
            return;
        };
        match key.as_str() {
            " " => {
                ev.prevent_default();
                toggle_card(row.row.card_id.clone());
            }
            "Enter" => {
                ev.prevent_default();
                let note_id = row.row.note_id.clone();
                if let Some(window) = web_sys::window() {
                    let _ = window.location().set_href(&format!("/notes/{note_id}"));
                }
            }
            "Escape" => {
                ev.prevent_default();
                selected.set(Vec::new());
            }
            _ => {}
        }
    };

    let locked = move || busy.get() || modal_open.get();
    let card_count = move || selected_cards().len();
    let note_count = move || selected_note_ids().len();
    let move_on = move || card_count() > 0 && !decks.get().is_empty();
    let suspend_on = move || card_count() > 0;
    let delete_on = move || note_count() > 0;
    let tag_ok = move || {
        let t = tag_text.get();
        !t.trim().is_empty() && note_count() > 0
    };

    view! {
        <main
            class="app-screen browse-screen"
            attr:data-modal=move || if modal_open.get() { "open" } else { "closed" }
        >
            <header class="app-page-header">
                <h1>"Browse"</h1>
            </header>
            {move || {
                (!message.get().is_empty())
                    .then(|| view! { <p role="alert">{message.get()}</p> })
            }}
            <div class="browse-search">
                <label for="browse-search">"Search"</label>
                <input
                    id="browse-search"
                    type="text"
                    prop:value=move || query.get()
                    disabled=move || locked()
                    on:input=move |ev| query.set(event_target_value(&ev))
                    on:keydown=move |ev: web_sys::KeyboardEvent| {
                        if ev.key() == "Enter" {
                            ev.prevent_default();
                            do_search();
                        }
                    }
                />
                <button type="button" disabled=move || !ready.get() || locked() on:click=on_search>
                    <span>"Search"</span>
                </button>
            </div>
            {move || bad_query.get().then(|| view! { <p role="alert">{BAD_QUERY}</p> })}
            {move || {
                (loaded.get() && rows.get().is_empty() && !bad_query.get())
                    .then(|| view! { <p>{EMPTY}</p> })
            }}
            <div
                class="browse-grid"
                role="grid"
                aria-label="Cards"
                tabindex="0"
                node_ref=grid_ref
                on:keydown=on_grid_key
            >
                <div role="row">
                    <span role="columnheader">"Deck"</span>
                    <span role="columnheader">"Front"</span>
                    <span role="columnheader">"Tags"</span>
                    <span role="columnheader">"State"</span>
                    <span role="columnheader">"Lapses"</span>
                </div>
                <For
                    each=move || {
                        rows.get()
                            .into_iter()
                            .enumerate()
                            .collect::<Vec<_>>()
                    }
                    key=|(index, row)| format!("{}:{index}", row.row.card_id)
                    children=move |(index, row)| {
                        let card_id = row.row.card_id.clone();
                        let row_id = card_id.clone();
                        let pick_id = card_id.clone();
                        let check_id = card_id.clone();
                        let is_active = move || active.get() == index;
                        let checked = move || selected.with(|s| s.contains(&check_id));
                        let front = row.row.front_text.clone();
                        let select_label = front.clone();
                        let deck_path = row.row.deck_path.clone();
                        let tags = row.tags_text.clone();
                        let state = row.row.state.clone();
                        let lapses = row.row.lapses;
                        view! {
                            <div
                                class="browse-row"
                                role="row"
                                id=format!("browse-row-{}", row_id)
                                tabindex="-1"
                                aria-selected=move || if is_active() { "true" } else { "false" }
                                on:click=move |_| active.set(index)
                                on:keydown=move |ev: web_sys::KeyboardEvent| {
                                    if ev.key() == " " || ev.key() == "Enter" {
                                        ev.stop_propagation();
                                    }
                                }
                            >
                                <span role="gridcell">{deck_path}</span>
                                <span role="gridcell">{front}</span>
                                <span role="gridcell">{tags}</span>
                                <span role="gridcell">{state}</span>
                                <span role="gridcell">{lapses}</span>
                                <span role="gridcell">
                                    <label>
                                        <input
                                            type="checkbox"
                                            prop:checked=checked
                                            disabled=move || locked()
                                            on:change=move |_| toggle_card(pick_id.clone())
                                        />
                                        "Select " {select_label}
                                    </label>
                                </span>
                            </div>
                        }
                    }
                />
            </div>
            <div class="browse-bulk" id="browse-bulk">
                <BrowseDeckList decks=decks deck_index=deck_index locked=Signal::derive(move || busy.get()) />
                <button type="button" disabled=move || busy.get() || !move_on() on:click=bulk_move>
                    <span>"Move"</span>
                </button>
                <label for="browse-tag">"Tag"</label>
                <input
                    id="browse-tag"
                    type="text"
                    prop:value=move || tag_text.get()
                    disabled=move || busy.get()
                    on:input=move |ev| tag_text.set(event_target_value(&ev))
                />
                <button type="button" disabled=move || busy.get() || !tag_ok() on:click=move |_| bulk_tag(true)>
                    <span>"Add tag"</span>
                </button>
                <button type="button" disabled=move || busy.get() || !tag_ok() on:click=move |_| bulk_tag(false)>
                    <span>"Remove tag"</span>
                </button>
                <button type="button" disabled=move || busy.get() || !suspend_on() on:click=bulk_suspend>
                    <span>"Suspend"</span>
                </button>
                <button type="button" class="app-danger" disabled=move || busy.get() || !delete_on() on:click=open_delete>
                    <span>"Delete"</span>
                </button>
            </div>
            <Show when=move || modal_open.get()>
                <div
                    class="tui-modal app-dialog browse-delete"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="browse-delete-title"
                    tabindex="-1"
                >
                    <h2 id="browse-delete-title">"Delete selected notes"</h2>
                    <p>"Trash the selected notes."</p>
                    <button type="button" disabled=move || busy.get() on:click=move |_| modal_open.set(false)>
                        "Cancel"
                    </button>
                    <button type="button" disabled=move || busy.get() on:click=confirm_delete>
                        "Confirm delete"
                    </button>
                </div>
            </Show>
        </main>
    }
}

#[component]
fn BrowseDeckList(
    decks: RwSignal<Vec<DeckRow>>,
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
            _ => return,
        };
        ev.prevent_default();
        deck_index.set(next);
    };
    view! {
        <div
            class="note-deck"
            role="listbox"
            aria-label="Deck"
            aria-disabled=move || locked.get().then_some("true".to_string())
            tabindex=move || if locked.get() { "-1".to_string() } else { "0".to_string() }
            on:keydown=on_key
        >
            <For
                each=move || {
                    decks.get().into_iter().enumerate().collect::<Vec<_>>()
                }
                key=|(_, d)| d.id.clone()
                children=move |(row, deck)| {
                    let selected = move || deck_index.get() == row;
                    view! {
                        <div
                            role="option"
                            id=format!("browse-deck-{}", deck.id)
                            tabindex="-1"
                            aria-selected=move || if selected() { "true" } else { "false" }
                            on:mousedown=move |ev: web_sys::MouseEvent| {
                                ev.prevent_default();
                                if !locked.get_untracked() {
                                    deck_index.set(row);
                                }
                            }
                        >
                            {deck.path.clone()}
                        </div>
                    }
                }
            />
        </div>
    }
}
