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
use tauri_plugin_global_shortcut::GlobalShortcutExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // We only ever register one shortcut at a time (the show/hide
                    // toggle), so any fire of it means the same thing regardless
                    // of which shortcut string it currently is.
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show RAPT", true, None::<&str>)?;
            let widget_item = MenuItem::with_id(app, "widget", "Toggle Widget", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &widget_item, &quit_item])?;

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
                    "widget" => {
                        let settings = store::load_settings(app).unwrap_or_default();
                        let _ = commands::widget_toggle(app.clone(), !settings.widget_enabled);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        restore_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let settings = store::load_settings(app.handle()).unwrap_or_default();

            // Re-register whatever shortcut was saved from a previous session.
            if !settings.global_shortcut.trim().is_empty() {
                if let Ok(shortcut) = settings
                    .global_shortcut
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                {
                    let _ = app.global_shortcut().register(shortcut);
                }
            }

            // Restore the widget at its last position if it was left enabled.
            if settings.widget_enabled {
                if let Some(widget) = app.get_webview_window("widget") {
                    if let (Some(x), Some(y)) = (settings.widget_x, settings.widget_y) {
                        let _ = widget.set_position(tauri::PhysicalPosition::new(x, y));
                    }
                    let _ = widget.show();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Main window X minimizes instead of quitting — stays in the
            // taskbar, click to restore. Tray "Quit" is the only real exit.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.minimize();
            }
            // Widget has no decorations/close button, but guard anyway —
            // treat any close request as just hiding it, not destroying it.
            WindowEvent::CloseRequested { api, .. } if window.label() == "widget" => {
                api.prevent_close();
                let _ = window.hide();
            }
            // Persist widget position whenever it's dragged.
            WindowEvent::Moved(position) if window.label() == "widget" => {
                if let Ok(mut settings) = store::load_settings(window.app_handle()) {
                    settings.widget_x = Some(position.x);
                    settings.widget_y = Some(position.y);
                    let _ = store::save_settings(window.app_handle(), &settings);
                }
            }
            _ => {}
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
            commands::shortcut_set,
            commands::widget_toggle,
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

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);
        if is_visible && !is_minimized {
            let _ = window.hide();
        } else {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
