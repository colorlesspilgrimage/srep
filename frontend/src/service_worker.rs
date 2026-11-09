use wasm_bindgen::JsValue;

pub fn register() {
    let window = match web_sys::window() {
        Some(window) => window,
        None => return,
    };
    let navigator = window.navigator();

    // Navigator::service_worker() throws where service workers are unsupported.
    let supported =
        js_sys::Reflect::has(&navigator, &JsValue::from_str("serviceWorker")).unwrap_or(false);
    if !supported {
        return;
    }

    wasm_bindgen_futures::spawn_local(async move {
        let mut options = web_sys::RegistrationOptions::new();
        options.set_update_via_cache(web_sys::ServiceWorkerUpdateViaCache::None);

        let registration = navigator
            .service_worker()
            .register_with_options("/sw.js", &options);

        match wasm_bindgen_futures::JsFuture::from(registration).await {
            Ok(_) => {
                web_sys::console::log_1(&JsValue::from_str("Service worker registered"));
            }
            Err(error) => {
                web_sys::console::error_2(
                    &JsValue::from_str("Service worker registration failed"),
                    &error,
                );
            }
        }
    });
}
