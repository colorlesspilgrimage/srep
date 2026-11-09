use leptos::{prelude::*, task::spawn_local};
use serde::{Deserialize, Serialize};

use crate::{
    api,
    themes::{self, ThemeHandle, THEME_IDS},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StudyDaySettings {
    rollover_hour: u8,
    timezone: String,
}

#[derive(Debug, Deserialize)]
struct StudyDayReply {
    settings: StudyDaySettings,
}

#[component]
pub fn SettingsScreen() -> impl IntoView {
    let theme = expect_context::<ThemeHandle>();
    let status = RwSignal::new(String::new());
    let timezone = RwSignal::new(String::new());
    let rollover_hour = RwSignal::new(0u8);
    let study_status = RwSignal::new(String::new());
    let saving = RwSignal::new(false);

    Effect::new(move |_| {
        spawn_local(async move {
            match api::get_json::<StudyDayReply>("/api/settings/study").await {
                Ok(reply) => {
                    timezone.set(reply.settings.timezone);
                    rollover_hour.set(reply.settings.rollover_hour);
                }
                Err(_) => study_status.set("Could not load study day settings.".to_string()),
            }
        });
    });

    let save_study_day = move |_| {
        if saving.get_untracked() {
            return;
        }
        if rollover_hour.get_untracked() > 23 {
            study_status.set("Rollover hour must be between 0 and 23.".to_string());
            return;
        }
        let request = StudyDaySettings {
            rollover_hour: rollover_hour.get_untracked(),
            timezone: timezone.get_untracked(),
        };
        saving.set(true);
        study_status.set(String::new());
        spawn_local(async move {
            let result =
                api::put_json_csrf::<StudyDayReply, _>("/api/settings/study", &request).await;
            saving.set(false);
            match result {
                Ok(_) => study_status.set("Study day settings saved.".to_string()),
                Err(_) => {
                    study_status.set("Could not save study day settings.".to_string());
                }
            }
        });
    };

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
                                        aria-selected=active
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
                <label>
                    "Timezone"
                    <input
                        type="text"
                        prop:value=move || timezone.get()
                        on:input=move |event| timezone.set(event_target_value(&event))
                    />
                </label>
                <label>
                    "Rollover hour"
                    <input
                        type="number"
                        min="0"
                        max="23"
                        step="1"
                        prop:value=move || rollover_hour.get().to_string()
                        on:input=move |event| {
                            if let Ok(value) = event_target_value(&event).parse::<u8>() {
                                rollover_hour.set(value);
                            }
                        }
                    />
                </label>
                <button
                    type="button"
                    disabled=move || saving.get()
                    on:click=save_study_day
                >
                    "Save"
                </button>
                {move || {
                    let text = study_status.get();
                    (!text.is_empty()).then(|| view! { <p role="status">{text}</p> })
                }}
            </div>
        </section>
    }
}
