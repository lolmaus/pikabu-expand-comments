import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { discoverExtensionId, launchChromeExtensionContext } from "../tests/support/extension.ts";
import {
  VISUAL_POST_URL,
  VISUAL_VIEWPORTS,
  preparePikabuVisualPage,
} from "../tests/support/visual-audit.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = resolve(root, "tmp/store-screenshots");
const chromiumExecutable = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const viewport = VISUAL_VIEWPORTS[0]!;

  // 1 & 2. Desktop Post Page before & after expansion (1280x800, 24-bit opaque PNG).
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await preparePikabuVisualPage(page, { theme: "light", viewport, withUserscript: true });
    await page.route("**/ajax/comments_actions.php", async (route) => {
      await route.fulfill({
        contentType: "text/plain; charset=utf-8",
        body: `Комментарий ${route.request().postData() ?? ""}`,
      });
    });
    await page.goto(VISUAL_POST_URL);
    const top = page.locator('[data-pikabu-expand-comments="top"]');
    await top
      .getByRole("button", { name: "Раскрыть все комментарии" })
      .waitFor({ state: "visible" });
    await page.screenshot({ path: join(outDir, "01-desktop-before-expand-1280x800.png") });

    await top.getByRole("button", { name: "Раскрыть все комментарии" }).click();
    await top.getByRole("status").filter({ hasText: "Все комментарии раскрыты." }).waitFor();
    await page.screenshot({ path: join(outDir, "02-desktop-after-expand-1280x800.png") });
    await context.close();
  } finally {
    await browser.close();
  }

  // 3. Variant C toolbar popup showcase framed at 1280x800 (light & dark side-by-side).
  const ext = await launchChromeExtensionContext();
  try {
    const postPage = ext.context.pages()[0] ?? (await ext.context.newPage());
    await preparePikabuVisualPage(postPage, { theme: "light", viewport, withUserscript: false });
    const extId = await discoverExtensionId(ext.context, postPage, VISUAL_POST_URL);
    const popupPage = await ext.context.newPage();
    await popupPage.setViewportSize({ width: 320, height: 280 });
    await popupPage.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await popupPage.goto(`chrome-extension://${extId}/popup.html`);
    await postPage.bringToFront();
    await popupPage.evaluate(() => location.reload());
    await popupPage.locator("#active-card").waitFor({ state: "visible" });
    const lightPng = (await popupPage.screenshot()).toString("base64");

    await popupPage.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const darkPng = (await popupPage.screenshot()).toString("base64");

    const canvasPage = await ext.context.newPage();
    await canvasPage.setViewportSize({ width: 1280, height: 800 });
    await canvasPage.setContent(`<!doctype html>
      <html lang="en"><body style="margin:0;width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:48px;background:linear-gradient(135deg,#eef2f7 0%,#dfe6f0 100%);font-family:system-ui,sans-serif;">
        <div style="border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.18);border:1px solid #d0d6e0;">
          <img src="data:image/png;base64,${lightPng}" width="320" alt="Light popup" style="display:block;" />
        </div>
        <div style="border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.28);border:1px solid #3c4043;">
          <img src="data:image/png;base64,${darkPng}" width="320" alt="Dark popup" style="display:block;" />
        </div>
      </body></html>`);
    await canvasPage.screenshot({ path: join(outDir, "03-extension-popup-1280x800.png") });
  } finally {
    await ext.close();
  }

  console.log("Captured 1280x800 store screenshots in tmp/store-screenshots/");
}

await main();
