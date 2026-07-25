use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::market::{self, History, Quote};
use crate::mutual_fund::{self, MfData, MfSearchResult};
use crate::store::{self, Settings, WatchlistItem};

#[tauri::command]
pub async fn get_quote(symbol: String) -> Result<Quote, String> {
    market::get_quote(&symbol).await
}

#[tauri::command]
pub async fn market_search(query: String) -> Result<Vec<market::SearchResult>, String> {
    market::search_symbols(&query).await
}

#[tauri::command]
pub async fn get_history(symbol: String, range: String, interval: String) -> Result<History, String> {
    market::get_history(&symbol, &range, &interval).await
}

#[tauri::command]
pub async fn mf_search(query: String) -> Result<Vec<MfSearchResult>, String> {
    mutual_fund::search(&query).await
}

#[tauri::command]
pub async fn mf_data(scheme_code: String) -> Result<MfData, String> {
    mutual_fund::data(&scheme_code).await
}

#[tauri::command]
pub fn watchlist_get(app: AppHandle) -> Result<Vec<WatchlistItem>, String> {
    store::load_watchlist(&app)
}

#[tauri::command]
pub fn watchlist_save(app: AppHandle, items: Vec<WatchlistItem>) -> Result<(), String> {
    store::save_watchlist(&app, &items)
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Result<Settings, String> {
    store::load_settings(&app)
}

#[tauri::command]
pub fn settings_save(app: AppHandle, settings: Settings) -> Result<(), String> {
    store::save_settings(&app, &settings)
}

#[tauri::command]
pub fn autostart_get(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())?;
    } else {
        manager.disable().map_err(|e| e.to_string())?;
    }
    manager.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shortcut_set(app: AppHandle, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;

    let mut settings = store::load_settings(&app)?;
    settings.global_shortcut = shortcut.clone();
    store::save_settings(&app, &settings)?;

    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let parsed: tauri_plugin_global_shortcut::Shortcut = trimmed
        .parse()
        .map_err(|_| format!("Could not parse shortcut: {trimmed}"))?;
    gs.register(parsed).map_err(|e| e.to_string())
}
