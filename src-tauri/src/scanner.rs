use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub file_path: String,
    pub file_hash: String,
    pub daw: String,
    pub daw_version: Option<String>,
    pub bpm: Option<f64>,
    pub key: Option<String>,
    pub time_signature: Option<String>,
    pub track_count: Option<u32>,
    pub duration_secs: Option<f64>,
    pub size_bytes: u64,
    pub created_at: i64,
    pub modified_at: i64,
}

pub const DAW_EXTENSIONS: &[(&str, &str)] = &[
    ("als",       "ableton"),
    ("alp",       "ableton"),
    ("logicx",    "logic"),
    ("flp",       "fl"),
    ("ptx",       "protools"),
    ("cpr",       "cubase"),
    ("rpp",       "reaper"),
    ("bwproject", "bitwig"),
];

pub fn scan_folder(root: &str) -> Vec<ProjectMetadata> {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| !is_backup_path(e.path()))
        .filter_map(|entry| {
            let path = entry.path();
            let ext = path.extension()?.to_str()?.to_lowercase();
            let daw = DAW_EXTENSIONS.iter().find(|(e, _)| *e == ext.as_str())?.1;
            build_metadata(path, daw).ok()
        })
        .collect()
}

fn is_backup_path(path: &Path) -> bool {
    path.components().any(|c| {
        c.as_os_str().eq_ignore_ascii_case("Backup")
    })
}

pub fn build_metadata_pub(path: &Path, daw: &str) -> Result<ProjectMetadata, std::io::Error> {
    build_metadata(path, daw)
}

fn build_metadata(path: &Path, daw: &str) -> Result<ProjectMetadata, std::io::Error> {
    let meta = fs::metadata(path)?;
    let size_bytes = meta.len();
    let modified_at = meta
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let created_at = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(modified_at);

    let file_hash = hash_file(path)?;

    let (bpm, key, time_signature, track_count, duration_secs, daw_version) = if daw == "ableton" {
        crate::parser::ableton::parse(path)
            .map(|m| (m.bpm, m.key, m.time_signature, m.track_count, m.duration_secs, m.daw_version))
            .unwrap_or((None, None, None, None, None, None))
    } else {
        (None, None, None, None, None, None)
    };

    Ok(ProjectMetadata {
        file_path: path.to_string_lossy().into_owned(),
        file_hash,
        daw: daw.to_string(),
        daw_version,
        bpm,
        key,
        time_signature,
        track_count,
        duration_secs,
        size_bytes,
        created_at,
        modified_at,
    })
}

fn hash_file(path: &Path) -> Result<String, std::io::Error> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn finds_als_files_recursively() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("project_folder");
        std::fs::create_dir(&sub).unwrap();
        let als_path = sub.join("my_track.als");
        std::fs::File::create(&als_path).unwrap().write_all(b"fake").unwrap();

        let results = scan_folder(dir.path().to_str().unwrap());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].daw, "ableton");
        assert!(results[0].size_bytes > 0);
    }

    #[test]
    fn ignores_unknown_extensions() {
        let dir = tempdir().unwrap();
        std::fs::File::create(dir.path().join("notes.txt")).unwrap();
        let results = scan_folder(dir.path().to_str().unwrap());
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn title_derived_from_filename() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("my-cool_track.als");
        std::fs::File::create(&path).unwrap().write_all(b"x").unwrap();
        let results = scan_folder(dir.path().to_str().unwrap());
        assert!(results[0].file_path.contains("my-cool_track"));
    }
}
