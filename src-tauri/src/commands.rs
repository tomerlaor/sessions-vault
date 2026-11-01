use crate::backup::restore::{RestoreOutcome, VerifyReport};
use crate::backup::{self, BackupResult, GDriveTokens, StageFileInput};
use crate::scanner::{self, ProjectMetadata};
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn scan_folder(path: String, app: AppHandle) -> Vec<ProjectMetadata> {
    let results = scanner::scan_folder(&path);
    let _ = app.emit(
        "scan:complete",
        serde_json::json!({ "folder": path, "count": results.len() }),
    );
    results
}

#[tauri::command]
pub fn start_watcher(paths: Vec<String>, app: AppHandle) {
    crate::watcher::start(paths, app);
}

#[tauri::command]
pub fn add_watch_path(path: String) {
    crate::watcher::add_path(&path);
}

#[tauri::command]
pub fn remove_watch_path(path: String) {
    crate::watcher::remove_path(&path);
}

#[tauri::command]
pub fn rename_project(old_path: String, new_name: String) -> Result<String, String> {
    if new_name.trim().is_empty()
        || new_name.contains('/')
        || new_name.contains('\\')
        || new_name.contains("..")
    {
        return Err("invalid characters in project name".into());
    }
    let path = std::path::Path::new(&old_path);
    let parent = path.parent().ok_or("file has no parent directory")?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let new_filename = if ext.is_empty() {
        new_name.clone()
    } else {
        format!("{}.{}", new_name, ext)
    };
    let new_path = parent.join(&new_filename);
    let conflict = std::fs::read_dir(parent)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| e.file_name().to_string_lossy() == new_filename.as_str())
        })
        .unwrap_or(false);
    if conflict {
        return Err(format!("A file named '{}' already exists", new_filename));
    }
    std::fs::rename(path, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    crate::launch::reveal(&path)
}

#[tauri::command]
pub fn open_in_daw(path: String) -> Result<(), String> {
    crate::launch::open(&path)
}

// ── Secrets ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn store_secret(key: String, value: String) -> Result<(), String> {
    crate::secrets::store(&key, &value)
}

#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    crate::secrets::get(&key)
}

/// Whether a secret is stored, without reading it (so no keychain prompt).
#[tauri::command]
pub fn secret_exists(key: String) -> Result<bool, String> {
    crate::secrets::exists(&key)
}

#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
    crate::secrets::delete(&key)
}

// ── Google Drive detection ────────────────────────────────────────────────────

#[tauri::command]
pub fn detect_gdrive_paths() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let cloud_storage = std::path::Path::new(&home).join("Library/CloudStorage");
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&cloud_storage) {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("GoogleDrive-")
            {
                let my_drive = entry.path().join("My Drive");
                let path = if my_drive.exists() {
                    my_drive
                } else {
                    entry.path()
                };
                found.push(path.to_string_lossy().into_owned());
            }
        }
    }
    found
}

// ── Backup ────────────────────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn backup_local(
    file_path: String,
    title: String,
    project_id: String,
    destination_dir: String,
    lyrics: Option<String>,
    tabs: Option<String>,
    todos: Option<String>,
    files: Vec<StageFileInput>,
) -> Result<BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::local::backup_to_local(
            &file_path,
            &title,
            &project_id,
            &destination_dir,
            lyrics.as_deref(),
            tabs.as_deref(),
            todos.as_deref(),
            &files,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gdrive_auth(client_id: String, client_secret: String) -> Result<GDriveTokens, String> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::gdrive::start_auth_sync(&client_id, &client_secret)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gdrive_refresh(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<GDriveTokens, String> {
    backup::gdrive::refresh_token(&client_id, &client_secret, &refresh_token).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn backup_gdrive(
    file_path: String,
    title: String,
    project_id: String,
    access_token: String,
    lyrics: Option<String>,
    tabs: Option<String>,
    todos: Option<String>,
    files: Vec<StageFileInput>,
) -> Result<BackupResult, String> {
    // Create zip in blocking thread
    let (zip_path, checksum, size_bytes, status, missing_count, manifest_json) =
        tauri::async_runtime::spawn_blocking({
            let file_path = file_path.clone();
            let title = title.clone();
            move || -> Result<_, String> {
                let als = Path::new(&file_path);
                let (zip, manifest) = backup::zip_project(
                    als,
                    &title,
                    &project_id,
                    lyrics.as_deref(),
                    tabs.as_deref(),
                    todos.as_deref(),
                    &files,
                )?;
                let checksum = backup::checksum_file(&zip)?;
                let size = std::fs::metadata(&zip).map_err(|e| e.to_string())?.len();
                let missing_count = manifest.missing.len() as u32;
                let status = if missing_count > 0 { "partial" } else { "ok" }.to_string();
                let manifest_json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
                Ok((zip, checksum, size, status, missing_count, manifest_json))
            }
        })
        .await
        .map_err(|e| e.to_string())??;

    let file_name = zip_path.file_name().unwrap().to_string_lossy().into_owned();
    let gdrive_id = backup::gdrive::upload(&zip_path, &file_name, &access_token).await;
    let _ = std::fs::remove_file(&zip_path);

    Ok(BackupResult {
        provider: "gdrive".to_string(),
        destination: gdrive_id?,
        size_bytes,
        checksum,
        status,
        missing_count,
        manifest_json,
    })
}

#[tauri::command]
pub async fn verify_backup(zip_path: String) -> Result<VerifyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::restore::verify_archive(Path::new(&zip_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_backup(
    zip_path: String,
    dest_dir: String,
    app: AppHandle,
) -> Result<RestoreOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::restore::restore_archive(
            Path::new(&zip_path),
            Path::new(&dest_dir),
            |done, total, file| {
                let _ = app.emit(
                    "restore:progress",
                    serde_json::json!({ "done": done, "total": total, "file": file }),
                );
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gdrive_download_backup(
    file_id: String,
    access_token: String,
) -> Result<String, String> {
    let path = backup::gdrive::download(&file_id, &access_token).await?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn inspect_audio(path: String) -> Result<crate::audio::AudioInfo, String> {
    tauri::async_runtime::spawn_blocking(move || crate::audio::inspect_audio(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn inspect_project_media(
    path: String,
) -> Result<Option<crate::parser::ableton::MediaReport>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::parser::ableton::inspect_media(Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_exists_many(paths: Vec<String>) -> Vec<bool> {
    crate::fsutil::exists_many(&paths)
}

#[tauri::command]
pub fn file_stat(path: String) -> Result<crate::fsutil::FileStat, String> {
    crate::fsutil::stat(&path)
}
