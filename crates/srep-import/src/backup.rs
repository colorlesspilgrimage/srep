use anyhow::{Context, Result};
use srep_config::{Config, DatabaseConfig};
use std::path::Path;
use tokio::fs;
use zip::write::FileOptions;
use zip::ZipWriter;

pub async fn backup_sqlite(config: &Config, out_path: &Path) -> Result<()> {
    let DatabaseConfig::Sqlite { path } = &config.database else {
        anyhow::bail!("backup is implemented for SQLite only");
    };
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let data = fs::read(path).await.with_context(|| format!("read {}", path.display()))?;
    let file = std::fs::File::create(out_path)?;
    let mut zip = ZipWriter::new(file);
    let opts: FileOptions<'_, ()> =
        FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("collection.db", opts)?;
    std::io::Write::write_all(&mut zip, &data)?;
    zip.start_file("manifest.json", opts)?;
    std::io::Write::write_all(
        &mut zip,
        br#"{"version":1,"format":"native-lite"}"#,
    )?;
    zip.finish()?;
    Ok(())
}

pub async fn restore_sqlite(config: &Config, from_path: &Path) -> Result<()> {
    let DatabaseConfig::Sqlite { path } = &config.database else {
        anyhow::bail!("restore is implemented for SQLite only");
    };
    let bytes = fs::read(from_path).await?;
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)?;
    let mut db_bytes = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        if file.name() == "collection.db" {
            std::io::Read::read_to_end(&mut file, &mut db_bytes)?;
            break;
        }
    }
    if db_bytes.is_empty() {
        anyhow::bail!("archive missing collection.db");
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(path, db_bytes).await?;
    Ok(())
}
