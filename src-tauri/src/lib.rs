mod backup;
mod commands;
mod scanner;
mod watcher;
mod parser;

use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let about_item = MenuItem::with_id(app, "about", "About SessionsVault", true, None::<&str>)?;
            let help_menu = Submenu::with_items(app, "Help", true, &[&about_item])?;
            let menu = Menu::default(&app.handle())?;
            menu.append(&help_menu)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "about" {
                if let Err(e) = app.emit("show-about", ()) {
                    eprintln!("[menu] failed to emit show-about: {e}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::start_watcher,
            commands::add_watch_path,
            commands::remove_watch_path,
            commands::reveal_in_finder,
            commands::open_in_daw,
            commands::rename_project,
            commands::detect_gdrive_paths,
            commands::backup_local,
            commands::gdrive_auth,
            commands::gdrive_refresh,
            commands::backup_gdrive,
            commands::store_secret,
            commands::get_secret,
            commands::delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
