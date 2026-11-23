import { expect, test } from "@playwright/test";
import {
  VISUAL_POST_URL,
  VISUAL_THEMES,
  VISUAL_VIEWPORTS,
  assertLightDarkTokenParity,
  auditCurrentState,
  measureTabBar,
  preparePikabuVisualPage,
  type TokenAuditReport,
} from "../support/visual-audit.ts";

for (const viewport of VISUAL_VIEWPORTS) {
  test.describe(`Strict P0 visual-audit gates (${viewport.name})`, () => {
    const tokensByTheme: Partial<Record<(typeof VISUAL_THEMES)[number], TokenAuditReport>> = {};

    for (const theme of VISUAL_THEMES) {
      test(`${theme} theme passes all P0 gates across mount, settings toggle, and run states`, async ({
        browser,
      }) => {
        // 1. Measure baseline without userscript.
        const baselineContext = await browser.newContext();
        const baselinePage = await baselineContext.newPage();
        await preparePikabuVisualPage(baselinePage, { theme, viewport, withUserscript: false });
        await baselinePage.goto(VISUAL_POST_URL);
        const baseline = await measureTabBar(baselinePage);
        await baselineContext.close();

        // 2. Measure injected userscript across key states.
        const context = await browser.newContext();
        const page = await context.newPage();
        await preparePikabuVisualPage(page, { theme, viewport, withUserscript: true });
        const holdBranch = Promise.withResolvers<void>();
        await page.route("**/ajax/comments_actions.php", async (route) => {
          const step = route.request().postData();
          if (step === "branch") await holdBranch.promise;
          await route.fulfill({
            contentType: "text/plain; charset=utf-8",
            body: `Комментарий ${step}`,
          });
        });

        await page.goto(VISUAL_POST_URL);
        const top = page.locator(".story-comments__menu");
        const start = top.getByRole("button", { name: "Раскрыть все комментарии" });
        const settings = top.getByRole("button", { name: "Настройки" });
        await expect(start).toBeVisible();

        const failures: string[] = [];
        const recordState = async (state: string, checkCls = false) => {
          const metrics = await auditCurrentState(page, state, baseline, { checkCls });
          if (state === "idle") tokensByTheme[theme] = metrics.tokens;
          for (const failure of metrics.p0.failures) {
            failures.push(
              `[${theme} ${viewport.name} ${state}] (${failure.gate}) ${failure.message}`,
            );
          }
        };

        try {
          await recordState("idle", true);

          await settings.click();
          await expect(
            top.getByRole("checkbox", { name: "Раскрывать комментарии при открытии поста" }),
          ).toBeVisible();
          await recordState("settings-open", true);

          await settings.click();
          await recordState("settings-closed", true);

          await start.click();
          await expect(top.getByRole("button", { name: "Остановить" })).toBeVisible();
          await recordState("running");

          await top.getByRole("button", { name: "Остановить" }).click();
          await expect(top.getByRole("status")).toHaveText("Раскрытие остановлено.");
          await recordState("stopped");
        } finally {
          holdBranch.resolve();
        }

        await top.getByRole("button", { name: "Продолжить" }).click();
        await expect(top.getByRole("status")).toHaveText("Все комментарии раскрыты.");
        await recordState("completed-all");

        await context.close();
        expect(failures, `P0 gate failures in ${theme} @ ${viewport.name}`).toEqual([]);
      });
    }

    test("light and dark themes resolve distinct Pikabu tokens", async ({ browser }) => {
      if (!tokensByTheme.light || !tokensByTheme.dark) {
        for (const theme of VISUAL_THEMES) {
          const context = await browser.newContext();
          const page = await context.newPage();
          await preparePikabuVisualPage(page, { theme, viewport, withUserscript: true });
          await page.goto(VISUAL_POST_URL);
          const baseline = await measureTabBar(page);
          const metrics = await auditCurrentState(page, "idle", baseline);
          tokensByTheme[theme] = metrics.tokens;
          await context.close();
        }
      }
      expect(assertLightDarkTokenParity(tokensByTheme.light!, tokensByTheme.dark!)).toEqual([]);
    });
  });
}
