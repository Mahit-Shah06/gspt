use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MfSearchResult {
    #[serde(rename = "schemeCode")]
    pub scheme_code: Value,
    #[serde(rename = "schemeName")]
    pub scheme_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MfHistoryPoint {
    pub t: i64,
    pub c: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MfData {
    pub scheme_name: Option<String>,
    pub latest_nav: Option<f64>,
    pub latest_date: Option<String>,
    pub change: Option<f64>,
    pub change_percent: Option<f64>,
    pub points: Vec<MfHistoryPoint>,
}

fn encode_query(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            other => format!("%{:02X}", other as u32),
        })
        .collect()
}

fn parse_amfi_date(s: &str) -> i64 {
    NaiveDate::parse_from_str(s, "%d-%m-%Y")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|dt| dt.and_utc().timestamp_millis())
        .unwrap_or(0)
}

pub async fn search(query: &str) -> Result<Vec<MfSearchResult>, String> {
    let url = format!("https://api.mfapi.in/mf/search?q={}", encode_query(query));
    let res = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Mutual fund search failed ({})", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

pub async fn data(scheme_code: &str) -> Result<MfData, String> {
    let url = format!("https://api.mfapi.in/mf/{}", scheme_code);
    let res = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Mutual fund data failed ({})", res.status()));
    }
    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    let scheme_name = json
        .get("meta")
        .and_then(|m| m.get("scheme_name"))
        .and_then(|v| v.as_str())
        .map(String::from);

    // mfapi returns newest-first; collect then reverse to oldest-first for charting
    let mut rows: Vec<(String, f64)> = json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|row| {
                    let date = row.get("date")?.as_str()?.to_string();
                    let nav: f64 = row.get("nav")?.as_str()?.parse().ok()?;
                    Some((date, nav))
                })
                .collect()
        })
        .unwrap_or_default();
    rows.reverse();

    let points: Vec<MfHistoryPoint> = rows
        .iter()
        .map(|(date, nav)| MfHistoryPoint {
            t: parse_amfi_date(date),
            c: *nav,
        })
        .collect();

    let latest = rows.last();
    let prev = if rows.len() >= 2 {
        Some(&rows[rows.len() - 2])
    } else {
        None
    };

    let latest_nav = latest.map(|(_, n)| *n);
    let latest_date = latest.map(|(d, _)| d.clone());
    let prev_nav = prev.map(|(_, n)| *n);

    let change = match (latest_nav, prev_nav) {
        (Some(l), Some(p)) => Some(l - p),
        _ => None,
    };
    let change_percent = match (change, prev_nav) {
        (Some(c), Some(p)) if p != 0.0 => Some((c / p) * 100.0),
        _ => None,
    };

    Ok(MfData {
        scheme_name,
        latest_nav,
        latest_date,
        change,
        change_percent,
        points,
    })
}
