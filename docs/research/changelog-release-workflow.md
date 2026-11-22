# Research: Agent-Friendly Changelog & Automated Release Workflows

> **Context:** Research for `lolmaus/pikabu-expand-comments` (Wayfinder Map #17, Ticket #18) — evaluating automated changelog generation, semantic versioning, GitHub Release asset publishing (`.user.js` + `.meta.js`), AI-agent ergonomics, and local Violentmonkey testing for a single-package, `"private": true` pnpm repository.

---

## 1. Current Repository Baseline

Verified directly from the repository files:

- **Package setup (`package.json`)**: Single-package, `"private": true`, `"type": "module"`, currently at `"version": "0.1.8"`. Declares pnpm via `"devEngines": { "packageManager": { "name": "pnpm", "version": "12.21.0", "onFail": "download" } }`.
- **Node & build (`lib/build.mts`, `.nvmrc`)**: `.nvmrc` pins Node `26.13.1`. `"build": "node lib/build.mts"` runs Vite/Rolldown directly under Node's native TypeScript execution, reading `manifest.version` from `package.json` to emit `dist/userscript/pikabu-expand-comments.user.js` and `dist/userscript/pikabu-expand-comments.meta.js`. Both files embed `// @updateURL` and `// @downloadURL` pointing to `https://github.com/lolmaus/pikabu-expand-comments/releases/latest/download/...`.
- **Commit discipline (`commitlint.config.mts`, `lefthook.yml`)**: `@commitlint/config-conventional` (`21.2.4`) is already enforced locally via `lefthook` on the `commit-msg` hook, alongside `lint`, `format`, and `typecheck` on `pre-commit`.
- **Release workflow (`.github/workflows/release.yml`)**: Triggers on `push.tags: ["v*"]`. Uses SHA-pinned `actions/checkout@v7.0.1` and `actions/setup-node@v7.1.0`, checks that `package.json` matches a stable `vX.Y.Z` tag, installs pnpm `12.21.0`, runs `pnpm install --frozen-lockfile && pnpm run build`, and publishes the GitHub Release via `gh release create "$GITHUB_REF_NAME" --verify-tag --generate-notes` with both `.user.js` and `.meta.js` attached.
- **Current pain point (`AGENTS.md`)**: Requires incrementing the patch version in `package.json` on _every_ userscript change so local Violentmonkey test installs pick up the new build. This pollutes `package.json` with throwaway version bumps, causes merge conflicts across parallel branches/agents, and couples local testing to release versioning.

---

## 2. Tool & Workflow Comparison

### Summary Matrix

| Tool / Workflow                                                         | Release Input Source                           | Release Model                                                                      | Private Single-Pkg Fit                                                                                                  | `0.x` Pre-1.0 Support                                                           | GitHub Release + Assets                                                                                                           | AI-Agent Ergonomics                                                                                                                                                | Maintainer Overhead                                                          |
| :---------------------------------------------------------------------- | :--------------------------------------------- | :--------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| **Release Please** (`googleapis/release-please-action`)                 | Conventional Commits (already enforced)        | Rolling **Release PR**; merge PR → tag + GitHub Release                            | **Excellent** (`release-type: "node"`, root `"."`)                                                                      | **First-class** (`bump-minor-pre-major`, `Release-As`)                          | Native Release; chain build + `gh release upload` in same workflow via `release_created` output                                   | **Best** — zero extra files; zero merge conflicts; human can edit Release PR notes before merge                                                                    | Very low (2 small JSON files + 1 workflow)                                   |
| **Changesets** (`@changesets/cli` + `changesets/action`)                | Markdown files in `.changeset/*.md`            | Rolling **Version Packages PR**; merge PR → publish/tag                            | **Fair** — built around npm publish; requires `privatePackages: { version: true, tag: true }` + custom `publish` script | Good (manual bump choice per changeset)                                         | Official `changesets/action` does **not** upload release assets natively (requires custom `publish` script or follow-up step)     | **Good with guardrails** — conflict-free files, but agents must remember to author `.changeset/*.md` on every PR                                                   | Medium (`.changeset/config.json`, custom publish script, optional PR check)  |
| **semantic-release**                                                    | Conventional Commits                           | **Immediate push-to-release** on every qualifying commit to `main`                 | **Fair** — disable npm publish, use `@semantic-release/exec` + `@semantic-release/github`                               | **Poor** — officially jumps to `1.0.0` on main; `0.x` is not supported natively | Native via `@semantic-release/github` (`assets`)                                                                                  | **High** (zero files), _but_ committing `package.json`/`CHANGELOG.md` back via `@semantic-release/git` conflicts with branch protection and is discouraged by docs | Medium (plugin chain + PAT/App if committing back to protected `main`)       |
| **`git-cliff`** (`orhun/git-cliff` + `orhun/git-cliff-action`)          | Conventional Commits (customizable regex/TOML) | CLI/Action changelog + `--bumped-version` generator; you wire PR/tag/release       | **Good** (language-agnostic Rust binary)                                                                                | Configurable via `[bump]` in `cliff.toml`                                       | Generates notes/version only; you wire `package.json` edit + PR/tag + `gh release create`                                         | **High** (zero files) if wired into a Release PR or `workflow_dispatch` workflow                                                                                   | Medium–High (custom workflow glue for bumping `package.json` & PR lifecycle) |
| **`changelogen`** (`unjs/changelogen`) / **`bumpp` + `changelogithub`** | Conventional Commits                           | Local interactive CLI (`bumpp`, `changelogen --release`) or `workflow_dispatch` CI | **Good** for manual maintainer-driven releases                                                                          | Good (interactive or semver flags)                                              | `changelogen`/`changelogithub` create GitHub Releases, but asset upload is still separate; pushing from CI hits branch protection | **Moderate** — agents don't touch versions, _but_ releases remain manual/interactive unless wrapped in custom CI                                                   | Low for manual releases; medium if automated in CI                           |
| **Keep a Changelog + GitHub Actions** (`taiki-e/parse-changelog`)       | Hand-edited `CHANGELOG.md` (`## [Unreleased]`) | Manual edit + tag push → CI parses notes & uploads assets                          | **Good** (zero JS release deps)                                                                                         | Manual (full control)                                                           | `taiki-e/create-gh-release-action` or `parse-changelog` + `gh release create`                                                     | **Poor** — every parallel agent PR edits top of `CHANGELOG.md` (guaranteed merge conflicts + drift)                                                                | High per release (manual version bump, changelog cut, tag push)              |

---

### Detailed Tool Findings (Primary Sources)

#### 2.1 Release Please (`googleapis/release-please` & `googleapis/release-please-action`)

- **How it works**: Runs on `push` to `main`, parses Conventional Commits since the last release, and opens/updates a single rolling **Release PR** that bumps `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`. Merging that PR causes the next run on `main` to create the Git tag (`vX.Y.Z`) and GitHub Release.
  - Primary docs: [googleapis/release-please](https://github.com/googleapis/release-please), [Manifest configuration docs](https://github.com/googleapis/release-please/blob/main/docs/manifest-releasers.md), [Customizing Release Please](https://github.com/googleapis/release-please/blob/main/docs/customizing.md).
- **Single-package Node configuration**: In manifest mode (`release-please-config.json` + `.release-please-manifest.json`), targeting `"."` with `"release-type": "node"` bumps `package.json` and maintains `CHANGELOG.md`, with tags formatted as `vX.Y.Z` (matching the existing `v*` convention because `"include-component-in-tag"` defaults to `false` for root packages).
- **`0.x` support**: Explicitly supported via `"bump-minor-pre-major": true` (breaking changes bump `0.1.x` → `0.2.0` instead of `1.0.0`) and optionally `"bump-patch-for-minor-pre-major": true` (`feat:` bumps patch while `< 1.0.0`). When intentionally ready for `1.0.0`, add a `Release-As: 1.0.0` commit footer (or empty commit) to override the next proposed version ([Customizing docs](https://github.com/googleapis/release-please/blob/main/docs/customizing.md)).
- **Attaching built userscript assets**: `googleapis/release-please-action` exposes `release_created` (`"true"` / `"false"` string) and `tag_name` / `upload_url` outputs ([googleapis/release-please-action](https://github.com/googleapis/release-please-action)). A downstream job in the **same workflow** gated on `if: ${{ needs.release-please.outputs.release_created == 'true' }}` can build the userscript and run `gh release upload` using the default `GITHUB_TOKEN`.
- **Node 24 runtime**: `googleapis/release-please-action@v5` upgraded its action runtime to **Node 24** (`node24`) following GitHub Actions' removal of Node 20 ([release-please-action releases](https://github.com/googleapis/release-please-action/releases)).
- **Caveats**:
  1. `GITHUB_TOKEN` cannot auto-run required CI checks on the Release PR without approval (see Section 4).
  2. `release-please` updates `package.json` (and `package-lock.json` if present), not `pnpm-lock.yaml`. For a single-package repo where root `version` is not stored in `pnpm-lock.yaml`, `pnpm install --frozen-lockfile` continues to pass cleanly — verify once during setup.
  3. Because changelog bullets come from commit subjects, squash-merging PRs with clean user-facing Conventional Commit titles matters (though the Release PR description/changelog can also be hand-edited before merging, or overridden via `CHANGELOG.md` edits on the Release PR branch).

#### 2.2 Changesets (`@changesets/cli` & `changesets/action`)

- **How it works**: Contributors add small Markdown intent files (`.changeset/<slug>.md`) describing user-facing changes and bump type (`patch`/`minor`/`major`). On push to `main`, `changesets/action` opens/updates a `Version Packages` PR that consumes those files into `CHANGELOG.md` and bumps `package.json`. Merging that PR runs the configured `publish` command.
  - Primary docs: [changesets/changesets](https://github.com/changesets/changesets), [Config file options](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md), [changesets/action](https://github.com/changesets/action).
- **Private single-package quirks**:
  - Changesets ignores `"private": true` packages unless `.changeset/config.json` sets `"privatePackages": { "version": true, "tag": true }` ([Changesets config docs](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md)).
  - In `changesets/action`, `create-github-releases` (renamed to kebab-case in `v2` / Changesets v3, which also upgraded to `node24`) only runs when a `publish` command executes and reports published packages ([changesets/action](https://github.com/changesets/action)). Because this repo does **not** publish to npm, you must supply a custom `publish` script (e.g., running `changeset tag` / `changeset git-tag` + `gh release create`) or disable `create-github-releases` and handle release creation + asset upload in a downstream step gated on `steps.changesets.outputs.published == 'true'`.
  - **Important verification note**: Official `changesets/action` does **not** have a `githubReleaseAssets` input — that input only exists in third-party forks such as `dotansimha/changesets-action` ([dotansimha/changesets-action](https://github.com/dotansimha/changesets-action)).
- **Trade-off**: Changesets shines in multi-package monorepos and when human-curated release prose should be decoupled from noisy commit logs. For a single-package repo already enforcing Conventional Commits via `commitlint`, adding `.changeset/*.md` files introduces a second mandatory authoring step that AI agents can forget unless enforced by a PR check.

#### 2.3 `semantic-release`

- **How it works**: Runs on `push` to `main`, analyzes Conventional Commits, computes the next version, runs build/prepare hooks (`@semantic-release/exec`), and publishes a GitHub Release with attached assets (`@semantic-release/github` `assets` option) in one shot — no Release PR.
  - Primary docs: [semantic-release docs](https://semantic-release.gitbook.io/semantic-release), [GitHub Actions CI recipe](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions), [@semantic-release/github](https://github.com/semantic-release/github), [@semantic-release/git](https://github.com/semantic-release/git).
- **Two major friction points for this repo**:
  1. **`0.x` unsupported on `main`**: By design, `semantic-release` starts at `1.0.0` and does not officially support staying in `0.x` on a release branch ([semantic-release FAQ](https://semantic-release.gitbook.io/semantic-release/support/faq#why-is-the-package.jsons-version-not-updated-in-my-repository)).
  2. **Committing `package.json` / `CHANGELOG.md` back to `main`**: Official docs explicitly discourage `@semantic-release/git` and warn that default `GITHUB_TOKEN` cannot push to protected branches, while replacing it with a PAT weakens branch-protection security guarantees ([GitHub Actions recipe](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions)). Without committing back, `package.json` stays stuck at a stale placeholder version in git (breaking local `lib/build.mts` reads unless overridden), and every single `feat:`/`fix:` merge immediately triggers a live Violentmonkey auto-update to all users with no batching or release-review gate.

#### 2.4 `git-cliff` (`orhun/git-cliff` & `orhun/git-cliff-action`)

- **How it works**: Fast Rust CLI that parses Conventional Commits with Tera templates (`cliff.toml`), supports Keep a Changelog formatting out of the box, integrates with GitHub API metadata (PR links, first-time contributors), and computes the next SemVer via `git-cliff --bumped-version` / `git-cliff --bump` with configurable `[bump]` rules ([git-cliff bump docs](https://git-cliff.org/docs/usage/bump-version), [orhun/git-cliff-action](https://github.com/orhun/git-cliff-action)).
- **Trade-off**: Excellent changelog quality and zero Node runtime overhead, _but_ `git-cliff` is a changelog/version calculator, not a release orchestrator. You still have to build and maintain your own workflow logic to edit `package.json`, open/update a Release PR (or run `workflow_dispatch`), create the tag, and publish the GitHub Release + assets.

#### 2.5 `changelogen` (`unjs/changelogen`) & `bumpp` + `changelogithub` (`antfu-collective`)

- **How they work**:
  - `changelogen` (`npx changelogen --release --push`) bumps `package.json`, updates `CHANGELOG.md` from Conventional Commits, creates a commit + tag, pushes, and creates a GitHub Release ([unjs/changelogen](https://github.com/unjs/changelogen)).
  - `bumpp` is an interactive local CLI that bumps `package.json`, commits, tags, and pushes (`vX.Y.Z`); pairing it with `changelogithub` on `on: push: tags: ["v*"]` populates rich GitHub Release notes automatically ([antfu-collective/bumpp](https://github.com/antfu-collective/bumpp), [antfu-collective/changelogithub](https://github.com/antfu-collective/changelogithub)).
- **Trade-off**: Very clean for **maintainer-initiated local releases** (`bumpp` locally → existing `.github/workflows/release.yml` runs on `v*` tag push and attaches `.user.js` + `.meta.js`). However, `changelogithub` writes GitHub Release notes only (no `CHANGELOG.md` file in git), and running `changelogen --push` inside CI hits the same protected-branch push and `GITHUB_TOKEN` workflow-trigger limitations as `semantic-release`.

#### 2.6 Keep a Changelog (`1.1.0`) + GitHub Actions (`taiki-e/parse-changelog`)

- **How it works**: Contributors maintain a hand-curated `CHANGELOG.md` with an `## [Unreleased]` section grouped under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` ([Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)). At release time, a human moves `[Unreleased]` under `## [X.Y.Z] - YYYY-MM-DD`, bumps `package.json`, and pushes tag `vX.Y.Z`. CI extracts the release notes using `taiki-e/parse-changelog` (or `taiki-e/create-gh-release-action`) and attaches the built assets via `gh release create` ([taiki-e/parse-changelog](https://github.com/taiki-e/parse-changelog), [taiki-e/create-gh-release-action](https://github.com/taiki-e/create-gh-release-action)).
- **Trade-off**: Highest prose quality for human-curated software, zero JS release dependencies, and works cleanly with the existing tag-triggered workflow. However, it has the **worst AI-agent ergonomics**: concurrent branches/agents editing `## [Unreleased]` constantly merge-conflict, and releases still require manual version bumps and tag pushes.

---

## 3. AI-Agent Ergonomics Assessment

For a repo actively developed by AI coding agents (potentially across parallel worktrees/branches):

1. **Conventional Commits (Best fit here)**:
   - Already enforced locally by `lefthook` + `@commitlint/config-conventional` (`commitlint.config.mts`). Zero new conventions for agents to learn or forget.
   - Completely **conflict-free** across parallel branches: agents never touch `package.json` or `CHANGELOG.md`.
   - **Guardrail needed**: Add a brief note in `AGENTS.md` (and PR merge policy) that `feat:` and `fix:` commit/squash-PR subjects appear in the public changelog, so they should describe user-visible behavior clearly (and internal refactors/tests/tooling should use `refactor:`, `test:`, `chore:`, `ci:`, `docs:`).
2. **Release PR batching vs. push-to-release**:
   - A rolling Release PR (Release Please or Changesets) is markedly safer for a Violentmonkey userscript than immediate push-to-release (`semantic-release`). Multiple agent PRs can merge into `main`, get verified together (including live Pikabu acceptance checks), and ship as **one** clean version bump to Violentmonkey users when the maintainer merges the Release PR.
3. **Changeset files (`.changeset/*.md`)**:
   - Conflict-free across parallel branches (random filenames), and decouples user-facing wording from internal commits.
   - Drawback: Agents must remember to generate a valid frontmatter `.changeset/*.md` file (non-interactive, since `pnpm changeset` is an interactive TTY prompt!). Without a CI check enforcing changeset presence, agents will periodically omit them.
4. **Direct `CHANGELOG.md` edits**:
   - Poor for multi-agent work: every feature branch touches lines 8–15 of `CHANGELOG.md`, guaranteeing rebase/merge conflicts.

---

## 4. GitHub Actions Mechanics & the `GITHUB_TOKEN` Limitation

### 4.1 The Exact `GITHUB_TOKEN` Constraint

Per GitHub's official documentation ([Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow), [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)):

- **Anti-recursion rule**: Actions performed with the built-in `GITHUB_TOKEN` (such as pushing a commit, pushing a `v*` tag, or creating a GitHub Release) **do not trigger new workflow runs**.
  - **Consequence for this repo**: If Release Please (or Changesets / `changelogen`) creates tag `v0.1.9` using `secrets.GITHUB_TOKEN`, the existing `.github/workflows/release.yml` (`on: push: tags: ["v*"]`) **will NOT run**, leaving the GitHub Release with **no `.user.js` or `.meta.js` assets** — breaking Violentmonkey's `releases/latest/download/...` install/update URLs!
- **Documented exceptions**:
  1. `workflow_dispatch` and `repository_dispatch` events _do_ trigger runs with `GITHUB_TOKEN`.
  2. `pull_request` events (`opened`, `synchronize`, `reopened`) created by `GITHUB_TOKEN` create runs in an **approval-required** state (a user with write access must click to approve CI runs on the Release PR).
- **Repository permission prerequisite**: For any workflow using `GITHUB_TOKEN` to open Release PRs (Release Please / Changesets), the repository setting **Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"** must be enabled. It is **disabled by default** on personal repositories ([Managing GitHub Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests)).

### 4.2 Three Clean Solutions for Building & Uploading `.user.js` + `.meta.js`

#### Option A: Single-Workflow Chained Job using `GITHUB_TOKEN` _(Recommended Default)_

Keep everything in `.github/workflows/release.yml` triggered on `push` to `main`. Job 1 runs `googleapis/release-please-action@v5` and exports `release_created` and `tag_name`. Job 2 (`needs: release-please`, `if: ${{ needs.release-please.outputs.release_created == 'true' }}`) checks out the release tag, builds `dist/userscript/*`, and uploads both assets to the already-created GitHub Release with `gh release upload`:

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - id: release
        uses: googleapis/release-please-action@v5 # pin to full commit SHA in production
        with:
          token: ${{ github.token }}

  publish-assets:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          package-manager-cache: false
      - name: Build userscript assets
        run: |
          pnpm_version="$(node -p 'require("./package.json").devEngines.packageManager.version')"
          npm install --global "pnpm@$pnpm_version"
          pnpm install --frozen-lockfile
          pnpm run build
      - name: Upload release assets
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release upload "${{ needs.release-please.outputs.tag_name }}" --clobber \
            dist/userscript/pikabu-expand-comments.user.js \
            dist/userscript/pikabu-expand-comments.meta.js
```

- **Pros**: Zero long-lived secrets or PATs; least-privileged ephemeral `GITHUB_TOKEN`; atomic single-workflow visibility; avoids tag-trigger recursion completely.
- **Subtlety**: There is a ~30–60s window between Release Please creating the GitHub Release and `publish-assets` uploading the `.user.js`/`.meta.js` files. To eliminate even that brief window where `releases/latest/download/...` lacks assets, configure `"draft": true` in `release-please-config.json` and finalize with `gh release edit "$TAG" --draft=false` immediately after `gh release upload`!
- **Caveat**: If branch protection on `main` requires CI status checks to pass before merging the Release PR, PRs opened by `GITHUB_TOKEN` will sit in approval-required state for CI checks until approved or switched to Option B.

#### Option B: GitHub App Installation Token (`actions/create-github-app-token`)

Mint a short-lived installation token inside the Release Please workflow via [actions/create-github-app-token](https://github.com/actions/create-github-app-token) scoped strictly to `permission-contents: write` and `permission-pull-requests: write`.

- **Pros**:
  - Release PRs automatically trigger CI workflows (no approval gate).
  - Tags created by the App token _do_ trigger a separate `on: push: tags: ["v*"]` workflow (so existing `.github/workflows/release.yml` can stay intact and also support manual tag pushes).
  - Not tied to a personal user account; tokens expire automatically; can be granted ruleset bypass cleanly.
- **Cons**: Requires one-time setup of a personal/org GitHub App + storing `APP_ID` variable and `APP_PRIVATE_KEY` secret.

#### Option C: Fine-Grained Personal Access Token (PAT)

Same triggering benefits as a GitHub App, stored as a repository secret (`RELEASE_PLEASE_TOKEN`) with `Contents: Read and write` and `Pull requests: Read and write` scoped to this repository.

- **Cons**: Tied to a personal account, expires and requires manual rotation, and carries higher risk if leaked (as warned in both GitHub and `semantic-release` docs). Prefer Option A (single workflow) or Option B (GitHub App) over a PAT.

---

## 5. Local Violentmonkey Test Installs Without Bumping `package.json`

### 5.1 Violentmonkey `@version` Parsing & Comparison Rules

Per Violentmonkey's official [Metadata Block documentation](https://violentmonkey.github.io/api/metadata-block/#version):

- `@version` is required for automatic updates (if omitted, the script will not update automatically).
- Format: _"composed of several parts, joined by `.`. Each part must start with numbers, and can be followed by alphabetic characters."_ Example from docs: `// @version 1.2a.3`.
- **Critical comparison rule**: **Alphabetic characters are NOT used for version comparison.** Violentmonkey compares the leading numeric values of each dot-separated segment (e.g., `1.2a.3` compares numerically as `[1, 2, 3]`), rather than implementing SemVer 2.0.0 pre-release precedence (`1.0.0-alpha < 1.0.0`).

### 5.2 Why Naive SemVer Pre-Releases Break Local Testing

Because Violentmonkey ignores non-numeric suffixes when comparing segments:

- `0.1.9-dev.1` has segments starting with `[0, 1, 9, 1]`, while the eventual stable release `0.1.9` has `[0, 1, 9]` (`[0, 1, 9, 0]`).
- Under dot-numeric comparison, **`0.1.9-dev.1` > `0.1.9`**! If you install `0.1.9-dev.1` locally, Violentmonkey will **refuse to auto-update** when official `0.1.9` is published.
- Similarly, `0.1.8-dev` compares **equal** to `0.1.8` (`[0, 1, 8]` == `[0, 1, 8]`), so Violentmonkey may treat it as the same version rather than an upgrade.

### 5.3 Clean, Monotonic Local Dev Versioning Strategy

Keep `package.json` strictly at the last released stable version (`0.1.8`) on all feature branches and in `AGENTS.md`. Update `lib/build.mts` to support an opt-in local test build mode (e.g., `pnpm run build:dev` or `USERSCRIPT_DEV=1` / `--dev` flag) that computes the emitted `@version` **only in `dist/userscript/`** without modifying `package.json`:

```text
<package.json version>.<YYYYMMDDHHMM>   (e.g., 0.1.8.202611221045)
```

(Or `<version>.<unix-timestamp>` / `<version>.<YYYYMMDDHHMMSS>` for sub-minute rebuilds.)

Let's verify the Violentmonkey comparison order across the full lifecycle:

1. **Installed stable release**: `0.1.8` → `[0, 1, 8, 0]`
2. **Local test build #1**: `0.1.8.202611221030` → `[0, 1, 8, 202611221030]` (**> `0.1.8`** → cleanly upgrades in Violentmonkey)
3. **Local test build #2**: `0.1.8.202611221045` → `[0, 1, 8, 202611221045]` (**> build #1** → cleanly upgrades in Violentmonkey)
4. **Next official GitHub Release**: `0.1.9` → `[0, 1, 9, 0]` (**> `0.1.8.202611221045`** because segment 3 `9 > 8` → Violentmonkey cleanly auto-updates back to the official release!)

**Additional detail for `@updateURL` / `@downloadURL` in dev builds**:

- **Keep `@updateURL` / `@downloadURL` pointing to `releases/latest/download`** if you want test profiles to automatically converge onto `0.1.9` once released (note: while `latest` is still `0.1.8`, Violentmonkey sees `0.1.8 < 0.1.8.<timestamp>`, so it will **not** downgrade your local test build!).
- **Omit `@updateURL` / `@downloadURL`** in dev builds (or change `@name` suffix like `(dev)`) only if you want isolated side-by-side dev installation that never auto-updates. Keeping the same `@name`/`@namespace` + `0.1.8.<timestamp>` is ideal when testing in-place upgrades over the production script and preserving `GM.getValue` / `GM.setValue` storage.

This lets `AGENTS.md` replace the manual `package.json` patch-bump rule with: _"Never bump `package.json` manually; use `pnpm run build:dev` for local Violentmonkey testing and report the emitted `@version`."_

---

## 6. Node 24 / Node 26 & pnpm 12 Compatibility Notes

- **GitHub Actions Node 24 runner transition**: GitHub switched JavaScript actions to Node.js 24 by default on **June 16, 2026** and completely removed Node.js 20 from runners on **September 23, 2026** ([GitHub Changelog: Node 24 migration](https://github.blog/changelog/)). This repository already uses Node 24-ready SHA-pinned `actions/checkout@v7.0.1` and `actions/setup-node@v7.1.0`. Any adopted release action must run on `node24` (e.g., `googleapis/release-please-action@v5`, `changesets/action@v2`, or native/Rust binaries like `git-cliff` / `parse-changelog`), pinned by full commit SHA per repo style.
- **Node 26 runtime (`.nvmrc`: `26.13.1`)**: `lib/build.mts` executes directly via `node lib/build.mts` using native TypeScript type-stripping (enabled by default from Node 24+ onward). Release scripts that invoke `pnpm run build` inherit `.nvmrc` cleanly via `actions/setup-node`.
- **pnpm 12 (`devEngines.packageManager`)**: `package.json` declares `pnpm@12.21.0` with `"onFail": "download"` ([pnpm `devEngines` docs](https://pnpm.io/package_json#devengines)). Either the repo's existing `npm install --global "pnpm@$pnpm_version"` pattern or the official `pnpm/action-setup` (v4+/v5+, or its pnpm 11/12+ successor `pnpm/setup`) reads `devEngines.packageManager` directly ([pnpm/action-setup](https://github.com/pnpm/action-setup)).

---

## 7. Concrete Recommendation for `lolmaus/pikabu-expand-comments`

1. **Primary recommendation — Release Please (`googleapis/release-please-action@v5`) in manifest mode + single-workflow draft-then-publish asset upload**:
   - Leverages the Conventional Commits + `commitlint` + `lefthook` setup already in the repo with **zero** extra files for AI agents to maintain and **zero** merge conflicts across parallel branches.
   - Manifest config (`release-please-config.json` + `.release-please-manifest.json`):
     - `"release-type": "node"`, root package `"."`, `"bump-minor-pre-major": true`, `"draft": true` (so the release is only published after `.user.js` + `.meta.js` are uploaded and verified!).
   - Single workflow on `push` to `main` using `GITHUB_TOKEN`: `release-please` job → `publish-assets` job (`needs: release-please`, `if: ${{ needs.release-please.outputs.release_created == 'true' }}`) builds `dist/userscript/*`, uploads with `gh release upload --clobber`, then publishes with `gh release edit "$TAG" --draft=false`.
   - Upgrade to a GitHub App token (`actions/create-github-app-token`) _only_ if branch protection later requires automated CI checks to run on the Release PR without manual approval.
2. **Runner-up — `bumpp` (local) + `changelogithub` / `git-cliff` (CI on `v*` tag)**:
   - Best choice if the maintainer prefers zero GitHub Release PRs and wants to manually cut releases from a local terminal (`pnpm exec bumpp`) while keeping the existing `on: push: tags: ["v*"]` workflow untouched.
3. **Local Violentmonkey testing (independent of release tool)**:
   - Stop bumping `package.json` on every edit. Add a `build:dev` script in `package.json` / `lib/build.mts` emitting `@version <pkgVersion>.<YYYYMMDDHHMM>` (pure numeric 4th segment), which strictly upgrades over `<pkgVersion>` and strictly upgrades _into_ the next stable release in Violentmonkey without touching git-tracked files.

---

## 8. Primary Sources Cited

1. **Conventional Commits 1.0.0**: <https://www.conventionalcommits.org/en/v1.0.0/>
2. **Release Please (core & manifest config)**: <https://github.com/googleapis/release-please> · <https://github.com/googleapis/release-please/blob/main/docs/manifest-releasers.md> · <https://github.com/googleapis/release-please/blob/main/docs/customizing.md>
3. **Release Please GitHub Action**: <https://github.com/googleapis/release-please-action> · <https://github.com/googleapis/release-please-action/releases>
4. **Changesets & Changesets Action**: <https://github.com/changesets/changesets> · <https://github.com/changesets/changesets/blob/main/docs/config-file-options.md> · <https://github.com/changesets/action>
5. **semantic-release**: <https://semantic-release.gitbook.io/semantic-release> · <https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions> · <https://github.com/semantic-release/github> · <https://github.com/semantic-release/git>
6. **git-cliff & Action**: <https://git-cliff.org/docs/usage/bump-version> · <https://github.com/orhun/git-cliff> · <https://github.com/orhun/git-cliff-action>
7. **changelogen, bumpp & changelogithub**: <https://github.com/unjs/changelogen> · <https://github.com/antfu-collective/bumpp> · <https://github.com/antfu-collective/changelogithub>
8. **Keep a Changelog 1.1.0 & parse-changelog**: <https://keepachangelog.com/en/1.1.0/> · <https://github.com/taiki-e/parse-changelog> · <https://github.com/taiki-e/create-gh-release-action>
9. **GitHub Actions (`GITHUB_TOKEN`, workflow triggers, PR creation permissions, App tokens)**:
   - <https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/automatic-token-authentication>
   - <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
   - <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
   - <https://github.com/actions/create-github-app-token>
10. **Violentmonkey Metadata Block (`@version`, `@updateURL`, `@downloadURL`)**: <https://violentmonkey.github.io/api/metadata-block/#version>
11. **pnpm `devEngines` & Actions setup**: <https://pnpm.io/package_json> · <https://github.com/pnpm/action-setup>
