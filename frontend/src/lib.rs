use leptos::prelude::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn hydrate() {
    mount_to_body(|| view! { <App /> });
}

#[component]
fn App() -> impl IntoView {
    view! {
        <main class="app-shell">
            <h1>"srep"</h1>
            <p>"Leptos WASM shell (v2 rewrite)."</p>
        </main>
    }
}
