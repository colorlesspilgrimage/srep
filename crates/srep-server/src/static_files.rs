use axum::{
    body::Body,
    extract::State,
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::Embed;

use srep_auth::AppState;

#[derive(Embed)]
#[folder = "../../site/"]
struct SiteAssets;

pub async fn serve_static_or_spa(State(_state): State<AppState>, uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(content) = SiteAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime.as_ref())
            // R13a: the app shell must be servable from the browser HTTP cache
            // for a cold offline launch (no service worker yet — R13b owns it).
            // One hour is short enough that a redeployed shell is picked up
            // promptly; the service worker will take over shell caching.
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::from(content.data.into_owned()))
            .unwrap();
    }

    if let Some(index) = SiteAssets::get("index.html") {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::from(index.data.into_owned()))
            .unwrap();
    }

    StatusCode::NOT_FOUND.into_response()
}
