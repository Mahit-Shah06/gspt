# GSPT — Gold-Silver Price Tracker

Desktop app (Windows). Live gold/silver price, plus a watchlist for any
stock, ETF, or mutual fund (India + US), with charts. Runs at startup,
lives in the tray.

See `ARCHITECTURE.md` for stack, data flow, and the decisions behind it.

## Prerequisites (Windows machine, not this sandbox)

- Node.js 18+
- Rust (`rustup`) — https://rustup.rs
- MSVC Build Tools — "Desktop development with C++" workload from the
  Visual Studio Build Tools installer
- WebView2 runtime — preinstalled on Windows 11 and most Windows 10
  machines; Tauri's installer bundles it anyway if missing

## Dev

```
npm install
npm run tauri dev
```

## Build the real installer (creates desktop shortcut + Start Menu entry)

```
npm run tauri build
```

Output: `src-tauri/target/release/bundle/nsis/GSPT_<version>_x64-setup.exe`

Must be run on Windows. Cross-compiling Windows installers from Linux
isn't reliable enough to bother with — run this step on your machine.

## Branch workflow

Single `master` branch, direct commits. No develop/main split — this
is a solo personal project, that split earned its keep on menu-xr
because of interns and a live prod split; neither applies here.

## Status

Scaffolding stage — repo + architecture docs committed. Tauri project
skeleton (`src-tauri/`, `src/`) comes next.
