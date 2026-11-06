pub mod gdrive;
pub mod local;
pub mod manifest;
pub mod restore;

use manifest::{Manifest, ManifestFile, ManifestMissing, ManifestProject};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

const LARGE_FILE_THRESHOLD: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB
const AUDIO_EXTENSIONS: [&str; 7] = ["wav", "aif", "aiff", "mp3", "flac", "m4a", "ogg"];

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub provider: String,
    pub destination: String,
    pub size_bytes: u64,
    pub checksum: String,
    pub status: String,
    pub missing_count: u32,
    pub manifest_json: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GDriveTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

/// A project_files row selected for inclusion in a stage backup.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageFileInput {
    pub file_path: String,
    pub file_name: String,
    pub kind: String,
    pub export_type: Option<String>,
    pub version_label: String,
    pub is_final: bool,
}

/// Wraps a `Read` and feeds every chunk through a running SHA-256 digest, so a
/// file can be hashed while it streams into the zip (or out of it, during
/// restore) without a second read pass.
pub(crate) struct HashingReader<R: Read> {
    inner: R,
    hasher: Sha256,
}

impl<R: Read> HashingReader<R> {
    pub(crate) fn new(inner: R) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
        }
    }

    pub(crate) fn finish(self) -> String {
        hex::encode(self.hasher.finalize())
    }
}

impl<R: Read> Read for HashingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.hasher.update(&buf[..n]);
        Ok(n)
    }
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// `Stored` for audio (already compressed or doesn't compress well); `Deflated`
/// for everything else (`.als`, sidecar XML/text, lyrics/tabs/todos).
fn compression_for(path: &Path) -> CompressionMethod {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        CompressionMethod::Stored
    } else {
        CompressionMethod::Deflated
    }
}

fn file_options(path: &Path, size_bytes: u64) -> SimpleFileOptions {
    let opts = SimpleFileOptions::default().compression_method(compression_for(path));
    if size_bytes >= LARGE_FILE_THRESHOLD {
        opts.large_file(true)
    } else {
        opts
    }
}

/// Returns a name unique within its directory, appending `_2`, `_3`, ... before
/// the extension on repeats. `dir_key` scopes the counter (e.g. one per `stages/<kind>/`).
fn dedup_name(used: &mut HashMap<String, u32>, dir_key: &str, name: &str) -> String {
    let key = format!("{dir_key}/{name}");
    let count = used.entry(key).or_insert(0);
    *count += 1;
    if *count == 1 {
        return name.to_string();
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{stem}_{count}.{ext}"),
        None => format!("{stem}_{count}"),
    }
}

fn mtime_secs(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The manifest fields that only apply to `project_files` stage entries —
/// grouped so `add_hashed_entry` stays under clippy's argument-count lint.
#[derive(Default)]
struct EntryMeta {
    stage: Option<String>,
    export_type: Option<String>,
    version_label: Option<String>,
    is_final: bool,
}

/// Streams `src` into the zip at `archive_path`, hashing it on the way, and
/// returns a manifest entry for it.
fn add_hashed_entry(
    zip: &mut ZipWriter<File>,
    archive_path: &str,
    original_path: &str,
    size_bytes: u64,
    meta: EntryMeta,
) -> Result<ManifestFile, String> {
    let opts = file_options(Path::new(archive_path), size_bytes);
    zip.start_file(archive_path, opts)
        .map_err(|e| e.to_string())?;
    let src = File::open(original_path).map_err(|e| format!("open {original_path}: {e}"))?;
    let mut hashing = HashingReader::new(src);
    std::io::copy(&mut hashing, zip).map_err(|e| e.to_string())?;
    let sha256 = hashing.finish();
    Ok(ManifestFile {
        archive_path: archive_path.to_string(),
        original_path: original_path.to_string(),
        stage: meta.stage,
        export_type: meta.export_type,
        version_label: meta.version_label,
        is_final: meta.is_final,
        size_bytes,
        sha256,
        mtime: mtime_secs(Path::new(original_path)),
    })
}

/// Creates a manifest-based backup archive: the `.als` file, its `.dawmgr`
/// sidecar (if present), optional lyrics/tabs/todos text, the selected stage
/// files (each hashed while it streams in), and a `manifest.json` covering all
/// of the above. Files that are missing or unreadable are recorded in
/// `manifest.missing` instead of failing the whole backup.
///
/// The zip is placed in the system temp dir; the caller is responsible for cleanup.
pub fn zip_project(
    als_path: &Path,
    title: &str,
    project_id: &str,
    lyrics: Option<&str>,
    tabs: Option<&str>,
    todos: Option<&str>,
    stage_files: &[StageFileInput],
) -> Result<(PathBuf, Manifest), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let ts = now.as_secs();
    // Nanosecond precision (rather than seconds) avoids two backups started in
    // the same second colliding on the same temp file name.
    let zip_name = format!("{}_{}.zip", sanitize(title), now.as_nanos());
    let zip_path = std::env::temp_dir().join(&zip_name);

    let file = File::create(&zip_path).map_err(|e| format!("zip create: {e}"))?;
    let mut zip = ZipWriter::new(file);

    let mut files = Vec::new();
    let mut missing = Vec::new();

    // The project file itself
    let als_name = als_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid project path")?;
    let als_archive_path = format!("project/{als_name}");
    let als_size = std::fs::metadata(als_path)
        .map_err(|e| format!("stat project: {e}"))?
        .len();
    files.push(add_hashed_entry(
        &mut zip,
        &als_archive_path,
        &als_path.to_string_lossy(),
        als_size,
        EntryMeta::default(),
    )?);

    // .dawmgr sidecar folder, if present
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
            let archive_path = format!("project/{rel}");
            let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            files.push(add_hashed_entry(
                &mut zip,
                &archive_path,
                &p.to_string_lossy(),
                size,
                EntryMeta::default(),
            )?);
        }
    }

    // Lyrics/tabs/todos text, written directly from memory (not a path on disk,
    // so hashed by hand rather than through add_hashed_entry).
    for (name, content) in [
        ("lyrics.txt", lyrics),
        ("tabs.txt", tabs),
        ("todos.txt", todos),
    ] {
        if let Some(s) = content {
            if !s.trim().is_empty() {
                let archive_path = format!("text/{name}");
                let bytes = s.as_bytes();
                zip.start_file(&archive_path, SimpleFileOptions::default())
                    .map_err(|e| e.to_string())?;
                zip.write_all(bytes).map_err(|e| e.to_string())?;
                let sha256 = hex::encode(Sha256::digest(bytes));
                files.push(ManifestFile {
                    archive_path,
                    original_path: format!("db:{name}"),
                    stage: None,
                    export_type: None,
                    version_label: None,
                    is_final: false,
                    size_bytes: bytes.len() as u64,
                    sha256,
                    mtime: ts as i64,
                });
            }
        }
    }

    // Selected stage files from project_files
    let mut used_names: HashMap<String, u32> = HashMap::new();
    for sf in stage_files {
        let dir_key = format!("stages/{}", sf.kind);
        let unique_name = dedup_name(&mut used_names, &dir_key, &sf.file_name);
        let archive_path = format!("{dir_key}/{unique_name}");

        let size = match std::fs::metadata(&sf.file_path) {
            Ok(m) => m.len(),
            Err(e) => {
                missing.push(ManifestMissing {
                    original_path: sf.file_path.clone(),
                    stage: Some(sf.kind.clone()),
                    reason: e.to_string(),
                });
                continue;
            }
        };

        let meta = EntryMeta {
            stage: Some(sf.kind.clone()),
            export_type: sf.export_type.clone(),
            version_label: Some(sf.version_label.clone()),
            is_final: sf.is_final,
        };
        match add_hashed_entry(&mut zip, &archive_path, &sf.file_path, size, meta) {
            Ok(entry) => files.push(entry),
            Err(e) => missing.push(ManifestMissing {
                original_path: sf.file_path.clone(),
                stage: Some(sf.kind.clone()),
                reason: e,
            }),
        }
    }

    let manifest = Manifest {
        schema: 1,
        project: ManifestProject {
            id: project_id.to_string(),
            title: title.to_string(),
            als_path: als_path.to_string_lossy().into_owned(),
        },
        created_at: ts as i64,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        files,
        missing,
    };

    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;
    Ok((zip_path, manifest))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn write_file(dir: &Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn hashing_reader_matches_direct_digest() {
        let data = b"the quick brown fox jumps over the lazy dog".repeat(100);
        let expected = hex::encode(Sha256::digest(&data));

        let mut reader = HashingReader::new(Cursor::new(data.clone()));
        let mut sink = Vec::new();
        std::io::copy(&mut reader, &mut sink).unwrap();

        assert_eq!(sink, data);
        assert_eq!(reader.finish(), expected);
    }

    #[test]
    fn compression_is_stored_for_audio_and_deflated_otherwise() {
        assert_eq!(
            compression_for(Path::new("x.wav")),
            CompressionMethod::Stored
        );
        assert_eq!(
            compression_for(Path::new("x.WAV")),
            CompressionMethod::Stored
        );
        assert_eq!(
            compression_for(Path::new("x.flac")),
            CompressionMethod::Stored
        );
        assert_eq!(
            compression_for(Path::new("x.als")),
            CompressionMethod::Deflated
        );
        assert_eq!(
            compression_for(Path::new("x.txt")),
            CompressionMethod::Deflated
        );
    }

    #[test]
    fn dedup_name_appends_suffix_on_repeat() {
        let mut used = HashMap::new();
        assert_eq!(dedup_name(&mut used, "stages/export", "mix.wav"), "mix.wav");
        assert_eq!(
            dedup_name(&mut used, "stages/export", "mix.wav"),
            "mix_2.wav"
        );
        assert_eq!(
            dedup_name(&mut used, "stages/export", "mix.wav"),
            "mix_3.wav"
        );
        // A different directory key does not share the counter.
        assert_eq!(
            dedup_name(&mut used, "stages/master_project", "mix.wav"),
            "mix.wav"
        );
    }

    #[test]
    fn zip_project_includes_stage_files_in_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let als = write_file(dir.path(), "song.als", b"fake-als-bytes");
        let export = write_file(dir.path(), "song_final.wav", b"fake-wav-bytes");

        let stage_files = vec![StageFileInput {
            file_path: export.to_string_lossy().into_owned(),
            file_name: "song_final.wav".into(),
            kind: "export".into(),
            export_type: Some("mix".into()),
            version_label: "v3".into(),
            is_final: true,
        }];

        let (zip_path, manifest) =
            zip_project(&als, "Song", "proj-1", None, None, None, &stage_files).unwrap();

        assert!(zip_path.exists());
        assert!(!manifest.is_partial());
        assert_eq!(manifest.missing.len(), 0);

        let stage_entry = manifest
            .files
            .iter()
            .find(|f| f.archive_path == "stages/export/song_final.wav")
            .expect("stage file entry present");
        assert_eq!(stage_entry.stage, Some("export".into()));
        assert_eq!(stage_entry.export_type, Some("mix".into()));
        assert_eq!(stage_entry.version_label, Some("v3".into()));
        assert!(stage_entry.is_final);
        assert_eq!(
            stage_entry.sha256,
            hex::encode(Sha256::digest(b"fake-wav-bytes"))
        );

        assert!(manifest
            .files
            .iter()
            .any(|f| f.archive_path == "project/song.als"));

        let _ = std::fs::remove_file(&zip_path);
    }

    #[test]
    fn zip_project_reports_missing_stage_file_as_partial() {
        let dir = tempfile::tempdir().unwrap();
        let als = write_file(dir.path(), "song.als", b"fake-als-bytes");
        let missing_path = dir.path().join("gone.wav");

        let stage_files = vec![StageFileInput {
            file_path: missing_path.to_string_lossy().into_owned(),
            file_name: "gone.wav".into(),
            kind: "export".into(),
            export_type: Some("stems".into()),
            version_label: "v1".into(),
            is_final: false,
        }];

        let (zip_path, manifest) =
            zip_project(&als, "Song", "proj-1", None, None, None, &stage_files).unwrap();

        assert!(manifest.is_partial());
        assert_eq!(manifest.missing.len(), 1);
        assert_eq!(
            manifest.missing[0].original_path,
            missing_path.to_string_lossy()
        );
        assert_eq!(manifest.missing[0].stage, Some("export".into()));
        assert!(!manifest
            .files
            .iter()
            .any(|f| f.archive_path.contains("gone.wav")));

        let _ = std::fs::remove_file(&zip_path);
    }

    #[test]
    fn zip_project_dedupes_colliding_stage_file_names() {
        let dir = tempfile::tempdir().unwrap();
        let als = write_file(dir.path(), "song.als", b"fake-als-bytes");
        let sub_a = dir.path().join("a");
        let sub_b = dir.path().join("b");
        std::fs::create_dir_all(&sub_a).unwrap();
        std::fs::create_dir_all(&sub_b).unwrap();
        let export_a = write_file(&sub_a, "mix.wav", b"content-a");
        let export_b = write_file(&sub_b, "mix.wav", b"content-b-longer");

        let stage_files = vec![
            StageFileInput {
                file_path: export_a.to_string_lossy().into_owned(),
                file_name: "mix.wav".into(),
                kind: "export".into(),
                export_type: Some("mix".into()),
                version_label: "v1".into(),
                is_final: false,
            },
            StageFileInput {
                file_path: export_b.to_string_lossy().into_owned(),
                file_name: "mix.wav".into(),
                kind: "export".into(),
                export_type: Some("mix".into()),
                version_label: "v2".into(),
                is_final: true,
            },
        ];

        let (zip_path, manifest) =
            zip_project(&als, "Song", "proj-1", None, None, None, &stage_files).unwrap();

        let archive_paths: Vec<&str> = manifest
            .files
            .iter()
            .map(|f| f.archive_path.as_str())
            .collect();
        assert!(archive_paths.contains(&"stages/export/mix.wav"));
        assert!(archive_paths.contains(&"stages/export/mix_2.wav"));

        let _ = std::fs::remove_file(&zip_path);
    }

    #[test]
    fn checksum_file_matches_known_digest() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_file(dir.path(), "data.bin", b"hello world");
        let expected = hex::encode(Sha256::digest(b"hello world"));
        assert_eq!(checksum_file(&path).unwrap(), expected);
    }
}
