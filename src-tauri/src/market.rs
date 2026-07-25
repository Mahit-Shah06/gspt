use serde::{Deserialize, Serialize};
use serde_json::Value;

const YF_BASE: &str = "https://query1.finance.yahoo.com/v8/finance/chart/";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Quote {
    pub symbol: Option<String>,
    pub price: Option<f64>,
    pub prev_close: Option<f64>,
    pub change: Option<f64>,
    pub change_percent: Option<f64>,
    pub currency: Option<String>,
    pub exchange_name: Option<String>,
    pub instrument_type: Option<String>,
    pub market_state: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryPoint {
    pub t: i64, // ms epoch
    pub c: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct History {
    pub quote: Quote,
    pub points: Vec<HistoryPoint>,
}

fn encode_symbol(s: &str) -> String {
    // symbols are always [A-Za-z0-9.=^-], a simple manual encode is enough here
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | '-' | '_' => c.to_string(),
            other => format!("%{:02X}", other as u32),
        })
        .collect()
}

async fn fetch_chart(symbol: &str, range: &str, interval: &str) -> Result<Value, String> {
    let url = format!(
        "{YF_BASE}{}?range={}&interval={}&includePrePost=false",
        encode_symbol(symbol),
        range,
        interval
    );

    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!(
            "Yahoo Finance request failed ({}) for {}",
            res.status(),
            symbol
        ));
    }

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    let result = json
        .get("chart")
        .and_then(|c| c.get("result"))
        .and_then(|r| r.get(0))
        .cloned();

    match result {
        Some(r) => Ok(r),
        None => {
            let err_msg = json
                .get("chart")
                .and_then(|c| c.get("error"))
                .and_then(|e| e.get("description"))
                .and_then(|d| d.as_str())
                .unwrap_or("No data returned");
            Err(format!("{}: {}", symbol, err_msg))
        }
    }
}

fn parse_quote(result: &Value) -> Quote {
    let meta = result.get("meta").cloned().unwrap_or(Value::Null);
    let price = meta.get("regularMarketPrice").and_then(|v| v.as_f64());
    let prev_close = meta
        .get("chartPreviousClose")
        .and_then(|v| v.as_f64())
        .or_else(|| meta.get("previousClose").and_then(|v| v.as_f64()));

    let change = match (price, prev_close) {
        (Some(p), Some(pc)) => Some(p - pc),
        _ => None,
    };
    let change_percent = match (change, prev_close) {
        (Some(c), Some(pc)) if pc != 0.0 => Some((c / pc) * 100.0),
        _ => None,
    };

    Quote {
        symbol: meta.get("symbol").and_then(|v| v.as_str()).map(String::from),
        price,
        prev_close,
        change,
        change_percent,
        currency: meta.get("currency").and_then(|v| v.as_str()).map(String::from),
        exchange_name: meta
            .get("exchangeName")
            .and_then(|v| v.as_str())
            .map(String::from),
        instrument_type: meta
            .get("instrumentType")
            .and_then(|v| v.as_str())
            .map(String::from),
        market_state: meta
            .get("marketState")
            .and_then(|v| v.as_str())
            .map(String::from),
    }
}

fn parse_history(result: &Value) -> Vec<HistoryPoint> {
    let timestamps: Vec<i64> = result
        .get("timestamp")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();

    let closes: Vec<Option<f64>> = result
        .get("indicators")
        .and_then(|i| i.get("quote"))
        .and_then(|q| q.get(0))
        .and_then(|q0| q0.get("close"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(|v| v.as_f64()).collect())
        .unwrap_or_default();

    let mut points = Vec::with_capacity(timestamps.len());
    for (i, ts) in timestamps.iter().enumerate() {
        if let Some(c) = closes.get(i).and_then(|v| *v) {
            points.push(HistoryPoint { t: *ts * 1000, c });
        }
    }
    points
}

pub async fn get_quote(symbol: &str) -> Result<Quote, String> {
    let result = fetch_chart(symbol, "5d", "1d").await?;
    Ok(parse_quote(&result))
}

pub async fn get_history(symbol: &str, range: &str, interval: &str) -> Result<History, String> {
    let result = fetch_chart(symbol, range, interval).await?;
    Ok(History {
        quote: parse_quote(&result),
        points: parse_history(&result),
    })
}
