# Firefox Add-ons (AMO) Reproducible Build Instructions

This source archive builds `dist/pikabu-expand-comments-firefox.zip` and `dist/firefox/` deterministically with zero external network calls during the build step and zero embedded wall-clock timestamps.

## Environment

- **OS:** Ubuntu Linux (tested on Ubuntu 24.04 LTS x86_64)
- **Node.js:** Node 24 LTS or Node 26 (exact pinned version in `.nvmrc`)
- **Package manager:** `pnpm` `12.21.0` (declared in `package.json#devEngines`)

## Exact Rebuild Steps

```bash
# 1. Install pnpm matching package.json (or enable via corepack / npm)
npm install --global pnpm@12.21.0

# 2. Install locked dependencies without modifying pnpm-lock.yaml
pnpm install --frozen-lockfile

# 3. Build only the Firefox MV3 extension and deterministic ZIP
pnpm run build:firefox
```

## Expected Outputs

- Unpacked Firefox MV3 extension: `dist/firefox/`
  - `manifest.json`
  - `content.js` (unminified IIFE compiled from `src/targets/extension/content.ts`)
  - `popup.html`, `assets/popup.js`, `assets/popup.css` (unminified ESM compiled from `src/targets/extension/popup/`)
  - `_locales/en/messages.json`, `_locales/ru/messages.json`
  - `icons/icon-{16,32,48,96,128}.png` (copied verbatim from `assets/icons/`)
- Deterministic Firefox package: `dist/pikabu-expand-comments-firefox.zip`

## Notes for Reviewers

- All JavaScript outputs are emitted **unminified** (`minify: false`) with unhashed asset paths for straightforward diff review.
- `dist/pikabu-expand-comments-firefox.zip` uses sorted POSIX entry paths, fixed `1980-01-01T00:00:00Z` timestamps, and normalized file modes (`0644`), so clean rebuilds reproduce the uploaded archive byte-for-byte.
- Extension icons are pre-exported PNGs in `assets/icons/` (generated from `assets/icons/icon-toolbar.svg` and `assets/icons/icon-store.svg`), so no native image library is required during rebuild.
