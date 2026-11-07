use leptos::prelude::*;

use crate::tui::tui_list::TuiList;

#[component]
pub fn ThemeSettingsPane(
    theme_names: Vec<String>,
    selected_index: RwSignal<usize>,
    on_select: Callback<usize>,
    on_save: Callback<()>,
    save_pending: RwSignal<bool>,
    status_text: RwSignal<String>,
) -> impl IntoView {
    view! {
        <TuiList
            label="Theme setting"
            items=theme_names
            selected_index=selected_index
            on_select=on_select
        />
        <button
            type="button"
            aria-busy=move || save_pending.get()
            on:click=move |_| on_save.run(())
        >
            "Save theme"
        </button>
        <Show when=move || !status_text.get().is_empty()>
            <p role="status" aria-label="Saved.">
                {move || status_text.get()}
            </p>
        </Show>
    }
}
