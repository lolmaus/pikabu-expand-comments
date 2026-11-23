import { expect, test } from "@playwright/test";
import { discoverExtensionId, launchChromeExtensionContext } from "../support/extension.ts";
import {
  VISUAL_POST_URL,
  VISUAL_VIEWPORTS,
  preparePikabuVisualPage,
} from "../support/visual-audit.ts";

test("unpacked Chrome MV3 extension expands comments from popup, syncs storage.local bidirectionally, and handles off-site tabs", async () => {
  const ext = await launchChromeExtensionContext();
  try {
    const postPage = ext.context.pages()[0] ?? (await ext.context.newPage());
    await preparePikabuVisualPage(postPage, {
      theme: "light",
      viewport: VISUAL_VIEWPORTS[0]!,
      withUserscript: false,
    });

    const holdBranch = Promise.withResolvers<void>();
    await postPage.route("**/ajax/comments_actions.php", async (route) => {
      const step = route.request().postData();
      if (step === "branch") await holdBranch.promise;
      await route.fulfill({
        contentType: "text/plain; charset=utf-8",
        body: `Комментарий ${step}`,
      });
    });

    // Discover extension ID via CDP Runtime.executionContextCreated (no background worker).
    const extensionId = await discoverExtensionId(ext.context, postPage, VISUAL_POST_URL);
    expect(extensionId).toMatch(/^[a-z]{32}$/);

    const onPageTop = postPage.locator('[data-pikabu-expand-comments="top"]');
    await expect(onPageTop.getByRole("button", { name: "Раскрыть все комментарии" })).toBeVisible();

    // Open popup.html in a tab, keep postPage active so chrome.tabs.query({ active: true, currentWindow: true })
    // resolves postPage just as a real toolbar popup does.
    const popupPage = await ext.context.newPage();
    await popupPage.setViewportSize({ width: 320, height: 320 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await postPage.bringToFront();
    await popupPage.evaluate(() => location.reload());

    const activeCard = popupPage.locator("#active-card");
    const offsiteCard = popupPage.locator("#offsite-card");
    const popupCounter = popupPage.locator("#popup-counter");
    const popupAction = popupPage.locator("#popup-action-btn");
    const popupSwitch = popupPage.getByRole("switch");

    await expect(activeCard).toBeVisible();
    await expect(offsiteCard).toBeHidden();
    await expect(popupCounter).toHaveText("3\u00a0/\u00a010");
    await expect(popupAction).toContainText("Expand all comments");
    await expect(popupSwitch).not.toBeChecked();

    // 1. Bidirectional storage.local sync: popup switch -> on-page settings popover checkbox.
    await popupSwitch.evaluate((el) => (el as HTMLInputElement).click());
    await expect(popupSwitch).toBeChecked();

    await onPageTop.getByRole("button", { name: "Настройки" }).click();
    const onPageCheckbox = onPageTop.getByRole("checkbox", {
      name: "Раскрывать комментарии при открытии поста",
    });
    await expect(onPageCheckbox).toBeChecked();

    // Reverse direction: on-page checkbox -> popup switch live via storage.onChanged.
    await onPageCheckbox.uncheck();
    await expect(popupSwitch).not.toBeChecked();
    await postPage.keyboard.press("Escape");

    // 2. Start expansion from popup, stop while in-flight, then continue to completion.
    try {
      await popupAction.evaluate((btn) => (btn as HTMLButtonElement).click());
      await expect(popupAction).toContainText("Stop");
      await expect(onPageTop.getByRole("button", { name: "Остановить" })).toBeVisible();

      await popupAction.evaluate((btn) => (btn as HTMLButtonElement).click());
      await expect(popupAction).toContainText("Continue");
      await expect(onPageTop.getByRole("status")).toHaveText("Раскрытие остановлено.");
    } finally {
      holdBranch.resolve();
    }

    await expect(popupCounter).toHaveText("4\u00a0/\u00a010");
    await popupAction.evaluate((btn) => (btn as HTMLButtonElement).click());
    await expect(popupCounter).toHaveText("10\u00a0/\u00a010");
    await expect(popupAction).toBeHidden();
    await expect(onPageTop.getByRole("status")).toHaveText("Все комментарии раскрыты.");

    // 3. Off-site tab fallback: non-Pikabu tab shows off-site card while switch still works.
    const offSitePage = await ext.context.newPage();
    await offSitePage.route("https://example.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body>Example</body></html>",
      }),
    );
    await offSitePage.goto("https://example.com/");
    await offSitePage.bringToFront();
    await popupPage.evaluate(() => location.reload());

    await expect(offsiteCard).toBeVisible();
    await expect(activeCard).toBeHidden();
    await expect(popupPage.locator("#popup-open-pikabu")).toHaveAttribute(
      "href",
      "https://pikabu.ru/",
    );
    await expect(popupSwitch).not.toBeChecked();
    await popupSwitch.evaluate((el) => (el as HTMLInputElement).click());
    await expect(popupSwitch).toBeChecked();
  } finally {
    await ext.close();
  }
});
