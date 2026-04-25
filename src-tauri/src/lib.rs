use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let about_item = MenuItem::with_id(
                app,
                "about",
                "About SessionsVault",
                true,
                None::<&str>,
            )?;
            let help_menu = Submenu::with_items(app, "Help", true, &[&about_item])?;
            let menu = Menu::with_items(app, &[&help_menu])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "about" {
                app.emit("show-about", ()).unwrap();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
