# Store Onboarding & Manual Verification Checklist

One-time human steps required to activate automated Chrome Web Store (API v2) and Firefox Add-ons (AMO API v5) publishing in `.github/workflows/release.yml`, plus the manual Firefox desktop & Android smoke checklist.

---

## 1. Chrome Web Store (API v2 via GCP Service Account + GitHub OIDC)

1. **Developer account**: Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time fee, 2FA enabled).
2. **Build local release artifacts**:
   ```bash
   pnpm run build
   pnpm run store:screenshots
   ```
   This produces `dist/pikabu-expand-comments-chrome.zip` and `1280×800` screenshots in `tmp/store-screenshots/`.
3. **Initial manual upload** (required by CWS before API uploads work):
   - Upload `dist/pikabu-expand-comments-chrome.zip`.
   - Fill out Store Listing copy from [`docs/store/listing-copy.md`](./listing-copy.md) (`en` and `ru` tabs) and upload the `1280×800` screenshots.
   - Complete Privacy Practices using the justifications in [`docs/store/listing-copy.md`](./listing-copy.md) and Privacy Policy URL `https://github.com/lolmaus/pikabu-expand-comments/blob/main/PRIVACY.md`.
   - Record your **Publisher ID** (`CWS_PUBLISHER_ID`) from Account → Publisher ID and the assigned **Item / Extension ID** (`CWS_EXTENSION_ID`).
4. **Google Cloud Service Account & GitHub OIDC**:
   - In Google Cloud Console, create/select a project and enable **Chrome Web Store API** (`chromewebstore.googleapis.com`).
   - Create a Service Account (e.g., `cws-publisher@<project>.iam.gserviceaccount.com`) and grant it **Publisher** access in CWS Developer Dashboard → Account → Group publishing / API access.
   - Configure Workload Identity Federation trusting GitHub repo `lolmaus/pikabu-expand-comments` (`token.actions.githubusercontent.com`) and bind the Service Account.
5. **Configure GitHub repository variables** (Settings → Secrets and variables → Actions → Variables):
   - `CWS_PUBLISHER_ID`
   - `CWS_EXTENSION_ID`
   - `CWS_GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `CWS_GCP_SERVICE_ACCOUNT`

Once those 4 variables are set, `publish-cws` runs automatically after every GitHub Release (and can be re-triggered via `workflow_dispatch` with a release tag). Until configured, `publish-cws` skips cleanly without failing releases.

---

## 2. Firefox Add-ons (AMO API v5 via `web-ext sign`)

1. **Developer account**: Sign in to [AMO Developer Hub](https://addons.mozilla.org/developers/) (2FA enabled).
2. **Generate API credentials**: Open **Tools → Manage API Keys** and record `JWT issuer` and `JWT secret`.
3. **Initial manual submission** (recommended for first listing metadata & screenshots):
   - Upload `dist/pikabu-expand-comments-firefox.zip` and attach `dist/pikabu-expand-comments-firefox-source.zip` as the source archive.
   - Select both **Firefox** and **Firefox for Android** compatibility.
   - Paste bilingual listing copy from [`docs/store/listing-copy.md`](./listing-copy.md) and upload the `1280×800` screenshots.
4. **Configure GitHub repository secrets** (Settings → Secrets and variables → Actions → Secrets):
   - `AMO_JWT_ISSUER`
   - `AMO_JWT_SECRET`

Once both secrets are set, `publish-amo` runs automatically after every GitHub Release using `web-ext sign --channel=listed --upload-source-code dist/pikabu-expand-comments-firefox-source.zip --approval-timeout=0` (never blocking GitHub Release publication while AMO reviews). Until configured, `publish-amo` skips cleanly.

---

## 3. Manual Firefox Desktop & Firefox for Android Smoke Checklist (`web-ext run`)

Before submitting a release to AMO:

1. **Lint check** (automated in tests & CI):
   ```bash
   pnpm run lint:firefox
   ```
2. **Firefox desktop smoke test**:
   ```bash
   pnpm exec web-ext run --source-dir dist/firefox --start-url https://pikabu.ru/story/poputchik_7957162
   ```
   - Verify no manifest warnings in `about:debugging`.
   - Click the toolbar icon → verify live `<open> / <total>`, one-tap Expand/Stop, and bidirectional `Auto-Expand on Visit` switch sync with the on-page settings popover.
   - Open a non-Pikabu tab → verify off-site card + `Open Pikabu ↗` link while toggle remains usable.
3. **Firefox for Android smoke test** (USB debugging / `adb` connected):
   ```bash
   pnpm exec web-ext run --target=firefox-android --adb-device=<device-id> --source-dir dist/firefox --start-url https://pikabu.ru/story/poputchik_7957162
   ```
   - Confirm mobile `html.mv` companion strip (`56px`) mounts below untouched `.story-comments__menu`, top-docked progress ribbon tracks below `header.header`, and Extensions menu popup renders cleanly at `360px` with `>= 44px` tap targets.
