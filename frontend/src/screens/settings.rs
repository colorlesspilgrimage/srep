use leptos::prelude::*;

use crate::themes::{self, ThemeHandle, THEME_IDS};

#[component]
pub fn SettingsScreen() -> impl IntoView {
    let theme = expect_context::<ThemeHandle>();
    let status = RwSignal::new(String::new());

    let pick = move |id: &'static str| {
        theme.set(id);
        themes::persist_theme(id);
        themes::apply_body_theme(id);
        status.set(format!("Theme set to {}.", themes::theme_label(id)));
    };

    view! {
        <section class="screen-settings">
            <p class="tui-eyebrow">"Settings"</p>
            <h1 class="screen-title">"Preferences"</h1>
            <div class="settings-pane">
                <h2>"Appearance"</h2>
                <ul class="theme-list" role="listbox" aria-label="Theme">
                    {THEME_IDS
                        .iter()
                        .map(|&id| {
                            let active = move || theme.id.get() == id;
                            view! {
                                <li>
                                    <button
                                        type="button"
                                        class=move || {
                                            if active() {
                                                "theme-pick is-active"
                                            } else {
                                                "theme-pick"
                                            }
                                        }
                                        aria-selected=move || active()
                                        on:click=move |_| pick(id)
                                    >
                                        {themes::theme_label(id)}
                                    </button>
                                </li>
                            }
                        })
                        .collect_view()}
                </ul>
                {move || {
                    let text = status.get();
                    (!text.is_empty()).then(|| view! { <p role="status">{text}</p> })
                }}
            </div>
            <div class="settings-pane">
                <h2>"Study day"</h2>
                <p class="tui-dim">"Timezone and rollover controls arrive with full settings parity."</p>
            </div>
        </section>
    }
}
