# Architecture

## Stack

**Tauri** (Rust backend shell + plain HTML/CSS/JS frontend). Chosen over
Electron for RAM/disk footprint — Tauri uses Windows' built-in WebView2
instead of bundling Chromium, so installed size lands around 10-20MB and
idle RAM around 30-60MB vs Electron's ~150-250MB idle. Frontend code is
the same either way (no framework, no build step needed for something
this size); the difference is entirely in the native shell.

Cost of that choice: the native shell (tray, autostart, window behavior,
HTTP fetch commands) is Rust, and building requires the Rust toolchain +
MSVC Build Tools on the Windows machine, not just `npm install`. Once set
up, `npm run tauri dev` / `npm run tauri build` behave like any other
frontend tool.

No Python — ruled out early for being the wrong tool for a
performance-sensitive desktop app with GUI + tray requirements. No plain
browser tab — can't do autostart, tray, or a real installed shortcut,
which were explicit requirements.

## Project structure

```
gspt/
├── src-tauri/                  Rust backend (native shell)
│   ├── Cargo.toml
│   ├── tauri.conf.json         window config, bundle/installer settings, icons
│   ├── icons/
│   └── src/
│       ├── main.rs             entry point, tray setup, window close behavior
│       ├── commands.rs         all invoke()-able commands, thin glue layer
│       ├── market.rs           Yahoo Finance fetch + parse (stocks/ETF/gold/silver/US funds)
│       ├── mutual_fund.rs      mfapi.in fetch + parse (Indian MF search + NAV history)
│       └── store.rs            local JSON persistence (watchlist, settings)
├── src/                        frontend — plain HTML/CSS/JS, no framework
│   ├── index.html
│   ├── style.css
│   └── app.js                  UI logic + Chart.js rendering
├── package.json                 chart.js dep + tauri CLI
├── README.md
└── ARCHITECTURE.md
```

## Data flow

Frontend never calls the internet directly. Everything goes through Rust
commands — avoids CORS/CSP headaches and keeps every external API call
in one place.

```
app.js → invoke('get_quote', { symbol }) → commands::get_quote → market::fetch_yahoo_chart() → JSON back to JS
```

## Commands (Rust → frontend)

| Command | Purpose |
|---|---|
| `get_quote(symbol)` | current price/change — watchlist rows + gold/silver cards |
| `get_history(symbol, range, interval)` | chart data |
| `mf_search(query)` | Indian MF name search via mfapi.in |
| `mf_data(scheme_code)` | full NAV history + latest for one scheme |
| `watchlist_get` / `watchlist_save(list)` | persisted JSON, Tauri app-data dir |
| `settings_get` / `settings_save` | refresh interval, close behavior |
| `autostart_get` / `autostart_set(bool)` | `tauri-plugin-autostart`, real Windows Run registry key |

## Data sources

- **Stocks / ETFs / US mutual funds / gold / silver / forex:** Yahoo
  Finance's public chart endpoint. Free, no key, covers NSE (`.NS`),
  BSE (`.BO`), US tickers, commodity futures, and forex from one
  endpoint. It's unofficial — can rate-limit or change shape without
  notice. That's the tradeoff for free/no-signup; if it breaks, the fix
  is swapping `market.rs`, not a rearchitecture.
- **Indian mutual funds:** AMFI NAV data via `mfapi.in`, free, no key,
  search by scheme name.
- Free-tier reality check: "live" means ~15min delayed during market
  hours for stocks/ETFs, not tick-by-tick. Mutual fund NAV updates once
  a day after market close everywhere, for everyone — not a limitation
  specific to this app.

## Gold / Silver

Direct commodity price — COMEX gold/silver futures (`GC=F`, `SI=F`),
real traded USD/oz prices, not something computed from other numbers.
Converted client-side to ₹/10g and ₹/kg using the live USD-INR rate
(`INR=X`). This will track spot price accurately but can sit 1-3% off a
local jeweler/MCX quote — duty, GST, and local premium aren't part of a
futures price, and no free API has that number. ETFs like `GOLDBEES.NS`
/ `SILVERBEES.NS` are addable through the normal watchlist search, not
baked into the gold/silver cards.

## Decisions log

- **Market scope:** both India and US (NSE/.NS, BSE/.BO, and US
  tickers all through the same Yahoo endpoint).
- **Gold/Silver:** direct futures price + INR conversion, shown as
  fixed cards, separate from the watchlist. ETF alternative available
  via normal add-to-watchlist flow, not automatic.
- **Refresh interval:** default 15s. Configurable in settings, 5s up to
  5min. Manual refresh button always available regardless of interval.
  5s as a sustained default was considered and rejected — free
  unofficial endpoint, real risk of IP throttling once the watchlist
  has more than a few symbols. UI should surface a clear "requests
  failing, try a longer interval" hint rather than failing silently.
- **Watchlist:** starts empty. Gold/silver cards are fixed, not part of
  the watchlist.
- **Window close (X button):** minimizes rather than quits — stays in
  taskbar, clickable to restore. Tray icon is the secondary way in;
  "Quit" only exists in the tray context menu.
- **Charts:** range toggle 1D/1W/1M/6M/1Y/5Y for Yahoo-sourced symbols.
  Mutual funds skip 1D/1W — NAV is daily-only, intraday ranges are
  meaningless for them.
- **Installer:** `tauri build` produces an NSIS installer with Start
  Menu + Desktop shortcut options, and registers autostart via
  `tauri-plugin-autostart`. Must be built on Windows — not attempted
  from this sandbox.

## Open items

- Confirm final icon/branding before first `tauri build`.
- Decide whether autostart should default on after first successful
  build+install, or stay off until the user opts in via settings.
