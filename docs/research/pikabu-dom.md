# Pikabu Post Page Comment DOM, Loading States, and Automation Feasibility

**Research Date:** 2026-11-21
**Primary Sources (Live Inspection via Headless Playwright Chromium 1248):**

- `https://pikabu.ru/story/poputchik_7957162` ("Попутчик - 14.01.21 11:38 | Пикабу", 1,713+ total comments)
- `https://pikabu.ru/story/angliyskie_myasniki_negoduyut_14539483` ("Английские мясники негодуют | Пикабу", 973+ total comments)

---

## 1. Automation Feasibility & Network/Security Headers

### Live Browser Access

- **Headless Chromium loads Pikabu Post Pages cleanly without CAPTCHA, anti-bot challenges, or login walls.** Both tested URLs returned `HTTP/2 200` and rendered full interactive comment trees while logged out.
- **Document response headers observed on `https://pikabu.ru/story/poputchik_7957162`:**
  - `server: ddos-guard` (sets `__ddg*` cookies passively; did not challenge or throttle normal automated page loads or sequential comment requests)
  - `content-type: text/html; charset=windows-1251`
  - `content-security-policy: upgrade-insecure-requests, frame-ancestors *.pikabu.ru pikabu.ru` (no `script-src`, `style-src`, or `require-trusted-types-for` restrictions; standard DOM-safe `createElement`/`textContent` remains recommended)
- **Local host caveat (Ubuntu 23.10+ AppArmor):**
  - Unprivileged user namespaces are restricted on this host by AppArmor. Launching Chromium/Playwright without an AppArmor profile fails with `No usable sandbox!`.
  - **Playwright mitigation:** Launch Chromium with `chromiumSandbox: false` (i.e., `--no-sandbox`) in local/CI test configs, or configure the host AppArmor profile once. With `--no-sandbox`, `chrome-headless-shell-1248` launched and navigated reliably in ~2s.

---

## 2. Comment Tree Architecture & Comment Batch Loader (`.comment__more`)

### Embedded Tree Manifest

Inside `.story-comments__all`, Pikabu embeds the full comment-tree ID structure in an inline JSON script tag:

```html
<script type="application/json">
  {"min":189844110,"tree":[[6968,0,[[17217,0,...]]]]}
</script>
```

Because the client already holds the ID tree, clicking any loader control updates placeholder DOM nodes and counters **synchronously (<15 ms)**, then hydrates comment bodies asynchronously via `POST https://pikabu.ru/ajax/comments_actions.php` (`action=get_comments_by_ids&ids=...`).

### Initial State on Both Tested Post Pages

Initially, only **1** top-level `.comment` is rendered in `.comments__container`, followed by a single `.comment__more` button:

```html
<button class="comment__more">
  Раскрыть <span class="comments__more-count">1712 комментариев</span>
</button>
```

On the second post (`angliyskie_myasniki_negoduyut_14539483`):

```html
<button class="comment__more">
  Раскрыть <span class="comments__more-count">972 комментария</span>
</button>
```

### Exact Click Lifecycle (Verified Across All 8 Batches to Exhaustion)

Clicking `.comment__more` repeatedly on `poputchik_7957162` (8 clicks total, revealing all 293 top-level comments):

| Step      | Button Text Before                      | At 15 ms After Click                                                                                                       | Network Request (`comments_actions.php`)             | State After Settling                                                                                |
| --------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0         | `Раскрыть 1712 комментариев`            | Same button node; text updates synchronously to `Раскрыть 527 комментариев`; 39 `.comment_loading-hidden` nodes inserted   | `POST action=get_comments_by_ids` (HTTP 200, 193 ms) | 41 `.comment`, 0 `.comment_loading-hidden`, 0 empty `.comment__body`                                |
| 1–6       | `527 → 270 → 219 → 171 → 127 → 76 → 21` | Same button node (`sameBtnNode: true`); 38–39 `.comment_loading-hidden` placeholders inserted per click                    | HTTP 200, 237–327 ms each                            | 0 `.comment_loading-hidden`, 0 empty `.comment__body`                                               |
| 7 (final) | `Раскрыть 21 комментарий`               | `.comment__more` is **synchronously removed from DOM** (`isConnected: false`); 13 `.comment_loading-hidden` nodes inserted | HTTP 200, 142 ms                                     | 293 top-level `.comment`, 0 `.comment__more`, 0 `.comment_loading-hidden`, 0 empty `.comment__body` |

### Key Takeaways for `.comment__more`

1. **The `.comment__more` button itself does NOT get a loading class or `disabled` attribute.** Instead, loading is observable via the newly inserted placeholder comments:
   ```html
   <div
     class="comment comment_loading-hidden"
     id="comment_189855351"
     data-id="189855351"
     data-indent="0"
   >
     <div class="comment__body"></div>
     <div class="comment-toggle-children comment-toggle-children_collapse">...</div>
   </div>
   ```
   Hydration completes when `document.querySelectorAll('.comment_loading-hidden').length === 0` (and inserted `.comment__body` elements are non-empty).
2. **The remaining count in `.comments__more-count` counts total unrendered descendants**, not just top-level comments (e.g., `1712 → 527` after 40 top-level comments because those 40 top-level comments hold ~1,185 collapsed Reply Branch descendants).
3. **Completion signal:** `.comment__more` is removed from the DOM on the final batch click (wait for remaining `.comment_loading-hidden` placeholders to finish hydrating after `.comment__more` disappears).
4. **No lazy scroll loading needed for `.comment__body`:** Once `get_comments_by_ids` finishes, all newly revealed comments are fully hydrated in the DOM (`emptyBeforeCount: 0`, `loadingHiddenBefore: 0`), making them immediately searchable via `Ctrl+F` even when offscreen.

---

## 3. Reply Branch Loader (`.comment-toggle-children`) & Variants

### Crucial Class Semantics (`_collapse` = Collapsed!)

**`comment-toggle-children_collapse` marks an UNEXPANDED (collapsed) Reply Branch — NOT an expanded one.**

- **Collapsed (target to click):**
  - Tag is `<a>` on server-rendered initial comments and `<div>` on dynamically inserted comments:
    ```html
    <a
      class="comment-toggle-children comment-toggle-children_collapse"
      href="https://pikabu.ru/story/poputchik_7957162?cid=189851078#comments"
    >
      <div class="comment-toggle-children__icon">...</div>
      <div class="comment-toggle-children__label">раскрыть ветку (463)</div>
    </a>
    ```
  - Parent `.comment` has a sibling `<div class="comment__children" hidden>` (`display: none`).
- **Expanded (DO NOT click!):**
  - Clicking strips `comment-toggle-children_collapse`, leaving `class="comment-toggle-children"`, and removes `hidden` from `.comment__children` (`display: block`).
  - **Gotcha:** The inner `.comment-toggle-children__label` text stays `"раскрыть ветку (463)"` even when expanded (Pikabu hides/changes presentation via CSS on the `_collapse` modifier).
  - Clicking `.comment-toggle-children:not(.comment-toggle-children_collapse)` **collapses** the branch and fires telemetry `POST /v2/event/j/3/comment_branch_collapse`.
  - **Therefore, the expansion selector MUST always require `.comment-toggle-children_collapse`.**

### Three Distinct Variants of `.comment-toggle-children_collapse` Observed Live

1. **Standard Reply Branch:**
   - Selector: `.comment-toggle-children.comment-toggle-children_collapse` (without modifiers below)
   - Label: `раскрыть ветку (N)`
   - Clicking expands the branch and hydrates children via `POST /ajax/comments_actions.php` (`action=get_comments_by_ids`).
2. **Deep-Nesting Continuation ("Next Floor" at `data-indent="10"`):**
   - Classes: `comment-toggle-children comment-toggle-children_next-floor comment-toggle-children_collapse`
   - Label: `раскрыть ветку (N)`
   - Appears _inside_ large expanded Reply Branches once nesting hits `data-indent="10"` (4 nested collapsed toggles were revealed inside `comment_189851078`'s 463-reply branch).
   - Verified clicking one loaded deeper replies (`totalComments: 373 → 374`, stripped `_collapse`, HTTP 200 in 287 ms).
   - **Implication:** Expansion Runs must **re-scan** newly revealed subtrees iteratively until no target `.comment-toggle-children_collapse` controls remain.
3. **Only-Hidden Branch (`comment-toggle-children_only-hidden`):**
   - Classes: `comment-toggle-children comment-toggle-children_collapse comment-toggle-children_only-hidden`
   - Label: `ещё комментарии`
   - **Important nuance:** On `poputchik_7957162` (`comment_189854783`), clicking this loaded 5 comments — the root reply was from a `DELETED` user, while its 4 replies were **normal positive-rated comments** (`+21`, `+7`, etc.) hidden only because they sat under that deleted/hidden parent!
   - **Decision needed in Expansion Engine ticket:** Whether to expand `.comment-toggle-children_only-hidden` by default (since it hides real replies) or exclude it per the "leave moderation-hidden/rating-collapsed untouched" rule.

### Non-Target Controls Observed

- Reaction expander: `<button class="emotion-btn emotion-btn_expand" data-count="0" hidden="">Ещё 0</button>` — unrelated, never matched by comment selectors.
- No separate `.comment_hidden` or `.spoiler` toggle elements appeared inside the tested comment trees; standard comment bodies rendered inline.

---

## 4. Concurrency, Rate Limits & Hydration Trap (CRITICAL FINDING)

### Concurrent Clicks Drop Requests Silently!

When **5** `.comment-toggle-children_collapse` buttons were clicked synchronously in the same loop tick (`for (const el of toClick) el.click()`):

- **Only the 1st branch loaded** (`parentChildrenCount: 300`, 1 `comments_actions.php` request fired).
- **Branches 2–5 lost their `comment-toggle-children_collapse` class** (turning into `class="comment-toggle-children"`), fired **zero** `comments_actions.php` requests, and remained **permanently empty (`parentChildrenCount: 0`)**!
- Telemetry (`click_show_comments_thread` + `comment_branch_show`) still fired for all 5, masking the silent failure unless you check `.comment__children` / `.comment_loading-hidden`.

### Sequential Clicks Succeed 100%

When clicking `.comment-toggle-children_collapse` **sequentially** (waiting for each branch's hydration before clicking the next):

- **7 out of 7 sequential branch expansions succeeded** (`3/3`, `1/1`, `20/20`, `8/8`, `300+` big branch, `next-floor` continuation, and `only-hidden` branch).
- Every click produced a `POST https://pikabu.ru/ajax/comments_actions.php` (`HTTP 200`, `100–487 ms`).
- **Zero HTTP 429 / rate-limit errors** occurred across 15+ sequential `comments_actions.php` requests.

### Implication for the Expansion Engine

- **Never fire concurrent clicks on Pikabu's comment loaders.** Drive clicks strictly sequentially (concurrency = 1), awaiting DOM hydration (no remaining `.comment_loading-hidden` nodes and/or `.comment__children` populated for the clicked parent) with a sensible timeout + stall check before advancing.

---

## 5. Navigation Model (MPA Between Stories, SPA Within Comment Tabs)

- **Between Post Pages / Feed:** Standard MPA links (`<a href="https://pikabu.ru/story/..." target="_blank" class="story__title-link">`). No Next.js or Nuxt global router detected (`__NEXT_DATA__` and `__NUXT__` absent; webpack bundle uses `webpackChunkpikabu` + `window.pkb`).
- **Within a Post Page's Comments Menu (`.story-comments__menu`):**
  - Tabs use `data-route` attributes (`data-id="all"` → `/story/poputchik_7957162`, `data-id="author"` → `/story/poputchik_7957162/author`).
  - Verified live: clicking `Автора` performed an **in-page SPA/AJAX transition** (`tabSwitchCausedFullReload: false`), updated `location.href` to `/story/poputchik_7957162/author#comments`, and swapped `.comments__container` content (from hundreds of comments down to 8 author comments, `commentMoreAfter: 0`).
  - **Implication:** An Expansion Run must abort/reset cleanly if the user switches comment tabs (observe URL changes / `.comments__container` replacement or `.menu__item_current` change).

---

## 6. Scroll Anchoring Behavior, Themes, and UI Anchor Points

### Scroll Shift Root Cause

- Spying on `window.scrollTo`, `window.scrollBy`, and `Element.prototype.scrollIntoView` proved **Pikabu's JS made zero programmatic scroll calls** (`scrollCalls: []`) during all 8 `.comment__more` clicks.
- **When `scrollY = 300` (reader is reading the post above the comments):** `scrollY` remained an **exact `300`** across all 8 batch expansions.
- **When `scrollY = 1500` (reader is inside or near the bottom of comments):** `scrollY` jumped violently (`1500 → 1644 → 11080 → 11332 → 56932 → 68723`). This is caused by the browser's native **CSS Scroll Anchoring (`overflow-anchor: auto`)** picking an anchor element _below_ the newly inserted comments (such as the related-stories block or a lower comment) and pushing `scrollY` down by the height of every newly inserted batch/branch!
- **Implication:** Preserving reading position during an Expansion Run is straightforward and clean: track the topmost visible comment/element in the viewport (or disable `overflow-anchor` on the comments container / restore anchor offset) rather than fighting Pikabu JS scroll calls.

### Theme & Design Tokens

- **Light theme (default):** `html` has no `data-theme-dark` attribute; `body` computed `background-color: rgb(247, 248, 252)`, `color: rgb(27, 30, 36)`.
- **Dark theme selector:** `:root[data-theme-dark]` (confirmed in Pikabu's stylesheets).
- **Pikabu CSS custom properties available on `:root`:**
  - `--color-black-800` (`#444850`), `--color-black-700` (`#70737b`), `--color-black-400` (`#e9e9e9`)
  - `--color-primary-700` (`#8bca58` — Pikabu's signature green accent)
  - `--color-bright-800` (`#fcfdff`), `--color-bright-900` (`#ffffff`)
  - Reusing these CSS variables (with sensible fallbacks) lets our minimal on-page UI automatically match both Pikabu light and dark themes.

### Natural DOM Anchor Point for On-Page Controls

Right above `.comments__container` sits the horizontal comments header bar:

```html
<section class="story-comments__menu section_header">
  <div class="menu menu_horizontal">
    <a data-id="all" class="menu__item menu__item_route menu__item_current" ...>Все комментарии</a>
    <a data-id="author" class="menu__item menu__item_route" ...>Автора</a>
    <div class="menu__spinner" style="display: none;">...</div>
  </div>
</section>
```

Injecting a compact inline control inside or right beside `.story-comments__menu` (optionally paired with a subtle sticky/floating progress indicator while scrolling) fits Pikabu's native layout cleanly.
