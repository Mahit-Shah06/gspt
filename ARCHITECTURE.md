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

Two data sources, shown together, not conflated:

- **COMEX spot** (`GC=F`, `SI=F`) — real global futures price, USD/oz.
- **NSE ETFs** (`GOLDBEES.NS`, `SILVERBEES.NS`) — real India-traded prices,
  INR. This replaced an earlier approach that computed an implied INR
  figure from spot × USD-INR fx rate; that was always an approximation
  (no duty/GST/premium in a futures price). The ETF price is real
  traded data, not something derived — still not identical to a local
  jeweler/MCX quote (ETF tracking error, expense ratio drag over time),
  but a meaningfully more honest number than a computed conversion.

Which one is "primary" (bigger number, drives the row/chart) flips with
the Settings currency toggle: INR mode leads with the ETF, native mode
leads with COMEX spot. The other one always stays visible as secondary
context in the sub-line / stats grid — never fully hidden.

**Gold/Silver ratio** — third pinned row below Silver. `ratio = gold
price ÷ silver price`, computed from data already being fetched (no
extra API calls for the live number). Detail view chart fetches gold
+ silver history for the selected range in parallel and divides them
point-by-point (matched by exact timestamp — COMEX gold/silver share
the same exchange calendar, so this holds up in practice; a point
without a same-timestamp counterpart on the other side is just
dropped rather than guessed at).

## Decisions log

- **Market scope:** both India and US (NSE/.NS, BSE/.BO, and US
  tickers all through the same Yahoo endpoint).
- **Layout:** single full-width scrollable list — gold, silver, the
  gold/silver ratio, then the user's own watchlist, all one list, one
  scrollbar. Earlier version had a permanently-visible two-column
  layout (list + empty chart panel); replaced because the second panel
  sat empty most of the time. Detail view (chart + stats) is now an
  overlay, only present when something's actually selected.
- **Adding items:** a persistent search bar (Yahoo symbol/company
  search + AMFI mutual fund name search merged into one result list),
  not a modal with separate tabs. Each result has an inline "+".
- **Hiding pinned items:** gold/silver/ratio can be hidden via an Edit
  mode toggle (shows a hide/show control on every row instead of a
  permanently visible one). Hidden items can be brought back the same
  way, shown dimmed while in Edit mode.
- **Currency display:** Settings toggle, INR (default) or native
  currency. Only USD-priced items convert (via the live USD-INR rate);
  other currencies pass through untouched — no reliable rate fetched
  for them, so no fake conversion is offered. Applies consistently to
  list rows, the detail header, the stats grid, and the chart's own
  y-axis (chart points get the same scalar multiply, so the curve's
  shape never changes, only its labeled scale).
- **Refresh interval:** default 15s. Configurable in settings, 5s up to
  5min, via a custom-built dropdown (native `<select>` renders with
  unstyled OS-default popups on Linux/WebKitGTK — not fixable with
  CSS on the parts that matter, so it's a hand-built dropdown instead).
  Manual refresh button always available regardless of interval.
- **Window close (X button):** minimizes rather than quits — stays in
  taskbar, clickable to restore. Tray icon is the secondary way in;
  "Quit" only exists in the tray context menu. A configurable global
  keyboard shortcut (Settings, recorded live, needs at least one
  modifier key) also toggles show/hide, works even when unfocused, via
  `tauri-plugin-global-shortcut`.
- **Charts:** range toggle 1D/1W/1M/6M/1Y/5Y for Yahoo-sourced symbols.
  Mutual funds skip 1D/1W — NAV is daily-only, intraday ranges are
  meaningless for them.
- **Installer:** `tauri build` produces an NSIS installer with Start
  Menu + Desktop shortcut options, and registers autostart via
  `tauri-plugin-autostart` (off by default, opt-in in Settings). Must
  be built on Windows — CI (`.github/workflows/release.yml`) handles
  this on a real `windows-latest` runner, not attempted locally.

## Open items

- Confirm final icon/branding — still the placeholder gold/silver coin
  mark generated early on.
- ~~Decide whether autostart should default on~~ — resolved: stays
  opt-in, never auto-enabled by an installer.
- **Desktop widget idea (raised, not scoped):** a separate always-on-top
  floating window, positionable anywhere on the desktop, showing a
  user-chosen subset of the watchlist. Technically straightforward in
  Tauri (multi-window is native support, a second undecorated
  transparent window is a normal pattern) — not started, needs actual
  scoping first: what it shows, whether it persists position/size,
  whether it needs to work independent of the main window being open
  at all.
