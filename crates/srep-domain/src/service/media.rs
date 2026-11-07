use crate::core::ids::new_id;
use crate::core::media_rules::{
    is_sha256_hex, normalize_declared_mime, sanitize_original_name, sniff_mime,
};
use crate::deps::DomainCtx;
use crate::error::{fail, ApiResult};
use crate::media_fs::write_media;
use crate::types::{MediaRow, MediaView};
use sha2::{Digest, Sha256};

pub async fn store_media(
    ctx: &DomainCtx<'_>,
    bytes: &[u8],
    declared_mime: &str,
    original_name: &str,
) -> ApiResult<MediaView> {
    if bytes.is_empty() {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "empty_file"));
    }
    if bytes.len() as u64 > ctx.config().media_max_bytes {
        return Err(fail(
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        ));
    }
    let mime = sniff_mime(bytes).ok_or_else(|| {
        fail(
            axum::http::StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
        )
    })?;
    if normalize_declared_mime(declared_mime) != mime {
        return Err(fail(axum::http::StatusCode::BAD_REQUEST, "mime_mismatch"));
    }
    let sha = {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hex::encode(hasher.finalize())
    };
    write_media(ctx.config().media_dir.as_path(), &sha, bytes)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    let row = MediaRow {
        id: new_id(),
        sha256: sha.clone(),
        mime: mime.to_string(),
        size: bytes.len() as i64,
        original_name: sanitize_original_name(original_name),
    };
    let store = ctx.store();
    let stored = store
        .insert_media_if_absent(&row)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?;
    Ok(MediaView {
        row: stored.clone(),
        created: stored.id == row.id,
    })
}

pub async fn read_media(ctx: &DomainCtx<'_>, sha: &str) -> ApiResult<(MediaRow, Vec<u8>)> {
    if !is_sha256_hex(sha) {
        return Err(fail(axum::http::StatusCode::NOT_FOUND, "not_found"));
    }
    let store = ctx.store();
    let media = store
        .get_media_by_sha(sha)
        .await
        .map_err(|_| fail(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "bad_request"))?
        .ok_or_else(|| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    let bytes = crate::media_fs::read_media(ctx.config().media_dir.as_path(), sha)
        .await
        .map_err(|_| fail(axum::http::StatusCode::NOT_FOUND, "not_found"))?;
    Ok((media, bytes))
}
