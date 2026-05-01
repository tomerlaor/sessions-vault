use notify_debouncer_mini::{new_debouncer, notify::*, DebounceEventResult};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

type WatcherHandle = Arc<Mutex<Option<notify_debouncer_mini::Debouncer<RecommendedWatcher>>>>;

static WATCHER: std::sync::OnceLock<WatcherHandle> = std::sync::OnceLock::new();

fn is_daw_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let lower = e.to_lowercase();
            crate::scanner::DAW_EXTENSIONS
                .iter()
                .any(|(ext, _)| *ext == lower.as_str())
        })
        .unwrap_or(false)
}

pub fn start(paths: Vec<String>, app: AppHandle) {
    let handle = WATCHER.get_or_init(|| Arc::new(Mutex::new(None)));
    let app_clone = app.clone();

    let mut debouncer = new_debouncer(
        Duration::from_secs(2),
        move |result: DebounceEventResult| {
            if let Ok(events) = result {
                for event in events {
                    let path = &event.path;
                    if !is_daw_file(path) {
                        continue;
                    }

                    if path.exists() {
                        if crate::scanner::is_backup_path(path) {
                            continue;
                        }
                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                        let lower = ext.to_lowercase();
                        let daw = crate::scanner::DAW_EXTENSIONS
                            .iter()
                            .find(|(e, _)| *e == lower.as_str())
                            .map(|(_, d)| *d)
                            .unwrap_or("unknown");
                        if let Ok(meta) = crate::scanner::build_metadata_pub(path, daw) {
                            let _ = app_clone.emit("project:updated", meta);
                        }
                    } else {
                        let _ =
                            app_clone.emit("project:deleted", path.to_string_lossy().to_string());
                    }
                }
            }
        },
    )
    .expect("failed to create watcher");

    for path in &paths {
        let _ = debouncer
            .watcher()
            .watch(std::path::Path::new(path), RecursiveMode::Recursive);
    }

    *handle.lock().unwrap() = Some(debouncer);
}

pub fn add_path(path: &str) {
    if let Some(handle) = WATCHER.get() {
        if let Some(ref mut debouncer) = *handle.lock().unwrap() {
            let _ = debouncer
                .watcher()
                .watch(std::path::Path::new(path), RecursiveMode::Recursive);
        }
    }
}

pub fn remove_path(path: &str) {
    if let Some(handle) = WATCHER.get() {
        if let Some(ref mut debouncer) = *handle.lock().unwrap() {
            let _ = debouncer.watcher().unwatch(std::path::Path::new(path));
        }
    }
}
