use super::manifest::Manifest;
use super::HashingReader;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

/// Resolves an archive entry's stored name to a path inside `base`, rejecting
/// anything that could escape it: absolute paths (Unix `/...` or a Windows drive
/// prefix, checked textually since the archive may have been written on a
/// different OS than the one restoring it), NUL bytes, and any `..` that would
/// walk back past `base` itself. Pure — takes the entry name as a plain string so
/// it's testable without a real zip file.
pub fn safe_extract_path(base: &Path, entry_name: &str) -> Result<PathBuf, String> {
    if entry_name.contains('\0') {
        return Err(format!("rejected entry with a NUL byte: {entry_name}"));
    }
    if entry_name.trim().is_empty() {
        return Err("rejected empty entry name".to_string());
    }

    let bytes = entry_name.as_bytes();
    let looks_like_drive_prefix =
        bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let looks_absolute =
        entry_name.starts_with('/') || entry_name.starts_with('\\') || looks_like_drive_prefix;
    if looks_absolute {
        return Err(format!("rejected absolute path: {entry_name}"));
    }

    let mut resolved = PathBuf::new();
    let mut depth: i64 = 0;
    for part in entry_name.split(['/', '\\']) {
        match part {
            "" | "." => continue,
            ".." => {
                depth -= 1;
                if depth < 0 {
                    return Err(format!("rejected path escaping the target: {entry_name}"));
                }
                resolved.pop();
            }
            p => {
                depth += 1;
                resolved.push(p);
            }
        }
    }

    if resolved.as_os_str().is_empty() {
        return Err(format!("rejected empty resolved path: {entry_name}"));
    }
    Ok(base.join(resolved))
}

fn read_manifest(zip: &mut ZipArchive<File>) -> Result<Manifest, String> {
    let mut entry = zip
        .by_name("manifest.json")
        .map_err(|e| format!("manifest.json: {e}"))?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| format!("manifest.json: {e}"))?;
    serde_json::from_str(&buf).map_err(|e| format!("manifest.json: {e}"))
}

fn open_zip(zip_path: &Path) -> Result<ZipArchive<File>, String> {
    let file = File::open(zip_path).map_err(|e| format!("open archive: {e}"))?;
    ZipArchive::new(file).map_err(|e| format!("read archive: {e}"))
}

// ── Verify ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyFileResult {
    pub archive_path: String,
    pub original_path: String,
    pub status: String, // "ok" | "missing" | "corrupt"
    pub expected_sha256: String,
    pub actual_sha256: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub ok_count: u32,
    pub missing_count: u32,
    pub corrupt_count: u32,
    pub files: Vec<VerifyFileResult>,
}

/// Re-hashes every file the manifest says is in the archive and compares it to
/// the recorded checksum, without extracting anything to disk.
pub fn verify_archive(zip_path: &Path) -> Result<VerifyReport, String> {
    let mut zip = open_zip(zip_path)?;
    let manifest = read_manifest(&mut zip)?;

    let mut files = Vec::with_capacity(manifest.files.len());
    let (mut ok_count, mut missing_count, mut corrupt_count) = (0u32, 0u32, 0u32);

    for entry in &manifest.files {
        let result = |status: &str, actual_sha256: Option<String>| VerifyFileResult {
            archive_path: entry.archive_path.clone(),
            original_path: entry.original_path.clone(),
            status: status.to_string(),
            expected_sha256: entry.sha256.clone(),
            actual_sha256,
        };

        let mut zf = match zip.by_name(&entry.archive_path) {
            Ok(zf) => zf,
            Err(_) => {
                missing_count += 1;
                files.push(result("missing", None));
                continue;
            }
        };

        let mut hasher = Sha256::new();
        let mut buf = [0u8; 65536];
        let mut read_err = false;
        loop {
            match zf.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buf[..n]),
                Err(_) => {
                    read_err = true;
                    break;
                }
            }
        }

        if read_err {
            corrupt_count += 1;
            files.push(result("corrupt", None));
            continue;
        }

        let actual = hex::encode(hasher.finalize());
        if actual == entry.sha256 {
            ok_count += 1;
            files.push(result("ok", Some(actual)));
        } else {
            corrupt_count += 1;
            files.push(result("corrupt", Some(actual)));
        }
    }

    Ok(VerifyReport {
        ok_count,
        missing_count,
        corrupt_count,
        files,
    })
}

// ── Restore ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredFile {
    pub archive_path: String,
    pub restored_path: Option<String>,
    pub stage: Option<String>,
    pub version_label: Option<String>,
    pub is_final: bool,
    /// "ok" | "mismatch" | "conflict" | "rejected" | "missing_in_archive" | "error"
    pub status: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub restored_to: String,
    pub ok_count: u32,
    pub mismatch_count: u32,
    pub conflict_count: u32,
    pub rejected_count: u32,
    pub files: Vec<RestoredFile>,
}

/// Extracts every file the manifest lists into `dest_dir`, never overwriting an
/// existing path (`create_new`), rejecting zip-slip/symlink entries, and
/// re-hashing each restored file against the manifest. `on_progress(done, total,
/// archive_path)` is called after each entry so a caller can surface progress.
pub fn restore_archive(
    zip_path: &Path,
    dest_dir: &Path,
    mut on_progress: impl FnMut(usize, usize, &str),
) -> Result<RestoreOutcome, String> {
    let mut zip = open_zip(zip_path)?;
    let manifest = read_manifest(&mut zip)?;

    std::fs::create_dir_all(dest_dir).map_err(|e| format!("create destination: {e}"))?;

    let total = manifest.files.len();
    let mut files = Vec::with_capacity(total);
    let (mut ok_count, mut mismatch_count, mut conflict_count, mut rejected_count) =
        (0u32, 0u32, 0u32, 0u32);

    for (i, entry) in manifest.files.iter().enumerate() {
        on_progress(i + 1, total, &entry.archive_path);

        let result =
            |restored_path: Option<String>, status: &str, detail: Option<String>| RestoredFile {
                archive_path: entry.archive_path.clone(),
                restored_path,
                stage: entry.stage.clone(),
                version_label: entry.version_label.clone(),
                is_final: entry.is_final,
                status: status.to_string(),
                detail,
            };

        let target = match safe_extract_path(dest_dir, &entry.archive_path) {
            Ok(p) => p,
            Err(reason) => {
                rejected_count += 1;
                files.push(result(None, "rejected", Some(reason)));
                continue;
            }
        };

        let mut zf = match zip.by_name(&entry.archive_path) {
            Ok(zf) => zf,
            Err(e) => {
                files.push(result(None, "missing_in_archive", Some(e.to_string())));
                continue;
            }
        };

        if zf.is_symlink() {
            rejected_count += 1;
            files.push(result(
                None,
                "rejected",
                Some("symlink entries are not supported".to_string()),
            ));
            continue;
        }

        if let Some(parent) = target.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                files.push(result(
                    None,
                    "error",
                    Some(format!("create parent dir: {e}")),
                ));
                continue;
            }
        }

        let restored_path = Some(target.to_string_lossy().into_owned());
        let out_file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(f) => f,
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                conflict_count += 1;
                files.push(result(
                    restored_path,
                    "conflict",
                    Some("a file already exists at this path".to_string()),
                ));
                continue;
            }
            Err(e) => {
                files.push(result(None, "error", Some(e.to_string())));
                continue;
            }
        };

        let mut hashing = HashingReader::new(&mut zf);
        let mut sink = out_file;
        let copy_ok = std::io::copy(&mut hashing, &mut sink).is_ok();
        let actual = hashing.finish();
        let status = if copy_ok && actual == entry.sha256 {
            ok_count += 1;
            "ok"
        } else {
            mismatch_count += 1;
            "mismatch"
        };

        files.push(result(restored_path, status, None));
    }

    Ok(RestoreOutcome {
        restored_to: dest_dir.to_string_lossy().into_owned(),
        ok_count,
        mismatch_count,
        conflict_count,
        rejected_count,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::{zip_project, StageFileInput};
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn write_file(dir: &Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    // ── safe_extract_path ────────────────────────────────────────────────────

    #[test]
    fn rejects_unix_absolute_path() {
        let base = Path::new("/tmp/restore-root");
        assert!(safe_extract_path(base, "/etc/passwd").is_err());
    }

    #[test]
    fn rejects_backslash_absolute_path() {
        let base = Path::new("/tmp/restore-root");
        assert!(safe_extract_path(base, "\\evil").is_err());
    }

    #[test]
    fn rejects_windows_drive_prefix() {
        let base = Path::new("/tmp/restore-root");
        assert!(safe_extract_path(base, "C:\\evil\\file.txt").is_err());
        assert!(safe_extract_path(base, "c:/evil/file.txt").is_err());
    }

    #[test]
    fn rejects_traversal_that_escapes_root() {
        let base = Path::new("/tmp/restore-root");
        assert!(safe_extract_path(base, "../evil").is_err());
        assert!(safe_extract_path(base, "a/../../evil").is_err());
    }

    #[test]
    fn rejects_nul_byte_and_empty_name() {
        let base = Path::new("/tmp/restore-root");
        assert!(safe_extract_path(base, "evil\0.txt").is_err());
        assert!(safe_extract_path(base, "").is_err());
        assert!(safe_extract_path(base, "   ").is_err());
    }

    #[test]
    fn accepts_traversal_that_stays_inside_root() {
        let base = Path::new("/tmp/restore-root");
        let resolved = safe_extract_path(base, "a/../b").unwrap();
        assert_eq!(resolved, base.join("b"));
    }

    #[test]
    fn accepts_plain_relative_path() {
        let base = Path::new("/tmp/restore-root");
        let resolved = safe_extract_path(base, "stages/export/song.wav").unwrap();
        assert_eq!(resolved, base.join("stages/export/song.wav"));
    }

    // ── verify_archive ───────────────────────────────────────────────────────

    fn make_backup_archive(dir: &Path) -> PathBuf {
        let als = write_file(dir, "song.als", b"fake-als-bytes");
        let export = write_file(dir, "song_final.wav", b"fake-wav-bytes");
        let stage_files = vec![StageFileInput {
            file_path: export.to_string_lossy().into_owned(),
            file_name: "song_final.wav".into(),
            kind: "export".into(),
            export_type: Some("mix".into()),
            version_label: "v1".into(),
            is_final: true,
        }];
        let (zip_path, _manifest) =
            zip_project(&als, "Song", "proj-1", None, None, None, &stage_files).unwrap();
        zip_path
    }

    /// Rewrites one zip member's bytes in place (same compressed size), used to
    /// simulate a corrupted archive without rebuilding it from scratch.
    fn corrupt_stored_entry(zip_path: &Path, entry_name: &str) {
        let data = std::fs::read(zip_path).unwrap();
        let needle = b"fake-wav-bytes";
        let pos = data
            .windows(needle.len())
            .position(|w| w == needle)
            .expect("entry bytes not found in archive");
        let mut data = data;
        data[pos] = data[pos].wrapping_add(1);
        std::fs::write(zip_path, &data).unwrap();
        // Sanity: the entry is still readable (Stored, no compression) so this
        // flips the hash without corrupting the zip's own structure.
        let file = File::open(zip_path).unwrap();
        let mut zip = ZipArchive::new(file).unwrap();
        assert!(zip.by_name(entry_name).is_ok());
    }

    #[test]
    fn verify_reports_ok_for_untouched_archive() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = make_backup_archive(dir.path());

        let report = verify_archive(&zip_path).unwrap();
        assert_eq!(report.missing_count, 0);
        assert_eq!(report.corrupt_count, 0);
        assert!(report.ok_count > 0);
        assert!(report.files.iter().all(|f| f.status == "ok"));
    }

    #[test]
    fn verify_reports_corrupt_for_tampered_entry() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = make_backup_archive(dir.path());
        corrupt_stored_entry(&zip_path, "stages/export/song_final.wav");

        let report = verify_archive(&zip_path).unwrap();
        assert_eq!(report.corrupt_count, 1);
        let entry = report
            .files
            .iter()
            .find(|f| f.archive_path == "stages/export/song_final.wav")
            .unwrap();
        assert_eq!(entry.status, "corrupt");
        assert_ne!(entry.actual_sha256, Some(entry.expected_sha256.clone()));
    }

    #[test]
    fn verify_reports_missing_for_entry_removed_from_archive() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = make_backup_archive(dir.path());

        // Rebuild the zip with manifest.json intact but the stage file entry
        // dropped, simulating an archive that doesn't match its own manifest.
        let rebuilt = dir.path().join("rebuilt.zip");
        {
            let src_file = File::open(&zip_path).unwrap();
            let mut src = ZipArchive::new(src_file).unwrap();
            let dst_file = File::create(&rebuilt).unwrap();
            let mut dst = ZipWriter::new(dst_file);
            for i in 0..src.len() {
                let mut entry = src.by_index(i).unwrap();
                if entry.name() == "stages/export/song_final.wav" {
                    continue;
                }
                let name = entry.name().to_string();
                dst.start_file(&name, SimpleFileOptions::default()).unwrap();
                let mut buf = Vec::new();
                entry.read_to_end(&mut buf).unwrap();
                dst.write_all(&buf).unwrap();
            }
            dst.finish().unwrap();
        }

        let report = verify_archive(&rebuilt).unwrap();
        assert_eq!(report.missing_count, 1);
        let entry = report
            .files
            .iter()
            .find(|f| f.archive_path == "stages/export/song_final.wav")
            .unwrap();
        assert_eq!(entry.status, "missing");

        let _ = std::fs::remove_file(&zip_path);
    }

    // ── restore_archive ──────────────────────────────────────────────────────

    #[test]
    fn restore_extracts_matching_files_with_correct_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = make_backup_archive(dir.path());
        let dest = dir.path().join("restored");

        let mut progress_calls = Vec::new();
        let outcome = restore_archive(&zip_path, &dest, |done, total, name| {
            progress_calls.push((done, total, name.to_string()));
        })
        .unwrap();

        assert_eq!(outcome.mismatch_count, 0);
        assert_eq!(outcome.conflict_count, 0);
        assert_eq!(outcome.rejected_count, 0);
        assert!(outcome.ok_count > 0);
        assert!(!progress_calls.is_empty());

        let restored_wav = dest.join("stages/export/song_final.wav");
        assert_eq!(std::fs::read(&restored_wav).unwrap(), b"fake-wav-bytes");
    }

    #[test]
    fn restore_never_overwrites_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = make_backup_archive(dir.path());
        let dest = dir.path().join("restored");

        let first = restore_archive(&zip_path, &dest, |_, _, _| {}).unwrap();
        assert!(first.ok_count > 0);
        assert_eq!(first.conflict_count, 0);

        let restored_wav = dest.join("stages/export/song_final.wav");
        let original_bytes = std::fs::read(&restored_wav).unwrap();

        let second = restore_archive(&zip_path, &dest, |_, _, _| {}).unwrap();
        assert_eq!(second.ok_count, 0);
        assert!(second.conflict_count > 0);
        assert!(second.files.iter().all(|f| f.status == "conflict"));

        // The first restore's bytes must be untouched, not silently overwritten.
        assert_eq!(std::fs::read(&restored_wav).unwrap(), original_bytes);
    }

    #[test]
    fn restore_rejects_a_zip_slip_manifest_entry() {
        let dir = tempfile::tempdir().unwrap();
        let als = write_file(dir.path(), "song.als", b"fake-als-bytes");
        let (zip_path, _m) = zip_project(&als, "Song", "proj-1", None, None, None, &[]).unwrap();

        // Craft a zip whose manifest.json claims a path-traversal entry, and
        // whose archive actually contains that entry too — restore must still
        // reject it on the manifest's archivePath before ever opening it.
        let evil_zip = dir.path().join("evil.zip");
        let manifest_json = r#"{
            "schema": 1,
            "project": {"id": "proj-1", "title": "Song", "alsPath": "song.als"},
            "createdAt": 0,
            "appVersion": "0.0.0",
            "files": [{
                "archivePath": "../../evil.txt",
                "originalPath": "/tmp/evil.txt",
                "stage": null, "exportType": null, "versionLabel": null,
                "isFinal": false, "sizeBytes": 4, "sha256": "deadbeef", "mtime": 0
            }],
            "missing": []
        }"#;
        {
            let file = File::create(&evil_zip).unwrap();
            let mut zip = ZipWriter::new(file);
            zip.start_file("manifest.json", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(manifest_json.as_bytes()).unwrap();
            zip.start_file("../../evil.txt", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"evil").unwrap();
            zip.finish().unwrap();
        }

        let restore_root = dir.path().join("nested").join("restored");
        let outcome = restore_archive(&evil_zip, &restore_root, |_, _, _| {}).unwrap();
        assert_eq!(outcome.rejected_count, 1);
        assert_eq!(outcome.files[0].status, "rejected");

        // Nothing was written outside the intended restore root.
        assert!(!dir.path().join("nested").join("evil.txt").exists());
        assert!(!dir.path().join("evil.txt").exists());

        let _ = std::fs::remove_file(&zip_path);
    }
}
