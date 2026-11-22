# Modern AI-Driven UI Design and Visual Critique Workflows, Skills, and Tooling

> Research note for Wayfinder Map #17 / Ticket #20 (`lolmaus/pikabu-expand-comments`).
> Scope: Practical, high-signal, low-maintenance AI design and visual critique workflows usable for both **Iteration 1.5** (host-native Shadow DOM polish on Pikabu.ru) and **Iteration 2** (expanded UI and controls).

## Executive Summary & Ranked Recommendations

Most popular AI frontend design workflows optimize for **greenfield originality** (fighting bland SaaS templates with bold typography and distinctive aesthetics). A userscript mounted inside Pikabu.ru's comment tab bar (`src/ui/expansion-control.ts`) has the **opposite** aesthetic goal: **host-native invisibility**, zero layout distortion, strict light/dark theme parity, and accessible contrast inside an encapsulated Shadow DOM.

The highest-ROI workflow for this repo separates **deterministic browser verification** (Playwright geometry, contrast, and multi-state screenshot capture) from **fresh-context multimodal critique** (an independent Critic agent grading baseline-vs-injected screenshots against a host-native rubric), backed by one lightweight code-audit skill.

### Recommendations Ranked by Signal-to-Noise Ratio & Maintenance Cost

| Rank | Practice / Tool                                                                                                                            | Signal-to-Noise       | Maintenance Cost | Verdict for This Repo                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Playwright Test capture + geometry/CLS assertions** (reusing `@playwright/test` `1.65.1` already in `package.json`)                      | Very High             | Very Low         | **Adopt in Iter 1.5** — deterministic gate for zero tab-bar distortion, light/dark token parity, and multi-state screenshot generation                                                                  |
| 2    | **Fresh-context Generator → Critic loop with host-native rubric** (Anthropic evaluator-optimizer pattern, reweighted for host integration) | Very High             | Very Low         | **Adopt in Iter 1.5** — eliminates single-agent self-praise bias with zero extra dependencies                                                                                                           |
| 3    | **`@axe-core/playwright` + Shadow DOM computed-contrast helper**                                                                           | High                  | Low              | **Adopt in Iter 1.5** — catches WCAG 1.4.3 / 1.4.11 & ARIA regressions; helper covers `axe-core`'s Shadow DOM `incomplete` contrast gap                                                                 |
| 4    | **`vercel-labs/agent-skills` (`web-design-guidelines`) via `npx skills add`**                                                              | High                  | Very Low         | **Adopt in Iter 1.5** — fits existing `skills-lock.json` workflow; terse `file:line` audit for focus rings, a11y, keyboard, motion, copy                                                                |
| 5    | **Repo-local `.agents/skills/pikabu-ui-critic/SKILL.md`**                                                                                  | High                  | Low              | **Adopt in Iter 2** — encodes Pikabu's extracted CSS tokens, capture command, and host-native rubric via progressive disclosure                                                                         |
| 6    | **`pbakaus/impeccable`** (`critique`, `audit`, `quieter`, `harden`)                                                                        | Medium-High           | Low-Medium       | **Optional in Iter 2** — strong structured UX critique vocabulary (`P0–P3`) and `DESIGN.md` context support; overkill for a two-button toolbar, useful if settings/panels grow                          |
| 7    | **`@playwright/cli`** (`microsoft/playwright-cli`)                                                                                         | Medium-High           | Low              | **Ad-hoc only** — token-efficient CLI browser inspection when poking live Pikabu pages; no need to commit as a repo dependency                                                                          |
| 8    | **Playwright MCP (`microsoft/playwright-mcp`) & Chrome DevTools MCP (`ChromeDevTools/chrome-devtools-mcp`)**                               | Medium                | Medium           | **Defer / Ad-hoc only** — MCP tool schemas + repeating accessibility snapshots add token overhead and local server setup; only reach for Chrome DevTools MCP when debugging live CDP cascade/CLS traces |
| 9    | **`anthropics/skills` (`frontend-design`)**                                                                                                | Low (for userscripts) | Very Low         | **Skip for Pikabu UI** — explicitly pushes bold, boutique aesthetics and custom display typography, which conflicts with blending into Pikabu.ru                                                        |
| 10   | **CI pixel-golden `toHaveScreenshot()` baselines**                                                                                         | Low-Medium            | High             | **Defer unless containerized** — cross-OS font/antialiasing drift creates false failures unless locked to a pinned Linux container                                                                      |

---

## 1. Designer + Critic Loop Architectures

### Why Single-Agent Self-Critique Fails

Primary-source engineering write-ups from Anthropic document two failure modes when a single coding agent designs and critiques its own UI:

1. **Distributional convergence ("AI slop"):** Without targeted design constraints, frontier models converge on statistical averages from training data—generic sans-serif defaults, boilerplate borders/shadows, and templated widget styling ([Anthropic — Improving frontend design through Skills](https://claude.com/blog/improving-frontend-design-through-skills)).
2. **Self-evaluation bias:** When the same context window generates code and then evaluates its own output, the model exhibits sunk-cost leniency—rationalizing layout flaws, subtle visual clashes, or incomplete states as "acceptable" ([Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)).

### The Evaluator-Optimizer & Generator-Evaluator Pattern

Anthropic's foundational agent architecture guide ([Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)) distinguishes deterministic **workflows** from open-ended **agents**, recommending the simplest composable pattern that fits. Among its core patterns, **evaluator-optimizer** is explicitly recommended when:

- Clear, articulated evaluation criteria exist, and
- Iterative feedback produces measurable quality gains.

In [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps), Anthropic extends this into a GAN-inspired **Planner → Generator → Evaluator** architecture for frontend work:

- **Context separation:** The Evaluator runs in a separate, skeptical session with no memory of the Generator's implementation rationalizations.
- **Live execution over static reading:** Rather than critiquing source code alone, the Evaluator renders and interacts with the live UI in a real browser (via Playwright), inspecting actual screenshots and interactive states.
- **Explicit weighted rubric + few-shot calibration:** Anthropic graded frontend output across four dimensions—**Design Quality** (heavy weight), **Originality** (heavy weight), **Craft** (baseline competence), and **Functionality** (baseline usability)—calibrated with concrete examples so lenient passes cannot slip through.

OpenAI's frontend engineering guidance for Codex similarly centers on grounding implementation in the target project's actual design tokens and component rules (captured in `AGENTS.md` or design specs), then closing the loop with Playwright browser verification across rendered states and screenshots rather than trusting static CSS edits ([OpenAI Developers](https://openai.com)).

### Reweighting the Critic Rubric for Host-Native Injected UI

Anthropic overweighted **Originality** because greenfield web apps suffer from generic templates. For an injected Pikabu.ru userscript, **Originality is an active failure mode**—any "distinctive" styling makes the control stick out like a foreign browser extension.

For `pikabu-expand-comments`, invert the weights into a **Host-Native Visual Critique Rubric**:

| Dimension                             | Weight             | What the Critic Grades                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Layout Non-Distortion**          | **Hard Gate (P0)** | Zero change in comment tab-bar height (`<= 1px`), zero wrapping or shifting of Pikabu's native tabs (`Лучшие`, `По порядку`, etc.) across mount, status updates, and settings open/close. No horizontal overflow at desktop or narrow widths.                 |
| **2. Accessibility & Contrast Craft** | **Hard Gate (P0)** | WCAG 2.1 AA text contrast (`>= 4.5:1`), non-text UI border/control/focus-ring contrast (`>= 3:1`) in **both** light and dark themes, keyboard reachability, clear `aria-expanded` / `role="status"` announcements, and `>= 44px` coarse-pointer targets.      |
| **3. Host-Native Visual Integration** | **Heavy (P1)**     | Control height, vertical baseline alignment, border radius, stroke weight, background surface, hover/active states, font size/weight, and spacing rhythm match adjacent native Pikabu controls closely enough that a regular user cannot tell it is injected. |
| **4. State & Micro-UX Clarity**       | **Medium (P2)**    | Crisp Russian micro-copy across all 5 states (`idle`, `running`, `stopped`, `error`, `completed`), unobtrusive floating Stop shortcut when scrolled past the header, clean visual hierarchy between primary action, settings trigger, and status text.        |

### Recommended Loop Cadence for This Repo

Keep the workflow bounded and deterministic (not an unbounded autonomous loop):

1. **Generate / Edit** (`src/ui/expansion-control.ts` and supporting modules).
2. **Deterministic Capture & Gate** (one Playwright command): runs geometry assertions, `@axe-core/playwright` + computed contrast checks, and writes labeled PNGs (`baseline` vs `injected` across states, light/dark themes, and desktop/narrow viewports) plus a compact `metrics.json` to a gitignored folder (e.g., `tmp/visual-review/`).
3. **Fresh-Context Multimodal Critique**: invoke an independent Critic subagent (fresh conversation, no generation history) that reads ONLY the rubric, `metrics.json`, and the baseline-vs-injected PNGs. It emits severity-ranked findings (`P0` blocker / `P1` host mismatch / `P2` polish) with concrete CSS/DOM remediation targets.
4. **Fix & Re-verify**: apply targeted fixes, re-run the Playwright capture script, and re-check with the Critic. Cap at **2–3 cycles**; stop immediately once all deterministic gates pass and `P0`/`P1` count is zero.

---

## 2. Reusable Agent Skills & Prompts Survey

### How This Repo Already Installs Skills

This repo already uses the open **Agent Skills** format ([agentskills.io](https://agentskills.io)) managed via `skills-lock.json` (version 2) and `.agents/skills/`:

- **Progressive disclosure (3 tiers):** Per the [Agent Skills specification](https://agentskills.io), agents load only YAML frontmatter (`name`, `description`; ~50–100 tokens) for discovery (Tier 1), load the full `SKILL.md` body only when triggered (Tier 2), and read `references/` or execute `scripts/` only when needed (Tier 3).
- **CLI management:** `vercel-labs/skills` ([github.com/vercel-labs/skills](https://github.com/vercel-labs/skills)) installs project-local skills into `.agents/skills/` and records pinned commit/content hashes in `skills-lock.json`:
  ```bash
  npx skills add <owner/repo> --skill <skill-name>
  ```

### Survey of Real, Maintained Primary-Source Design & Critique Skills

| Skill / Pack                               | Primary Repository                                                                                                                                                                   | Install Command                                                                                                | Focus & Strengths                                                                                                                                                                                                                                                                           | Fit for `pikabu-expand-comments`                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`web-design-guidelines`**                | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (rules from [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines)) | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines`                                        | Audits UI files against 100+ concrete web interface rules (ARIA, keyboard & focus-visible states, dark-mode safety, `prefers-reduced-motion`, layout stability, button copy). Outputs terse `file:line` findings.                                                                           | **High fit (Adopt now).** Low token overhead, directly complements visual pixel review with code-level UI/a11y checks. Caveat: static code audit only—must still pair with Playwright rendered checks.                                                                                                    |
| **Impeccable**                             | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) ([impeccable.style](https://impeccable.style))                                                                           | `npx skills add pbakaus/impeccable` (or `npx impeccable install`; static scanner `npx impeccable detect src/`) | Comprehensive design vocabulary (24+ commands) including `/impeccable critique` (structured UX critique), `/impeccable audit` (P0–P3 technical/a11y audit), `/quieter`, `/distill`, `/harden`, `/polish`, plus `DESIGN.md` context awareness and 62 deterministic local anti-pattern rules. | **Medium-High fit (Optional for Iter 2).** `/critique`, `/audit`, `/quieter`, and `/harden` are well aligned with refining dense UI. Overweight for Iteration 1.5's small toolbar; `detect` rules mainly target standard web apps rather than Shadow DOM strings inside `CSSStyleSheet.replaceSync(...)`. |
| **`frontend-design`**                      | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design)                                                                                           | `npx skills add https://github.com/anthropics/skills --skill frontend-design`                                  | Enforces pre-code design plan (4–6 custom hex tokens, distinctive font pairings, bold aesthetic direction) and anti-slop self-critique.                                                                                                                                                     | **Poor fit for Pikabu UI (Skip).** Optimized for greenfield visual differentiation; pushes agents _away_ from inheriting host site styles. Only relevant if building a standalone landing/docs page.                                                                                                      |
| **Repo-local `pikabu-ui-critic`** (custom) | `.agents/skills/pikabu-ui-critic/SKILL.md` (proposed)                                                                                                                                | Checked into repo                                                                                              | Encodes Pikabu's live CSS custom properties, the exact Playwright capture command, and the host-native P0–P3 rubric in <100 lines.                                                                                                                                                          | **Highest long-term ROI (Iter 2).** Zero external drift, tailored to Shadow DOM injection and Russian UI copy.                                                                                                                                                                                            |

---

## 3. Browser / Visual MCPs & Playwright Tooling Comparison

This repo already ships `@playwright/test` `1.65.1` with both offline (`playwright.config.mts`) and live (`playwright.live.config.mts`) Chromium configs. Evaluating additional browser/visual tooling against that baseline yields clear trade-offs:

| Tool                                            | Primary Source                                                                              | Architecture                                                                                                    | Context / Token Cost                                                                                          | Best Role in This Repo                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Playwright Test scripts** _(installed)_       | [playwright.dev](https://playwright.dev/docs/test-snapshots)                                | Deterministic Node/TS test runner driving Chromium directly                                                     | **Minimal** — outputs concise pass/fail + compact JSON + targeted cropped PNGs                                | **Primary workhorse.** Runs automated geometry/CLS assertions, light/dark theme switching, and batch screenshot capture in one reproducible command.                                                                                          |
| **Playwright CLI (`@playwright/cli`)**          | [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)                     | Shell commands + optional `SKILL.md`; writes accessibility `.yml` snapshots & PNGs to disk on demand            | **Low** — avoids injecting bulky MCP schemas or accumulating full accessibility trees in conversation history | **Best ad-hoc exploration tool** when an agent needs to inspect a live Pikabu page interactively without setting up an MCP server.                                                                                                            |
| **Playwright MCP (`@playwright/mcp`)**          | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)                     | Persistent MCP server returning accessibility-tree snapshots (`[ref=e...]`) and screenshots via JSON tool calls | **Moderate-High** — tool definitions + multi-turn accessibility trees compound in context                     | **Not needed for this repo.** Useful in Anthropic's multi-hour full-stack harness for exploratory QA, but redundant with our existing Playwright Test harness and heavier on tokens.                                                          |
| **Chrome DevTools MCP (`chrome-devtools-mcp`)** | [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Official Google Chrome MCP server over CDP + Puppeteer (`npx chrome-devtools-mcp@latest`)                       | **Moderate-High** — exposes rich CDP tool suite (performance traces, network, console, computed styles)       | **Optional deep-debug tool only.** Shines for live Core Web Vitals / CLS tracing (`performance_start_trace` / `performance_stop_trace`) and live CSS cascade inspection against Pikabu, but unnecessary overhead for routine PR verification. |
| **`@axe-core/playwright`**                      | [dequelabs/axe-core-npm](https://github.com/dequelabs/axe-core-npm)                         | In-page `axe-core` audit integrated directly into Playwright tests                                              | **Minimal** — structured JSON `violations` and `incomplete` arrays                                            | **Adopt in Iter 1.5.** Natively pierces **open** Shadow DOM (`src/ui/expansion-control.ts` uses `mode: "open"`).                                                                                                                              |

### Critical Caveat: `axe-core` Color Contrast Inside Shadow DOM

Per [dequelabs/axe-core-npm](https://github.com/dequelabs/axe-core-npm) and `axe-core` Shadow DOM behavior:

1. `AxeBuilder` automatically traverses **open** shadow roots (`mode: "open"`), and supports scoping via array-path selectors (`['#shadow-host', 'button']`). Closed shadow roots (`mode: "closed"`) cannot be inspected—keep `attachShadow({ mode: "open" })`.
2. **`color-contrast` frequently reports `incomplete` rather than `violations` inside Shadow DOM** when elements have transparent backgrounds composited over host-page surfaces or custom stacking contexts.
3. **Mitigation:** Always assert on both `results.violations` and inspect `results.incomplete` for `color-contrast`, and pair `axe-core` with a small deterministic Playwright contrast check (Section 4.3) that walks up through `el.parentElement ?? (el.getRootNode() as ShadowRoot).host` to composite the true painted background against WCAG 2.1 Level AA thresholds:
   - **Normal text:** `>= 4.5:1` ([W3C WCAG 2.1 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum))
   - **UI component boundaries, borders, checkboxes, focus outlines:** `>= 3.0:1` ([W3C WCAG 2.1 SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast))

### Note on Playwright `toHaveScreenshot()` Visual Regression

Playwright's `expect(locator).toHaveScreenshot()` ([Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots)) supports `animations: "disabled"`, `mask`, and `stylePath` (which pierces Shadow DOM). However, font hinting and sub-pixel antialiasing differ across macOS, Windows, and Linux, so checked-in pixel baselines cause frequent false positives unless generated inside a pinned Linux Docker container. For this small repo:

- Use **deterministic DOM geometry + computed token/contrast assertions** as always-on CI checks.
- Use **Playwright `locator.screenshot()` artifacts + fresh-context Critic review** for visual polish on UI changes, without committing brittle golden PNGs to Git.

---

## 4. Host-Native Injected Shadow DOM UI Techniques (Pikabu.ru Specific)

Inspecting `src/ui/expansion-control.ts` reveals three concrete architectural realities that any design/critique harness for this repo must test directly:

1. **CSS Custom Properties pierce Shadow DOM**, while host selectors do not ([MDN — Using shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)). `src/ui/expansion-control.ts` already relies on `--color-black-940`, `--color-black-400`, `--color-black-300`, `--color-black-800`, `--color-primary-900`, and `--color-black-alpha-16` with hardcoded **light-theme** hex fallbacks (`#1b1e24`, `#f7f8fc`, etc.). If Pikabu renames or changes scoping on any variable in dark mode, the light fallback silently activates and breaks dark-theme contrast.
2. **Inline settings expansion currently mutates host flex layout:** Clicking `Настройки` toggles `preference.hidden` inside `:host` appended directly to `menu`. In a constrained comment tab bar, expanding an inline checkbox+label (`"Раскрывать комментарии при открытии поста"`) can increase `menu`'s height or wrap controls. Promoting transient settings disclosures to the browser **top layer** via the HTML **Popover API** (`popover="auto"`, [MDN — Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)) works natively inside Shadow DOM, avoids `z-index` battles with sticky host headers, provides built-in `Escape` / light-dismiss, and guarantees **zero tab-bar layout shift** on toggle.
3. **Host dark mode may not rely solely on `prefers-color-scheme`:** Pikabu.ru switches themes via site classes/attributes/cookies as well as or instead of system media queries, so offline fixtures must reproduce Pikabu's actual light and dark token sets (not only `page.emulateMedia({ colorScheme })`).

### Concrete 4-Part Verification Protocol

#### 4.1 Live CSS Token Extraction & Fallback-Leak Check

Add a small extraction helper (run via `test:live` or an opt-in capture script) that inspects Pikabu's live comment header in both light and dark themes and dumps the resolved tokens into our offline fixture / token reference:

```ts
const tokenNames = [
  "--color-black-940",
  "--color-black-800",
  "--color-black-400",
  "--color-black-300",
  "--color-primary-900",
  "--color-black-alpha-16",
];

const tokenAudit = await menu.evaluate((el, names) => {
  const cs = getComputedStyle(el);
  return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
}, tokenNames);

// Fail if any consumed Pikabu token is missing (would silently drop to light fallback!)
for (const [name, value] of Object.entries(tokenAudit)) {
  expect(value, `Expected Pikabu CSS variable ${name} to be defined`).not.toBe("");
}
```

Also sample computed styles (`height`, `fontSize`, `lineHeight`, `fontWeight`, `borderRadius`, `padding`, `color`, `backgroundColor`, `borderColor`) from an adjacent native Pikabu tab/button so the Designer and Critic share measured host baselines rather than guessing from memory.

#### 4.2 Zero Height-Shift & Zero Tab-Bar-Distortion Assertions

Use `Element.getBoundingClientRect()` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)) and optionally the Layout Instability API ([MDN — `LayoutShift`](https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift), [`LayoutShiftAttribution`](https://developer.mozilla.org/en-US/docs/Web/API/LayoutShiftAttribution)) across every state transition:

```ts
type RectSnapshot = {
  menu: { height: number; width: number; top: number; scrollWidth: number; clientWidth: number };
  tabs: Array<{ text: string; top: number; height: number; left: number; right: number }>;
};

async function measureTabBar(
  page: Page,
  menuSelector: string,
  tabSelector: string,
): Promise<RectSnapshot> {
  return page.evaluate(
    ({ menuSel, tabSel }) => {
      const menu = document.querySelector<HTMLElement>(menuSel)!;
      const m = menu.getBoundingClientRect();
      const tabs = [...menu.querySelectorAll<HTMLElement>(tabSel)].map((t) => {
        const r = t.getBoundingClientRect();
        return {
          text: (t.textContent ?? "").trim(),
          top: r.top,
          height: r.height,
          left: r.left,
          right: r.right,
        };
      });
      return {
        menu: {
          height: m.height,
          width: m.width,
          top: m.top,
          scrollWidth: menu.scrollWidth,
          clientWidth: menu.clientWidth,
        },
        tabs,
      };
    },
    { menuSel: menuSelector, tabSel: tabSelector },
  );
}
```

Assert across **Baseline (pre-mount) → Mounted (`idle`) → Settings Open → Settings Closed → `running` → `stopped` → `error` → `completed`**:

1. **Tab-bar height invariance (desktop):** `Math.abs(after.menu.height - baseline.menu.height) <= 1`.
2. **Native tab stability:** Every native tab keeps `Math.abs(tab.top - baseTab.top) <= 1` and `Math.abs(tab.height - baseTab.height) <= 1` (proving zero accidental line-wrap or vertical push).
3. **No horizontal overflow:** `after.menu.scrollWidth <= after.menu.clientWidth + 1` and `document.documentElement.scrollWidth <= window.innerWidth`.
4. **Zero unexpected CLS:** Collect `PerformanceObserver({ type: "layout-shift", buffered: true })` entries with `!entry.hadRecentInput` around mount; assert total shift `=== 0`.

#### 4.3 Shadow DOM Effective Contrast Check (Complementing `axe-core`)

Because `axe-core` can mark Shadow DOM elements as `incomplete` for `color-contrast`, compute WCAG 2.1 relative luminance in Playwright by walking up the shadow-inclusive ancestor chain (`el.parentElement ?? (el.getRootNode() as ShadowRoot).host`) to composite semi-transparent backgrounds over the host surface, then assert:

- Button text, status text, and settings label: contrast ratio `>= 4.5` (WCAG 1.4.3).
- Button borders, checkbox control, and `:focus-visible` outline against adjacent surface: contrast ratio `>= 3.0` (WCAG 1.4.11).

#### 4.4 Side-by-Side Baseline-vs-Injected Screenshot Matrix

Capture tight, consistent crops of the comment header (`menu` bounding box padded by ~24px top / ~100px bottom so any popover or wrapped status line is visible) across:

| Axis                     | Variants                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baseline vs Injected** | `00-baseline-no-script`, `01-idle`, `02-settings-open`, `03-running`, `04-running-floating-stop` (scrolled viewport), `05-stopped`, `06-error`, `07-completed-all`, `08-completed-skipped-plural` |
| **Themes**               | `light` (Pikabu light CSS tokens) and `dark` (Pikabu dark CSS tokens + `emulateMedia({ colorScheme: "dark" })`)                                                                                   |
| **Viewports**            | `1280x800` (standard desktop), `1024x800` (narrow desktop), `480x800` (narrow / touch-target check)                                                                                               |

Write all PNGs plus `metrics.json` (geometry deltas, token resolution, `axe-core` violations + `incomplete`, computed contrast ratios) to `tmp/visual-review/` (gitignored).

### Copy-Pasteable Host-Native Critic Prompt

Use this prompt in a **fresh subagent / fresh conversation** after running the Playwright capture script:

```text
You are an independent, skeptical UI Visual Critic reviewing an injected Shadow DOM control for Pikabu.ru.
You did NOT write this code and must not excuse flaws.

Inputs:
1. Baseline screenshots (Pikabu comment header WITHOUT the userscript) and injected screenshots across states, light/dark themes, and viewports in `tmp/visual-review/`.
2. `tmp/visual-review/metrics.json` (bounding-box deltas, CLS, CSS token resolution, axe-core violations/incomplete, computed contrast ratios).

Goal: The injected control must look 100% native to Pikabu.ru—indistinguishable from Pikabu's own chrome—while preserving zero layout distortion and WCAG 2.1 AA accessibility. Do NOT reward originality or decorative styling.

Grade strictly using these severity levels:
- P0 (Blocker): Any tab-bar height increase or native-tab displacement on desktop (>1px), horizontal overflow, clipping/overlap, missing Pikabu CSS token fallback leak in dark mode, WCAG contrast failure (<4.5:1 text or <3:1 UI/focus), or broken keyboard/ARIA state.
- P1 (Host-Native Mismatch): Control looks visibly "injected"—mismatched button height/padding/radius/border weight/font size/vertical alignment, jarring color/hover treatment, or status text crowding native tabs.
- P2 (Micro-UX Polish): Subtle spacing rhythm issues, awkward wrapping on narrow viewports, floating stop positioning/shadow refinement, or verbose Russian copy.

Output format:
1. Verdict: PASS (zero P0 and zero P1) or REVISE.
2. Findings table: [Severity | Theme/Viewport/State | Evidence (screenshot + metric) | Concrete CSS/DOM fix].
3. Do not suggest generic redesigns; every fix must make the widget blend more closely into the baseline screenshot.
```

---

## 5. Phased Rollout Plan for This Repo

### Iteration 1.5 (Immediate — Host-Native Polish of Current Control)

1. **Install `web-design-guidelines` skill** into `.agents/skills/` via `npx skills add vercel-labs/agent-skills --skill web-design-guidelines` (updates `skills-lock.json` cleanly).
2. **Add `@axe-core/playwright`** as a devDependency and wire Shadow DOM a11y + computed contrast + tab-bar geometry assertions into `tests/e2e/` using light & dark Pikabu fixtures populated from live token extraction.
3. **Add an opt-in capture script** (e.g., `pnpm run ui:capture` writing to gitignored `tmp/visual-review/`) that produces the baseline-vs-injected PNG matrix + `metrics.json`.
4. **Run 2 rounds of Generator → Fresh-Context Critic** using the Host-Native Critic Prompt above before shipping Iteration 1.5 (paying special attention to dark-theme token parity and replacing inline settings expansion with a top-layer `popover="auto"` or equivalent zero-shift disclosure).

### Iteration 2 (Richer Controls & Ongoing Maintenance)

1. **Create `.agents/skills/pikabu-ui-critic/SKILL.md`** (~80 lines) capturing the Pikabu token contract, `pnpm run ui:capture` invocation, and the Host-Native Critic rubric so any agent working on Iteration 2 invokes the exact same visual verification loop on demand.
2. **Evaluate `pbakaus/impeccable`** (`critique`, `audit`, `quieter`, `harden`) only if Iteration 2 introduces multi-section settings UI or richer surfaces where design-director UX critique adds signal beyond the toolbar rubric.
3. **Keep MCP servers (`playwright-mcp`, `chrome-devtools-mcp`) optional** for one-off live debugging rather than mandatory repo setup.

---

## Primary Sources

- Anthropic Engineering — _Building Effective Agents_: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic Engineering — _Harness design for long-running application development_: https://www.anthropic.com/engineering/harness-design-long-running-apps
- Anthropic / Claude Blog — _Improving frontend design through Skills_: https://claude.com/blog/improving-frontend-design-through-skills
- Anthropic Official Skills Repository (`frontend-design`): https://github.com/anthropics/skills/tree/main/skills/frontend-design
- Agent Skills Open Specification (Progressive Disclosure & `SKILL.md`): https://agentskills.io
- Vercel Labs Skills CLI (`npx skills`, `skills-lock.json`): https://github.com/vercel-labs/skills
- Vercel Labs Agent Skills (`web-design-guidelines`): https://github.com/vercel-labs/agent-skills
- Vercel Labs Web Interface Guidelines: https://github.com/vercel-labs/web-interface-guidelines
- Impeccable Design Skill & CLI (`pbakaus/impeccable`): https://github.com/pbakaus/impeccable and https://impeccable.style
- Microsoft Playwright Visual Comparisons (`toHaveScreenshot`, `stylePath`): https://playwright.dev/docs/test-snapshots
- Microsoft Playwright `page.emulateMedia`: https://playwright.dev/docs/api/class-page#page-emulate-media
- Microsoft Playwright MCP: https://github.com/microsoft/playwright-mcp
- Microsoft Playwright CLI (token-efficient CLI + skills): https://github.com/microsoft/playwright-cli
- Google Chrome DevTools MCP: https://github.com/ChromeDevTools/chrome-devtools-mcp
- Deque `@axe-core/playwright` (`axe-core-npm`): https://github.com/dequelabs/axe-core-npm
- W3C WCAG 2.1 SC 1.4.3 — _Contrast (Minimum)_: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
- W3C WCAG 2.1 SC 1.4.11 — _Non-text Contrast_: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast
- MDN Web Docs — _Using shadow DOM_: https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM
- MDN Web Docs — _Element.getBoundingClientRect()_: https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect
- MDN Web Docs — _LayoutShift_: https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift
- MDN Web Docs — _LayoutShiftAttribution_: https://developer.mozilla.org/en-US/docs/Web/API/LayoutShiftAttribution
- MDN Web Docs — _Popover API_: https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
