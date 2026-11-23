import { expect, test } from "@playwright/test";
import { discoverExtensionId, launchChromeExtensionContext } from "../support/extension.ts";
import {
  ALL_VISUAL_VIEWPORTS,
  VISUAL_POST_URL,
  VISUAL_THEMES,
  VISUAL_VIEWPORTS,
  assertLightDarkTokenParity,
  auditCurrentState,
  auditMobileState,
  auditPopupState,
  evaluateMobileP0Gates,
  measureTabBar,
  preparePikabuVisualPage,
  resetCls,
  type TokenAuditReport,
} from "../support/visual-audit.ts";

for (const viewport of ALL_VISUAL_VIEWPORTS) {
  const isMobile = viewport.profile === "mobile";
  const contextOptions = isMobile ? { hasTouch: true, isMobile: true } : {};
  const startLabel = isMobile ? "Раскрыть все" : "Раскрыть все комментарии";

  test.describe(`Strict P0 visual-audit gates (${viewport.name})`, () => {
    const tokensByTheme: Partial<Record<(typeof VISUAL_THEMES)[number], TokenAuditReport>> = {};

    for (const theme of VISUAL_THEMES) {
      test(`${theme} theme passes all P0 gates across mount, settings toggle, and run states`, async ({
        browser,
      }) => {
        // 1. Measure baseline without userscript.
        const baselineContext = await browser.newContext(contextOptions);
        const baselinePage = await baselineContext.newPage();
        await preparePikabuVisualPage(baselinePage, {
          theme,
          viewport,
          withUserscript: false,
          showFloorAd: isMobile,
        });
        await baselinePage.goto(VISUAL_POST_URL);
        const baseline = await measureTabBar(baselinePage);
        await baselineContext.close();

        // 2. Measure injected userscript across key states.
        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();
        await preparePikabuVisualPage(page, {
          theme,
          viewport,
          withUserscript: true,
          showFloorAd: isMobile,
        });
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
        const top = page.locator('[data-pikabu-expand-comments="top"]');
        const bottom = page.locator('[data-pikabu-expand-comments="bottom"]');
        const start = top.getByRole("button", { name: startLabel });
        const settings = top.getByRole("button", { name: "Настройки" });
        await expect(start).toBeVisible();

        const failures: string[] = [];
        const recordState = async (
          state: string,
          options: {
            checkCls?: boolean;
            expectedExpandedGears?: number;
            expectFloatingRibbon?: boolean;
          } = {},
        ) => {
          const metrics = await auditCurrentState(page, state, baseline, {
            checkCls: options.checkCls ?? false,
          });
          if (state === "idle") tokensByTheme[theme] = metrics.tokens;
          for (const failure of metrics.p0.failures) {
            failures.push(
              `[${theme} ${viewport.name} ${state}] (${failure.gate}) ${failure.message}`,
            );
          }
          if (isMobile) {
            const mobile = await auditMobileState(page);
            for (const failure of evaluateMobileP0Gates(mobile, {
              expectedExpandedGears: options.expectedExpandedGears ?? 0,
              expectFloatingRibbon: options.expectFloatingRibbon ?? false,
            })) {
              failures.push(
                `[${theme} ${viewport.name} ${state}] (${failure.gate}) ${failure.message}`,
              );
            }
          }
        };

        try {
          await recordState("idle", { checkCls: !isMobile });
          if (isMobile) await resetCls(page);

          await settings.click();
          await expect(
            top.getByRole("checkbox", { name: "Раскрывать комментарии при открытии поста" }),
          ).toBeVisible();
          await recordState("settings-open", { checkCls: true, expectedExpandedGears: 1 });

          await settings.click();
          await recordState("settings-closed", { checkCls: true, expectedExpandedGears: 0 });

          if (isMobile) {
            await bottom.scrollIntoViewIfNeeded();
            const bottomSettings = bottom.getByRole("button", { name: "Настройки" });
            await bottomSettings.click();
            await expect(
              bottom.getByRole("checkbox", { name: "Раскрывать комментарии при открытии поста" }),
            ).toBeVisible();
            await recordState("settings-open-bottom", { checkCls: true, expectedExpandedGears: 1 });
            await bottomSettings.click();
            await page.evaluate(() => window.scrollTo(0, 0));
          }

          await start.click();
          await expect(top.getByRole("button", { name: "Остановить" })).toBeVisible();
          await recordState("running", { expectFloatingRibbon: false });

          if (isMobile) {
            await page.evaluate(() => {
              const comments = document.querySelector(".comments__container");
              if (comments) {
                const spacer = document.createElement("div");
                spacer.id = "p0-mobile-spacer";
                spacer.style.height = "1600px";
                comments.prepend(spacer);
              }
              window.scrollTo(0, 700);
            });
            await expect(top.locator('[data-role="floating-ribbon"]')).toBeVisible();
            await recordState("running-floating-ribbon", { expectFloatingRibbon: true });
            await page.evaluate(() => {
              document.getElementById("p0-mobile-spacer")?.remove();
              window.scrollTo(0, 0);
            });
          }

          await top.getByRole("button", { name: "Остановить" }).first().click();
          await expect(top.getByRole("status")).toHaveText("Раскрытие остановлено.");
          await recordState("stopped");
        } finally {
          holdBranch.resolve();
        }

        await top.getByRole("button", { name: "Продолжить" }).click();
        await expect(top.getByRole("status")).toHaveText("Все комментарии раскрыты.");
        await recordState("completed-all");

        await context.close();

        // 3. Error state (Comment Batch hydration timeout -> Retry + inline error contrast & height).
        const errContext = await browser.newContext(contextOptions);
        const errPage = await errContext.newPage();
        await errPage.clock.install();
        await preparePikabuVisualPage(errPage, {
          theme,
          viewport,
          withUserscript: true,
          showFloorAd: isMobile,
        });
        await errPage.goto(VISUAL_POST_URL);
        await errPage.evaluate(() => {
          const oldContainer = document.querySelector(".comments__container")!;
          const fresh = document.createElement("div");
          fresh.className = "comments__container";
          fresh.innerHTML = `<div class="comment" id="comment_1" data-id="1" data-indent="0">
              <div class="comment__body">Тестовый комментарий</div>
            </div>
            <button type="button" class="comment__more">Раскрыть <span class="comments__more-count">12 комментариев</span></button>`;
          oldContainer.replaceWith(fresh);
        });
        const errTop = errPage.locator('[data-pikabu-expand-comments="top"]');
        await errTop.getByRole("button", { name: startLabel }).click();
        await errPage.clock.runFor(67_500);
        await errPage.clock.resume();
        await expect(errTop.getByRole("button", { name: "Повторить" })).toBeVisible();
        const errMetrics = await auditCurrentState(errPage, "error", baseline, { checkCls: false });
        for (const failure of errMetrics.p0.failures) {
          failures.push(`[${theme} ${viewport.name} error] (${failure.gate}) ${failure.message}`);
        }
        if (isMobile) {
          const errMobile = await auditMobileState(errPage);
          for (const failure of evaluateMobileP0Gates(errMobile, {
            expectedExpandedGears: 0,
            expectFloatingRibbon: false,
          })) {
            failures.push(`[${theme} ${viewport.name} error] (${failure.gate}) ${failure.message}`);
          }
        }
        await errContext.close();

        expect(failures, `P0 gate failures in ${theme} @ ${viewport.name}`).toEqual([]);
      });
    }

    test("light and dark themes resolve distinct Pikabu tokens", async ({ browser }) => {
      if (!tokensByTheme.light || !tokensByTheme.dark) {
        for (const theme of VISUAL_THEMES) {
          const context = await browser.newContext(contextOptions);
          const page = await context.newPage();
          await preparePikabuVisualPage(page, {
            theme,
            viewport,
            withUserscript: true,
            showFloorAd: isMobile,
          });
          await page.goto(VISUAL_POST_URL);
          const baseline = await measureTabBar(page);
          const metrics = await auditCurrentState(page, "idle", baseline, { checkCls: false });
          tokensByTheme[theme] = metrics.tokens;
          await context.close();
        }
      }
      expect(assertLightDarkTokenParity(tokensByTheme.light!, tokensByTheme.dark!)).toEqual([]);
    });
  });
}

const POPUP_PROFILES = [
  { name: "desktop-320", width: 320, height: 320, isMobile: false },
  { name: "mobile-360", width: 360, height: 360, isMobile: true },
] as const;

for (const profile of POPUP_PROFILES) {
  test.describe(`Strict P0 popup visual-audit gates (${profile.name})`, () => {
    test("passes axe-core, overflow, contrast, touch-target, theme-parity, and keyboard toggle gates in light and dark themes", async () => {
      const ext = await launchChromeExtensionContext({
        hasTouch: profile.isMobile,
        isMobile: profile.isMobile,
        viewport: { width: profile.width, height: profile.height },
      });
      try {
        const postPage = ext.context.pages()[0] ?? (await ext.context.newPage());
        await preparePikabuVisualPage(postPage, {
          theme: "light",
          viewport: VISUAL_VIEWPORTS[0]!,
          withUserscript: false,
        });
        const extensionId = await discoverExtensionId(ext.context, postPage, VISUAL_POST_URL);

        const popupPage = await ext.context.newPage();
        await popupPage.setViewportSize({ width: profile.width, height: profile.height });
        await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

        const themeColors: Record<string, { bg: string; color: string }> = {};
        const failures: string[] = [];

        for (const theme of VISUAL_THEMES) {
          await popupPage.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });

          // 1. On-post active state (unchecked switch + checked switch for WCAG 1.4.11 track/thumb contrast)
          await postPage.bringToFront();
          await popupPage.evaluate(() => location.reload());
          await expect(popupPage.locator("#active-card")).toBeVisible();
          const onPost = await auditPopupState(popupPage, {
            state: "on-post",
            theme,
            isMobile: profile.isMobile,
          });
          themeColors[theme] = { bg: onPost.bodyBackground, color: onPost.bodyColor };
          for (const f of onPost.p0.failures) {
            failures.push(`[popup ${profile.name} ${theme} on-post] (${f.gate}) ${f.message}`);
          }

          const switchInput = popupPage.getByRole("switch");
          await switchInput.evaluate((el) => (el as HTMLInputElement).click());
          await expect(switchInput).toBeChecked();
          const onPostChecked = await auditPopupState(popupPage, {
            state: "on-post-checked",
            theme,
            isMobile: profile.isMobile,
          });
          for (const f of onPostChecked.p0.failures) {
            failures.push(
              `[popup ${profile.name} ${theme} on-post-checked] (${f.gate}) ${f.message}`,
            );
          }
          await switchInput.evaluate((el) => (el as HTMLInputElement).click());
          await expect(switchInput).not.toBeChecked();

          // 2. Off-site fallback state (popup itself active => chrome-extension:// tab has no content script)
          await popupPage.bringToFront();
          await popupPage.reload();
          await expect(popupPage.locator("#offsite-card")).toBeVisible();
          const offSite = await auditPopupState(popupPage, {
            state: "off-site",
            theme,
            isMobile: profile.isMobile,
          });
          for (const f of offSite.p0.failures) {
            failures.push(`[popup ${profile.name} ${theme} off-site] (${f.gate}) ${f.message}`);
          }
        }

        // Verify distinct light and dark computed colors.
        expect(themeColors["light"]?.bg).not.toBe(themeColors["dark"]?.bg);
        expect(themeColors["light"]?.color).not.toBe(themeColors["dark"]?.color);

        // Keyboard Tab + Space toggles switch and persists to chrome.storage.local.
        const toggle = popupPage.getByRole("switch");
        await toggle.focus();
        await popupPage.keyboard.press("Space");
        await expect(toggle).toBeChecked();
        await popupPage.reload();
        await expect(toggle).toBeChecked();

        expect(failures, `Popup P0 failures (${profile.name})`).toEqual([]);
      } finally {
        await ext.close();
      }
    });
  });
}
