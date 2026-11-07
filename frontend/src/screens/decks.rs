use std::collections::HashSet;

use leptos::html::Div;
use leptos::prelude::*;
use leptos_router::components::A;
use serde::Deserialize;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, app_message_for, error_code_from_body, ApiError};
use crate::dialog_focus::{
    activates_control, active_focus_index, dialog_key_action, focusable_items, next_trap_index,
    DialogKeyAction,
};
use crate::deck::{
    after_mutation, deck_level, deck_row_dom_id, deck_tree_key_action, effect_for_tree_key,
    join_deck_views, move_target_ids, visible_deck_rows, CountRow, DeckListRow, DeckTreeKeyInput,
    DeckView, TreeEffect, TreeKeyState,
};
use crate::webauthn_client;

#[derive(Debug, Deserialize)]
struct DeckListResponse {
    decks: Vec<DeckListRow>,
}

#[derive(Debug, Deserialize)]
struct DeckCountsResponse {
    counts: Vec<CountRow>,
}

#[derive(Debug, Deserialize)]
struct CreateDeckResponse {
    deck: DeckCreated,
}

#[derive(Debug, Deserialize)]
struct DeckCreated {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ImpactResponse {
    decks: i64,
    cards: i64,
    notes: i64,
}

async fn load_decks() -> Result<Vec<DeckView>, String> {
    webauthn_client::sync_csrf_from_status().await;
    let listed: DeckListResponse = api::get_json("/api/decks")
        .await
        .map_err(|e| e.body)?;
    let counts: DeckCountsResponse = api::get_json("/api/decks/counts")
        .await
        .map_err(|e| e.body)?;
    Ok(join_deck_views(&listed.decks, &counts.counts))
}

fn schedule_refresh(
    decks: RwSignal<Vec<DeckView>>,
    expanded: RwSignal<HashSet<String>>,
    selected_id: RwSignal<Option<String>>,
    message: RwSignal<String>,
    ready: RwSignal<bool>,
    prefer: Option<String>,
    parent_id: Option<String>,
) {
    spawn_local(async move {
        match load_decks().await {
            Ok(loaded) => {
                let (sel, exp) = after_mutation(
                    &loaded,
                    &expanded.get_untracked(),
                    prefer
                        .as_deref()
                        .or(selected_id.get_untracked().as_deref()),
                    parent_id.as_deref(),
                );
                decks.set(loaded);
                expanded.set(exp);
                selected_id.set(sel);
                message.set(String::new());
            }
            Err(msg) => message.set(msg),
        }
        ready.set(true);
    });
}

#[component]
pub fn DecksHome() -> impl IntoView {
    let decks = RwSignal::new(Vec::<DeckView>::new());
    let expanded = RwSignal::new(HashSet::<String>::new());
    let selected_id = RwSignal::new(None::<String>);
    let name = RwSignal::new(String::new());
    let message = RwSignal::new(String::new());
    let busy = RwSignal::new(false);
    let ready = RwSignal::new(false);
    let delete_open = RwSignal::new(false);
    let name_field = NodeRef::<leptos::html::Input>::new();
    let tree_ref = NodeRef::<Div>::new();

    let modal_open = expect_context::<RwSignal<bool>>();
    let palette_open = expect_context::<RwSignal<bool>>();
    Effect::new(move |_| {
        modal_open.set(delete_open.get());
    });

    Effect::new(move |_| {
        schedule_refresh(
            decks,
            expanded,
            selected_id,
            message,
            ready,
            None,
            None,
        );
    });

    Effect::new(move |_| {
        let id = selected_id.get();
        if let Some(id) = &id {
            if let Some(row) = decks.get().iter().find(|d| &d.id == id) {
                name.set(row.name.clone());
            }
        } else {
            name.set(String::new());
        }
    });

    let run_create = move |parent_id: Option<String>| {
        let deck_name = name.get();
        if deck_name.trim().is_empty() {
            return;
        }
        busy.set(true);
        let parent_id_clone = parent_id.clone();
        spawn_local(async move {
            #[derive(serde::Serialize)]
            struct Body<'a> {
                name: &'a str,
                #[serde(rename = "parentId")]
                parent_id: Option<String>,
            }
            let body = Body {
                name: &deck_name,
                parent_id: parent_id.clone(),
            };
            match api::post_json::<CreateDeckResponse, _>("/api/decks", &body).await {
                Ok(resp) => {
                    schedule_refresh(
                        decks,
                        expanded,
                        selected_id,
                        message,
                        ready,
                        Some(resp.deck.id),
                        parent_id_clone,
                    );
                }
                Err(ApiError { body, .. }) => {
                    message.set(app_message_for(&error_code_from_body(&body)));
                }
            }
            busy.set(false);
        });
    };

    let rename = move || {
        let id = selected_id.get();
        let Some(id) = id else { return };
        let new_name = name.get();
        busy.set(true);
        spawn_local(async move {
            #[derive(serde::Serialize)]
            struct Body<'a> {
                name: &'a str,
            }
            match api::patch_json::<serde_json::Value, _>(&format!("/api/decks/{id}"), &Body {
                name: &new_name,
            })
            .await
            {
                Ok(_) => {
                    schedule_refresh(
                        decks,
                        expanded,
                        selected_id,
                        message,
                        ready,
                        Some(id.clone()),
                        None,
                    );
                }
                Err(ApiError { body, .. }) => {
                    message.set(app_message_for(&error_code_from_body(&body)));
                }
            }
            busy.set(false);
        });
    };

    let on_tree_key = move |ev: web_sys::KeyboardEvent| {
        let visible = visible_deck_rows(&decks.get(), &expanded.get());
        let sid = selected_id.get();
        let index = sid
            .as_ref()
            .and_then(|id| visible.iter().position(|r| &r.id == id))
            .unwrap_or(0);
        let Some(row) = visible.get(index) else {
            return;
        };
        let has_children = decks
            .get()
            .iter()
            .any(|d| d.parent_id.as_deref() == Some(row.id.as_str()));
        let input = DeckTreeKeyInput {
            key: ev.key(),
            shift_key: ev.shift_key(),
            modified: ev.alt_key() || ev.ctrl_key() || ev.meta_key(),
            has_children,
            expanded: expanded.get().contains(&row.id),
            is_root: row.parent_id.is_none(),
            target_is_field: ev
                .target()
                .map(|t| crate::deck::target_is_text_field(&t))
                .unwrap_or(false),
            modal_open: delete_open.get(),
            palette_open: palette_open.get_untracked(),
        };
        let action = deck_tree_key_action(&input);
        let effect = effect_for_tree_key(
            action,
            TreeKeyState {
                visible: &visible,
                index,
                expanded_ids: expanded.get(),
                row_id: row.id.clone(),
                parent_id: row.parent_id.clone(),
                decks: &decks.get(),
            },
        );
        match effect {
            TreeEffect::Ignore => {}
            TreeEffect::Prevent => {
                ev.prevent_default();
            }
            TreeEffect::FocusName => {
                ev.prevent_default();
                if let Some(el) = name_field.get() {
                    let _ = el.focus();
                }
            }
            TreeEffect::Select { id, expanded_ids } => {
                ev.prevent_default();
                selected_id.set(Some(id));
                expanded.set(expanded_ids);
            }
        }
    };

    let selected_name = move || {
        let sid = selected_id.get();
        decks
            .get()
            .iter()
            .find(|d| Some(&d.id) == sid.as_ref())
            .map(|d| d.name.clone())
            .unwrap_or_default()
    };

    let targets = move || {
        let sid = selected_id.get();
        let Some(id) = sid else {
            return vec![];
        };
        let allowed: HashSet<_> = move_target_ids(&decks.get(), &id).into_iter().collect();
        decks
            .get()
            .iter()
            .filter(|d| allowed.contains(&d.id))
            .map(|d| (d.id.clone(), d.name.clone()))
            .collect::<Vec<_>>()
    };

    view! {
        <main class="app-screen">
            <header class="app-page-header">
                <p class="tui-eyebrow app-eyebrow-icon">"Library"</p>
                <h1>"Decks"</h1>
                <p class="app-lead">"Organize what you study. Counts include every deck below a parent."</p>
                <div class="app-page-tools">
                    <button
                        type="button"
                        class="app-ghost"
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
                </div>
            </header>
            {move || {
                (!message.get().is_empty()).then(|| view! { <p role="alert">{message.get()}</p> })
            }}
            <div class="app-decks">
                <section class="app-panel" aria-label="Deck tree">
                    <p class="tui-eyebrow">"Tree"</p>
                    <div
                        class="app-tree"
                        role="tree"
                        aria-label="Decks"
                        tabindex="0"
                        node_ref=tree_ref
                        aria-activedescendant=move || {
                            let visible = visible_deck_rows(&decks.get(), &expanded.get());
                            let sid = selected_id.get()?;
                            if visible.iter().any(|r| r.id == sid) {
                                Some(deck_row_dom_id(&sid))
                            } else {
                                None
                            }
                        }
                        on:keydown=on_tree_key
                        on:focus=move |_| {
                            if selected_id.get_untracked().is_none() {
                                let visible = visible_deck_rows(&decks.get_untracked(), &expanded.get_untracked());
                                if let Some(first) = visible.first() {
                                    selected_id.set(Some(first.id.clone()));
                                }
                            }
                        }
                    >
                        {move || {
                            if visible_deck_rows(&decks.get(), &expanded.get()).is_empty() && ready.get() {
                                view! { <p>"No decks yet."</p> }.into_any()
                            } else {
                                view! {
                                    <For
                                        each=move || visible_deck_rows(&decks.get(), &expanded.get())
                                        key=|row| row.id.clone()
                                        children=move |row| {
                                            view! {
                                                <DeckTreeRow
                                                    row=row
                                                    decks=decks
                                                    expanded=expanded
                                                    selected_id=selected_id
                                                    tree_ref=tree_ref
                                                />
                                            }
                                        }
                                    />
                                }
                                .into_any()
                            }
                        }}
                    </div>
                </section>
                <section class="app-detail" aria-label="Deck actions">
                    <div class="app-detail-field">
                        <label for="deck-name">"Deck name"</label>
                        <input
                            id="deck-name"
                            type="text"
                            maxlength="100"
                            autocomplete="off"
                            prop:value=move || name.get()
                            disabled=move || busy.get() || !ready.get()
                            node_ref=name_field
                            on:input=move |ev| name.set(event_target_value(&ev))
                            on:keydown=move |ev| {
                                if ev.key() == "Escape" {
                                    ev.prevent_default();
                                    if let Some(el) = name_field.get() {
                                        let _ = el.blur();
                                    }
                                }
                                if ev.key() == "Enter" {
                                    ev.prevent_default();
                                    rename();
                                }
                            }
                        />
                    </div>
                    {move || {
                        selected_id.get().map(|id| {
                            let study_href = format!("/study?deck={id}");
                            let add_href = format!("/notes/new?deck={id}");
                            view! {
                                <div class="app-detail-primary">
                                    <A href=study_href attr:class="app-action app-action-strong">
                                        <span>"Study"</span>
                                    </A>
                                    <A href=add_href attr:class="app-action">
                                        <span>"Add note"</span>
                                    </A>
                                </div>
                            }
                        })
                    }}
                    <div class="app-detail-secondary" role="group" aria-label="Deck edits">
                        <button
                            type="button"
                            disabled=move || busy.get() || !ready.get()
                            on:click=move |_| run_create(None)
                        >
                            <span>"Create root"</span>
                        </button>
                        <button
                            type="button"
                            disabled=move || busy.get() || !ready.get() || selected_id.get().is_none()
                            on:click=move |_| run_create(selected_id.get())
                        >
                            <span>"Create child"</span>
                        </button>
                        <button
                            type="button"
                            disabled=move || busy.get() || !ready.get() || selected_id.get().is_none()
                            on:click=move |_| rename()
                        >
                            <span>"Rename"</span>
                        </button>
                        <button
                            type="button"
                            class="app-danger"
                            disabled=move || busy.get() || !ready.get() || selected_id.get().is_none()
                            on:click=move |_| delete_open.set(true)
                        >
                            <span>"Delete"</span>
                        </button>
                    </div>
                </section>
            </div>
            <Show when=move || delete_open.get() && selected_id.get().is_some()>
                <DeleteDeckDialog
                    deck_id=Signal::derive(move || selected_id.get().unwrap_or_default())
                    deck_name=selected_name
                    targets=targets
                    on_close=Callback::new(move |_| delete_open.set(false))
                    on_done=Callback::new(move |_| {
                        delete_open.set(false);
                        schedule_refresh(
                            decks,
                            expanded,
                            selected_id,
                            message,
                            ready,
                            selected_id.get_untracked(),
                            None,
                        );
                    })
                />
            </Show>
        </main>
    }
}

#[component]
fn DeckTreeRow(
    row: DeckView,
    decks: RwSignal<Vec<DeckView>>,
    expanded: RwSignal<HashSet<String>>,
    selected_id: RwSignal<Option<String>>,
    tree_ref: NodeRef<Div>,
) -> impl IntoView {
    let row_id = row.id.clone();
    let level = deck_level(&decks.get_untracked(), &row_id);
    let has_children = decks
        .get_untracked()
        .iter()
        .any(|d| d.parent_id.as_deref() == Some(row_id.as_str()));
    let is_selected = {
        let row_id = row_id.clone();
        move || selected_id.get().as_deref() == Some(row_id.as_str())
    };
    let row_id_exp = row_id.clone();
    let aria_expanded = move || {
        if !has_children {
            None
        } else {
            Some(expanded.get().contains(&row_id_exp))
        }
    };
    let row_id_class = row_id.clone();
    let row_open_class = move || has_children && expanded.get().contains(&row_id_class);
    let dom_id = deck_row_dom_id(&row_id);
    let row_ref = NodeRef::<Div>::new();
    Effect::new(move |_| {
        let Some(el) = row_ref.get() else {
            return;
        };
        let _ = is_selected();
        let expanded_attr = aria_expanded();
        let _ = el.set_attribute(
            "aria-selected",
            if is_selected() { "true" } else { "false" },
        );
        let _ = el.set_attribute("aria-level", &level.to_string());
        match expanded_attr {
            None => {
                let _ = el.remove_attribute("aria-expanded");
            }
            Some(open) => {
                let _ = el.set_attribute("aria-expanded", if open { "true" } else { "false" });
            }
        }
    });
    view! {
        <div
            id=dom_id
            node_ref=row_ref
            class="app-tree-row"
            class:app-tree-row-open=row_open_class
            role="treeitem"
            data-level=level
            tabindex="-1"
            on:click=move |_| {
                selected_id.set(Some(row_id.clone()));
                if let Some(el) = tree_ref.get() {
                    let _ = el.focus();
                }
            }
        >
            <span class="app-tree-label">
                <span class="app-tree-name">{row.name.clone()}</span>
            </span>
            <span class="app-tree-counts">
                <span class="app-chip app-chip-new">
                    "New " {row.subtree.new}
                </span>
                <span class="app-chip app-chip-learn">
                    "Learning " {row.subtree.learning}
                </span>
                <span class="app-chip app-chip-due">
                    "Due " {row.subtree.due}
                </span>
            </span>
        </div>
    }
}

async fn delete_deck_request(
    id: String,
    action: &'static str,
    target: Option<String>,
) -> Result<(), ApiError> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase", tag = "action")]
    enum DeleteBody {
        #[serde(rename = "move")]
        Move { target_deck_id: String },
        #[serde(rename = "trash")]
        Trash,
    }
    let body = if action == "trash" {
        DeleteBody::Trash
    } else if let Some(tid) = target {
        DeleteBody::Move {
            target_deck_id: tid,
        }
    } else {
        return Err(ApiError {
            status: 0,
            body: "bad_target".into(),
        });
    };
    let payload = serde_json::to_string(&body).map_err(|e| ApiError {
        status: 0,
        body: e.to_string(),
    })?;
    let response = api::fetch_raw(&format!("/api/decks/{id}"), "DELETE", Some(payload)).await?;
    let status = response.status();
    if (200..300).contains(&status) {
        Ok(())
    } else {
        use wasm_bindgen_futures::JsFuture;
        let text = JsFuture::from(response.text().unwrap())
            .await
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_default();
        Err(ApiError { status, body: text })
    }
}

#[component]
fn DeleteDeckDialog(
    deck_id: Signal<String>,
    deck_name: impl Fn() -> String + Send + Sync + 'static,
    targets: impl Fn() -> Vec<(String, String)> + Send + Sync + 'static,
    on_close: Callback<()>,
    on_done: Callback<()>,
) -> impl IntoView {
    let impact = RwSignal::new(None::<(i64, i64, i64)>);
    let message = RwSignal::new(String::new());
    let target_id = RwSignal::new(String::new());
    let busy = RwSignal::new(false);
    let dialog_ref = NodeRef::<Div>::new();
    let return_focus = RwSignal::new(None::<web_sys::HtmlElement>);

    let restore_focus = move || {
        let el = return_focus.get_untracked();
        return_focus.set(None);
        if let Some(el) = el {
            let _ = el.focus();
        }
    };

    let dismiss = Callback::new(move |_| {
        on_close.run(());
        restore_focus();
    });

    Effect::new(move |_| {
        let Some(dialog) = dialog_ref.get() else {
            return;
        };
        if let Some(doc) = web_sys::window().and_then(|w| w.document()) {
            if let Some(active) = doc.active_element() {
                if let Ok(html) = active.dyn_into::<web_sys::HtmlElement>() {
                    if !dialog.is_same_node(Some(&html)) {
                        return_focus.set(Some(html));
                    }
                }
            }
        }
        let _ = dialog.focus();
    });

    Effect::new(move |_| {
        let window = web_sys::window().expect("window");
        let dialog_ref = dialog_ref;
        let dismiss = dismiss.clone();
        let closure = Closure::wrap(Box::new(move |ev: web_sys::KeyboardEvent| {
            let action = dialog_key_action(
                &ev.key(),
                ev.shift_key(),
                ev.target()
                    .map(|t| activates_control(&t))
                    .unwrap_or(false),
            );
            match action {
                DialogKeyAction::None => {}
                DialogKeyAction::Close => {
                    ev.prevent_default();
                    ev.stop_propagation();
                    dismiss.run(());
                }
                DialogKeyAction::Prevent => {
                    ev.prevent_default();
                    ev.stop_propagation();
                }
                DialogKeyAction::Tab { shift } => {
                    let Some(root) = dialog_ref.get() else {
                        return;
                    };
                    let items = focusable_items(&root);
                    let current = active_focus_index(&items);
                    if let Some(next) = next_trap_index(items.len(), current, shift) {
                        ev.prevent_default();
                        ev.stop_propagation();
                        if let Some(el) = items.get(next) {
                            let _ = el.focus();
                        }
                    }
                }
            }
        }) as Box<dyn FnMut(_)>);
        let cb = closure.as_ref().unchecked_ref();
        let options = web_sys::AddEventListenerOptions::new();
        options.set_capture(true);
        let _ = window.add_event_listener_with_callback_and_add_event_listener_options(
            "keydown",
            cb,
            &options,
        );
        closure.forget();
    });

    Effect::new(move |_| {
        let id = deck_id.get();
        spawn_local(async move {
                impact.set(None);
                match api::get_json::<ImpactResponse>(&format!("/api/decks/{id}/impact")).await {
                    Ok(body) => impact.set(Some((body.decks, body.cards, body.notes))),
                    Err(ApiError { body, .. }) => {
                        message.set(app_message_for(&error_code_from_body(&body)))
                    }
                }
        });
    });

    view! {
        <div
            class="tui-modal app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-deck-title"
            tabindex="-1"
            node_ref=dialog_ref
        >
            <h2 id="delete-deck-title">
                "Delete " {deck_name()}
            </h2>
            {move || match impact.get() {
                None => view! { <p>"Loading impact."</p> }.into_any(),
                Some((d, c, n)) => view! {
                    <p>"Decks " {d} ". Cards " {c} ". Notes " {n} "."</p>
                }
                .into_any(),
            }}
            {move || {
                (!message.get().is_empty()).then(|| view! { <p role="alert">{message.get()}</p> })
            }}
            <button type="button" disabled=move || busy.get() on:click=move |_| dismiss.run(())>
                "Cancel"
            </button>
            <button type="button" disabled=move || busy.get() on:click=move |_| {
                let id = deck_id.get();
                busy.set(true);
                let done = on_done;
                spawn_local(async move {
                    let result = delete_deck_request(id, "trash", None).await;
                    busy.set(false);
                    match result {
                        Ok(()) => done.run(()),
                        Err(ApiError { body, .. }) => {
                            message.set(app_message_for(&error_code_from_body(&body)));
                        }
                    }
                });
            }>
                "Trash"
            </button>
            <label for="move-target">"Move target"</label>
            <select
                id="move-target"
                prop:value=move || target_id.get()
                on:change=move |ev| target_id.set(event_target_value(&ev))
            >
                <option value="">"Choose a deck"</option>
                {move || {
                    targets()
                        .into_iter()
                        .map(|(id, name)| {
                            view! { <option value=id.clone()>{name}</option> }
                        })
                        .collect_view()
                }}
            </select>
            <button
                type="button"
                disabled=move || busy.get() || target_id.get().is_empty()
                on:click=move |_| {
                    let id = deck_id.get();
                    let tid = target_id.get();
                    busy.set(true);
                    let done = on_done;
                    spawn_local(async move {
                        let result = delete_deck_request(id, "move", Some(tid)).await;
                        busy.set(false);
                        match result {
                            Ok(()) => done.run(()),
                            Err(ApiError { body, .. }) => {
                                message.set(app_message_for(&error_code_from_body(&body)));
                            }
                        }
                    });
                }
            >
                "Move"
            </button>
        </div>
    }
}
