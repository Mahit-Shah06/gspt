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

Building a Windows installer needs an actual Windows toolchain (MSVC +
WebView2), which this dev machine doesn't have. Don't try `npm run
tauri build` here for a real release — use the GitHub Actions workflow
instead (see below), which builds on a real Windows runner.

Local `npm run tauri build` only works if you're actually developing
from a Windows machine at some point.

## Publishing a release

`.github/workflows/release.yml` builds the Windows installer on
`windows-latest` and attaches it to a GitHub Release, triggered by
pushing a version tag:

```
# bump "version" in src-tauri/tauri.conf.json first, then:
git tag v0.1.0
git push origin v0.1.0
```

Check the Actions tab for build progress (~5-10 min). It publishes as
a **draft** release — review it, download the installer yourself to
sanity-check it, then hit "Publish" on GitHub when satisfied.

The installer is unsigned (no paid code-signing cert), so Windows
SmartScreen will show an "unknown publisher" warning on first run.
Normal for an indie/free app — "More info" -> "Run anyway" gets past
it. Worth a line in the release notes so people aren't caught off
guard.

First-time setup: GitHub Actions needs write access to create the
release. Settings -> Actions -> General -> Workflow permissions ->
"Read and write permissions", if it's not already on.

## Branch workflow

Single `master` branch, direct commits. No develop/main split — this
is a solo personal project, that split earned its keep on menu-xr
because of interns and a live prod split; neither applies here.

## Status

Scaffolding stage — repo + architecture docs committed. Tauri project
skeleton (`src-tauri/`, `src/`) comes next.
