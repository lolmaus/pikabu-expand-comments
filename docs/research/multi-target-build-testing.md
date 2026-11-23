# Multi-Target Vite 8 Extension Build, TypeScript Boundaries, Playwright Extension E2E, and Visual-Audit Extension

Research report for Wayfinder ticket [#32](https://github.com/lolmaus/pikabu-expand-comments/issues/32) (Map [#29](https://github.com/lolmaus/pikabu-expand-comments/issues/29)).

**Repo baseline inspected**: Node `26.13.1` (`.nvmrc`), pnpm `12.21.0`, Vite `8.3.8` (Rolldown), TypeScript `7.0.2` (`tsgo`/`tsc`), Playwright `1.65.1`, Vitest `5.1.1`, Oxlint `1.94.0`, Oxfmt `0.79.0`.

---

## Executive Summary & Recommendations

| Area                                            | Recommended Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Key Constraint / Gotcha                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-target Vite 8 build (`lib/build.mts`)** | Single-package multi-pass programmatic `vite.build()`: Pass 1 builds `dist/userscript/` (unchanged IIFE + `@build` banner); Pass 2 builds extension content script as a single-file IIFE (`format: "iife"`, `codeSplitting: false`); Pass 3 builds `popup.html` as ESM with `root` set to popup dir and `emptyOutDir: false`. Generate target-specific `manifest.json` (`dist/chrome/`, `dist/firefox/`), copy `_locales/` + `icons/`, and emit deterministic `.zip` packages + AMO source archive (`git archive`).                                                           | **Vite 8 / Rolldown** deprecates `rollupOptions` and `inlineDynamicImports`; use `rolldownOptions.output.codeSplitting: false`. **Never** embed wall-clock `@build` timestamps in `dist/chrome/` or `dist/firefox/` (breaks AMO deterministic rebuild verification).                                                                                                             |
| **TypeScript & Oxlint boundaries**              | Keep `src/core`, `src/adapters`, `src/ui`, and `src/targets/userscript` strictly in `tsconfig.browser.json` (`"types": []`). For a minimal `storage.local` + `i18n` extension, prefer a ~25-line hand-typed boundary module (`src/targets/extension/webext-api.ts`) using `globalThis.browser ?? globalThis.chrome` (zero runtime `webextension-polyfill`, zero `@types/*` global leakage, matching existing `GM` pattern). Add a dedicated `tsconfig.extension.json` leaf with `@types/chrome` only if/when broader WebExtension APIs (`tabs`, `scripting`, etc.) are added. | Firefox MV3 `browser.*` returns Promises natively while `chrome.*` was historically callback-first; Chrome MV3 `chrome.storage.local` returns Promises natively and adds the `browser` namespace in Chrome 148+. Prefer `globalThis.browser ?? globalThis.chrome`. Under `exactOptionalPropertyTypes: true`, never pass explicit `undefined` to optional `@types/chrome` fields. |
| **Chromium Playwright E2E**                     | `chromium.launchPersistentContext(tmpUserDataDir, { channel: "chromium", headless: true, args: ["--disable-extensions-except=...", "--load-extension=..."] })`. Discover the extension ID **without a service worker** via CDP `Runtime.executionContextCreated` (`event.context.origin` = `chrome-extension://<id>`) on a mocked Pikabu fixture page (or cross-check with Chromium's deterministic SHA-256 `a`–`p` path hash). Test `storage.local` + `storage.onChanged` live sync directly between `popup.html` and an open Post Page tab in the same persistent context.  | Branded Chrome 137+ removed `--load-extension` (Chrome 139 removed `--disable-extensions-except`); **must** use `channel: "chromium"` (or Chrome for Testing). Playwright's official `waitForEvent("serviceworker")` **hangs forever** when an MV3 extension has no background service worker. Do not put a dev `"key"` in release `dist/chrome/manifest.json`.                  |
| **Firefox testing**                             | 3-layer strategy: (1) `web-ext lint` / `addons-linter` in CI against `dist/firefox/` (validates MV3 schema, `gecko.id`, `data_collection_permissions`), (2) deterministic Vitest contract tests on the Firefox `browser.storage` adapter (including Firefox Bug 1833153 `onChanged` quirk) and generated manifests, (3) `web-ext run` (or optional WebDriver BiDi `webExtension.install`) for release smoke checks.                                                                                                                                                           | Playwright 1.65 Firefox (Juggler) still has **no native API** to load temporary unpacked WebExtensions (`playwright#7297`, `#26995`).                                                                                                                                                                                                                                            |
| **Visual-audit harness**                        | Split `tests/support/visual-audit.ts` into desktop (`1280x800`, `1024x800`), mobile (`390x844`, `412x915`, `hasTouch: true`, dedicated mobile fixture & touch-target `>= 44px` gate), and extension popup (`popup.html` at `320px` width in light/dark via `emulateMedia({ colorScheme })`). Generalize `auditShadowContrast` + `auditAxe` to support both Shadow DOM (on-page) and Light DOM (`popup.html`).                                                                                                                                                                 | Current `tests/fixtures/pikabu-theme.css` hardcodes a `300px` desktop sidebar and `50px` single-row `.story-comments__menu`; running `390x844` against the desktop fixture causes immediate horizontal overflow and false geometry failures.                                                                                                                                     |

---

## 1. Multi-Target Vite 8 Build & TypeScript Boundaries

### 1.1 Why Multi-Pass Programmatic `vite.build()` in `lib/build.mts`

The repo already drives Vite 8 programmatically from [lib/build.mts](../../lib/build.mts) (`import { build } from "vite"`, executed directly by Node 26 via `node lib/build.mts`). Extending this script rather than adopting a heavy extension framework (WXT, Plasmo, CRXJS) preserves zero runtime bloat, full control over output determinism, and a single-package layout.

A **single** multi-input `vite.build()` call cannot cleanly produce both an MV3 content script and an MV3 popup page:

1. **Content scripts must be self-contained IIFE classic scripts.** Declared `content_scripts[].js` files in MV3 execute as classic scripts, not ES modules, so split ESM chunks fail to load unless wrapped in dynamic `import(chrome.runtime.getURL(...))` loaders + `web_accessible_resources`. In Vite 8 / Rolldown, emitting a single self-contained IIFE requires `format: "iife"` and `codeSplitting: false` inside `build.rolldownOptions.output` (Rolldown replaces Rollup's deprecated `rollupOptions` with `rolldownOptions`, and replaces `inlineDynamicImports: true` with `codeSplitting: false`).
   - Primary sources: [Vite 8 Migration Guide — Rolldown](https://vite.dev/guide/migration), [Rolldown Output Options (`codeSplitting`)](https://rolldown.rs/reference/OutputOptions.codeSplitting).
2. **Popup HTML must emit at the extension root (`popup.html`), not nested.** When `root` is the repo root and `rolldownOptions.input` points to `src/targets/extension/popup/popup.html`, Vite preserves the relative source path and writes `dist/chrome/src/targets/extension/popup/popup.html`.
   - Primary source: [Vite Building for Production — Multi-Page App](https://vite.dev/guide/build#multi-page-app).
   - **Clean fix**: Run the popup `build()` pass with `root: resolve(repoRoot, "src/targets/extension/popup")`, `base: "./"`, `build: { outDir: resolve(repoRoot, "dist/chrome"), emptyOutDir: false }`. Vite emits `dist/chrome/popup.html` and relative `dist/chrome/assets/popup.js` / `popup.css` directly with zero path-rewriting plugins.
3. **Zero-bloat shared extension assets across Chrome and Firefox.** Because both Chrome MV3 and Firefox MV3 execute the exact same `content.js` and `popup.html` bundle (via the thin `globalThis.browser ?? globalThis.chrome` storage adapter), `lib/build.mts` can build the extension JS/HTML/CSS once into a staging directory (or `dist/chrome/`), copy the static assets into `dist/firefox/`, and then write target-specific `manifest.json` files.

### 1.2 Proposed Directory & Output Layout

```text
src/
  core/                      # Pure domain logic (StoragePort, settings, expansion-run)
  adapters/pikabu/           # Pikabu DOM adapters (desktop + mobile)
  ui/                        # Shadow DOM on-page controls
  targets/
    userscript/              # main.ts, storage.ts (GM.* only)
    extension/
      webext-api.ts          # ~25-line browser/chrome Promise + i18n boundary
      storage.ts             # StoragePort + onChanged subscription over storage.local
      content.ts             # MV3 content script entry -> bundled to IIFE content.js
      popup/
        popup.html           # Extension action popup HTML
        popup.css            # Pikabu light/dark tokens via prefers-color-scheme
        popup.ts             # Popup entry -> bundled to ESM assets/popup.js
      assets/
        icons/               # icon-16.png, icon-32.png, icon-48.png, icon-128.png
        _locales/
          ru/messages.json
          en/messages.json

dist/
  userscript/
    pikabu-expand-comments.user.js
    pikabu-expand-comments.meta.js
  chrome/                    # Unpacked Chrome MV3 extension (loadable in Playwright)
    manifest.json
    content.js
    popup.html
    assets/
    icons/
    _locales/
  firefox/                   # Unpacked Firefox MV3 extension (lintable with web-ext)
    manifest.json
    content.js
    popup.html
    assets/
    icons/
    _locales/
  pikabu-expand-comments-chrome.zip
  pikabu-expand-comments-firefox.zip
  pikabu-expand-comments-firefox-source.zip   # Deterministic AMO source archive
```

Recommended `package.json` scripts (keeping `pnpm run build` building all targets or adding granular targets for fast iteration):

- `build`: builds userscript + chrome + firefox (or calls `node lib/build.mts`)
- `build:userscript`, `build:chrome`, `build:firefox`, `build:source`: optional `--target=<name>` flag to `node lib/build.mts` so AMO reviewers and CI jobs can rebuild a single target deterministically.

### 1.3 Programmatic Vite 8 Multi-Pass Pattern

```ts
// Pass 1: Userscript (existing behavior preserved; @build timestamp stays userscript-only)
await build({
  configFile: false,
  root: repoRoot,
  build: {
    outDir: "dist/userscript",
    emptyOutDir: true,
    minify: false,
    rolldownOptions: {
      input: "src/targets/userscript/main.ts",
      output: {
        format: "iife",
        codeSplitting: false,
        entryFileNames: `${name}.user.js`,
        postBanner: userscriptMetadata,
      },
    },
  },
});

// Pass 2: Extension content script (single-file IIFE, no hashes, no timestamps)
await build({
  configFile: false,
  root: repoRoot,
  build: {
    outDir: extStagingDir,
    emptyOutDir: true,
    minify: false, // readable for AMO/CWS review and deterministic diffs
    rolldownOptions: {
      input: "src/targets/extension/content.ts",
      output: {
        format: "iife",
        codeSplitting: false,
        entryFileNames: "content.js",
      },
    },
  },
});

// Pass 3: Extension popup HTML/CSS/TS (ESM, flat popup.html at outDir root)
await build({
  configFile: false,
  root: resolve(repoRoot, "src/targets/extension/popup"),
  base: "./",
  build: {
    outDir: extStagingDir,
    emptyOutDir: false, // keep content.js from Pass 2
    minify: false,
    modulePreload: false, // unnecessary for local extension popup
    rolldownOptions: {
      input: resolve(repoRoot, "src/targets/extension/popup/popup.html"),
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
```

> **Note on deterministic filenames**: Using unhashed `assets/[name].js` and `assets/[name][extname]` (safe because extension files are versioned per package, not HTTP-cached on a CDN) guarantees byte-for-byte identical output across machines and simplifies AMO review diffs.

### 1.4 Target-Specific `manifest.json` Generation

Generate both manifests programmatically from `package.json` (`version` always sourced from `package.json`, never bumped manually per [AGENTS.md](../../AGENTS.md)):

- **Shared MV3 fields**:
  - `"manifest_version": 3`
  - `"name": "__MSG_extensionName__"`, `"description": "__MSG_extensionDescription__"`, `"default_locale": "ru"`
  - `"version": manifest.version`
  - `"permissions": ["storage"]` (no `tabs`, no `scripting`, no `host_permissions` beyond `content_scripts`, **no `background`**)
  - `"action": { "default_popup": "popup.html", "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" } }`
  - `"icons": { "16": ..., "32": ..., "48": ..., "128": ... }`
  - `"content_scripts": [{ "matches": ["https://pikabu.ru/story/*"], "js": ["content.js"], "run_at": "document_end", "all_frames": false }]` (expand `matches` if mobile Pikabu uses `https://m.pikabu.ru/story/*` — see Section 4)
- **Chrome additions (`dist/chrome/manifest.json`)**:
  - `"minimum_chrome_version": "120"` (covers MV3 `storage.local` Promises, `color-mix()`, Popover API `popover="auto"`, `adoptedStyleSheets`).
  - **Omit `"key"`** in release builds: Chrome Web Store assigns the extension's public key on first draft upload; shipping a different local `"key"` triggers an ID mismatch error on store upload.
    - Primary source: [Chrome for Developers — Manifest `key`](https://developer.chrome.com/docs/extensions/reference/manifest/key).
- **Firefox additions (`dist/firefox/manifest.json`)**:
  - `"browser_specific_settings"`:
    ```json
    {
      "gecko": {
        "id": "pikabu-expand-comments@lolmaus.github.io",
        "strict_min_version": "140.0",
        "data_collection_permissions": {
          "required": ["none"]
        }
      },
      "gecko_android": {
        "strict_min_version": "142.0"
      }
    }
    ```
  - **2025/2026 AMO requirement**: Mozilla now mandates `browser_specific_settings.gecko.data_collection_permissions` for new AMO extensions (natively supported in Firefox Desktop `140+` and Firefox for Android `142+`); extensions that collect no data must explicitly declare `"required": ["none"]`.
    - Primary sources: [Mozilla Extension Workshop — Firefox built-in data collection consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [MDN — `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).

### 1.5 Deterministic `.zip` Packaging & AMO Source-Code Archive

Mozilla Extension Workshop requires source-code submission whenever an extension is compiled or bundled (TypeScript + Vite/Rolldown always qualifies). AMO reviewers unpack the source archive in a clean Linux environment, install from the lockfile, rebuild, and diff the rebuilt extension against the submitted `.zip`.

- Primary source: [Mozilla Extension Workshop — Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/).

Three determinism traps to eliminate upfront:

1. **No timestamps in extension builds**: Keep `buildTimestamp` (`@build`) strictly inside `dist/userscript/`. Never inject `new Date()` into `dist/chrome/` or `dist/firefox/`.
2. **Deterministic extension `.zip` creation in Node 26**:
   - Standard OS `zip` commands embed current `mtime`, local `umask`, and filesystem directory order.
   - Use a small pure-JS library (`fflate` — zero sub-dependencies, ESM, TypeScript types built in) or `yazl` in `lib/zip.mts`:
     1. Walk the output directory recursively and **sort relative POSIX paths lexicographically** (`a < b ? -1 : a > b ? 1 : 0`, avoiding locale-dependent `localeCompare` differences across Linux locales).
     2. Pin every entry's `mtime` to **`new Date(Date.UTC(1980, 0, 1, 0, 0, 0))`** (the earliest valid MS-DOS ZIP epoch; `new Date(0)` predates 1980 and clamps inconsistently across ZIP implementations).
     3. Pin file mode to `0o100644` (or `0o644` depending on writer API) and compression level to `6`.
   - Primary sources: [Reproducible Builds — Archives](https://reproducible-builds.org/docs/archives/), [`fflate` API](https://github.com/101arrowz/fflate).
3. **Deterministic AMO source archive (`dist/pikabu-expand-comments-firefox-source.zip`)**:
   - Use `git archive --format=zip -o dist/pikabu-expand-comments-firefox-source.zip HEAD` (which excludes `.git/`, `node_modules/`, `dist/`, `tmp/`, sorts entries, and stamps the deterministic git commit timestamp) — or filter to the exact tracked build inputs (`package.json`, `pnpm-lock.yaml`, `.nvmrc`, `tsconfig*.json`, `lib/`, `src/`, `README.md`, `AMO_BUILD.md`).
   - Primary source: [Git — `git-archive(1)`](https://git-scm.com/docs/git-archive).
   - **Risk to document in AMO Reviewer Notes**: Because `.nvmrc` pins Node `26.13.1` and `package.json` uses `pnpm@12.21.0` (`devEngines.packageManager`), AMO reviewer machines (typically Ubuntu LTS with Node LTS + npm) may need explicit instructions (`corepack enable` or `npx pnpm@12.21.0 install --frozen-lockfile && npx pnpm@12.21.0 run build:firefox`) and we should verify whether `lib/build.mts` runs cleanly on Node 24 LTS as well as Node 26.

### 1.6 TypeScript 7 (`tsgo`) & Oxlint 1.94.0 Boundaries

Current `tsconfig.*.json` layout in this repo:

- [tsconfig.base.json](../../tsconfig.base.json): `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `noPropertyAccessFromIndexSignature: true`, `verbatimModuleSyntax: true`, `skipLibCheck: true`, `noEmit: true`.
- [tsconfig.browser.json](../../tsconfig.browser.json): `"types": []`, includes `src/**/*.ts`, excludes `src/**/*.test.ts`.
- [tsconfig.node.json](../../tsconfig.node.json), [tsconfig.vitest.json](../../tsconfig.vitest.json), [tsconfig.playwright.json](../../tsconfig.playwright.json).

#### Cross-browser runtime nuance (`browser.*` vs `chrome.*`)

- **Firefox MV3**: The `browser` namespace natively returns Promises for all async APIs; `chrome` exists as a callback-oriented porting aid (though some MV3 methods support Promises).
- **Chrome MV3**: `chrome.storage.local.get/set` natively return Promises in MV3; Chrome officially adds the standard `browser` namespace starting in **Chrome 148** (DevTools in 152).
- Primary sources: [MDN — Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities), [Chrome for Developers — Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage), [Chrome Developers — `browser` namespace support in Chrome 148](https://developer.chrome.com/docs/extensions/reference/api).

Therefore, checking `globalThis.browser?.storage?.local` first and falling back to `globalThis.chrome?.storage?.local` works natively with Promises on **both** Firefox MV3 and Chrome MV3 with **zero `webextension-polyfill` runtime dependency**.

#### Typing options compared

| Option                                                                    | Isolation from `src/core`, `adapters`, `ui`, `userscript`                                                                                                                             | TS 7 (`tsgo`) + `exactOptionalPropertyTypes` friction                                                                                                                                                   | Runtime bloat | Verdict                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| **A. Hand-typed narrow boundary (`src/targets/extension/webext-api.ts`)** | Complete (`tsconfig.browser.json` stays `"types": []`, no ambient globals; mirrors [src/targets/userscript/storage.ts](../../src/targets/userscript/storage.ts) & `declare const GM`) | **Zero** — only ~25 lines covering `storage.local.{get,set}`, `storage.onChanged.{addListener,removeListener}`, `i18n.getMessage`                                                                       | **0 B**       | **Recommended for MVP**                                                                           |
| **B. Dedicated `tsconfig.extension.json` leaf + `@types/chrome`**         | Complete when `tsconfig.browser.json` excludes `src/targets/extension/**/*.ts` and `tsconfig.extension.json` sets `"types": ["chrome"]`                                               | Low (`skipLibCheck: true` protects `node_modules/@types/chrome` under TS 7 `tsgo`, but call sites must omit rather than pass explicit `undefined` to optional props under `exactOptionalPropertyTypes`) | **0 B**       | **Recommended upgrade path** if extension later uses `tabs`, `scripting`, `action`, `permissions` |
| **C. `webextension-polyfill` + `@types/webextension-polyfill`**           | Requires separate leaf or explicit import                                                                                                                                             | Low                                                                                                                                                                                                     | ~10–15 KB     | **Not recommended** (unnecessary for storage + i18n MV3-only extension)                           |

**How Option A stays invisible to Oxlint 1.94.0**:

- Currently `pnpm run lint` runs `oxlint .` with no config file.
- Accessing `(globalThis as ExtensionGlobalThis).browser ?? (globalThis as ExtensionGlobalThis).chrome` inside `src/targets/extension/webext-api.ts` requires **zero** Oxlint config changes and guarantees `chrome` / `browser` cannot be referenced accidentally anywhere else in `src/`.
- If Option B (bare `chrome` / `browser` globals) is adopted later, add an `oxlint.config.ts` `overrides` entry scoped strictly to `["src/targets/extension/**/*.ts"]` with `globals: { chrome: "readonly", browser: "readonly" }`.
  - Primary source: [Oxlint Configuration — `env`, `globals`, `overrides`](https://oxc.rs/docs/guide/usage/linter/config.html).

---

## 2. Automated Playwright 1.65+ Extension E2E Testing

### 2.1 Chromium Unpacked MV3 Extension Testing

#### Mandatory launch configuration (2026)

- **Chrome 137+ restriction**: Google removed `--load-extension` from branded Google Chrome in Chrome 137 and `--disable-extensions-except` in Chrome 139. Tests targeting `channel: "chrome"` silently fail to load extensions.
  - Primary source: [Chrome Developers — Removing `--load-extension` from branded Chrome](https://developer.chrome.com/blog/chrome-for-testing) / [Playwright Chrome Extensions Docs](https://playwright.dev/docs/chrome-extensions).
- **Playwright 1.65+ official pattern**: Use `chromium.launchPersistentContext(userDataDir, { channel: "chromium", headless: true, args: [...] })`.
  - Setting `channel: "chromium"` selects Playwright's bundled Chromium (using new headless mode when `headless: true`), which **fully supports unpacked MV3 extensions headlessly on Linux CI without `Xvfb`**.
  - **Repo-specific nuance** ([playwright.config.mts](../../playwright.config.mts)): This repo optionally passes `executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"]` and `chromiumSandbox: false`. Because `channel` and `executablePath` should not be combined ambiguously, only set `channel: "chromium"` when `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is unset (and ensure any custom executable is unbranded Chromium or Chrome for Testing, not branded Google Chrome 137+).
  - **Worker isolation**: Always allocate a fresh `mkdtempSync(join(tmpdir(), "pikabu-ext-"))` per test/fixture and `rmSync(userDataDir, { recursive: true, force: true })` in teardown so parallel Playwright workers do not collide on Chromium's profile lock or leak `chrome.storage.local` across tests.

#### Critical Gotcha: Discovering the Extension ID Without a Background Service Worker

Playwright's official docs (`https://playwright.dev/docs/chrome-extensions`) exclusively show:

```ts
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent("serviceworker");
const extensionId = sw.url().split("/")[2];
```

**Because our MV3 extension intentionally has NO `background.service_worker`, `waitForEvent("serviceworker")` will hang forever until test timeout.**

Primary-source comparison of the 4 alternatives:

| Method                                                                             | Works headless?     | Modifies `manifest.json`? | Reliability                                                                                                                                                                                                                | Verdict                                              |
| ---------------------------------------------------------------------------------- | ------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **1. CDP `Runtime.executionContextCreated` on a matched fixture page**             | Yes                 | No                        | **Highest** — captures `event.context.origin` (`chrome-extension://<id>`) directly from Chromium's Runtime domain when the content script injects into its isolated world. Also proves content-script injection succeeded! | **Recommended primary**                              |
| **2. Deterministic path-hash (`components/crx_file/id_util.cc`)**                  | Yes                 | No                        | High on Linux/macOS (`sha256(realpathSync(extDir))` first 16 bytes mapped `0..15` -> `'a'..'p'`); Windows requires UTF-16LE + uppercase drive letter normalization.                                                        | **Great fast helper / cross-check**                  |
| **3. Parse `Default/Preferences` & `Default/Secure Preferences` in `userDataDir`** | Yes                 | No                        | Medium — Chromium writes `extensions.settings` to `Preferences` or `Secure Preferences` depending on OS/branding and flushes asynchronously (requires short retry/poll).                                                   | Fallback only                                        |
| **4. `manifest.json` `"key"` field**                                               | Yes                 | **Yes**                   | High, but **dangerous** if leaked into release `dist/chrome/manifest.json` (causes CWS upload mismatch errors). Would require a separate test-only manifest copy.                                                          | Avoid unless testing against a CWS-issued public key |
| **5. `chrome://extensions` DOM scraping**                                          | **No / unreliable** | No                        | Blocked/restricted in headless automation.                                                                                                                                                                                 | Do not use                                           |

Primary sources: [Chromium `components/crx_file/id_util.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/id_util.cc), [Chrome DevTools Protocol — `Runtime.executionContextCreated`](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-executionContextCreated), [Chrome for Developers — Manifest `key`](https://developer.chrome.com/docs/extensions/reference/manifest/key).

**Recommended Playwright extension fixture (no service worker)**:

```ts
async function discoverExtensionIdViaCdp(
  context: BrowserContext,
  fixtureUrl = "https://pikabu.ru/story/fixture_id_probe",
): Promise<string> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const resolved = Promise.withResolvers<string>();

  await cdp.send("Runtime.enable");
  cdp.on("Runtime.executionContextCreated", ({ context: ctx }) => {
    const match = ctx.origin.match(/^chrome-extension:\/\/([a-p]{32})(?:\/|$)/);
    if (match?.[1]) resolved.resolve(match[1]);
  });

  await page.route(fixtureUrl, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });

  try {
    return await resolved.promise;
  } finally {
    await cdp.detach();
    await page.close();
  }
}
```

#### Testing `storage.local` + `storage.onChanged` Live Sync (Popup ↔ Post Page, No Service Worker)

Both extension popups (`chrome-extension://<id>/popup.html`) and content scripts have direct access to `chrome.storage.local` and `chrome.storage.onChanged` without any background service worker intermediary.

- Primary sources: [Chrome for Developers — `chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage), [MDN — `storage.onChanged`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged).

**Critical Playwright routing caveat**:

- Always attach mock routes (`route.fulfill` for `https://pikabu.ru/story/*`, `/pikabu-theme.css`, `/fixture.js`, `**/ajax/comments_actions.php`) via **`postPage.route(...)`** (or scoped `context.route("https://pikabu.ru/**", ...)`).
- **Never** register a catch-all `context.route("**/*", route => route.abort())` on the extension's `BrowserContext`, because aborting all requests at context level can interfere with extension page subresources (`chrome-extension://<id>/assets/popup.js`).
- When `postPage.route` fulfills `https://pikabu.ru/story/fixture_1` with local HTML, Chromium still matches the URL against `manifest.json` `content_scripts[].matches` and injects the real `content.js` in its isolated world!

**End-to-end live-sync test scenario**:

1. Open `postPage` on mocked `https://pikabu.ru/story/fixture_1`. Wait for the Shadow DOM control (`Раскрыть все комментарии`) to mount via the real unpacked content script. Open on-page Settings popover and verify `Auto-Expand on Visit` checkbox is unchecked.
2. Open `popupPage = await context.newPage()` in the **same** persistent `BrowserContext` and `await popupPage.goto(\`chrome-extension://${extensionId}/popup.html\`)`.
3. Click the `Auto-Expand on Visit` toggle in `popupPage`.
4. **Without reloading `postPage`**, assert that `postPage`'s on-page checkbox updates to `toBeChecked()` (proving `storage.local.set` in popup → `storage.onChanged` in content script works with zero service worker).
5. Uncheck the checkbox from `postPage`'s on-page popover and assert `popupPage`'s toggle updates to `not.toBeChecked()` (bidirectional sync).
6. Re-enable in `popupPage`, navigate a fresh `postPage2` to `https://pikabu.ru/story/fixture_2`, and assert Auto-Expand on Visit starts an Expansion Run automatically and expands all Comment Batches and Reply Branches.

### 2.2 Firefox Extension Testing Strategy (2026)

#### Current Playwright Firefox status

- Playwright's Firefox integration runs on its custom **Juggler** protocol (while WebDriver BiDi adoption continues) and **still does not expose a native API** to dynamically install unpacked/temporary WebExtensions (long-standing issues [microsoft/playwright#7297](https://github.com/microsoft/playwright/issues/7297) and [#26995](https://github.com/microsoft/playwright/issues/26995)).
- Attempting to pre-seed `firefox.launchPersistentContext()` profiles with unpacked extensions is brittle because release Firefox enforces add-on signing and Juggler lacks first-class `moz-extension://` page instrumentation.

#### Recommended primary-source Firefox verification stack (3 layers)

1. **CI Gate 1 — Official Mozilla Static Linter (`web-ext lint` / `addons-linter`)**:
   - Run `pnpm exec web-ext lint --source-dir dist/firefox --warnings-as-errors` (or `addons-linter dist/firefox`) in CI.
   - Executes the exact validation ruleset used by AMO: MV3 manifest schema, `browser_specific_settings.gecko.id`, `data_collection_permissions`, `_locales` integrity, CSP compliance, and unsafe DOM sink checks (`innerHTML`).
   - Primary source: [Mozilla Extension Workshop — `web-ext` command reference (`lint`)](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-lint).
2. **CI Gate 2 — Deterministic Vitest Contract Tests (`src/targets/extension/*.test.ts` + manifest contract tests)**:
   - Test `src/targets/extension/storage.ts` and `webext-api.ts` against simulated `globalThis.browser` (Firefox Promise API) including **Firefox Bug 1833153** (`storage.onChanged` may include unchanged keys or extra keys in `changes`, so listeners must verify `areaName === "local"` and compare `newValue !== oldValue` / current state).
     - Primary source: [MDN — `storage.onChanged` compatibility notes](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged).
   - Contract-test built `dist/chrome/manifest.json` and `dist/firefox/manifest.json`: identical `version` to `package.json`, Chrome omits `"key"`, Firefox includes `browser_specific_settings.gecko.id` and `data_collection_permissions.required: ["none"]`, zero `background` field, all referenced icons/JS/HTML exist on disk.
3. **Release Gate — Real Firefox Smoke Test**:
   - Manual / scripted smoke via `pnpm exec web-ext run --source-dir dist/firefox` on Firefox Desktop (and `web-ext run --target=firefox-android` for Firefox for Android).
   - If automated real-Firefox browser E2E becomes necessary later, **Firefox WebDriver BiDi** natively implements the W3C [`webExtension.install`](https://w3c.github.io/webdriver-bidi/#module-webExtension) command (via `geckodriver` / WebdriverIO / Selenium) without patching Firefox — keep that out of MVP scope until real Firefox-specific regressions justify a second browser-automation runner.
   - Primary sources: [Mozilla Extension Workshop — Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/), [W3C WebDriver BiDi — `webExtension` module](https://w3c.github.io/webdriver-bidi/#module-webExtension).

---

## 3. Extending the Visual-Audit Harness (Mobile Viewports + Extension Popup)

### 3.1 Gaps Identified in the Current Harness

Inspecting [tests/support/visual-audit.ts](../../tests/support/visual-audit.ts), [tests/visual/capture.mts](../../tests/visual/capture.mts), [tests/visual/p0-gates.spec.ts](../../tests/visual/p0-gates.spec.ts), and [tests/fixtures/pikabu-theme.css](../../tests/fixtures/pikabu-theme.css) reveals four concrete blockers to extending directly:

1. **Desktop-hardcoded fixture CSS**: `pikabu-theme.css` sets `.pikabu-shell { display: flex }` with a fixed `.pikabu-sidebar { flex: 0 0 300px }` and `.story-comments__menu { flex-wrap: nowrap; overflow: hidden; padding: 0 24px }`. Simply appending `{ name: "390x844", width: 390, height: 844 }` to `VISUAL_VIEWPORTS` will immediately fail `pageOverflowPx > 0` because the desktop sidebar doesn't collapse on narrow viewports.
2. **Desktop-hardcoded geometry gates**: `evaluateP0Gates` enforces `menuHeightDeltaPx <= 1` and `activeTabUnderlineGapPx <= 1`. On mobile viewports (`<= 480px` or `pointer: coarse`), [src/ui/expansion-control.ts](../../src/ui/expansion-control.ts#L377-L397) intentionally wraps `.bar` (`block-size: auto`) and enlarges interactive controls to `min-block-size: 44px; min-inline-size: 44px` for WCAG/touch ergonomics — which violates a desktop `<= 1px` height-delta rule unless mobile uses a mobile gate profile.
3. **No touch/coarse-pointer emulation**: `capture.mts` and `p0-gates.spec.ts` call `browser.newContext()` without `hasTouch: true` / `isMobile: true`, so `@media (pointer: coarse)` in `expansion-control.ts` is never exercised even at narrow widths!
4. **Shadow-DOM-only contrast and axe scoping**: `auditShadowContrast()` and `auditAxe()` in `tests/support/visual-audit.ts` hardcode `[data-pikabu-expand-comments]` Shadow DOM hosts and `document.documentElement.hasAttribute("data-theme-dark")`. The extension `popup.html` is regular Light DOM and switches themes via `@media (prefers-color-scheme: dark)` rather than `data-theme-dark`.

### 3.2 Mobile Pikabu Viewports (`390x844`, `412x915`) Architecture

Extend `VisualViewport` in `tests/support/visual-audit.ts` with a layout profile:

```ts
export interface VisualViewport {
  name: string;
  width: number;
  height: number;
  profile: "desktop" | "mobile";
  hasTouch?: boolean;
  isMobile?: boolean;
}

export const VISUAL_VIEWPORTS: readonly VisualViewport[] = [
  { name: "1280x800", width: 1280, height: 800, profile: "desktop" },
  { name: "1024x800", width: 1024, height: 800, profile: "desktop" },
  { name: "390x844", width: 390, height: 844, profile: "mobile", hasTouch: true, isMobile: true },
  { name: "412x915", width: 412, height: 915, profile: "mobile", hasTouch: true, isMobile: true },
];
```

- **Context creation**: Pass `{ hasTouch: viewport.hasTouch ?? false, isMobile: viewport.isMobile ?? false, viewport: { width: viewport.width, height: viewport.height } }` to `browser.newContext(...)` so `@media (pointer: coarse)` and mobile touch semantics activate accurately.
- **Fixture separation**: Add `tests/fixtures/mobile-post-page.html` + `tests/fixtures/pikabu-mobile-theme.css` (aligned with the real mobile Pikabu DOM findings from the parallel mobile-Pikabu research ticket!) and select the fixture pair based on `viewport.profile`.
- **Profile-aware P0 gates**:
  - **Desktop profile**: Keep all existing strict gates unchanged (`menuHeightDeltaPx <= 1`, `maxTabTopDeltaPx <= 1`, `maxTabHeightDeltaPx <= 1`, `activeTabUnderlineGapPx <= 1`, `menuOverflowPx <= 1`, `pageOverflowPx === 0`, `cls === 0`, tokens, axe, contrast).
  - **Mobile profile**:
    - `pageOverflowPx === 0` (zero horizontal page scroll at `390px` and `412px`).
    - Zero right-edge clipping on every visible element inside `[data-pikabu-expand-comments]` (`rect.right <= window.innerWidth` and `rect.left >= 0`).
    - Touch target gate: every visible interactive `button` / `label.settings-option` inside `[data-pikabu-expand-comments]` has `width >= 44 && height >= 44` (or `>= 44` height for full-width rows), matching `expansion-control.ts` mobile rules.
    - Floating Stop clearance: stays inside viewport with safe-area padding (`rect.right <= innerWidth`, `rect.bottom <= innerHeight`).
    - Existing universal gates: `cls === 0`, non-empty Pikabu CSS tokens + light/dark token parity, `axe-core` WCAG 2.1 AA = 0 violations, Shadow DOM contrast = 0 failures.

### 3.3 Extension Toolbar Popup (`popup.html`) Capture & P0 Gates

1. **Loading `popup.html` with full fidelity**:
   - Launch a single persistent Chromium context (`channel: "chromium"`, `args: ["--disable-extensions-except=dist/chrome", "--load-extension=dist/chrome"]`), discover `extensionId` once via CDP (Section 2.1), and open `chrome-extension://${extensionId}/popup.html`.
   - Set viewport to `{ width: 320, height: 260 }` (realistic toolbar popup width; Chrome caps extension popups at `800x600`, and `320px` tests narrow popup wrapping cleanly).
   - Switch themes via `await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })` (`"light"` and `"dark"`).
2. **Generalized contrast & axe helpers in `tests/support/visual-audit.ts`**:
   - Refactor `auditShadowContrast(page)` into a shared `auditContrast(page, options)` accepting `{ rootSelector: string; traverseShadowRoots: boolean; fallbackRootBg: string }`:
     - On-page Pikabu audit calls `auditContrast(page, { rootSelector: "[data-pikabu-expand-comments]", traverseShadowRoots: true, fallbackRootBg: ... })`.
     - Popup audit calls `auditContrast(page, { rootSelector: "body", traverseShadowRoots: false, fallbackRootBg: theme === "dark" ? "rgb(41, 42, 46)" : "rgb(252, 253, 255)" })`.
   - Refactor `auditAxe(page, includeSelector?)` so popup audits run `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()` on the full popup document.
3. **Popup P0 Gates (in `tests/visual/p0-gates.spec.ts` & `tests/visual/capture.mts`)**:
   - **States captured per theme (`light`, `dark`)**: `01-auto-expand-off.png`, `02-auto-expand-on.png`, `03-focus-visible.png` under `tmp/visual-review/popup-light/` and `tmp/visual-review/popup-dark/`, recorded in `tmp/visual-review/metrics.json`.
   - **Geometry & overflow**: `document.documentElement.scrollWidth <= window.innerWidth` (0px horizontal overflow) and rendered height `<= 600px` (Chrome popup ceiling).
   - **Theme parity**: Computed `body` `backgroundColor` and primary text `color` in `dark` must differ from `light` (catches broken `@media (prefers-color-scheme: dark)` rules).
   - **Accessibility & contrast**: 0 `axe-core` WCAG 2.1 AA violations; 0 text (`< 4.5:1`), UI-boundary (`< 3:1`), or `:focus-visible` outline (`< 3:1`) contrast failures.
   - **Interactive persistence**: Keyboard `Tab` + `Space` toggles the checkbox and updates `chrome.storage.local`.

---

## 4. Newly Discovered Risks & Open Fog

1. **Mobile Pikabu DOM/origin coupling**: `tests/fixtures/pikabu-theme.css` and `manifest.json` `content_scripts[].matches` currently assume desktop `https://pikabu.ru/story/*`. If mobile Pikabu serves from `https://m.pikabu.ru/story/*` or uses a distinct comment-header DOM, both `manifest.json` `matches` and `tests/fixtures/mobile-post-page.html` must incorporate the mobile-Pikabu research findings before implementing the mobile visual fixture.
2. **AMO reviewer environment vs Node 26 / pnpm 12**: `.nvmrc` pins Node `26.13.1` and `package.json` pins `pnpm@12.21.0`. AMO's automated/human rebuild environment typically runs Ubuntu LTS with Node LTS. Verify whether `node lib/build.mts` works identically on Node 24 LTS (strip-types is stable there too) and document exact `pnpm` install steps in `AMO_BUILD.md` / Reviewer Notes.
3. **`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` vs `--load-extension`**: If CI or a developer machine sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to branded Google Chrome `137+`, Chromium extension E2E tests will silently fail to load the extension. Extension test fixtures should assert that the extension actually injected (which the CDP discovery probe automatically enforces with a clear timeout error!) and document that `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` must point to unbranded Chromium or Chrome for Testing.
4. **Firefox `storage.onChanged` extra-keys quirk (Bugzilla 1833153)**: Both content script and popup `storage.onChanged` listeners must defensively filter by `areaName === "local"` and ignore unchanged values (`change.newValue === change.oldValue`) to prevent redundant UI re-renders or accidental re-triggers.

---

## Primary Sources

- **Vite 8 & Rolldown**:
  - Vite 8 Migration Guide (Rolldown integration, `rolldownOptions`): https://vite.dev/guide/migration
  - Vite Building for Production (Multi-Page App HTML output paths, `root`, `outDir`, `emptyOutDir`): https://vite.dev/guide/build
  - Rolldown Output Options (`codeSplitting: false` replacing `inlineDynamicImports`, `format: "iife"`): https://rolldown.rs/reference/OutputOptions.codeSplitting
- **Chrome / Chromium WebExtensions & Testing**:
  - Chrome for Developers — Manifest `key` (deterministic IDs & Chrome Web Store public key workflow): https://developer.chrome.com/docs/extensions/reference/manifest/key
  - Chrome for Developers — `chrome.storage` API (MV3 Promises, `storage.local`, `storage.onChanged` in content scripts & popups): https://developer.chrome.com/docs/extensions/reference/api/storage
  - Chrome for Developers — Chrome for Testing & `--load-extension` removal in branded Chrome 137+: https://developer.chrome.com/blog/chrome-for-testing
  - Chromium Source — `components/crx_file/id_util.cc` (SHA-256 `a`–`p` unpacked extension ID derivation): https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/id_util.cc
  - Chrome DevTools Protocol — `Runtime.executionContextCreated`: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#event-executionContextCreated
- **Playwright**:
  - Playwright Official Docs — Chrome Extensions (`launchPersistentContext`, `channel: "chromium"`, headless support): https://playwright.dev/docs/chrome-extensions
  - Playwright GitHub Issues — Firefox extension support tracking: https://github.com/microsoft/playwright/issues/7297 and https://github.com/microsoft/playwright/issues/26995
- **Mozilla / Firefox / AMO**:
  - MDN — Chrome incompatibilities (`browser` vs `chrome` namespaces & Promises): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities
  - MDN — `storage.onChanged` & `storage.local.onChanged` (including Firefox Bug 1833153 quirk): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged
  - MDN — `browser_specific_settings` (`gecko`, `gecko_android`, `data_collection_permissions`): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
  - Mozilla Extension Workshop — Source code submission & deterministic rebuilds: https://extensionworkshop.com/documentation/publish/source-code-submission/
  - Mozilla Extension Workshop — Firefox built-in data collection consent (`data_collection_permissions`): https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
  - Mozilla Extension Workshop — `web-ext` command reference (`lint`, `run`): https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
  - W3C WebDriver BiDi — `webExtension` module (`webExtension.install`): https://w3c.github.io/webdriver-bidi/#module-webExtension
- **TypeScript, Oxlint & Deterministic Archives**:
  - TypeScript Docs — `exactOptionalPropertyTypes`: https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes
  - Oxlint Configuration (`env`, `globals`, `overrides`): https://oxc.rs/docs/guide/usage/linter/config.html
  - Reproducible Builds — Archives (deterministic ZIP sorting, timestamps, permissions): https://reproducible-builds.org/docs/archives/
  - Git Documentation — `git-archive`: https://git-scm.com/docs/git-archive
