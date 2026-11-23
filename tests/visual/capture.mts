import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator, type Page } from "@playwright/test";
import {
  VISUAL_POST_URL,
  VISUAL_THEMES,
  VISUAL_VIEWPORTS,
  assertLightDarkTokenParity,
  auditCurrentState,
  measureTabBar,
  preparePikabuVisualPage,
  type StateAuditMetrics,
  type TabBarSnapshot,
  type VisualTheme,
  type VisualViewport,
} from "../support/visual-audit.ts";

const outputRoot = fileURLToPath(new URL("../../tmp/visual-review", import.meta.url));
const chromiumExecutable = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];

interface ComboReport {
  theme: VisualTheme;
  viewport: VisualViewport;
  baseline: TabBarSnapshot;
  states: StateAuditMetrics[];
  screenshots: string[];
}

async function captureClip(
  page: Page,
  target: Locator,
  destination: string,
  pad: { top: number; bottom: number; left: number; right: number },
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) {
    await page.screenshot({ path: destination });
    return;
  }
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const x = Math.max(0, Math.floor(box.x - pad.left));
  const y = Math.max(0, Math.floor(box.y - pad.top));
  const width = Math.min(viewport.width - x, Math.ceil(box.width + pad.left + pad.right));
  const height = Math.min(viewport.height - y, Math.ceil(box.height + pad.top + pad.bottom));
  await page.screenshot({
    path: destination,
    clip: { x, y, width: Math.max(1, width), height: Math.max(1, height) },
  });
}

async function captureTopHeader(page: Page, destination: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureClip(page, page.locator(".story-comments__menu"), destination, {
    top: 24,
    bottom: 120,
    left: 16,
    right: 16,
  });
}

async function captureBottomBar(page: Page, destination: string): Promise<void> {
  const bottom = page.locator('[data-pikabu-expand-comments="bottom"]');
  if (await bottom.isVisible()) {
    await captureClip(page, bottom, destination, {
      top: 48,
      bottom: 110,
      left: 24,
      right: 24,
    });
  } else {
    await captureClip(page, page.locator('section[data-role="answer"]'), destination, {
      top: 80,
      bottom: 40,
      left: 16,
      right: 16,
    });
  }
}

async function runCaptureForCombo(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  theme: VisualTheme,
  viewport: VisualViewport,
): Promise<ComboReport> {
  const comboDirName = `${theme}-${viewport.name}`;
  const comboDir = join(outputRoot, comboDirName);
  mkdirSync(comboDir, { recursive: true });
  const screenshots: string[] = [];
  const states: StateAuditMetrics[] = [];

  const rel = (fileName: string) => {
    const relPath = `${comboDirName}/${fileName}`;
    screenshots.push(relPath);
    return join(comboDir, fileName);
  };

  // 00. Baseline without userscript
  const baselineContext = await browser.newContext();
  const baselinePage = await baselineContext.newPage();
  await preparePikabuVisualPage(baselinePage, { theme, viewport, withUserscript: false });
  await baselinePage.goto(VISUAL_POST_URL);
  const baseline = await measureTabBar(baselinePage);
  await captureTopHeader(baselinePage, rel("00-baseline-no-script.png"));
  await captureBottomBar(baselinePage, rel("00-baseline-no-script-bottom.png"));
  await baselineContext.close();

  // 01–07. Main interactive lifecycle
  const context = await browser.newContext();
  const page = await context.newPage();
  await preparePikabuVisualPage(page, { theme, viewport, withUserscript: true });

  const holdBranch = Promise.withResolvers<void>();
  await page.route("**/ajax/comments_actions.php", async (route) => {
    const step = route.request().postData();
    if (step === "branch") await holdBranch.promise;
    await route.fulfill({ contentType: "text/plain; charset=utf-8", body: `Комментарий ${step}` });
  });

  await page.goto(VISUAL_POST_URL);
  const top = page.locator(".story-comments__menu");
  const bottom = page.locator('[data-pikabu-expand-comments="bottom"]');
  const start = top.getByRole("button", { name: "Раскрыть все комментарии" });
  const settings = top.getByRole("button", { name: "Настройки" });
  await start.waitFor({ state: "visible" });

  // 01. Idle
  states.push(await auditCurrentState(page, "01-idle", baseline));
  await captureTopHeader(page, rel("01-idle.png"));
  await captureBottomBar(page, rel("01-idle-bottom.png"));

  // 02. Settings open (top & bottom)
  await settings.click();
  states.push(await auditCurrentState(page, "02-settings-open", baseline));
  await captureTopHeader(page, rel("02-settings-open.png"));
  await settings.click();

  await bottom.getByRole("button", { name: "Настройки" }).click();
  await captureBottomBar(page, rel("02-settings-open-bottom.png"));
  await bottom.getByRole("button", { name: "Настройки" }).click();

  // 03. Running + 04. Floating stop
  await start.click();
  await top.getByRole("button", { name: "Остановить" }).waitFor({ state: "visible" });
  states.push(await auditCurrentState(page, "03-running", baseline, { checkCls: false }));
  await captureTopHeader(page, rel("03-running.png"));

  await page.evaluate(() => {
    const comments = document.querySelector(".comments__container");
    if (comments) {
      const spacer = document.createElement("div");
      spacer.id = "visual-capture-spacer";
      spacer.style.height = "1600px";
      comments.prepend(spacer);
    }
    window.scrollTo(0, 700);
  });
  await page.waitForTimeout(50);
  states.push(
    await auditCurrentState(page, "04-running-floating-stop", baseline, { checkCls: false }),
  );
  await page.screenshot({ path: rel("04-running-floating-stop.png") });
  await page.evaluate(() => {
    document.getElementById("visual-capture-spacer")?.remove();
    window.scrollTo(0, 0);
  });

  // 05. Stopped
  await top.getByRole("button", { name: "Остановить" }).first().click();
  await top.getByRole("button", { name: "Продолжить" }).waitFor({ state: "visible" });
  states.push(await auditCurrentState(page, "05-stopped", baseline, { checkCls: false }));
  await captureTopHeader(page, rel("05-stopped.png"));

  // Release and finish to 07. Completed all
  holdBranch.resolve();
  await top.getByRole("button", { name: "Продолжить" }).click();
  await top.getByRole("status").filter({ hasText: "Все комментарии раскрыты." }).waitFor();
  states.push(await auditCurrentState(page, "07-completed-all", baseline, { checkCls: false }));
  await captureTopHeader(page, rel("07-completed-all.png"));
  await captureBottomBar(page, rel("07-completed-all-bottom.png"));
  await context.close();

  // 06. Error state (Comment Batch hydration timeout -> Retry)
  const errContext = await browser.newContext();
  const errPage = await errContext.newPage();
  await errPage.clock.install();
  await preparePikabuVisualPage(errPage, { theme, viewport, withUserscript: true });
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
  await errPage
    .locator(".story-comments__menu")
    .getByRole("button", { name: "Раскрыть все комментарии" })
    .click();
  await errPage.clock.runFor(67_500);
  await errPage.clock.resume();
  await errPage
    .locator(".story-comments__menu")
    .getByRole("button", { name: "Повторить" })
    .waitFor({ state: "visible" });
  states.push(await auditCurrentState(errPage, "06-error", baseline, { checkCls: false }));
  await captureTopHeader(errPage, rel("06-error.png"));
  await errContext.close();

  // 08. Completed with skipped plural branches (2 silent drops -> "Не удалось раскрыть 2 ветки.")
  const skippedContext = await browser.newContext();
  const skippedPage = await skippedContext.newPage();
  await skippedPage.clock.install();
  await preparePikabuVisualPage(skippedPage, { theme, viewport, withUserscript: true });
  await skippedPage.goto(VISUAL_POST_URL);
  await skippedPage.evaluate(() => {
    const oldContainer = document.querySelector(".comments__container")!;
    const fresh = document.createElement("div");
    fresh.className = "comments__container";
    for (const id of ["s1", "s2"]) {
      const root = document.createElement("div");
      root.className = "comment";
      root.dataset["id"] = id;
      root.innerHTML = `<div class="comment__body">Комментарий ${id}</div>
        <button type="button" class="comment-toggle-children comment-toggle-children_collapse">раскрыть ветку</button>
        <div class="comment__children" hidden></div>`;
      const btn = root.querySelector("button")!;
      const children = root.querySelector<HTMLElement>(".comment__children")!;
      btn.addEventListener("click", () => {
        btn.classList.remove("comment-toggle-children_collapse");
        children.hidden = false;
      });
      fresh.append(root);
    }
    oldContainer.replaceWith(fresh);
  });
  await skippedPage
    .locator(".story-comments__menu")
    .getByRole("button", { name: "Раскрыть все комментарии" })
    .click();
  for (let i = 0; i < 3; i += 1) {
    await skippedPage.clock.runFor(15_200);
  }
  await skippedPage.clock.resume();
  await skippedPage
    .locator(".story-comments__menu")
    .getByRole("status")
    .filter({ hasText: "Не удалось раскрыть 2 ветки." })
    .waitFor();
  states.push(
    await auditCurrentState(skippedPage, "08-completed-skipped-plural", baseline, {
      checkCls: false,
    }),
  );
  await captureTopHeader(skippedPage, rel("08-completed-skipped-plural.png"));
  await skippedContext.close();

  return { theme, viewport, baseline, states, screenshots };
}

async function main() {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
  });

  try {
    const combos: ComboReport[] = [];
    for (const viewport of VISUAL_VIEWPORTS) {
      for (const theme of VISUAL_THEMES) {
        combos.push(await runCaptureForCombo(browser, theme, viewport));
      }
    }

    const tokenParityFailures: Array<{ viewport: string; identicalTokens: string[] }> = [];
    for (const viewport of VISUAL_VIEWPORTS) {
      const lightIdle = combos
        .find((c) => c.viewport.name === viewport.name && c.theme === "light")
        ?.states.find((s) => s.state === "01-idle");
      const darkIdle = combos
        .find((c) => c.viewport.name === viewport.name && c.theme === "dark")
        ?.states.find((s) => s.state === "01-idle");
      if (lightIdle && darkIdle) {
        const identical = assertLightDarkTokenParity(lightIdle.tokens, darkIdle.tokens);
        if (identical.length > 0) {
          tokenParityFailures.push({ viewport: viewport.name, identicalTokens: identical });
        }
      }
    }

    const allP0Failures = combos.flatMap((combo) =>
      combo.states.flatMap((state) =>
        state.p0.failures.map((f) => ({
          theme: combo.theme,
          viewport: combo.viewport.name,
          state: state.state,
          gate: f.gate,
          message: f.message,
        })),
      ),
    );

    const metrics = {
      generatedAt: new Date().toISOString(),
      outputDir: "tmp/visual-review",
      p0Summary: {
        passed: allP0Failures.length === 0 && tokenParityFailures.length === 0,
        totalFailures: allP0Failures.length + tokenParityFailures.length,
        tokenParityFailures,
        failures: allP0Failures,
      },
      combos,
    };

    const metricsPath = join(outputRoot, "metrics.json");
    writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

    const screenshotCount = combos.reduce((sum, combo) => sum + combo.screenshots.length, 0);
    console.log(
      `Captured ${screenshotCount} screenshots and metrics.json in tmp/visual-review/ (${allP0Failures.length} P0 findings).`,
    );
  } finally {
    await browser.close();
  }
}

await main();
