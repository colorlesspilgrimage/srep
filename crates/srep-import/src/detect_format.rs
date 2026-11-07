#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportFormat {
    Native,
    Apkg,
    Csv,
    Tsv,
}

const ZIP_MAGIC: &[u8] = b"PK\x03\x04";

fn is_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes.starts_with(ZIP_MAGIC)
}

pub fn detect_import_format(bytes: &[u8], content_type: &str) -> Option<ImportFormat> {
    let type_part = content_type.split(';').next()?.trim().to_lowercase();
    if type_part == "text/csv" || type_part == "application/csv" {
        return Some(ImportFormat::Csv);
    }
    if type_part == "text/tab-separated-values" {
        return Some(ImportFormat::Tsv);
    }
    if is_zip(bytes) {
        if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) {
            let mut has_manifest = false;
            let mut has_anki = false;
            for i in 0..archive.len() {
                if let Ok(file) = archive.by_index(i) {
                    match file.name() {
                        "manifest.json" => has_manifest = true,
                        "collection.anki2" | "collection.anki21" | "collection.anki21b" => {
                            has_anki = true
                        }
                        _ => {}
                    }
                }
            }
            if has_manifest {
                return Some(ImportFormat::Native);
            }
            if has_anki {
                return Some(ImportFormat::Apkg);
            }
        }
        return Some(ImportFormat::Apkg);
    }
    if type_part.contains("csv") {
        return Some(ImportFormat::Csv);
    }
    if !bytes.is_empty() && (bytes.contains(&b',') || bytes.contains(&b'\t')) {
        let sample = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]);
        if sample.contains('\t') {
            return Some(ImportFormat::Tsv);
        }
        if sample.contains(',') {
            return Some(ImportFormat::Csv);
        }
    }
    None
}
