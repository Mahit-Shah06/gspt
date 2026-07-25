#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod market;
mod mutual_fund;
mod store;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show RAPT", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("default window icon missing — check bundle.icon in tauri.conf.json");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("RAPT — Real-time Asset Price Tracker")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => restore_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        restore_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // X button minimizes instead of quitting — stays in the taskbar,
            // click to restore. Tray "Quit" is the only real exit.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.minimize();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_quote,
            commands::market_search,
            commands::get_history,
            commands::mf_search,
            commands::mf_data,
            commands::watchlist_get,
            commands::watchlist_save,
            commands::settings_get,
            commands::settings_save,
            commands::autostart_get,
            commands::autostart_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RAPT");
}

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
