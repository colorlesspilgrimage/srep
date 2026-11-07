use leptos::html::Button;
use leptos::prelude::*;

use crate::tui::list_state::list_key_index;

#[component]
pub fn TuiList(
    label: &'static str,
    items: Vec<String>,
    selected_index: RwSignal<usize>,
    #[prop(optional)] on_select: Option<Callback<usize>>,
) -> impl IntoView {
    let count = items.len();
    let on_key = move |ev: web_sys::KeyboardEvent| {
        let next = list_key_index(count, selected_index.get_untracked(), &ev.key());
        if let Some(idx) = next {
            ev.prevent_default();
            selected_index.set(idx);
            if let Some(cb) = on_select {
                cb.run(idx);
            }
        }
    };
    view! {
        <div
            class="tui-list"
            role="listbox"
            aria-label=label
            tabindex="0"
            on:keydown=on_key
        >
            {items
                .clone()
                .into_iter()
                .enumerate()
                .map(|(index, item)| {
                    let is_selected = move || selected_index.get() == index;
                    let row_ref = NodeRef::<Button>::new();
                    let on_select = on_select;
                    Effect::new(move |_| {
                        let Some(el) = row_ref.get() else {
                            return;
                        };
                        let _ = is_selected();
                        let _ = el.set_attribute(
                            "aria-selected",
                            if is_selected() { "true" } else { "false" },
                        );
                    });
                    view! {
                        <button
                            type="button"
                            class="tui-option"
                            role="option"
                            node_ref=row_ref
                            on:click=move |_| {
                                selected_index.set(index);
                                if let Some(cb) = on_select {
                                    cb.run(index);
                                }
                            }
                        >
                            {item}
                        </button>
                    }
                })
                .collect_view()}
        </div>
    }
}
