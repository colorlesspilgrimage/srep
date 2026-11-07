use serde::de::DeserializeOwned;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, RequestMode, Response};

#[derive(Clone, Debug)]
pub struct ApiError {
    pub status: u16,
    pub body: String,
}

pub async fn get_json<T: DeserializeOwned>(path: &str) -> Result<T, ApiError> {
    let response = fetch(path, "GET", None).await?;
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

#[allow(dead_code)]
pub async fn post_json<T: DeserializeOwned, B: serde::Serialize>(
    path: &str,
    body: &B,
) -> Result<T, ApiError> {
    let payload = serde_json::to_string(body).map_err(|e| ApiError {
        status: 0,
        body: e.to_string(),
    })?;
    let response = fetch(path, "POST", Some(payload)).await?;
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

async fn fetch(path: &str, method: &str, body: Option<String>) -> Result<Response, ApiError> {
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
    if has_body {
        request
            .headers()
            .set("Content-Type", "application/json")
            .map_err(|e| ApiError {
                status: 0,
                body: format!("header: {e:?}"),
            })?;
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
    resp_value
        .dyn_into::<Response>()
        .map_err(|e| ApiError {
            status: 0,
            body: format!("response: {e:?}"),
        })
}
