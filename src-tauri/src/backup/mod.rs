pub mod gdrive;
pub mod local;

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub provider: String,
    pub destination: String,
    pub size_bytes: u64,
    pub checksum: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GDriveTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .collect()
}

/// Creates a zip of the .als file and its .dawmgr sidecar (if present).
/// The zip is placed in the system temp dir; caller is responsible for cleanup.
pub fn zip_project(als_path: &Path, title: &str) -> Result<PathBuf, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let zip_name = format!("{}_{}.zip", sanitize(title), ts);
    let zip_path = std::env::temp_dir().join(&zip_name);

    let file = File::create(&zip_path).map_err(|e| format!("zip create: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // Add the project file itself
    let als_name = als_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid project path")?;
    zip.start_file(als_name, opts).map_err(|e| e.to_string())?;
    let mut f = File::open(als_path).map_err(|e| format!("open project: {e}"))?;
    std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;

    // Add .dawmgr sidecar folder if present
    let stem = als_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("invalid stem")?;
    let sidecar = als_path.with_file_name(format!("{stem}.dawmgr"));
    if sidecar.exists() {
        let base = als_path.parent().unwrap_or(Path::new("/"));
        for entry in WalkDir::new(&sidecar).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let rel = p
                .strip_prefix(base)
                .unwrap_or(p)
                .to_string_lossy()
                .replace('\\', "/");
            zip.start_file(&rel, opts).map_err(|e| e.to_string())?;
            let mut f = File::open(p).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(zip_path)
}

pub fn checksum_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}
