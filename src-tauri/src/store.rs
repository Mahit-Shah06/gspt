use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistItem {
    pub id: String,
    pub kind: String, // "yahoo" | "mf_in"
    pub symbol: String,
    pub label: String,
    pub sub: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub refresh_interval_secs: u64,
    pub hidden_metals: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            refresh_interval_secs: 15,
            hidden_metals: Vec::new(),
        }
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn watchlist_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("watchlist.json"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("settings.json"))
}

pub fn load_watchlist(app: &AppHandle) -> Result<Vec<WatchlistItem>, String> {
    let path = watchlist_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save_watchlist(app: &AppHandle, items: &[WatchlistItem]) -> Result<(), String> {
    let path = watchlist_path(app)?;
    let raw = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

pub fn load_settings(app: &AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}
