import { expect, test } from "@playwright/test";
import {
  VISUAL_POST_URL,
  VISUAL_THEMES,
  VISUAL_VIEWPORTS,
  assertLightDarkTokenParity,
  auditAxe,
  auditCurrentState,
  auditPikabuTokens,
  auditShadowContrast,
  evaluateP0Gates,
  measureTabBar,
  preparePikabuVisualPage,
  type TokenAuditReport,
} from "../support/visual-audit.ts";

test("resolves Pikabu light and dark tokens, passes axe-core, has no page overflow, and meets Shadow DOM text contrast", async ({
  browser,
}) => {
  for (const viewport of VISUAL_VIEWPORTS) {
    const tokensByTheme: Partial<Record<(typeof VISUAL_THEMES)[number], TokenAuditReport>> = {};

    for (const theme of VISUAL_THEMES) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await preparePikabuVisualPage(page, { theme, viewport, withUserscript: true });
      await page.goto(VISUAL_POST_URL);
      await expect(
        page
          .locator(".story-comments__menu")
          .getByRole("button", { name: "Раскрыть все комментарии" }),
      ).toBeVisible();

      const tokens = await auditPikabuTokens(page);
      expect(tokens.emptyTokens, `Empty Pikabu CSS tokens (${theme} ${viewport.name})`).toEqual([]);
      tokensByTheme[theme] = tokens;

      const tabBar = await measureTabBar(page);
      expect(tabBar.page.scrollWidth).toBeLessThanOrEqual(tabBar.page.innerWidth);

      const axe = await auditAxe(page);
      expect(axe.violations, `axe-core violations (${theme} ${viewport.name})`).toEqual([]);
      expect(Array.isArray(axe.incomplete)).toBe(true);

      const contrast = await auditShadowContrast(page);
      const textFailures = contrast.failures.filter((sample) => sample.kind === "text");
      expect(textFailures, `Shadow DOM text contrast failures (${theme} ${viewport.name})`).toEqual(
        [],
      );

      await context.close();
    }

    expect(assertLightDarkTokenParity(tokensByTheme.light!, tokensByTheme.dark!)).toEqual([]);
  }
});

test("visual-audit P0 harness passes on a compliant host-native control and flags P0 regressions", async ({
  browser,
}) => {
  const viewport = VISUAL_VIEWPORTS[0]!;
  const context = await browser.newContext();
  const page = await context.newPage();
  await preparePikabuVisualPage(page, { theme: "dark", viewport, withUserscript: false });
  await page.goto(VISUAL_POST_URL);
  const baseline = await measureTabBar(page);

  // Inject a compliant single-row Shadow DOM control with high-contrast text, border, and focus outline.
  await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>(".story-comments__menu")!;
    const host = document.createElement("span");
    host.dataset["pikabuExpandComments"] = "top";
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 8px;
        color: var(--color-black-940);
      }
      button {
        height: 30px;
        padding: 0 12px;
        border: 1px solid var(--color-black-700);
        border-radius: 8px;
        background: var(--color-black-440);
        color: var(--color-black-940);
        font: 500 13px / 16px inherit;
      }
      button:focus-visible {
        outline: 2px solid var(--color-black-940);
        outline-offset: 2px;
      }
    `);
    shadow.adoptedStyleSheets = [sheet];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Раскрыть";
    shadow.append(button);
    menu.append(host);
  });

  const compliant = await auditCurrentState(page, "compliant", baseline);
  expect(compliant.p0.failures).toEqual([]);
  expect(compliant.p0.passed).toBe(true);

  // Induce a tab-bar bloat regression and verify the P0 harness catches it deterministically.
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-pikabu-expand-comments="top"]')!;
    host.style.height = "80px";
  });
  const distorted = await auditCurrentState(page, "distorted", baseline);
  expect(distorted.p0.passed).toBe(false);
  expect(distorted.p0.failures.some((f) => f.gate === "geometry")).toBe(true);

  // Verify evaluator catches CLS, missing tokens, axe violations, and contrast failures.
  const synthetic = evaluateP0Gates({
    geometryDiff: compliant.geometryDiff,
    cls: { totalScore: 0.05, entryCount: 1 },
    tokens: {
      consumedTokens: ["--missing"],
      values: { "--missing": "" },
      emptyTokens: ["--missing"],
    },
    axe: {
      violations: [
        { id: "button-name", impact: "critical", help: "label", nodeCount: 1, targets: ["button"] },
      ],
      incomplete: [],
    },
    contrast: {
      samples: [],
      failures: [
        {
          hostPlacement: "top",
          selector: "button",
          kind: "ui-boundary",
          text: "Раскрыть",
          foreground: "rgb(100, 100, 100)",
          background: "rgb(90, 90, 90)",
          ratio: 1.2,
          minRequired: 3,
          passed: false,
        },
      ],
    },
  });
  expect(synthetic.passed).toBe(false);
  expect(synthetic.failures.map((f) => f.gate).sort()).toEqual([
    "axe",
    "cls",
    "contrast",
    "tokens",
  ]);

  await context.close();
});
