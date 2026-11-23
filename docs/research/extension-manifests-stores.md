# Research: MV3 Manifests, Cross-Browser Compatibility, and Store Publishing (CWS, AMO, Edge Android)

> **Ticket:** [#31](https://github.com/lolmaus/pikabu-expand-comments/issues/31) (Map [#29](https://github.com/lolmaus/pikabu-expand-comments/issues/29))  
> **Scope:** Target architecture for packaging, localizing, and publishing `pikabu-expand-comments` as a Manifest V3 browser extension for Chrome, Firefox (desktop & Android), and Edge for Android alongside the existing userscript release pipeline.

---

## Executive Summary

1. **Minimal, zero-background MV3 works across Chrome, Firefox desktop, Firefox for Android, and Edge.** Static `content_scripts` matching `https://pikabu.ru/story/*` plus `"permissions": ["storage"]` and an `action.default_popup` require **neither** `host_permissions` **nor** a `"background"` service worker.
2. **Generate target-specific manifests at build time from `package.json`.** Chrome warns on `browser_specific_settings`, while Firefox AMO **requires** `browser_specific_settings.gecko.id` and `data_collection_permissions: { "required": ["none"] }` (mandatory for all new AMO extensions since November 3, 2025). Generating `dist/chrome/manifest.json` and `dist/firefox/manifest.json` at build time keeps both packages warning-free and uses `package.json` as the single Release Please version source.
3. **Chrome Web Store API v1.1 was shut down on October 15, 2026.** CI automation must target **Chrome Web Store API v2** (`chromewebstore.googleapis.com/v2/...`), which adds mandatory `publisherId` paths and native **Google Cloud Service Account** support (enabling secretless GitHub Actions OIDC via Workload Identity Federation).
4. **Firefox AMO requires source-code archive submission for TypeScript/Vite builds** on both `listed` and `unlisted` channels, with reproducible Ubuntu/Node build instructions and no non-deterministic build timestamps inside extension outputs.
5. **Version strings must stay strict numeric `MAJOR.MINOR.PATCH`** (`0..65535` integers, no `-alpha`/`-beta` suffixes) to satisfy both CWS and AMO simultaneously; Release Please's default `node` versioning already produces compliant `X.Y.Z` strings.

---

## 1. Manifest V3 Differences (Chrome, Firefox Desktop, Firefox for Android, Edge for Android)

### 1.1 `browser_specific_settings.gecko` & `gecko_android`

Firefox requires Gecko-specific metadata under `browser_specific_settings` in `manifest.json`:

```json
"browser_specific_settings": {
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

- **`gecko.id` format:** Mandatory for MV3 extensions submitted to AMO or relying on `storage.local` persistence. Must be ≤ 80 characters and either an email-like string (recommended, e.g., `pikabu-expand-comments@lolmaus.github.io`; avoid real inboxes) or a braced GUID (`{uuid}`).  
  _Primary source:_ [MDN — `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)
- **`strict_min_version` baselines:**
  - **Firefox 127+** (desktop & Android) is the minimum version where static `content_scripts.matches` and `host_permissions` in MV3 are shown and **granted automatically on install** (in Firefox 109–126, MV3 host permissions were opt-in post-install).
  - **Firefox 140.0** (desktop) and **Firefox 142.0** (Android) introduced built-in `data_collection_permissions` consent UI support. Setting `gecko.strict_min_version: "140.0"` and `gecko_android.strict_min_version: "142.0"` aligns with Firefox's current ESR 140+ baseline and satisfies `addons-linter` checks for `data_collection_permissions`.
  - If `gecko_android` is omitted, desktop constraints/defaults cascade to Android; declaring `gecko_android` explicitly documents verified Android compatibility.  
    _Primary sources:_ [MDN — `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings), [Firefox Extension Workshop — Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/), [Firefox Extension Workshop — Built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- **Chrome handling of `browser_specific_settings`:** Chrome ignores the key and emits a non-fatal "Unrecognized manifest key" warning when loaded unpacked or uploaded. Stripping `browser_specific_settings` from the Chrome/Edge manifest at build time avoids the warning entirely.  
  _Primary source:_ [MDN — `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

### 1.2 Firefox AMO Mandatory `data_collection_permissions`

- Effective **November 3, 2025**, Mozilla requires all **new extensions** submitted to AMO to declare data collection and transmission practices via `browser_specific_settings.gecko.data_collection_permissions`. AMO validation rejects new extensions omitting this key.
- Extensions that collect or transmit **zero data** must explicitly set `"required": ["none"]`. The `"none"` token is exclusive and cannot be combined with any other category.
- Firefox displays the declaration natively in the install prompt, in `about:addons` (_Permissions and data_ tab), and on the public AMO listing page.
- Because `pikabu-expand-comments` collects no data, no custom fallback consent dialog is required for older Firefox versions (and pinning `strict_min_version` to `140.0` / `142.0` makes it moot).  
  _Primary sources:_ [Firefox Extension Workshop — Firefox built-in consent for data collection and transmission](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [MDN — `browser_specific_settings`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

### 1.3 `action.default_popup` on Firefox for Android vs. Desktop

- **Support:** The MV3 `action` key and `action.default_popup` have full support on **Firefox for Android 109+** (replacing MV2 `browser_action`).  
  _Primary source:_ [MDN — `manifest.json/action`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/action)
- **Mobile UX & layout constraints:**
  - On desktop Chrome/Firefox, the popup opens anchored to the toolbar button. On Firefox for Android, users open it from the browser's Extensions menu, and it renders inside the mobile viewport constraints.
  - Popup HTML **must** include `<meta name="viewport" content="width=device-width, initial-scale=1.0">`, fluid widths (avoid fixed wide desktop-only dimensions that clip or scroll horizontally on ~360px screens), and touch-sized controls.
  - **Debugging caveat:** Direct DevTools inspection of mobile popups on Fenix is limited; Extension Workshop recommends opening the popup page directly in a browser tab during remote debugging (`about:debugging`) to inspect layout/styles.  
    _Primary source:_ [Firefox Extension Workshop — Developing extensions for Firefox for Android](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)

### 1.4 `content_scripts.matches` vs. `host_permissions`

- **`host_permissions` is NOT required** when an extension only injects static `content_scripts` and uses `storage` (e.g., an Expansion Run on a Pikabu Post Page plus a popup toggling **Auto-Expand on Visit** in `storage.local`).
- Static `content_scripts.matches` (`["https://pikabu.ru/story/*"]`) grants injection permission on matching pages in both Chrome MV3 and Firefox MV3 without duplicating the pattern into `host_permissions`. `host_permissions` is only needed for programmatic APIs (`scripting.executeScript`, `cookies`, reading `tabs` URLs/titles, or cross-origin `fetch` from extension pages/workers).
- **Install prompts & updates:**
  - In **Chrome MV3**, both `content_scripts.matches` and `host_permissions` surface site-access install warnings; omitting `host_permissions` keeps permissions minimal for store review.
  - In **Firefox 127+**, both `content_scripts.matches` and `host_permissions` are shown in the install prompt and **granted automatically on install**. Users can still revoke/manage host access per site in `about:addons`.
  - **Important Firefox update caveat:** Adding _new_ host patterns in a later extension update does not automatically prompt existing users in Firefox (tracked in Bug 1893232). Decide upfront whether mobile Pikabu URLs (e.g., `https://m.pikabu.ru/story/*` or mobile-UA desktop URLs) are in scope before initial AMO launch.  
    _Primary sources:_ [Chrome for Developers — Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [Chrome for Developers — Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [MDN — `manifest.json/host_permissions`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions), [MDN — `manifest.json/content_scripts`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)

### 1.5 `storage.local` + `storage.onChanged` Without a Background Service Worker

- **No `"background"` key needed:** The `"background"` manifest key is optional in MV3 on both Chrome and Firefox. Content scripts and popup pages can access `storage.local` and listen to `storage.onChanged` directly with only `"permissions": ["storage"]`.
- **Direct cross-context sync:** When the popup updates **Auto-Expand on Visit** via `storage.local.set()`, every open Post Page content script subscribed to `storage.onChanged` receives the update automatically—eliminating service worker lifecycle complexity and `runtime.sendMessage` boilerplate.
- **Persistence:** Unlike page `localStorage` (which browsers may clear with browsing data), `storage.local` persists until the extension is uninstalled.
- **Firefox `storage.onChanged` quirk:** MDN warns that Firefox may deliver keys in the `changes` object whose value did not actually change when `storage.local.set()` is invoked; listeners must guard with `change.oldValue !== change.newValue`.  
  _Primary sources:_ [Chrome for Developers — `chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage), [MDN — `storage.local`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local), [MDN — `storage.onChanged`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged)

### 1.6 `chrome.*` vs. `browser.*` Native Promise APIs

- **Chrome / Chromium MV3:** `chrome.storage.*` and modern MV3 async APIs natively return Promises when no callback is passed. Chromium also added native support for the `browser` global namespace in **Chrome 148** (and DevTools pages in **Chrome 152**).
- **Firefox MV3:** `browser.*` natively returns Promises in all supported versions (`109+`). Firefox retains `chrome.*` primarily as a callback-compatible porting shim.
- **Recommended cross-browser pattern:** No `webextension-polyfill` dependency is needed. A minimal runtime lookup:
  ```ts
  const ext = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
  ```
  selects native Promise-returning `browser.storage.local` in Firefox and Chrome 148+, and native Promise-returning `chrome.storage.local` in Chrome 88–147 and Edge.  
  _Primary sources:_ [MDN — Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities), [Firefox Extension Workshop — Building a cross-browser extension](https://extensionworkshop.com/documentation/develop/building-a-cross-browser-extension/)

### 1.7 Microsoft Edge for Android Compatibility

- **Runtime compatibility:** Microsoft Edge (desktop and Android) is Chromium-based and requires **Manifest V3** (Partner Center no longer accepts new MV2 extensions). The Chrome MV3 `.zip` runs directly on Edge provided there is no Chrome-specific `update_url` or Chrome-specific branding in metadata.
- **Distribution model:**
  - Publishing to **Microsoft Edge Add-ons** via [Microsoft Partner Center](https://partner.microsoft.com/) is **free** (requires a personal Microsoft Account; automates updates via the Edge Add-ons Update API v1.1).
  - **Edge for Android catalog caveat:** Publishing a desktop Edge Add-on does **not** automatically make it browsable in Edge for Android's built-in mobile catalog. Mobile catalog inclusion requires meeting Microsoft's mobile UX/testing criteria and requesting mobile enablement through Microsoft's Edge Mobile extension onboarding process.
  - **Developer testing / sideloading:** Developers can sideload `.crx` packages on **Edge Canary for Android** via developer options (_Settings → About_, tap version number to unlock developer menu).  
    _Primary sources:_ [Microsoft Learn — Register as a Microsoft Edge extension developer](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/register-extension-developer), [Microsoft Learn — Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension), [Microsoft Learn — Using the Microsoft Edge Add-ons API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/api/using-addons-api)

---

## 2. Store Publishing APIs & CI Automation

### 2.1 Chrome Web Store Publish API (v2)

- **API v1.1 Shutdown:** Legacy Chrome Web Store API v1.1 (`www.googleapis.com/chromewebstore/v1.1/...`) was **deprecated and shut down on October 15, 2026**. All new automation must use **Chrome Web Store API v2** (`https://chromewebstore.googleapis.com`).
- **Mandatory v2 path identifiers:** Every v2 endpoint requires **both** `{publisherId}` and `{itemId}`:
  - **Upload ZIP:** `POST https://chromewebstore.googleapis.com/upload/v2/publishers/{publisherId}/items/{itemId}:upload`
  - **Publish item:** `POST https://chromewebstore.googleapis.com/v2/publishers/{publisherId}/items/{itemId}:publish` (supports `publishType` for immediate or staged publishing)
  - **Status / Cancel / Rollout:** `GET .../items/{itemId}:fetchStatus`, `POST ...:cancelSubmission`, `POST ...:setPublishedDeployPercentage`
- **Authentication options for GitHub Actions:**
  1. **Service Account + GitHub OIDC / Workload Identity Federation (Recommended):** API v2 natively supports Google Cloud Service Accounts. Enable _Chrome Web Store API_ in GCP, create a Service Account, grant its email access under **Account** settings in the Chrome Web Store Developer Dashboard, and authenticate in GitHub Actions with `google-github-actions/auth` (scoped to `https://www.googleapis.com/auth/chromewebstore`). Zero long-lived credentials and no expiring refresh tokens. (A Service Account JSON key in GitHub Secrets also works if WIF is not configured.)
  2. **OAuth 2.0 Refresh Token (Supported fallback):** Existing OAuth2 client ID / secret / refresh token flows remain valid on v2, but GCP OAuth apps left in _Testing_ mode expire refresh tokens after 7 days.
- **CLI / Action choices:**
  - Two direct `fetch`/`curl` calls after `google-github-actions/auth` avoids third-party upload wrappers completely.
  - If a CLI wrapper is preferred, `fregante/chrome-webstore-upload` / `chrome-webstore-upload-cli` has been updated for v2 (`publisherId` + v2 endpoints).
- **Mandatory first-time manual setup:** The API **cannot create new items**. A human must pay the one-time $5 developer registration fee (with 2FA enabled), manually upload the initial `.zip` in the Developer Dashboard, complete Store Listing + Privacy Practices, and record `publisherId` + `itemId` before CI can automate subsequent releases.
- **Review policies for content-script extensions:**
  - **Single Purpose:** Narrow, clear scope (expanding comments on Pikabu Post Pages).
  - **Minimum Permissions:** Requesting only `storage` + `https://pikabu.ru/story/*` (no `<all_urls>`, no `tabs`, no `host_permissions`) minimizes review scrutiny and wait time.
  - **Readable Code:** Obfuscated code is prohibited. Keeping `minify: false` (matching the existing `lib/build.mts` convention) makes automated + human review straightforward.
  - **Expectations:** First submission for a new developer/item commonly takes several days (up to a couple weeks during high volume); routine updates to narrow-permission extensions are typically faster.  
    _Primary sources:_ [Chrome for Developers — Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api), [Chrome for Developers — Chrome Web Store API Reference (v2)](https://developer.chrome.com/docs/webstore/api), [Chrome for Developers — Developer Program Policies](https://developer.chrome.com/docs/webstore/program-policies), [Chrome for Developers — Review Process](https://developer.chrome.com/docs/webstore/review-process)

### 2.2 Firefox AMO (`web-ext sign` & AMO API v5)

- **API v5 & `web-ext` v8+:** `web-ext sign` (v8+) natively uses the **AMO Add-on Submission API v5** (`POST /api/v5/addons/upload/` → poll validation → `POST /api/v5/addons/addon/{id}/versions/`), authenticating with AMO JWT credentials (`--api-key "$AMO_JWT_ISSUER"` and `--api-secret "$AMO_JWT_SECRET"`).
- **Distribution channels (`--channel`):**
  - `--channel=listed`: Publishes publicly on addons.mozilla.org; AMO signs, hosts, and auto-updates the add-on. Initial creation via API requires `--amo-metadata <path.json>` containing at least `summary`, `categories`, and `version.license` (or create the listing manually once in Developer Hub, then automate updates).
  - `--channel=unlisted`: Signs an `.xpi` for self-distribution without publishing a public AMO listing.
- **CI timeout trap (`--approval-timeout`):** `web-ext sign` waits up to **15 minutes (`900000` ms)** by default for AMO approval. Listed releases frequently wait longer for human review, causing CI jobs to fail despite a successful upload. Pass **`--approval-timeout=0`** in CI for `--channel=listed` so `web-ext sign` uploads, validates, and exits cleanly while review completes asynchronously.
- **Mandatory source-code archive submission:**
  - Mozilla requires source-code submission whenever an extension uses **TypeScript**, **Vite/Rollup/Rolldown**, bundlers, transpilers, or minifiers—regardless of whether `--channel` is `listed` or `unlisted` and even if minification is disabled.
  - **Upload mechanism:** Pass `--upload-source-code <source.zip>` to `web-ext sign` (maps to the `source` field on `POST /api/v5/addons/addon/{id}/versions/`).
  - **Archive rules:** Max **200 MB** (`.zip`, `.tar.gz`, `.tgz`, `.tar.bz2`). Include only clean source files (`src/`, `lib/`, `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `tsconfig*.json`, icons, `_locales/`, and a build `README`); exclude `node_modules/`, `dist/`, `.git/`, and test fixtures/screenshots not needed for the build.
  - **Reviewer build environment & reproducibility:** AMO reviewers build inside a clean headless **Ubuntu Linux** environment with Node.js LTS and verify that the reproduced output matches the submitted `.zip`.
    - Provide explicit, copy-pasteable build instructions in both the source archive `README` and AMO `approval_notes` (exact Node version from `.nvmrc`, exact `pnpm` version from `package.json`'s `devEngines.packageManager`, `pnpm install --frozen-lockfile`, and the exact extension build command).
    - **Deterministic build requirement:** Unlike the userscript in `lib/build.mts` (which embeds a `new Date().toISOString()` `@build` timestamp), **extension build outputs must be 100% deterministic** (no build timestamps or random chunk hashes) so a reviewer's rebuild matches the uploaded package cleanly.  
      _Primary sources:_ [Firefox Extension Workshop — `web-ext` command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/), [Firefox Extension Workshop — Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/), [AMO Add-ons Server — API v5 Add-ons & Signing](https://addons-server.readthedocs.io/en/latest/topics/api/addons.html)

---

## 3. Store Listing, Assets, Localization, and Privacy

### 3.1 Icons, Screenshots, and Promotional Tiles

| Asset                             | Chrome Web Store (CWS)                                                                                                                                      | Firefox AMO                                                                                                | Recommendation for This Repo                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Manifest `icons`**              | **PNG required** (SVG unsupported): `16`, `32`, `48`, `128` px                                                                                              | PNG (`48`, `96`, `128`) or SVG (with `xmlns` + `viewBox`, supports `prefers-color-scheme`)                 | Maintain one master SVG in repo; export crisp PNGs at `16`, `32`, `48`, `96`, `128` for both targets (optionally SVG for Firefox toolbar) |
| **Toolbar `action.default_icon`** | PNG `16`, `32` (1× / 2× HiDPI)                                                                                                                              | PNG `16`, `32` or theme-aware SVG                                                                          | Ship `16` and `32` PNGs                                                                                                                   |
| **Store Listing Icon**            | **128×128 px PNG** inside ZIP (~96×96 artwork + 16 px transparent padding; no baked-in rounded frame or heavy drop shadow; readable on light & dark themes) | **128×128 px** PNG/JPEG (AMO resizes to 32/64/128); avoid text (shared globally across locales)            | Reuse the same padding-compliant 128×128 PNG on both stores                                                                               |
| **Screenshots**                   | **1–5 required**; **1280×800** or **640×400** px; JPEG or 24-bit PNG (no transparency, square corners)                                                      | Recommended **1280×800** px (1.6:1 aspect ratio), PNG/JPEG; **single shared image set** across all locales | Produce 2–3 clean **1280×800 px** 24-bit PNGs (Post Page before/after Expansion Run + popup UI) usable on both CWS and AMO                |
| **Promotional Tiles**             | Optional (required for featuring): Small **440×280 px**, Marquee **1400×560 px** (PNG/JPEG)                                                                 | Not used                                                                                                   | Optional; add 440×280 small promo tile for cleaner CWS search cards                                                                       |

_Primary sources:_ [Chrome for Developers — Manifest `icons`](https://developer.chrome.com/docs/extensions/reference/manifest/icons), [Chrome for Developers — Supplying images](https://developer.chrome.com/docs/webstore/images), [MDN — `manifest.json/icons`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/icons), [Firefox Extension Workshop — Add-on listing guidelines](https://extensionworkshop.com/documentation/publish/add-on-listing-guidelines/)

### 3.2 Localization (`_locales/ru` + `_locales/en` vs. Store Dashboard Copy)

- **Package localization (`_locales/`):**
  - Place `_locales/en/messages.json` and `_locales/ru/messages.json` at the root of the extension package.
  - Whenever `_locales/` is present, `"default_locale"` is **mandatory** in `manifest.json` (e.g., `"default_locale": "en"` as the international fallback, with `ru` served automatically on Russian browser profiles).
  - Localize manifest strings via `__MSG_extName__`, `__MSG_extDescription__`, and `__MSG_actionTitle__`, and localize popup/page controls via `i18n.getMessage()` if desired.
- **How each store consumes localization:**
  - **CWS:** Automatically detects every locale folder in `_locales/` from the uploaded ZIP, syncs localized `name`/`description` from `messages.json`, and exposes matching language tabs in the Developer Dashboard for localized long descriptions and screenshots.
  - **AMO:** Uses `_locales/` for browser UI strings; store listing copy (`name`, `summary`, `description`, `release_notes`) is localized separately per locale (`en-US`, `ru`) in Developer Hub or via `--amo-metadata` / API v5 locale maps (`{ "en-US": "...", "ru": "..." }`). Remember AMO screenshots are global (only captions localize).

_Primary sources:_ [Chrome for Developers — Internationalization (`chrome.i18n`)](https://developer.chrome.com/docs/extensions/reference/api/i18n), [Chrome for Developers — Internationalizing your app](https://developer.chrome.com/docs/webstore/i18n), [MDN — Internationalization](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization)

### 3.3 Privacy Policy & Data-Collection Disclosure (Zero-Data-Collection Extensions)

- **Firefox AMO:**
  - Declaring `browser_specific_settings.gecko.data_collection_permissions: { "required": ["none"] }` explicitly certifies zero data collection/transmission on both the AMO listing and in `about:addons`.
  - A separate privacy policy URL is not mandatory when zero data is collected, though linking a short policy page is optional and safe.
- **Chrome Web Store (Important Nuance):**
  - Chrome's User Data FAQ defines "handling user data" broadly to include **local-only processing and storage** as well as interacting with **website content** via content scripts.
  - In the Developer Dashboard **Privacy Practices** tab, you must provide a Single Purpose statement, justify `"storage"` and `content_scripts.matches` (`https://pikabu.ru/story/*`), certify "No remote code", certify Limited Use compliance, and ensure dashboard disclosures strictly match the manifest and privacy policy text.
  - **Practical recommendation:** Host a concise public HTTPS Privacy Policy (e.g., `PRIVACY.md` published on GitHub Pages or linked in the repo) stating that the extension executes exclusively on `https://pikabu.ru/story/*`, stores only the local **Auto-Expand on Visit** preference in `storage.local`, and never collects, transmits, sells, or shares any user or browsing data. Supplying this HTTPS URL in the CWS Privacy Practices tab avoids the most common CWS rejection reason (missing policy or perceived mismatch with content-script/storage permissions).

_Primary sources:_ [Chrome for Developers — User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [Chrome for Developers — Privacy Policy & User Data](https://developer.chrome.com/docs/webstore/program-policies/privacy), [Firefox Extension Workshop — Built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)

---

## 4. Artifact & Version Conventions and Release Please Integration

### 4.1 Package Artifacts & GitHub Releases Strategy

| Artifact                                    | Purpose                                                             | Notes                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pikabu-expand-comments-chrome.zip`         | Chrome Web Store & Edge Add-ons upload (and GitHub Release archive) | `manifest.json` and `_locales/` at archive root (no top-level wrapper folder); no `browser_specific_settings`   |
| `pikabu-expand-comments-firefox.zip`        | AMO upload artifact                                                 | `manifest.json` (with `gecko` + `gecko_android` + `data_collection_permissions`) and `_locales/` at root        |
| `pikabu-expand-comments-firefox-source.zip` | AMO reviewer source archive (`--upload-source-code`)                | Clean repo source + lockfile + `.nvmrc` + reviewer build README; ≤ 200 MB; excludes `node_modules/` and `dist/` |
| Signed `.xpi` (optional on GitHub Releases) | Direct Firefox install                                              | Standard Firefox Release/Beta **blocks unsigned `.zip`/`.xpi` installs**. See channel caveat below.             |

**Critical Firefox `.xpi` & channel caveat:**

- A single extension ID **cannot reuse the same version number** on both `listed` and `unlisted` AMO channels, and `listed` submissions **must not** declare `browser_specific_settings.gecko.update_url` (AMO rejects `update_url` on listed add-ons because AMO handles auto-updates).
- Therefore, when publishing **listed on AMO**:
  - Do **not** block GitHub Release publication waiting for AMO human review to return a signed `.xpi`.
  - Direct Firefox users to install from the AMO listing URL (which serves the signed `.xpi` with `Content-Type: application/x-xpinstall` and automatic updates; GitHub Release downloads serve `application/octet-stream`, which downloads instead of triggering one-click Firefox install).
  - If a signed `.xpi` mirror on GitHub Releases is still desired later, fetch the already-approved listed `.xpi` from AMO's public download URL after approval—it auto-updates via AMO automatically because `update_url` is absent.
- Only use `--channel=unlisted` + a hosted `update_url` JSON manifest if self-hosting outside AMO (e.g., private beta builds under a separate beta extension ID).

_Primary sources:_ [Firefox Extension Workshop — Signing and distributing your add-on](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [Firefox Extension Workshop — Self-distribution](https://extensionworkshop.com/documentation/publish/self-distribution/), [Firefox Extension Workshop — Updating your extension](https://extensionworkshop.com/documentation/manage/updating-your-extension/)

### 4.2 Manifest Version String Rules

| Platform                     | Allowed `manifest.json` `"version"` Format                                                                                                 | Pre-release Suffixes (`-alpha.1`, `-beta.1`)                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **Chrome Web Store**         | 1–4 dot-separated integers, each `0..65535`; no leading zeros on non-zero segments (`032` invalid); cannot be all zero (`0.0.0.0` invalid) | **Disallowed in `version`** (allowed only in optional display-only `version_name`) |
| **Firefox / AMO**            | 1–4 dot-separated non-negative integers up to 9 digits each, no leading zeros: `^(0\|[1-9][0-9]{0,8})([.](0\|[1-9][0-9]{0,8})){0,3}$`      | **Disallowed** (letters/hyphens rejected; AMO has no listed pre-release channel)   |
| **Cross-store intersection** | **Strict `MAJOR.MINOR.PATCH`** (`0..65535` integers, e.g., `0.2.0`, `1.0.0`)                                                               | Must avoid pre-release tags in `package.json` for store releases                   |

_Primary sources:_ [Chrome for Developers — Manifest `version`](https://developer.chrome.com/docs/extensions/reference/manifest/version), [MDN — `manifest.json/version`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/version), [Firefox Extension Workshop — Manage pre-release versions](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)

### 4.3 Integration with Existing Release Please Pipeline

The repository already uses Release Please (`release-please-config.json` with `release-type: "node"`, `bump-minor-pre-major: true`, `draft: true`) and `.github/workflows/release.yml`, where `lib/build.mts` reads `version` directly from `package.json` at build time.

Recommended integration:

1. **Single version source of truth:** Keep `package.json` as the sole Release Please version file; generate `dist/chrome/manifest.json` and `dist/firefox/manifest.json` at build time using `package.json`'s `version` (no `extra-files` config needed in `release-please-config.json`, zero version drift).
2. **Keep GitHub Release creation decoupled from store APIs:**
   - `publish-assets` builds userscript + Chrome `.zip` + Firefox `.zip` + Firefox source `.zip`, uploads them to the GitHub Release, and publishes the release (`--draft=false --latest`).
   - Run `publish-cws` (API v2 upload + publish) and `publish-amo` (`web-ext sign --channel=listed --upload-source-code ... --approval-timeout=0`) as **downstream jobs** (`needs: publish-assets`, or `workflow_dispatch`-retriggerable) so a store API outage or review delay never blocks the userscript/GitHub Release.

---

## 5. Newly Discovered Risks, Prerequisites & Fog Items

1. **Mobile Pikabu URL pattern (`m.pikabu.ru` vs. `pikabu.ru`):** Firefox Bug 1893232 means adding new `content_scripts.matches` patterns in a _future_ Firefox update will not auto-prompt users for permission. Before first AMO submission, verify whether Firefox for Android and Edge for Android open Post Pages on `https://pikabu.ru/story/*` or redirect to `https://m.pikabu.ru/story/*` (and whether mobile DOM is in scope).
2. **Deterministic extension builds for AMO review:** `lib/build.mts` currently injects `new Date().toISOString()` into `@build` for the userscript. Extension builds must **exclude** build timestamps so AMO reviewers' clean Ubuntu rebuilds match the uploaded `.zip`.
3. **Manual one-time store onboarding prerequisites (cannot be automated via CI):**
   - **CWS:** $5 developer registration + 2FA, first manual ZIP upload + Store Listing + Privacy Practices (including public HTTPS Privacy Policy URL), GCP project + Chrome Web Store API enabled + Service Account granted dashboard access + Workload Identity Federation configured for GitHub Actions, recording `PUBLISHER_ID` and `EXTENSION_ID`.
   - **AMO:** Mozilla developer account + 2FA, AMO API key (`AMO_JWT_ISSUER` / `AMO_JWT_SECRET`), and either initial manual listing creation or an `amo-metadata.json` file (`summary`, `categories`, `version.license`).
   - **Edge for Android (if targeted):** Free Microsoft Partner Center MSA registration + separate Edge Mobile catalog opt-in review.
4. **CWS Privacy Policy nuance for zero-telemetry content scripts:** Even with zero external transmission, Google's User Data FAQ considers local storage and reading page DOM ("Website content") to be handling user data. Hosting a simple public HTTPS Privacy Policy prevents CWS review rejection.
