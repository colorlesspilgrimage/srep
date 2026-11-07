use crate::backup;
use crate::detect_format::ImportFormat;
use crate::pending::{stash_pending, PendingImport};
use serde_json::json;
use srep_auth::AppState;
use srep_config::DatabaseConfig;

pub struct DryRunReport {
    pub body: serde_json::Value,
}

pub async fn dry_run_import(
    state: &AppState,
    bytes: &[u8],
    content_type: &str,
) -> Result<DryRunReport, &'static str> {
    let Some(format) = crate::detect_format::detect_import_format(bytes, content_type) else {
        return Err("unknown_format");
    };
    let now = chrono::Utc::now().timestamp_millis();
    let (summary, format_name, would_import) = match format {
        ImportFormat::Native => {
            let counts = native_counts(bytes)?;
            (
                "Native srep archive.",
                "native",
                counts,
            )
        }
        ImportFormat::Apkg => (
            "Anki .apkg package.",
            "apkg",
            json!({ "presets": 0, "decks": 0, "notes": 0, "cards": 0 }),
        ),
        ImportFormat::Csv => (
            "CSV note import.",
            "csv",
            csv_would_import(bytes, b',')?,
        ),
        ImportFormat::Tsv => (
            "TSV note import.",
            "tsv",
            csv_would_import(bytes, b'\t')?,
        ),
    };
    let token = stash_pending(
        PendingImport {
            format,
            bytes: bytes.to_vec(),
            expires_at: now + 15 * 60 * 1000,
        },
        now,
    );
    Ok(DryRunReport {
        body: json!({
            "format": format_name,
            "summary": summary,
            "warnings": [],
            "conflicts": [],
            "wouldImport": would_import,
            "importToken": token,
        }),
    })
}

fn native_counts(bytes: &[u8]) -> Result<serde_json::Value, &'static str> {
    let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) else {
        return Err("bad_archive");
    };
    let mut manifest = false;
    let mut collection_db = false;
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            if file.name() == "manifest.json" {
                manifest = true;
            }
            if file.name() == "collection.db" {
                collection_db = true;
            }
        }
    }
    if !collection_db {
        return Err("bad_archive");
    }
    let _ = manifest;
    Ok(json!({ "presets": 0, "decks": 0, "notes": 0, "cards": 0 }))
}

fn csv_would_import(bytes: &[u8], sep: u8) -> Result<serde_json::Value, &'static str> {
    let text = std::str::from_utf8(bytes).map_err(|_| "bad_csv")?;
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let header = lines.next().ok_or("bad_csv_header")?;
    let cols: Vec<_> = header.split(sep as char).collect();
    let has_deck = cols.iter().any(|c| c.eq_ignore_ascii_case("deck"));
    let has_field = cols
        .iter()
        .any(|c| c.to_ascii_lowercase().starts_with("field") || ["front", "back"].contains(&c.to_ascii_lowercase().as_str()));
    if !has_deck || !has_field {
        return Err("bad_csv_header");
    }
    let note_rows = lines.count();
    Ok(json!({ "presets": 0, "decks": 0, "notes": note_rows, "cards": note_rows }))
}

pub async fn apply_import(state: &AppState, token: &str) -> Result<(), &'static str> {
    let now = chrono::Utc::now().timestamp_millis();
    let Some(pending) = crate::pending::take_pending(token, now) else {
        return Err("bad_token");
    };
    match pending.format {
        ImportFormat::Native => apply_native(state, &pending.bytes).await,
        ImportFormat::Apkg => Err("bad_apkg_collection"),
        ImportFormat::Csv | ImportFormat::Tsv => apply_csv_placeholder(state, &pending.bytes, pending.format).await,
    }
}

async fn apply_native(state: &AppState, bytes: &[u8]) -> Result<(), &'static str> {
    let DatabaseConfig::Sqlite { path } = &state.config.database else {
        return Err("bad_request");
    };
    let tmp = std::env::temp_dir().join(format!("srep-import-{}.zip", uuid::Uuid::new_v4()));
    tokio::fs::write(&tmp, bytes).await.map_err(|_| "bad_archive")?;
    let mut cfg = (*state.config).clone();
    cfg.database = DatabaseConfig::Sqlite {
        path: path.clone(),
    };
    backup::restore_sqlite(&cfg, &tmp)
        .await
        .map_err(|_| "bad_archive")?;
    let _ = tokio::fs::remove_file(&tmp).await;
    Ok(())
}

async fn apply_csv_placeholder(_state: &AppState, _bytes: &[u8], _format: ImportFormat) -> Result<(), &'static str> {
    // CSV row materialization requires snapshot merge (ported in a later pass).
    Err("bad_csv")
}
