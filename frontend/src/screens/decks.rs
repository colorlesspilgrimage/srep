use leptos::prelude::*;
use serde::Deserialize;
use wasm_bindgen_futures::spawn_local;

use crate::api::{self, ApiError};

#[derive(Debug, Clone, Deserialize)]
struct DeckRow {
    id: String,
    name: String,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    #[serde(rename = "archivedAt", default)]
    archived_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct DeckListResponse {
    decks: Vec<DeckRow>,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
struct DeckView {
    id: String,
    name: String,
    depth: usize,
}

fn visible_tree(decks: &[DeckRow]) -> Vec<DeckView> {
    let active: Vec<_> = decks.iter().filter(|d| d.archived_at.is_none()).collect();
    let mut roots: Vec<_> = active
        .iter()
        .filter(|d| d.parent_id.is_none())
        .map(|d| (*d).clone())
        .collect();
    roots.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let mut out = Vec::new();
    fn walk(decks: &[&DeckRow], parent: &str, depth: usize, out: &mut Vec<DeckView>) {
        let mut kids: Vec<_> = decks
            .iter()
            .filter(|d| d.parent_id.as_deref() == Some(parent))
            .copied()
            .collect();
        kids.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        for kid in kids {
            out.push(DeckView {
                id: kid.id.clone(),
                name: kid.name.clone(),
                depth,
            });
            walk(decks, &kid.id, depth + 1, out);
        }
    }
    let refs: Vec<_> = active.to_vec();
    for root in roots {
        out.push(DeckView {
            id: root.id.clone(),
            name: root.name.clone(),
            depth: 0,
        });
        walk(&refs, &root.id, 1, &mut out);
    }
    out
}

#[component]
pub fn DecksHome() -> impl IntoView {
    let rows = RwSignal::new(Vec::<DeckView>::new());
    let error = RwSignal::new(Option::<String>::None);
    let loading = RwSignal::new(true);

    Effect::new(move |_| {
        spawn_local(async move {
            loading.set(true);
            match api::get_json::<DeckListResponse>("/api/decks").await {
                Ok(body) => {
                    rows.set(visible_tree(&body.decks));
                    error.set(None);
                }
                Err(ApiError { status, body }) => {
                    error.set(Some(format!("{status}: {body}")));
                }
            }
            loading.set(false);
        });
    });

    view! {
        <section class="screen-decks">
            <p class="tui-eyebrow">"Decks"</p>
            <h1 class="screen-title">"Your library"</h1>
            {move || loading.get().then(|| view! { <p class="tui-dim">"Loading decks…"</p> })}
            {move || {
                error.get().map(|msg| {
                    view! { <p class="error" role="alert">"Could not load decks: " {msg}</p> }
                })
            }}
            {move || {
                let list = rows.get();
                if !loading.get() && error.get().is_none() {
                    if list.is_empty() {
                        view! {
                            <p class="tui-dim" role="status">
                                "No decks yet. Import a package or create one from the CLI."
                            </p>
                        }
                        .into_any()
                    } else {
                        view! {
                            <ul class="deck-tree" role="tree" aria-label="Decks">
                                {list
                                    .into_iter()
                                    .map(|row| {
                                        let pad = format!("padding-left: {}rem", row.depth * 5 / 4);
                                        let study_href = format!("/study?deck={}", row.id);
                                        view! {
                                            <li role="treeitem" class="deck-tree-item" style=pad>
                                                <span class="deck-name">{row.name}</span>
                                                <a href=study_href>"Study"</a>
                                            </li>
                                        }
                                    })
                                    .collect_view()}
                            </ul>
                        }
                        .into_any()
                    }
                } else {
                    ().into_any()
                }
            }}
        </section>
    }
}
