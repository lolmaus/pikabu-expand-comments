# Pikabu Expand Comments

Expand comment batches and collapsed reply branches on desktop Pikabu post pages. You can read the discussion in place or search it with your browser’s Find command.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/get-it/) for desktop Chrome or Firefox.
2. On Chrome 138 or later, open `chrome://extensions`, select **Details** for Violentmonkey, and enable **Allow User Scripts**. [Chrome documentation](https://developer.chrome.com/docs/extensions/reference/api/userScripts#enable_usage)
3. Open [Install Pikabu Expand Comments](https://github.com/lolmaus/pikabu-expand-comments/releases/latest/download/pikabu-expand-comments.user.js) and confirm the installation in Violentmonkey. This link becomes available with the first stable release.

Violentmonkey on desktop Chrome and Firefox is the supported target. Tampermonkey is expected to work and is outside the release acceptance checks.

## Use

- On a Pikabu post, click **Раскрыть все комментарии** beside the comment tabs. The status shows how many comments are visible.
- Click **Остановить** to pause and **Продолжить** to resume. A floating Stop button appears while expansion runs below the comment tabs.
- For automatic expansion on future visits, open **Настройки** and enable **Раскрывать комментарии при открытии поста**.

## Verify and publish a release

Use the Node version from `.nvmrc` and the pnpm version specified in `package.json`. Install dependencies with `pnpm install --frozen-lockfile` and Chromium with `pnpm exec playwright install chromium`.

- Run `pnpm test` for unit and DOM tests and `pnpm run test:e2e` for offline browser tests.
- Run `pnpm run test:live` for the opt-in Chromium smoke test against Pikabu. It allows up to eight loader clicks on the sample post and is separate from the offline suites.
- Releasable Conventional Commits pushed to `main` automatically open or update the rolling Release Please pull request with the proposed version bump and `CHANGELOG.md` entry. Review or edit the changelog on that PR if needed, then merge it. The release workflow creates the matching `v*` tag and draft GitHub Release, builds and attaches both `.user.js` and `.meta.js`, and publishes the release once the uploads succeed.

### Violentmonkey release acceptance

Run these checks on fresh desktop Chrome and Firefox profiles with stable Violentmonkey.

1. Open the README install link after publishing version A. Confirm that Violentmonkey opens its install prompt and reports version A after installation.
2. Open a live Pikabu post with collapsed comments and run **Раскрыть все комментарии**. Enable **Раскрывать комментарии при открытии поста** and confirm it survives a reload.
3. Publish a higher version B at the same release URLs. Let Violentmonkey check for updates, confirm it installs B over A, and verify that automatic expansion still runs with the saved preference.

If either browser has trouble opening or updating the GitHub Release assets, test a raw GitHub fallback before choosing the public install URL. Publish both built files at the root of a dedicated `release` branch and point the README install link and the build’s update/download URLs at `https://raw.githubusercontent.com/lolmaus/pikabu-expand-comments/release/` with the corresponding filenames. Keep the script name and namespace stable and repeat the install and update checks.
