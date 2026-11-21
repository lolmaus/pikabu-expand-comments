# Research: Build Toolchain, Mobile Extension Constraints, and Agent Testing Harness

Research findings for issue #4 covering:

1. Single-package multi-target build toolchain (Iteration 1 userscript -> Iteration 2 Chrome & Firefox MV3 extensions).
2. Mobile-compatible Chrome and Firefox extension constraints and the Iteration 1 architectural boundaries they dictate.
3. Agent testing harness (deterministic fixture tests + live end-to-end verification of the built `.user.js`) mapped to this repository's `tsconfig.*.json` conventions.

## Current Repository Baseline

The repository is a single-package ESM (`"type": "module"`) pnpm codebase configured with:

- Node `26.13.1` (`.nvmrc`), `@types/node` `26.6.6`, pnpm `12.21.0` (`package.json` `devEngines`).
- TypeScript `7.0.2` (`tsgo`), `oxlint` `1.94.0`, `oxfmt` `0.79.0`, `lefthook` `2.2.2`, and `@commitlint/cli` `21.2.4`.
- Strict shared compiler settings in `tsconfig.base.json` (`strict`, `isolatedModules`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noUncheckedSideEffectImports`, `noEmit: true`) extended by environment-specific leaf configs (`tsconfig.node.json` currently, with `tsconfig.browser.json`, `tsconfig.vitest.json`, and `tsconfig.playwright.json` added only when their source trees exist).

---

## 1. Single-Package Multi-Target Build Toolchain

### Options Compared

| Criterion                                                 | Vite + `vite-plugin-monkey`                                                                                                                                          | WXT                                                                                                                                                                | Programmatic Vite 8 (Rolldown) + custom banner                                                                                 | Standalone Rolldown or esbuild + custom banner                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Emits `.user.js` (Iteration 1)**                        | Yes (native)                                                                                                                                                         | **No** (browser extensions only; centered on `manifest.json` + `entrypoints/`)                                                                                     | Yes (`build.lib` IIFE + `rolldownOptions.output.postBanner`)                                                                   | Yes (`format: 'iife'` + Rolldown `output.postBanner` or esbuild `banner.js`)                                               |
| **Emits Chrome + Firefox MV3 (Iteration 2)**              | **No** (userscript-only; requires a second tool or replacement)                                                                                                      | Yes (first-class `-b chrome`, `-b firefox --mv3`, `--firefox-compatibility`)                                                                                       | Yes (sequential `vite.build()` calls for content IIFE, optional background ESM, HTML popup/options, generated `manifest.json`) | Partial (bundles JS/TS fast, but HTML/CSS popup & options pages need extra glue)                                           |
| **Compatibility with Vite 8 / Rolldown & Node 26 / TS 7** | Medium risk: plugin hooks tightly into Vite/Rollup chunking; peer dependency ranges and Rolldown comment-stripping behavior have required patches across Vite majors | Medium risk: pins its own Vite lifecycle and relies on `wxt prepare` codegen                                                                                       | High: first-party Vite 8 + Rolldown APIs (`build.rolldownOptions`, `postBanner`)                                               | Very high: tiny API surface, zero framework coupling; Rolldown is from the same Oxc/VoidZero ecosystem as `oxlint`/`oxfmt` |
| **Fit with our multi-leaf `tsconfig.*.json` + Oxlint**    | Good (no tsconfig takeover)                                                                                                                                          | Poor: `wxt prepare` generates `.wxt/tsconfig.json` and uses `unimport` auto-imports (implicit globals), clashing with explicit imports and our strict leaf configs | Excellent: `lib/build.mts` typechecked under `tsconfig.node.json`; `src/` stays pure strict TS                                 | Excellent: `lib/build.mts` typechecked under `tsconfig.node.json`; `src/` stays pure strict TS                             |
| **Overlap with Vitest**                                   | Shares Vite                                                                                                                                                          | Shares Vite (with WXT plugin)                                                                                                                                      | Shares the exact Vite dependency Vitest already installs                                                                       | Adds a second bundler alongside Vitest's Vite                                                                              |

### Primary-Source Evidence

- **`vite-plugin-monkey`**: Designed strictly for userscripts (`.user.js` metadata generation, `@grant` detection, `@require` CDN externalization, and dev-server hot-install). It does not build WebExtensions, and its chunk-manipulation hooks have faced compatibility friction as Vite transitions from Rollup to Rolldown (including comment/banner stripping and peer-dependency updates).
  - Sources: [lisonge/vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey), [vite-plugin-monkey issues](https://github.com/lisonge/vite-plugin-monkey/issues).
- **WXT**: Built on Vite with file-based `entrypoints/` (`background.ts`, `content.ts`, `popup/index.html`), automatic `manifest.json` generation, multi-browser targets (`wxt build -b firefox --mv3`), and `--firefox-compatibility "firefox,android"`. However, WXT does not target standalone `.user.js` userscripts, generates `.wxt/tsconfig.json` (which root `tsconfig.json` is expected to extend), and enables `unimport` auto-imports by default.
  - Sources: [WXT Documentation](https://wxt.dev/), [WXT Entrypoints](https://wxt.dev/guide/essentials/entrypoints.html), [WXT Target Browsers](https://wxt.dev/guide/essentials/target-browsers.html), [WXT TypeScript Config](https://wxt.dev/guide/essentials/config/typescript.html), [WXT Auto-imports](https://wxt.dev/guide/essentials/config/auto-imports.html).
- **Vite 8 (Rolldown) & Standalone Rolldown / esbuild**:
  - Vite 8 replaces the split esbuild + Rollup pipeline with **Rolldown** + Oxc, introducing `build.rolldownOptions` (deprecating `build.rollupOptions` while keeping an alias) and updating default browser baselines to modern targets (Chrome/Edge >= 111, Firefox >= 114, Safari >= 16.4).
  - Rolldown exposes both `output.banner` (inserted _before_ `renderChunk` and _before_ minification, where standard `//` comments can be stripped unless marked as legal comments) and **`output.postBanner`** (inserted _after_ `renderChunk` and _after_ minification — ideal for preserving a `// ==UserScript==` metadata block verbatim even when minification is enabled).
  - `esbuild` similarly supports `format: 'iife'` with `banner: { js: '...' }`, injecting the banner verbatim at the top of the bundle without requiring a `globalName` when the entry has no exports.
  - Sources: [Vite Building for Production / Library Mode](https://vite.dev/guide/build.html), [Vite 8 Migration Guide](https://vite.dev/guide/migration.html), [Rolldown Output Options (`banner` / `postBanner` / `format`)](https://rolldown.rs/), [esbuild API — `banner`](https://esbuild.github.io/api/#banner), [esbuild API — `format: iife`](https://esbuild.github.io/api/#format-iife).

### Recommendation: Programmatic Vite 8 (Rolldown) Build Script (`lib/build.mts`)

Use **Vite (8.x, backed by Rolldown)** invoked programmatically from a small Node script (`lib/build.mts`, checked by `tsconfig.node.json`) with a typed userscript metadata serializer (`src/targets/userscript/metadata.ts`):

1. **Single bundler dependency**: Vitest already pulls Vite into `devDependencies`; using Vite's programmatic `build()` avoids maintaining two bundlers.
2. **Safe userscript header preservation**: Emit `dist/userscript/pikabu-expand-comments.user.js` as a single self-contained IIFE (`formats: ['iife']`, `inlineDynamicImports: true`, `rolldownOptions.output.postBanner` for the `// ==UserScript==` header). Note: `build.lib` requires a `name` when `formats` includes `'iife'`; keep the userscript entrypoint side-effect-only (no exports) and verify the emitted wrapper does not leak globals or trigger minifier stripping. (If readable output is preferred for Greasy Fork / code review, disable minification on the userscript target via `build.minify: false`.)
3. **Zero-friction Iteration 2 extension targets**: The same `lib/build.mts` script can add `chrome` and `firefox` targets via sequential `vite.build()` calls:
   - Bundle the content script as a self-contained IIFE (MV3 content scripts declared in `manifest.json` run as classic scripts, not native ES modules).
   - Bundle optional popup/options HTML entrypoints natively through Vite's standard HTML/CSS pipeline.
   - Emit per-browser `manifest.json` from a shared TypeScript manifest builder (eliminating Chrome vs. Firefox manifest warnings).
4. **Clean module layout in a single package**:
   - `src/core/` — Pure Expansion Run state machine, retry/backoff/concurrency control, settings schema (including Auto-Expand on Visit), and abstract port interfaces (`StoragePort`, `PostPageAdapter`, `LoggerPort`). Zero DOM, `GM.*`, or WebExtension API dependencies.
   - `src/adapters/pikabu/` — Pikabu Post Page DOM adapter: finding Comment Batch loaders and Reply Branch loaders, triggering them, and observing DOM updates. Standard DOM APIs only; zero `GM.*` or `chrome.*`/`browser.*` dependencies.
   - `src/targets/userscript/` — Thin userscript bootstrap: `GM.*`-backed `StoragePort`, menu command / minimal control wiring, and `// ==UserScript==` metadata block definition.
   - `src/targets/extension/` (Iteration 2) — Thin MV3 content script bootstrap (`storage.local`-backed `StoragePort`), responsive popup/options UI, and Chrome/Firefox manifest definitions.
5. **Low-cost fallback**: Because build orchestration lives in a small `lib/build.mts` file, if Vite 8 + Vitest 4 ever hits a peer-dependency or `build.lib` IIFE quirk under `typescript@7.0.2` / `pnpm@12`, swapping the JS bundling step to standalone `rolldown` or `esbuild` is an isolated one-file change. Revisit WXT in Iteration 2 only if extension-specific workflow needs (store auto-submission, multi-surface HMR) outweigh its `.wxt/tsconfig.json` / auto-import coupling.

---

## 2. Mobile-Compatible Chrome & Firefox Extension Constraints

### Platform Realities (Primary Sources)

#### Firefox for Android (MV3)

- **Mandatory manifest keys**:
  - `browser_specific_settings.gecko.id` is **required** for all Firefox MV3 extensions (AMO submission and self-distribution).
  - `browser_specific_settings.gecko_android` (e.g., `{ "strict_min_version": "120.0" }` or `{}`) is **required** for AMO and `web-ext sign` to mark the extension compatible with Firefox for Android; omitting it marks the add-on desktop-only.
  - Sources: [MDN — `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings), [Firefox Extension Workshop — Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).
- **Static Android compatibility linting**: Mozilla's `web-ext lint` reads `gecko_android.strict_min_version` and reports `ANDROID_INCOMPATIBLE_API`, `PERMISSION_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, and `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`.
  - Source: [Firefox Extension Workshop — Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).
- **Background execution divergence (MV3)**: Firefox MV3 does **not** support `background.service_worker` (Mozilla bug 1573659); it uses non-persistent event pages via `background.scripts`. Chromium MV3 requires `background.service_worker`. Cross-browser manifests targeting Firefox 121+ and Chromium 121+ can declare both keys, or per-browser builds can emit only the target's key.
  - Source: [MDN — `manifest.json/background`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).
- **APIs unsupported on Firefox for Android**:
  - `menus` / `contextMenus`
  - `commands` (keyboard shortcuts)
  - `sidebar_action`
  - `omnibox`, `chrome_url_overrides`, `chrome_settings_overrides`
  - Desktop windowing and native-messaging integrations
  - Sources: [Firefox Extension Workshop — Differences between desktop and Android extensions](https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/), [MDN — WebExtensions API compatibility](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities).
- **APIs supported on Firefox for Android that fit our extension**:
  - `content_scripts` (isolated world with DOM access).
  - `storage.local` (fully supported; persists even when browsing history/site data is cleared). Note: `storage.sync` has stricter quotas and mobile account-sync caveats, so prefer `storage.local` for local settings like Auto-Expand on Visit.
  - `action` (browser action popup surfaced through Firefox for Android's Extensions menu) and `options_ui` (supported since Firefox for Android 57; `options_page` since 126). Popups/options must work on mobile viewports (~360 x 640 dp) with touch-sized controls.
  - Sources: [MDN — `storage` API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage), [Firefox Extension Workshop — Differences between desktop and Android extensions](https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/).

#### Chrome & Chromium-Based Mobile Browsers

- **Google Chrome for Android**: Does not support browser extensions.
- **Chrome MV3 Desktop / Chromium Baseline**:
  - Content scripts execute in an **isolated world**: they share the page's DOM but do **not** share JavaScript variables, prototypes, or globals with the host page.
  - Service workers are event-driven, have **no DOM access**, and terminate after ~30 seconds of idle time — in-memory globals are wiped on termination.
  - `chrome.storage` is asynchronous and returns **Promises** natively in MV3; content scripts can read and write `chrome.storage.local` directly without routing through a service worker. `storage.local` has a 10 MB default quota; `storage.sync` is capped at ~100 KB total / ~8 KB per item.
  - `window.localStorage` inside a content script accesses the **host website's** storage (not extension storage) and is unavailable in service workers.
  - Both modern Chromium MV3 and Firefox MV3 support Promise-based APIs (and modern Chrome has converged on the `browser` namespace as well), minimizing or eliminating the need for `webextension-polyfill` on modern targets.
  - Sources: [Chrome Developers — Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome Developers — Extension service worker basics](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics), [Chrome Developers — Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Chrome Developers — `chrome.storage` API](https://developer.chrome.com/docs/extensions/reference/api/storage), [Chrome Developers — Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [MDN — Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities).
- **Microsoft Edge for Android**: Uses the Chromium MV3 extension platform (distributed via Microsoft Partner Center / Edge Add-ons). Android extension support has been rolling out progressively (initially via Canary/Dev flags and developer options), and Microsoft integrated Kiwi Browser's extension-support code into Edge for Android.
  - Sources: [Microsoft Learn — Edge Extensions overview](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/), [Microsoft Learn — Supported APIs](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/supported-apis), [Microsoft Learn — Manifest V3 timeline](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/getting-started/manifest-v3-timeline).
- **Kiwi Browser & Quetta Browser**:
  - **Kiwi Browser** (`kiwibrowser/src.next`) has been **officially archived**; its developer partnered with Microsoft Edge and directed users to Edge Canary for Android. Do not add Kiwi-specific workarounds.
  - **Quetta Browser** (and similar Chromium Android forks) installs standard Chrome Web Store / Edge Add-ons MV3 packages inside a mobile UI, inheriting the same mobile constraints (touch UI, narrow popup width, no desktop shortcuts/hover/sidebars).
  - Sources: [kiwibrowser/src.next](https://github.com/kiwibrowser/src.next), [Quetta Browser](https://www.quetta.net/).

### Iteration 1 Architectural Boundaries for a Painless Iteration 2

To make Iteration 2 a thin wrapper around Iteration 1's code (with zero rewrites of `core` or `pikabu`):

1. **Async-only `StoragePort` (`Promise<T>`)**:
   - Define `StoragePort` with `get<T>(key, fallback): Promise<T>` and `set<T>(key, value): Promise<void>`.
   - Iteration 1 implements it with Greasemonkey 4+ / Violentmonkey / Tampermonkey **`GM.getValue`** and **`GM.setValue`** (Promise-based, explicitly declared via `@grant GM.getValue` and `@grant GM.setValue`). Avoid synchronous `GM_getValue` and never use host-page `window.localStorage`.
   - Iteration 2 swaps in `browser.storage.local` / `chrome.storage.local` (directly from the content script and popup/options pages).
   - Sources: [Violentmonkey — GM APIs](https://violentmonkey.github.io/api/gm/), [Violentmonkey — Metadata Block](https://violentmonkey.github.io/api/metadata-block/), [Tampermonkey Documentation](https://www.tampermonkey.net/documentation.php).
2. **Strict isolated-world discipline (no `unsafeWindow`, no host JS globals)**:
   - Declaring `@grant GM.getValue` (anything other than `@grant none`) runs the userscript inside a sandbox isolated from the host page's JS globals — matching MV3 content scripts' isolated world.
   - The Pikabu adapter must interact exclusively with the standard DOM (`querySelectorAll`, `MutationObserver`, element `.click()`, standard attributes/text). Never rely on `unsafeWindow`, Pikabu's internal JS objects, or monkey-patching `window.fetch` in the page world.
3. **No background-script dependency for core behavior**:
   - Keep all Expansion Run runtime state inside the active Post Page content context and persist only lightweight preferences (e.g., Auto-Expand on Visit) via `StoragePort`.
   - Because content scripts and popup/options pages can all access `storage.local` directly, Iteration 2 likely needs **no background script at all** — completely sidestepping MV3 service worker 30s idle eviction and Chrome `service_worker` vs. Firefox `scripts` differences.
4. **Zero desktop-only APIs or UX assumptions**:
   - Do not depend on `contextMenus`/`menus`, `commands` (keyboard shortcuts), `sidebar_action`, or hover-only controls.
   - Keep any injected control or popup/options UI minimal, touch-friendly, and functional at 360px width.
5. **Surface caveat — Mobile Pikabu DOM**:
   - `GLOSSARY.md` currently defines **Post Page** as a _desktop_ Pikabu.ru page. On Android browsers (Firefox for Android, Edge Android, Quetta), Pikabu may serve a mobile DOM layout unless the user enables desktop mode. Keeping `PostPageAdapter` as an interface behind `src/adapters/pikabu/` ensures Iteration 2 can add or extend mobile selectors without touching `src/core/`.

---

## 3. Agent Testing Harness

### Tier 1: Deterministic Unit & DOM-Fixture Tests (Vitest)

#### Environment Comparison

| Environment                                            | Engine                           | Speed                    | Fidelity                                                                       | Best Fit Here                                                                                                                           |
| ------------------------------------------------------ | -------------------------------- | ------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Vitest (`node`)**                                    | Node.js                          | Fastest (<1s)            | No DOM                                                                         | `src/core/` pure Expansion Run state machine, backoff/retry, settings & fake `StoragePort`                                              |
| **Vitest (`jsdom`)**                                   | Node.js + WHATWG DOM/HTML in JS  | Fast                     | Strong HTML/DOM & `MutationObserver` spec compliance; no real layout/CSS paint | **`src/adapters/pikabu/` deterministic HTML-fixture tests** (sanitized Post Page snapshots, Comment Batch & Reply Branch DOM mutations) |
| **Vitest (`happy-dom`)**                               | Node.js + lightweight DOM        | Very fast (2–4x `jsdom`) | Occasional spec edge-case gaps; no real layout/CSS paint                       | Optional speed swap later if `jsdom` ever becomes slow (unlikely for a small suite)                                                     |
| **Vitest Browser Mode (`@vitest/browser-playwright`)** | Real Chromium via Playwright/CDP | Medium                   | Real browser layout, visibility, CSS selectors, native APIs                    | Overkill as a separate runner here when Playwright (`@playwright/test`) is already required for Tier 2                                  |

Sources: [Vitest — Test Environment](https://vitest.dev/guide/environment.html), [Vitest — Browser Mode](https://vitest.dev/guide/browser/).

**Recommendation for Tier 1**: Use **Vitest** with two lightweight environments (via Vitest `projects` or per-file `@vitest-environment jsdom` annotations): `node` for `src/core/` and `jsdom` for `src/adapters/pikabu/` HTML fixtures. Do **not** add Vitest Browser Mode on top of Playwright — two runners (Vitest for millisecond unit/DOM-fixture TDD, Playwright for real-browser bundle & live E2E) keep dependencies and agent feedback loops lean.

### Tier 2: Real-Browser Bundle & Live E2E Verification (Playwright)

Use **`@playwright/test`** for two distinct test suites:

1. **Deterministic Bundled-Artifact E2E (`pnpm run test:e2e`, CI-safe)**:
   - Serves sanitized Post Page HTML fixtures and intercepts Comment Batch / Reply Branch API requests with `page.route(...)` so the test never touches the network.
   - Injects a tiny **`GM.*` test shim** (`GM.getValue`, `GM.setValue`, `GM.registerMenuCommand` backed by an in-memory `Map` + inspection hook) via `page.addInitScript()`.
   - Injects the **actual built `dist/userscript/pikabu-expand-comments.user.js`** artifact and verifies real-browser rendering, visibility, `MutationObserver`, real click dispatch, Expansion Run completion, and Auto-Expand on Visit persistence across page reloads.
2. **Live Pikabu Smoke Verification (`pnpm run test:live`, opt-in / agent-driven, excluded from default CI)**:
   - Navigates Chromium to real public Pikabu Post Page URLs with the `GM.*` shim + built `.user.js` bundle to verify that live Pikabu DOM selectors and Comment Batch / Reply Branch loading still work against production markup.

#### Crucial Playwright Timing & Sandbox Mechanics

- **`page.addInitScript()` runs at `document-start`** (after the document is created, _before_ any page scripts execute and _before_ `DOMContentLoaded`). It persists across reloads and navigations.
  - Inject the `GM.*` shim with `page.addInitScript()` first so `GM` is guaranteed present before the userscript executes.
  - Make the userscript bootstrap itself `document.readyState`-aware (`if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();`). That way `page.addInitScript({ path: 'dist/userscript/pikabu-expand-comments.user.js' })` works cleanly for both initial navigation and `page.reload()` (essential for testing Auto-Expand on Visit!) without needing fragile `addScriptTag` timing after `page.goto`.
  - Source: [Playwright — `page.addInitScript`](https://playwright.dev/docs/api/class-page#page-add-init-script).
- **Main-world caveat in `addInitScript`**: Unlike Tampermonkey/Violentmonkey's `@grant` sandbox or an MV3 content script's isolated world, `page.addInitScript` executes in the page's main world. Enforce isolated-world discipline statically via TypeScript (no host-page global types) and Vitest unit fixtures so the userscript never depends on page globals.
- **Iteration 2 Extension E2E Continuity**:
  - Playwright supports testing unpacked Chromium MV3 extensions (including headless mode via `channel: 'chromium'`) using `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=...', '--load-extension=...'] })`.
  - The same Playwright fixture tests and live smoke assertions carry directly into Iteration 2 by swapping the `addInitScript` userscript fixture for a `launchPersistentContext` extension fixture.
  - For Firefox MV3 (desktop & Android), Playwright does not offer the same unpacked-extension flag workflow; pair Playwright's Chromium E2E with Mozilla's `web-ext lint` (CI) and `web-ext run` (manual/device smoke check).
  - Source: [Playwright — Chrome Extensions](https://playwright.dev/docs/chrome-extensions).

### Mapping to Repository `tsconfig.*.json` Conventions

Following `.agents/skills/lolmaus-repo-boilerplate/SKILL.md` (create configs only as their directories are introduced; keep `tsconfig.base.json` environment-agnostic; run `tsc --noEmit --project <leaf>` for every active leaf config):

| Config File                | Extends                       | Key `compilerOptions`                                                                                                                                                                                 | `include` / `exclude`                                                           | Role                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.base.json`       | —                             | Existing strict flags (`noEmit: true`, `strict`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, etc.)                                                              | None                                                                            | Shared compiler baseline                                                                                                                                                                                                                                                                                    |
| `tsconfig.node.json`       | `./tsconfig.base.json`        | `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `types: ["node"]`, `allowImportingTsExtensions: true`, `erasableSyntaxOnly: true`                                                               | `["*.mts", "lib/**/*.ts", "lib/**/*.mts", "lib/**/*.cts"]`                      | Root configs (`vite.config.mts`, `vitest.config.mts`, `playwright.config.mts`, `oxlint.config.mts`, `oxfmt.config.mts`, `commitlint.config.mts`) and `lib/build.mts`                                                                                                                                        |
| `tsconfig.browser.json`    | `./tsconfig.base.json`        | `target: "ESNext"`, `lib: ["ESNext", "DOM", "DOM.Iterable"]`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `types: []`, `erasableSyntaxOnly: true`                                              | `include: ["src/**/*.ts"]`, `exclude: ["src/**/*.test.ts"]`                     | Production browser code (`core`, `adapters/pikabu`, `targets/*`). Keeping `types: []` prevents accidental ambient Node/Vitest/GM globals from leaking into `src/core/` and `src/adapters/pikabu/`; scope `GM.*` / `chrome.*` type imports or narrow ambient `.d.ts` bindings strictly inside `src/targets/` |
| `tsconfig.vitest.json`     | `./tsconfig.browser.json`     | Overrides `types: ["node"]` (import `describe`/`it`/`expect`/`vi` explicitly from `"vitest"` to stay compatible with `verbatimModuleSyntax` and `oxlint`)                                             | `include: ["src/**/*.ts"]`, `exclude: []` (overrides inherited test exclusion!) | Vitest unit & `jsdom` DOM-fixture tests (`src/**/*.test.ts`)                                                                                                                                                                                                                                                |
| `tsconfig.playwright.json` | `./tsconfig.base.json`        | `target: "ESNext"`, `lib: ["ESNext", "DOM", "DOM.Iterable"]`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `types: ["node"]`, `allowImportingTsExtensions: true`, `erasableSyntaxOnly: true` | `include: ["tests/**/*.ts"]`                                                    | Playwright fixture E2E & live smoke tests (`tests/e2e/`, `tests/live/`). `DOM` lib is needed for browser callbacks inside `page.evaluate` / `page.addInitScript`                                                                                                                                            |
| `tsconfig.json`            | Solution config (`files: []`) | —                                                                                                                                                                                                     | `references` pointing to each active leaf config                                | Editor project graph (only switch to solution form once `src/` exists)                                                                                                                                                                                                                                      |

**`typecheck` script** (per [TypeScript Project References docs](https://www.typescriptlang.org/docs/handbook/project-references.html) and repo conventions — plain `tsc` on an empty solution does not check references, and `tsc --build` rejects `noEmit: true`):

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit --project tsconfig.node.json && tsc --noEmit --project tsconfig.browser.json && tsc --noEmit --project tsconfig.vitest.json && tsc --noEmit --project tsconfig.playwright.json"
  }
}
```

---

## Summary of Concrete Decisions & Newly Surfaced Fog

### Recommended Decisions

1. **Build toolchain**: Use **Vite 8 (Rolldown)** via a thin programmatic Node build script (`lib/build.mts`) with `rolldownOptions.output.postBanner` for the `// ==UserScript==` metadata block — one bundler shared with Vitest, clean `.user.js` IIFE output in Iteration 1, and direct Chrome + Firefox MV3 target generation in Iteration 2 without WXT's `.wxt/tsconfig.json`/auto-import takeover.
2. **Iteration 1 -> Iteration 2 mobile-safe boundaries**: Enforce `src/core/` (pure state machine + async `StoragePort`), `src/adapters/pikabu/` (DOM-only, isolated-world safe, no `unsafeWindow`), and `src/targets/userscript/` (`GM.getValue`/`GM.setValue`, no `localStorage`, no desktop-only APIs). Iteration 2 will declare `browser_specific_settings.gecko.id` + `gecko_android`, use `storage.local` directly from content/popup/options (likely needing no background script), and validate with `web-ext lint`.
3. **Agent testing harness**: Two-tier setup — **Vitest (`node` + `jsdom`)** for sub-second unit and sanitized HTML-fixture tests, plus **Playwright (`@playwright/test`)** injecting a `GM.*` shim and the built `.user.js` bundle via `page.addInitScript()` (with `document.readyState`-safe bootstrap) for both offline mocked E2E and opt-in live Pikabu smoke tests.

### Open Questions / Newly Surfaced Fog

- **Mobile Pikabu DOM layout**: `GLOSSARY.md` scopes **Post Page** to desktop Pikabu.ru. When Iteration 2 targets Firefox for Android and Edge Android, Pikabu may serve a different mobile DOM structure unless desktop mode is enabled; we will need a dedicated mobile Pikabu DOM inspection before shipping mobile extensions.
- **Exact Vite 8 + Vitest 4 + `typescript@7.0.2` (`tsgo`) version matrix**: Before scaffolding build/test dependencies, verify the exact compatible versions of `vite`, `vitest`, `jsdom`, and `@playwright/test` under Node `26.13.1` and `pnpm@12.21.0` (with standalone `rolldown` or `esbuild` as an immediate zero-architecture-change fallback for `lib/build.mts` if Vite 8's Rolldown `build.lib` IIFE mode hits any edge case).
