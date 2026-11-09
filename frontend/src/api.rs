use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::repository::model::UndoEventsResponse;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, Response};

#[derive(Clone, Debug)]
pub struct ApiError {
    pub status: u16,
    pub body: String,
}

/// R17: fetch the undo tombstones at or after `since_ms` (server time).
pub async fn get_undo_events(since_ms: i64) -> Result<UndoEventsResponse, ApiError> {
    get_json(&format!("/api/study/undo-events?since={since_ms}")).await
}

pub async fn get_json<T: DeserializeOwned>(path: &str) -> Result<T, ApiError> {
    let response = fetch("GET", path, &[], None).await?;
    decode_json(response).await
}

pub async fn post_json_csrf<T, B>(path: &str, body: &B) -> Result<T, ApiError>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    #[derive(Deserialize)]
    struct AuthStatus {
        #[serde(rename = "csrfToken")]
        csrf_token: String,
    }

    let status: AuthStatus = get_json("/api/auth/status").await?;
    let payload = serde_json::to_string(body).map_err(|e| ApiError {
        status: 0,
        body: format!("Could not encode request: {e}"),
    })?;
    let response = fetch(
        "POST",
        path,
        &[
            ("Content-Type", "application/json"),
            ("x-srep-csrf", status.csrf_token.as_str()),
        ],
        Some(payload),
    )
    .await?;
    decode_json(response).await
}

async fn method_json_csrf<T, B>(method: &str, path: &str, body: &B) -> Result<T, ApiError>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    #[derive(Deserialize)]
    struct AuthStatus {
        #[serde(rename = "csrfToken")]
        csrf_token: String,
    }

    let status: AuthStatus = get_json("/api/auth/status").await?;
    let payload = serde_json::to_string(body).map_err(|e| ApiError {
        status: 0,
        body: format!("Could not encode request: {e}"),
    })?;
    let response = fetch(
        method,
        path,
        &[
            ("Content-Type", "application/json"),
            ("x-srep-csrf", status.csrf_token.as_str()),
        ],
        Some(payload),
    )
    .await?;
    decode_json(response).await
}

pub async fn put_json_csrf<T, B>(path: &str, body: &B) -> Result<T, ApiError>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    method_json_csrf("PUT", path, body).await
}

pub async fn patch_json_csrf<T, B>(path: &str, body: &B) -> Result<T, ApiError>
where
    T: DeserializeOwned,
    B: Serialize + ?Sized,
{
    method_json_csrf("PATCH", path, body).await
}

async fn fetch(
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<String>,
) -> Result<Response, ApiError> {
    let init = RequestInit::new();
    init.set_method(method);
    if let Some(body) = body {
        init.set_body(&JsValue::from_str(&body));
    }

    let request = Request::new_with_str_and_init(path, &init).map_err(|e| ApiError {
        status: 0,
        body: format!("request: {e:?}"),
    })?;
    for (name, value) in headers {
        request.headers().set(name, value).map_err(|e| ApiError {
            status: 0,
            body: format!("header: {e:?}"),
        })?;
    }

    let window = web_sys::window().ok_or(ApiError {
        status: 0,
        body: "no window".to_string(),
    })?;
    let value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|e| ApiError {
            status: 0,
            body: format!("fetch: {e:?}"),
        })?;
    let response: Response = value.dyn_into().map_err(|e| ApiError {
        status: 0,
        body: format!("response: {e:?}"),
    })?;

    if !response.ok() {
        let status = response.status();
        let text = response_text(&response).await.unwrap_or_default();
        let body = if text.is_empty() {
            format!("Request failed with HTTP {status}")
        } else {
            text
        };
        return Err(ApiError { status, body });
    }

    Ok(response)
}

async fn decode_json<T: DeserializeOwned>(response: Response) -> Result<T, ApiError> {
    let text = response_text(&response).await?;
    serde_json::from_str(&text).map_err(|e| ApiError {
        status: response.status(),
        body: format!("json: {e}; body={text}"),
    })
}

async fn response_text(response: &Response) -> Result<String, ApiError> {
    let promise = response.text().map_err(|e| ApiError {
        status: 0,
        body: format!("text: {e:?}"),
    })?;
    let value = JsFuture::from(promise).await.map_err(|e| ApiError {
        status: 0,
        body: format!("text: {e:?}"),
    })?;
    value.as_string().ok_or(ApiError {
        status: 0,
        body: "Response was not text".to_string(),
    })
}
