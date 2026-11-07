use js_sys::{Function, Promise, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

fn client() -> js_sys::Object {
    let window = web_sys::window().expect("window");
    Reflect::get(&window, &JsValue::from_str("srepClient"))
        .expect("srepClient")
        .dyn_into()
        .expect("srepClient object")
}

pub fn set_csrf(token: &str) {
    crate::api::set_csrf(token);
}

async fn call1(name: &str, a: JsValue) -> JsValue {
    let f = Reflect::get(&client(), &JsValue::from_str(name)).expect(name);
    let f: Function = f.dyn_into().expect("fn");
    let p = f.call1(&client(), &a).expect("call");
    JsFuture::from(Promise::from(p))
        .await
        .expect("promise")
}

async fn call2(name: &str, a: JsValue, b: JsValue) -> JsValue {
    let f = Reflect::get(&client(), &JsValue::from_str(name)).expect(name);
    let f: Function = f.dyn_into().expect("fn");
    let p = f.call2(&client(), &a, &b).expect("call");
    JsFuture::from(Promise::from(p))
        .await
        .expect("promise")
}

pub struct CeremonyOutcome {
    pub ok: bool,
    pub message: String,
    pub body: JsValue,
}

fn parse_outcome(v: JsValue) -> CeremonyOutcome {
    let ok = Reflect::get(&v, &JsValue::from_str("ok"))
        .ok()
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let message = Reflect::get(&v, &JsValue::from_str("message"))
        .ok()
        .and_then(|x| x.as_string())
        .unwrap_or_default();
    let body = Reflect::get(&v, &JsValue::from_str("body"))
        .unwrap_or(JsValue::UNDEFINED);
    if ok {
        if let Ok(token) = Reflect::get(&body, &JsValue::from_str("csrfToken")) {
            if let Some(t) = token.as_string() {
                set_csrf(&t);
            }
        }
    }
    CeremonyOutcome { ok, message, body }
}

pub async fn enroll_setup(
    setup_token: String,
    nickname: String,
    kind: &str,
) -> CeremonyOutcome {
    let fields = js_sys::Object::new();
    let _ = Reflect::set(
        &fields,
        &JsValue::from_str("setupToken"),
        &JsValue::from_str(&setup_token),
    );
    let _ = Reflect::set(
        &fields,
        &JsValue::from_str("nickname"),
        &JsValue::from_str(&nickname),
    );
    let _ = Reflect::set(
        &fields,
        &JsValue::from_str("kind"),
        &JsValue::from_str(kind),
    );
    let base = JsValue::from_str("/api/auth/setup");
    parse_outcome(call2("enroll", base, fields.into()).await)
}

pub async fn enroll_credential(nickname: String, kind: &str) -> CeremonyOutcome {
    let fields = js_sys::Object::new();
    let _ = Reflect::set(
        &fields,
        &JsValue::from_str("nickname"),
        &JsValue::from_str(&nickname),
    );
    let _ = Reflect::set(
        &fields,
        &JsValue::from_str("kind"),
        &JsValue::from_str(kind),
    );
    let base = JsValue::from_str("/api/auth/credentials");
    parse_outcome(call2("enroll", base, fields.into()).await)
}

pub async fn login_with(kind: &str) -> CeremonyOutcome {
    parse_outcome(call1("loginWith", JsValue::from_str(kind)).await)
}

pub async fn recovery_login(code: String) -> CeremonyOutcome {
    parse_outcome(call1("recoveryLogin", JsValue::from_str(&code)).await)
}

pub async fn sign_out(everywhere: bool) {
    let path = if everywhere {
        "/api/auth/logout-all"
    } else {
        "/api/auth/logout"
    };
    let _ = crate::api::post_empty(path).await;
    crate::api::clear_csrf();
}

pub async fn sync_csrf_from_status() {
    if let Ok(status) = crate::api::get_json::<AuthStatus>("/api/auth/status").await {
        if let Some(token) = status.csrf_token {
            set_csrf(&token);
        }
    }
}

#[derive(serde::Deserialize)]
pub struct AuthStatus {
    #[serde(rename = "setupComplete")]
    pub setup_complete: bool,
    pub authenticated: bool,
    #[serde(rename = "csrfToken")]
    pub csrf_token: Option<String>,
}
