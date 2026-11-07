use leptos::prelude::*;

use crate::client_js;

#[component]
pub fn CardHtml(#[prop(into)] text: Signal<String>) -> impl IntoView {
    let node_ref = NodeRef::<leptos::html::Div>::new();
    Effect::new(move |_| {
        let html = client_js::sanitize_card_html(&text.get());
        if let Some(el) = node_ref.get() {
            let _ = el.set_inner_html(&html);
        }
    });
    view! {
        <div class="study-card" node_ref=node_ref />
    }
}

#[component]
pub fn NotePreviewBlock(
    front: String,
    back: String,
    template_name: String,
) -> impl IntoView {
    let front_sig = RwSignal::new(front);
    let back_sig = RwSignal::new(back);
    view! {
        <p>{template_name}</p>
        <CardHtml text=Signal::derive(move || front_sig.get()) />
        <CardHtml text=Signal::derive(move || back_sig.get()) />
    }
}
