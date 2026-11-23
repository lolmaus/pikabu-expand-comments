---
name: pikabu-ui-critic
description: Visual audit and host-native UI critique workflow for Pikabu.ru controls. Use when designing, modifying, or reviewing on-page or extension UI, running `pnpm run ui:capture` or `pnpm run ui:audit`, or critiquing Pikabu light/dark screenshots.
---

Host-native UI review loop for Pikabu Expand Comments. Goal: controls look native to Pikabu.ru across light and dark themes, cause zero layout distortion, and pass WCAG 2.1 AA inside Shadow DOM.

## 1. Pikabu Token & Layout Contract

All tokens inherit across Shadow DOM and switch via `:root[data-theme-dark]`.

| Role                             | Token                                                    | Light                             | Dark                              |
| -------------------------------- | -------------------------------------------------------- | --------------------------------- | --------------------------------- |
| Page background                  | `--color-black-300` / `--s-colorBg-tonned`               | `#f7f8fc`                         | `#222326`                         |
| Card / menu surface              | `--color-bright-800` / `--s-colorBg-clear`               | `#fcfdff`                         | `#292a2e`                         |
| Hairline border                  | `--color-black-430` / `--s-colorBg-stroke`               | `#ebedf2`                         | `#37393d`                         |
| Gray button / `.comment__more`   | `--color-black-440`                                      | `#e7e8ea`                         | `#2d3236`                         |
| Primary / secondary / muted text | `--color-black-940` / `-800` / `-700`                    | `#1b1e24` / `#444850` / `#70737b` | `#e0e3ea` / `#b9bdc7` / `#8f939d` |
| Active tab / green accent        | `--color-primary-900` / `--color-primary-700`            | `#65ab3c` / `#8bca58`             | `#618f45` / `#638c47`             |
| Soft green hover / danger        | `--color-primary-100` / `--color-danger-800`             | `#f8fff2` / `#f75c48`             | `#282f2e` / `#ca4533`             |
| Popover / floating shadow        | `--shadow-medium` / `--shadow-default`                   | `0 4px 20px rgba(0,0,0,.08)`      | `0 4px 20px rgba(0,0,0,.24)`      |
| Modern button (`S`)              | `--c-btn-S-*`, `--c-btn-primary-*`, `--c-btn-secondary*` | `13/16px`, `r:12px`, `#89cc52`    | `#67993d`, `#45474d`              |
| Counter pill / tooltip           | `--c-counter-*`, `--c-tooltip-base-*`                    | `#f2f3f7`/`#757880`, `#fcfdff`    | `#45474d`/`#dcdee5`, `#45474d`    |

Layout invariants:

- Prefer `--color-black-430` / `--s-colorBg-stroke` or borderless Pikabu buttons; avoid `--color-black-400` in dark mode (`#65686b` outline glare).
- `.story-comments__menu` is `50px` tall (`48px` inner) with `overflow: hidden` and `.menu_horizontal { width: 100% }` (~`444px` free right width at `1280px`). Top `:host` must use `flex: 0 0 auto`, stay single-row at `<= 36px`, and keep active-tab underline flush at `0px`.
- Settings popover must render in the top layer (`popover="auto"`) or `position: fixed` so `overflow: hidden` cannot clip it and toggling causes `0px` height shift.
- Bottom controls mount as immediate sibling after `.comments__container` inside `section.comments` (above `section[data-role="answer"]`).

## 2. Capture, P0 Gates & Static Audit

1. Run `pnpm run ui:capture` to rebuild and write baseline-vs-injected light/dark PNGs (`1280x800`, `1024x800`, top & bottom controls) + `tmp/visual-review/metrics.json`.
2. Run `pnpm run ui:audit` to enforce all deterministic Playwright P0 gates (`tests/visual/p0-gates.spec.ts`).
3. Run the `web-design-guidelines` skill on touched UI files for static a11y/focus/keyboard audit.

## 3. Fresh-Context Critic Loop (2-3 Rounds Max)

After capture, launch a **fresh-context Critic subagent** (zero generator history) to inspect `tmp/visual-review/**/*.png` and `tmp/visual-review/metrics.json` against the rubric below.

### Rubric

- **P0 (Blocker)**: `> 1px` tab-bar height or native-tab displacement across mount/states/settings toggle, active-tab underline detach `> 1px`, horizontal overflow, clipping/overlap, unexpected CLS `> 0`, empty or fallback-leaked Pikabu CSS token, `@axe-core/playwright` violation, WCAG contrast `< 4.5:1` text or `< 3:1` UI/borders/focus, broken keyboard/ARIA state.
- **P1 (Host-Native Mismatch)**: Visibly injected look — mismatched button height, padding, radius, border weight, typography, vertical alignment, jarring hover/color treatment, or status crowding native tabs.
- **P2 (Micro-UX Polish)**: Spacing rhythm, `1024px` tightness, floating Stop shadow/placement, verbose Russian copy.

### Critic Output & Completion Criterion

Require the Critic to return:

1. **Verdict**: `PASS` (zero P0 and zero P1) or `REVISE`.
2. **Findings table**: `[Severity | Theme/Viewport/State | Evidence (PNG + metric) | Concrete CSS/DOM fix]`.
3. Only host-native fixes that blend closer to `00-baseline-no-script.png` (no generic redesigns).

Fix every P0 and P1 finding, re-run `pnpm run ui:capture` + `pnpm run ui:audit`, and re-dispatch a fresh Critic until `PASS` (cap at 3 rounds; surface unresolved trade-offs to the user).
