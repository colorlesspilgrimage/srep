use leptos::prelude::*;

#[component]
pub fn StudyScreen() -> impl IntoView {
    view! {
        <section class="screen-study">
            <p class="tui-eyebrow">"Study"</p>
            <h1 class="screen-title">"Daily queue"</h1>
            <p class="tui-dim">
                "The study client will pull the next card from "
                <code>"/api/study/next"</code> ". Use deck links on the home screen to focus a subtree."
            </p>
            <div class="study-placeholder" role="status">
                <p>"No card loaded yet."</p>
                <p class="tui-dim">"Sign in and add notes to begin reviewing."</p>
            </div>
        </section>
    }
}
