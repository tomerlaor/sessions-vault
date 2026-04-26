use crate::backup::{self, BackupResult, GDriveTokens};
use crate::scanner::{self, ProjectMetadata};
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn scan_folder(path: String, app: AppHandle) -> Vec<ProjectMetadata> {
    let results = scanner::scan_folder(&path);
    let _ = app.emit("scan:complete", serde_json::json!({ "folder": path, "count": results.len() }));
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
    if new_path.exists() {
        return Err(format!("A file named '{}' already exists", new_filename));
    }
    std::fs::rename(path, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_in_daw(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── OS Keychain ───────────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE: &str = "com.sessions.app";

#[tauri::command]
pub fn store_secret(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &key)
        .map_err(|e| e.to_string())?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ── Google Drive detection ────────────────────────────────────────────────────

#[tauri::command]
pub fn detect_gdrive_paths() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let cloud_storage = std::path::Path::new(&home).join("Library/CloudStorage");
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&cloud_storage) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("GoogleDrive-") {
                let my_drive = entry.path().join("My Drive");
                let path = if my_drive.exists() { my_drive } else { entry.path() };
                found.push(path.to_string_lossy().into_owned());
            }
        }
    }
    found
}

// ── Backup ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn backup_local(
    file_path: String,
    title: String,
    destination_dir: String,
) -> Result<BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        backup::local::backup_to_local(&file_path, &title, &destination_dir)
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
pub async fn backup_gdrive(
    file_path: String,
    title: String,
    access_token: String,
) -> Result<BackupResult, String> {
    // Create zip in blocking thread
    let (zip_path, checksum, size_bytes) = tauri::async_runtime::spawn_blocking({
        let file_path = file_path.clone();
        let title = title.clone();
        move || -> Result<_, String> {
            let als = Path::new(&file_path);
            let zip = backup::zip_project(als, &title)?;
            let checksum = backup::checksum_file(&zip)?;
            let size = std::fs::metadata(&zip).map_err(|e| e.to_string())?.len();
            Ok((zip, checksum, size))
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
    })
}
