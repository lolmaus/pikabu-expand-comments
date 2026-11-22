import { expect, test } from "@playwright/test";
import { installUserscript } from "../support/install-userscript.ts";

const postUrl = "https://pikabu.ru/story/poputchik_7957162";
const loaderClickLimit = 8;
const visibleCountPattern = /Сейчас видно (\d+)\./;

function visibleCommentCount(status: string | null) {
  return Number(status?.match(visibleCountPattern)?.[1] ?? 0);
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
  const status = menu.getByRole("status");
  await expect(start).toBeVisible();
  await expect(anchor).toBeVisible();

  // Observe public DOM clicks and prevent the run from loading the entire discussion,
  // even if a test assertion fails or Pikabu responds faster than expected.
  const run = await start.evaluateHandle(
    (button, { limit, countPattern }) => {
      const clicks: Array<{ type: "batch" | "branch"; visibleCount: number }> = [];
      const controls = button.getRootNode() as ShadowRoot;
      const status = controls.querySelector('[role="status"]')!;
      const state = { clicks, stoppedFromViewport: false, runningOverflowAnchor: "" };
      const readCount = () => Number(status.textContent?.match(countPattern)?.[1] ?? 0);

      // The site can hydrate several steps between browser-driver commands.
      // Use the first progress update to activate the floating shortcut in the page.
      const stopAfterProgress = new MutationObserver(() => {
        const first = clicks[0];
        if (first?.type !== "branch" || readCount() <= first.visibleCount) {
          return;
        }
        stopAfterProgress.disconnect();
        const shortcut = Array.from(controls.querySelectorAll("button")).find(
          (candidate) => candidate !== button && candidate.textContent === "Остановить",
        );
        const bounds = shortcut?.getBoundingClientRect();
        state.stoppedFromViewport =
          button.getBoundingClientRect().bottom <= 0 &&
          !!bounds &&
          bounds.height > 0 &&
          bounds.top >= 0 &&
          bounds.bottom <= window.innerHeight;
        state.runningOverflowAnchor = getComputedStyle(
          document.querySelector(".comments__container")!,
        ).overflowAnchor;
        shortcut?.click();
      });
      stopAfterProgress.observe(status, { childList: true });

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
    { limit: loaderClickLimit, countPattern: visibleCountPattern },
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
  await expect(status).toHaveText(/^Раскрытие остановлено\./);
  const firstRun = await run.jsonValue();
  expect(firstRun.stoppedFromViewport).toBe(true);
  expect(firstRun.runningOverflowAnchor).toBe("none");
  // Stop lets the in-flight click settle, including any intermediate placeholder renders.
  await expect
    .poll(async () => visibleCommentCount(await status.textContent()))
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
        return visibleCommentCount(await status.textContent()) > batch.visibleCount;
      },
      {
        message: "A live Comment Batch should increase the visible comment count",
        timeout: 30_000,
      },
    )
    .toBe(true);
});
