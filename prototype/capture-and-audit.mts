import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const prototypePath = resolve("tmp/prototype-mobile/mobile-controls-prototype.html");
const outDir = resolve("tmp/prototype-mobile/review");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results: Array<Record<string, unknown>> = [];

try {
  const cases = [
    { variant: "B", theme: "light", w: "390", st: "idle", view: "top", pop: "0", ad: "0" },
    { variant: "B", theme: "dark", w: "390", st: "idle", view: "top", pop: "0", ad: "0" },
    { variant: "B", theme: "light", w: "390", st: "running", view: "top", pop: "0", ad: "0" },
    { variant: "B", theme: "light", w: "390", st: "error", view: "top", pop: "1", ad: "0" },
    { variant: "B", theme: "dark", w: "412", st: "completed", view: "top", pop: "0", ad: "0" },
    { variant: "B", theme: "light", w: "390", st: "running", view: "floating", pop: "0", ad: "0" },
    { variant: "B", theme: "dark", w: "390", st: "running", view: "floating", pop: "0", ad: "1" },
    { variant: "B", theme: "light", w: "390", st: "idle", view: "bottom", pop: "1", ad: "1" },
    { variant: "A", theme: "dark", w: "390", st: "running", view: "floating", pop: "0", ad: "1" },
    { variant: "A", theme: "light", w: "390", st: "running", view: "floating", pop: "0", ad: "0" },
  ] as const;

  const context = await browser.newContext({ viewport: { width: 1000, height: 1050 } });
  const page = await context.newPage();

  for (const c of cases) {
    const url = new URL(pathToFileURL(prototypePath).href);
    url.searchParams.set("variant", c.variant);
    url.searchParams.set("theme", c.theme);
    url.searchParams.set("w", c.w);
    url.searchParams.set("st", c.st);
    url.searchParams.set("view", c.view);
    url.searchParams.set("pop", c.pop);
    url.searchParams.set("ad", c.ad);
    url.searchParams.set("capture", "1");
    await page.goto(url.href, { waitUntil: "load" });

    const phone = page.locator("#phone-viewport");
    const fileName = `r2-${c.variant}-${c.theme}-${c.w}-${c.st}-${c.view}${c.ad === "1" ? "-ad" : ""}${c.pop === "1" ? "-pop" : ""}.png`;
    await phone.screenshot({ path: resolve(outDir, fileName) });

    const axe = await new AxeBuilder({ page })
      .include("[data-pikabu-expand-comments]")
      .include("#floating-stop-slot")
      .include("#popover-slot")
      .analyze();

    const metrics = await page.evaluate(() => {
      const vp = document.getElementById("phone-viewport")!;
      const vpRect = vp.getBoundingClientRect();
      const scroll = document.getElementById("phone-scroll")!;
      const menu = document.getElementById("comments-menu")!;
      const topStrip = document.getElementById("mobile-top-strip")!;
      const bottomFooter = document.getElementById("mobile-bottom-footer")!;
      const overflowX = scroll.scrollWidth - scroll.clientWidth;
      const menuOverflowX = menu.scrollWidth - menu.clientWidth;

      const controls = Array.from(
        vp.querySelectorAll<HTMLElement>(
          "[data-pikabu-expand-comments] button, .m-floating-btn, .m-settings-opt",
        ),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height) };
      });

      const floorAd = document.getElementById("pkb-floor-ad")!;
      const floating = document.getElementById("floating-stop-el");
      let floatingOverlapsAd = false;
      if (floating && !floorAd.hidden) {
        const fr = floating.getBoundingClientRect();
        const ar = floorAd.getBoundingClientRect();
        floatingOverlapsAd = fr.bottom > ar.top && fr.top < ar.bottom;
      }

      // Check how many Stop buttons are visible inside phone viewport
      const headerBottom = document.getElementById("pkb-header")!.getBoundingClientRect().bottom;
      const visibleStopCount = Array.from(vp.querySelectorAll<HTMLButtonElement>("button")).filter(
        (btn) => {
          if (!btn.textContent?.includes("Остановить")) return false;
          const r = btn.getBoundingClientRect();
          return r.bottom > headerBottom && r.top < vpRect.bottom && r.height > 0;
        },
      ).length;

      // Check popover doesn't overlap its own trigger or floor ad, and ARIA controls/expanded match
      const pop = vp.querySelector<HTMLElement>(".m-popover");
      let popoverOverlapsTrigger = false;
      let popoverOverlapsAd = false;
      let expandedGears = Array.from(vp.querySelectorAll<HTMLElement>("[data-toggle-pop]")).filter(
        (g) => g.getAttribute("aria-expanded") === "true",
      ).length;
      let ariaControlsValid = true;
      if (pop) {
        const trigger = vp.querySelector<HTMLElement>('[data-toggle-pop][aria-expanded="true"]');
        ariaControlsValid = Boolean(trigger && trigger.getAttribute("aria-controls") === pop.id);
        if (trigger) {
          const pr = pop.getBoundingClientRect();
          const tr = trigger.getBoundingClientRect();
          popoverOverlapsTrigger = pr.top < tr.bottom && pr.bottom > tr.top;
          if (!floorAd.hidden) {
            const ar = floorAd.getBoundingClientRect();
            popoverOverlapsAd = pr.bottom > ar.top && pr.top < ar.bottom;
          }
        }
      }

      return {
        menuHeight: Math.round(menu.getBoundingClientRect().height),
        topStripHeight: Math.round(topStrip.getBoundingClientRect().height),
        bottomFooterHeight: Math.round(bottomFooter.getBoundingClientRect().height),
        overflowX,
        menuOverflowX,
        minTouchTarget: controls.length ? Math.min(...controls.map((x) => Math.min(x.w, x.h))) : null,
        floatingOverlapsAd,
        popoverOverlapsTrigger,
        popoverOverlapsAd,
        expandedGears,
        ariaControlsValid,
        visibleStopCount,
      };
    });

    results.push({
      ...c,
      fileName,
      axeViolations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      ...metrics,
    });
  }

  await writeFile(resolve(outDir, "metrics.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
