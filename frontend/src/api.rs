use js_sys::{Function, Reflect};
use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, RequestMode, Response};

#[derive(Clone, Debug)]
pub struct ApiError {
    #[allow(dead_code)]
    pub status: u16,
    pub body: String,
}

#[allow(dead_code)]
pub fn sync_csrf_from_client() {
    if let Some(token) = csrf_token() {
        set_csrf(&token);
    }
}

pub fn csrf_token() -> Option<String> {
    let window = web_sys::window()?;
    let client = Reflect::get(&window, &JsValue::from_str("srepClient")).ok()?;
    let get = Reflect::get(&client, &JsValue::from_str("getCsrfToken")).ok()?;
    let get: Function = get.dyn_into().ok()?;
    let v = get.call0(&client).ok()?;
    v.as_string()
}

pub fn set_csrf(token: &str) {
    let Some(window) = web_sys::window() else {
        return;
    };
    let Ok(client) = Reflect::get(&window, &JsValue::from_str("srepClient")) else {
        return;
    };
    let Ok(set) = Reflect::get(&client, &JsValue::from_str("setCsrfToken")) else {
        return;
    };
    let Ok(set) = set.dyn_into::<Function>() else {
        return;
    };
    let _ = set.call1(&client, &JsValue::from_str(token));
}

pub fn clear_csrf() {
    let Some(window) = web_sys::window() else {
        return;
    };
    let Ok(client) = Reflect::get(&window, &JsValue::from_str("srepClient")) else {
        return;
    };
    let Ok(set) = Reflect::get(&client, &JsValue::from_str("setCsrfToken")) else {
        return;
    };
    let Ok(set) = set.dyn_into::<Function>() else {
        return;
    };
    let _ = set.call1(&client, &JsValue::NULL);
}

pub fn message_for(code: &str) -> String {
    let window = web_sys::window().expect("window");
    let client = Reflect::get(&window, &JsValue::from_str("srepClient")).expect("srepClient");
    let f = Reflect::get(&client, &JsValue::from_str("messageFor")).expect("messageFor");
    let f: Function = f.dyn_into().expect("fn");
    let out = f
        .call1(&client, &JsValue::from_str(code))
        .unwrap_or(JsValue::UNDEFINED);
    out.as_string().unwrap_or_else(|| code.to_string())
}

pub async fn get_json<T: DeserializeOwned>(path: &str) -> Result<T, ApiError> {
    let response = fetch_raw(path, "GET", None).await?;
    parse_json_response(response).await
}

pub async fn post_json<T: DeserializeOwned, B: Serialize>(
    path: &str,
    body: &B,
) -> Result<T, ApiError> {
    let payload = serde_json::to_string(body).map_err(|e| ApiError {
        status: 0,
        body: e.to_string(),
    })?;
    let response = fetch_raw(path, "POST", Some(payload)).await?;
    parse_json_response(response).await
}

pub async fn patch_json<T: DeserializeOwned, B: Serialize>(
    path: &str,
    body: &B,
) -> Result<T, ApiError> {
    let payload = serde_json::to_string(body).map_err(|e| ApiError {
        status: 0,
        body: e.to_string(),
    })?;
    let response = fetch_raw(path, "PATCH", Some(payload)).await?;
    parse_json_response(response).await
}

pub async fn delete_json<T: DeserializeOwned, B: Serialize>(
    path: &str,
    body: &B,
) -> Result<T, ApiError> {
    let payload = serde_json::to_string(body).map_err(|e| ApiError {
        status: 0,
        body: e.to_string(),
    })?;
    let response = fetch_raw(path, "DELETE", Some(payload)).await?;
    parse_json_response(response).await
}

pub async fn post_empty(path: &str) -> Result<(), ApiError> {
    let response = fetch_raw(path, "POST", Some("{}".to_string())).await?;
    let status = response.status();
    if (200..300).contains(&status) {
        Ok(())
    } else {
        let text = JsFuture::from(response.text().unwrap())
            .await
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_default();
        Err(ApiError { status, body: text })
    }
}

async fn parse_json_response<T: DeserializeOwned>(response: Response) -> Result<T, ApiError> {
    let status = response.status();
    let text = JsFuture::from(response.text().unwrap())
        .await
        .map_err(|e| ApiError {
            status,
            body: format!("{e:?}"),
        })?;
    let text = text.as_string().unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(ApiError { status, body: text });
    }
    serde_json::from_str(&text).map_err(|e| ApiError {
        status,
        body: format!("json: {e}; body={text}"),
    })
}

pub async fn fetch_raw(path: &str, method: &str, body: Option<String>) -> Result<Response, ApiError> {
    let opts = RequestInit::new();
    opts.set_method(method);
    opts.set_mode(RequestMode::Cors);
    let has_body = body.is_some();
    if let Some(payload) = body {
        opts.set_body(&JsValue::from_str(&payload));
    }
    let request = Request::new_with_str_and_init(path, &opts).map_err(|e| ApiError {
        status: 0,
        body: format!("request: {e:?}"),
    })?;
    let headers = request.headers();
    if has_body {
        headers
            .set("Content-Type", "application/json")
            .map_err(|e| ApiError {
                status: 0,
                body: format!("header: {e:?}"),
            })?;
    }
    if let Some(token) = csrf_token() {
        let _ = headers.set("x-srep-csrf", &token);
    }
    let window = web_sys::window().ok_or(ApiError {
        status: 0,
        body: "no window".into(),
    })?;
    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|e| ApiError {
            status: 0,
            body: format!("fetch: {e:?}"),
        })?;
    resp_value.dyn_into::<Response>().map_err(|e| ApiError {
        status: 0,
        body: format!("response: {e:?}"),
    })
}

#[derive(serde::Deserialize)]
pub struct ErrorBody {
    pub error: Option<String>,
}

pub fn error_code_from_body(body: &str) -> String {
    serde_json::from_str::<ErrorBody>(body)
        .ok()
        .and_then(|b| b.error)
        .unwrap_or_else(|| "error".to_string())
}
