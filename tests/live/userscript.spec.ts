import { expect, test } from "@playwright/test";
import { installUserscript } from "../support/install-userscript.ts";

const postUrl = "https://pikabu.ru/story/poputchik_7957162";
const loaderClickLimit = 8;
const mobileLoaderClickLimit = 6;
const counterPattern = /^(\d+)(?:\s*\/\s*(\d+))?$/;
const mobileUserAgent =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function isPikabuOrigin(url: URL): boolean {
  return (
    url.hostname === "pikabu.ru" ||
    url.hostname.endsWith(".pikabu.ru") ||
    url.hostname.endsWith(".pikabu.tech")
  );
}

function visibleCommentCount(counter: string | null) {
  return Number(counter?.trim().match(counterPattern)?.[1] ?? 0);
}

test("expands live Pikabu comments, preserves the viewport, and stops and continues", async ({
  page,
}) => {
  await installUserscript(page);
  const response = await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  expect(response?.ok(), `Pikabu Post Page returned HTTP ${response?.status()}`).toBe(true);

  const menu = page.locator(".story-comments__menu");
  const comments = page.locator(".comments__container");
  const anchor = comments.locator("#comment_189851078");
  const start = menu.getByRole("button", { name: "Раскрыть все комментарии" });
  const counter = menu.locator('[data-role="counter"]');
  const status = menu.getByRole("status");
  await expect(start).toBeVisible();
  await expect(anchor).toBeVisible();
  await expect(counter).toHaveText(/^\d+ \/ \d+$/);

  // Observe public DOM clicks and prevent the run from loading the entire discussion,
  // even if a test assertion fails or Pikabu responds faster than expected.
  const run = await start.evaluateHandle(
    (button, { limit, countPattern }) => {
      const clicks: Array<{ type: "batch" | "branch"; visibleCount: number }> = [];
      const controls = button.getRootNode() as ShadowRoot;
      const counter = controls.querySelector('[data-role="counter"]')!;
      const state = { clicks, stoppedFromViewport: false, runningOverflowAnchor: "" };
      const readCount = () => Number(counter.textContent?.trim().match(countPattern)?.[1] ?? 0);

      // The site can hydrate several steps between browser-driver commands.
      // Use the first progress update to activate the floating shortcut in the page.
      const stopAfterProgress = new MutationObserver(() => {
        const first = clicks[0];
        if (first?.type !== "branch" || readCount() <= first.visibleCount) {
          return;
        }
        stopAfterProgress.disconnect();
        const bottomControls = document.querySelector(
          '[data-pikabu-expand-comments="bottom"]',
        )?.shadowRoot;
        const inViewportStopButtons = [
          ...Array.from(controls.querySelectorAll("button")),
          ...Array.from(bottomControls?.querySelectorAll("button") ?? []),
        ].filter((candidate) => {
          if (candidate === button || candidate.textContent !== "Остановить" || candidate.hidden) {
            return false;
          }
          const bounds = candidate.getBoundingClientRect();
          return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
        });
        state.stoppedFromViewport =
          button.getBoundingClientRect().bottom <= 0 && inViewportStopButtons.length === 1;
        state.runningOverflowAnchor = getComputedStyle(
          document.querySelector(".comments__container")!,
        ).overflowAnchor;
        inViewportStopButtons[0]?.click();
      });
      stopAfterProgress.observe(counter, { childList: true });

      window.addEventListener(
        "click",
        (event) => {
          if (!(event.target instanceof Element)) return;
          const loader = event.target.closest(".comment__more, .comment-toggle-children_collapse");
          if (!loader?.closest(".comments__container")) return;
          if (clicks.length === limit) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (button.textContent === "Остановить") (button as HTMLButtonElement).click();
            return;
          }
          clicks.push({
            type: loader.matches(".comment__more") ? "batch" : "branch",
            visibleCount: readCount(),
          });
        },
        { capture: true },
      );
      return state;
    },
    { limit: loaderClickLimit, countPattern: counterPattern },
  );
  const readClicks = () => run.evaluate(({ clicks }) => clicks);
  const anchorTop = await anchor.evaluate((comment) => {
    window.scrollBy({ top: comment.getBoundingClientRect().top - 8, behavior: "instant" });
    return comment.getBoundingClientRect().top;
  });
  expect(anchorTop).toBeGreaterThanOrEqual(0);
  expect(anchorTop).toBeLessThan(30);
  const originalOverflowAnchor = await comments.evaluate(
    (container) => getComputedStyle(container).overflowAnchor,
  );
  // Start from the reader's position without Playwright scrolling the inline button into view.
  await start.evaluate((button) => (button as HTMLButtonElement).click());

  const stop = menu.getByRole("button", { name: "Остановить", exact: true });
  await expect(status).toHaveText("Раскрытие остановлено.");
  const firstRun = await run.jsonValue();
  expect(firstRun.stoppedFromViewport).toBe(true);
  expect(firstRun.runningOverflowAnchor).toBe("none");
  // Stop lets the in-flight click settle, including any intermediate placeholder renders.
  await expect
    .poll(async () => visibleCommentCount(await counter.textContent()))
    .toBeGreaterThan(firstRun.clicks[0]!.visibleCount);
  await expect(stop).toHaveCount(0);
  await expect(comments).toHaveCSS("overflow-anchor", originalOverflowAnchor);
  expect(
    Math.abs((await anchor.evaluate((comment) => comment.getBoundingClientRect().top)) - anchorTop),
  ).toBeLessThan(3);

  const pausedClickCount = firstRun.clicks.length;
  const continueButton = menu.getByRole("button", { name: "Продолжить" });
  await expect(continueButton).toBeVisible();
  await continueButton.evaluate((button) => (button as HTMLButtonElement).click());
  await expect.poll(async () => (await readClicks()).length).toBeGreaterThan(pausedClickCount);
  await expect
    .poll(
      async () => {
        const batch = (await readClicks()).find(({ type }) => type === "batch");
        if (!batch) return false;
        return visibleCommentCount(await counter.textContent()) > batch.visibleCount;
      },
      {
        message: "A live Comment Batch should increase the visible comment count",
        timeout: 30_000,
      },
    )
    .toBe(true);
});

test("expands live mobile Pikabu (html.mv) comments with companion strip, top-docked ribbon, and sticky-header scroll preservation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: mobileUserAgent,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (isPikabuOrigin(url)) return route.continue();
      return route.abort();
    });
    await installUserscript(page);
    const response = await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    expect(response?.ok(), `Mobile Pikabu Post Page returned HTTP ${response?.status()}`).toBe(
      true,
    );

    // Confirm live Pikabu served mobile layout (html.mv).
    expect(await page.evaluate(() => document.documentElement.classList.contains("mv"))).toBe(true);

    const top = page.locator('[data-pikabu-expand-comments="top"]');
    const comments = page.locator(".comments__container");
    const start = top.getByRole("button", { name: "Раскрыть все" });
    const counter = top.locator('[data-role="counter"]');
    const status = top.getByRole("status");
    await expect(start).toBeVisible({ timeout: 15_000 });
    await expect(counter).toHaveText(/^\d+\s*\/\s*\d+$/);

    // Companion strip sits directly after untouched .story-comments__menu at 56px height.
    const layoutMetrics = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>(".story-comments__menu")!;
      const host = document.querySelector<HTMLElement>('[data-pikabu-expand-comments="top"]')!;
      return {
        previousIsMenu: host.previousElementSibling === menu,
        menuOverflowX: Math.max(0, menu.scrollWidth - menu.clientWidth),
        topStripHeight: Math.round(host.getBoundingClientRect().height),
      };
    });
    expect(layoutMetrics.previousIsMenu).toBe(true);
    expect(layoutMetrics.menuOverflowX).toBe(0);
    expect(layoutMetrics.topStripHeight).toBe(56);

    // Scroll the first visible comment directly beneath header.header so the top companion strip is offscreen.
    const headerHeight = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>("header.header");
      return header ? Math.round(header.getBoundingClientRect().height) : 0;
    });
    const anchor = comments.locator(".comment:visible").first();
    await expect(anchor).toBeVisible();
    const anchorTop = await anchor.evaluate((comment, inset) => {
      const topStrip = document.querySelector<HTMLElement>('[data-pikabu-expand-comments="top"]');
      const minDelta = topStrip ? topStrip.getBoundingClientRect().bottom - inset + 4 : 0;
      const delta = Math.max(comment.getBoundingClientRect().top - (inset + 4), minDelta);
      window.scrollBy({ top: delta, behavior: "instant" });
      return comment.getBoundingClientRect().top;
    }, headerHeight);

    const run = await start.evaluateHandle(
      (button, { limit, countPattern }) => {
        const clicks: Array<{ type: "batch" | "branch"; visibleCount: number }> = [];
        const controls = button.getRootNode() as ShadowRoot;
        const counterEl = controls.querySelector('[data-role="counter"]')!;
        const state = { clicks, stoppedFromRibbon: false };
        const readCount = () => Number(counterEl.textContent?.trim().match(countPattern)?.[1] ?? 0);

        const stopAfterProgress = new MutationObserver(() => {
          const first = clicks[0];
          if (!first || readCount() <= first.visibleCount) return;
          const ribbon = controls.querySelector<HTMLElement>('[data-role="floating-ribbon"]');
          const ribbonStop = ribbon?.querySelector<HTMLButtonElement>("button");
          if (ribbon && !ribbon.hidden && ribbonStop) {
            stopAfterProgress.disconnect();
            state.stoppedFromRibbon = true;
            ribbonStop.click();
          }
        });
        stopAfterProgress.observe(counterEl, { childList: true });

        window.addEventListener(
          "click",
          (event) => {
            if (!(event.target instanceof Element)) return;
            const loader = event.target.closest(
              ".comment__more, .comment-toggle-children_collapse",
            );
            if (!loader?.closest(".comments__container")) return;
            if (clicks.length === limit) {
              event.preventDefault();
              event.stopImmediatePropagation();
              if (button.textContent === "Остановить") (button as HTMLButtonElement).click();
              return;
            }
            clicks.push({
              type: loader.matches(".comment__more") ? "batch" : "branch",
              visibleCount: readCount(),
            });
          },
          { capture: true },
        );
        return state;
      },
      { limit: mobileLoaderClickLimit, countPattern: counterPattern },
    );

    await start.evaluate((button) => (button as HTMLButtonElement).click());
    await expect(status).toHaveText("Раскрытие остановлено.", { timeout: 25_000 });
    const firstRun = await run.jsonValue();
    expect(firstRun.stoppedFromRibbon).toBe(true);
    expect(firstRun.clicks.length).toBeGreaterThan(0);
    await expect
      .poll(async () => visibleCommentCount(await counter.textContent()))
      .toBeGreaterThan(firstRun.clicks[0]!.visibleCount);
    expect(
      Math.abs(
        (await anchor.evaluate((comment) => comment.getBoundingClientRect().top)) - anchorTop,
      ),
    ).toBeLessThan(12);

    // Continue from the paused state: collapse the huge top Reply Branch (463 replies on mobile SSR)
    // so the userscript respects the reader's collapse and advances directly to the Comment Batch.
    const topBranchToggle = anchor.locator(":scope > .comment-toggle-children");
    if ((await topBranchToggle.count()) > 0) {
      await topBranchToggle.evaluate((el) => (el as HTMLElement).click());
    }
    const continueButton = top.getByRole("button", { name: "Продолжить" });
    await expect(continueButton).toBeVisible();
    await continueButton.evaluate((button) => (button as HTMLButtonElement).click());
    await expect
      .poll(
        async () => {
          const clicks = await run.evaluate(({ clicks }) => clicks);
          const hasBranch = clicks.some(({ type }) => type === "branch");
          const batch = clicks.find(({ type }) => type === "batch");
          if (!hasBranch || !batch) return false;
          return visibleCommentCount(await counter.textContent()) > batch.visibleCount;
        },
        {
          message: "Live mobile run should hydrate both a Reply Branch and a Comment Batch",
          timeout: 30_000,
        },
      )
      .toBe(true);
    const finalClicks = await run.evaluate(({ clicks }) => clicks);
    expect(finalClicks.length).toBeLessThanOrEqual(mobileLoaderClickLimit);
  } finally {
    await context.close();
  }
});
