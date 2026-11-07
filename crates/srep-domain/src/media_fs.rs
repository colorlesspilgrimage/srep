use std::path::Path;
use tokio::fs;

pub async fn write_media(dir: &Path, sha: &str, bytes: &[u8]) -> anyhow::Result<()> {
    let target = file_path(dir, sha);
    fs::create_dir_all(target.parent().unwrap()).await?;
    if fs::try_exists(&target).await.unwrap_or(false) {
        return Ok(());
    }
    let tmp_dir = dir.join("tmp");
    fs::create_dir_all(&tmp_dir).await?;
    let tmp = tmp_dir.join(format!("{}", uuid::Uuid::new_v4()));
    fs::write(&tmp, bytes).await?;
    fs::rename(&tmp, &target).await?;
    Ok(())
}

pub async fn read_media(dir: &Path, sha: &str) -> anyhow::Result<Vec<u8>> {
    fs::read(file_path(dir, sha)).await.map_err(Into::into)
}

fn file_path(dir: &Path, sha: &str) -> std::path::PathBuf {
    dir.join(&sha[..2]).join(sha)
}
