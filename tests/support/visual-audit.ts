import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { installUserscript } from "./install-userscript.ts";

export const VISUAL_THEMES = ["light", "dark"] as const;
export type VisualTheme = (typeof VISUAL_THEMES)[number];
export type VisualProfile = "desktop" | "mobile";

export interface VisualViewport {
  name: string;
  width: number;
  height: number;
  profile: VisualProfile;
}

export const VISUAL_VIEWPORTS: readonly VisualViewport[] = [
  { name: "1280x800", width: 1280, height: 800, profile: "desktop" },
  { name: "1024x800", width: 1024, height: 800, profile: "desktop" },
];

export const MOBILE_VISUAL_VIEWPORTS: readonly VisualViewport[] = [
  { name: "390x844", width: 390, height: 844, profile: "mobile" },
  { name: "412x915", width: 412, height: 915, profile: "mobile" },
];

export const ALL_VISUAL_VIEWPORTS: readonly VisualViewport[] = [
  ...VISUAL_VIEWPORTS,
  ...MOBILE_VISUAL_VIEWPORTS,
];

export const VISUAL_POST_URL = "https://pikabu.ru/story/fixture_1";

const postHtml = readFileSync(new URL("../fixtures/post-page.html", import.meta.url), "utf8");
const pikabuThemeCss = readFileSync(
  new URL("../fixtures/pikabu-theme.css", import.meta.url),
  "utf8",
);
const fixtureScriptPath = fileURLToPath(new URL("../fixtures/comment-loading.js", import.meta.url));

const CORE_PIKABU_TOKENS = [
  "--color-black-300",
  "--color-bright-800",
  "--color-black-430",
  "--color-black-440",
  "--color-black-940",
  "--color-black-800",
  "--color-black-700",
  "--color-primary-900",
  "--color-primary-700",
  "--color-black-alpha-16",
] as const;

export interface TabRect {
  text: string;
  top: number;
  bottom: number;
  height: number;
  left: number;
  right: number;
}

export interface TabBarSnapshot {
  menu: {
    height: number;
    width: number;
    top: number;
    bottom: number;
    scrollWidth: number;
    clientWidth: number;
  };
  tabs: TabRect[];
  activeTabUnderlineGapPx: number | null;
  topHost: { width: number; height: number; top: number; bottom: number } | null;
  page: { scrollWidth: number; innerWidth: number };
}

export interface GeometryDiff {
  menuHeightDeltaPx: number;
  maxTabTopDeltaPx: number;
  maxTabHeightDeltaPx: number;
  activeTabUnderlineGapPx: number | null;
  menuOverflowPx: number;
  pageOverflowPx: number;
}

export interface ClsReport {
  totalScore: number;
  entryCount: number;
}

export interface TokenAuditReport {
  consumedTokens: string[];
  values: Record<string, string>;
  emptyTokens: string[];
}

export interface AxeFinding {
  id: string;
  impact: string | null;
  help: string;
  nodeCount: number;
  targets: string[];
}

export interface AxeAuditReport {
  violations: AxeFinding[];
  incomplete: AxeFinding[];
}

export interface ContrastSample {
  hostPlacement: string;
  selector: string;
  kind: "text" | "ui-boundary" | "focus-outline";
  text: string;
  foreground: string;
  background: string;
  ratio: number;
  minRequired: number;
  passed: boolean;
}

export interface ContrastAuditReport {
  samples: ContrastSample[];
  failures: ContrastSample[];
}

export interface P0Failure {
  gate: "geometry" | "overflow" | "cls" | "tokens" | "axe" | "contrast";
  message: string;
}

export interface StateAuditMetrics {
  state: string;
  geometry: TabBarSnapshot;
  geometryDiff: GeometryDiff;
  cls: ClsReport;
  tokens: TokenAuditReport;
  axe: AxeAuditReport;
  contrast: ContrastAuditReport;
  p0: { passed: boolean; failures: P0Failure[] };
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseCssColor(value: string): RgbaColor | null {
  const trimmed = value.trim();
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i,
  );
  if (rgbMatch) {
    const [, rRaw, gRaw, bRaw, aRaw] = rgbMatch;
    let a = 1;
    if (aRaw !== undefined) {
      a = aRaw.endsWith("%") ? Number.parseFloat(aRaw) / 100 : Number.parseFloat(aRaw);
    }
    return {
      r: Number.parseFloat(rRaw!),
      g: Number.parseFloat(gRaw!),
      b: Number.parseFloat(bRaw!),
      a: Math.min(1, Math.max(0, Number.isNaN(a) ? 1 : a)),
    };
  }
  const srgbMatch = trimmed.match(
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i,
  );
  if (srgbMatch) {
    const [, rRaw, gRaw, bRaw, aRaw] = srgbMatch;
    let a = 1;
    if (aRaw !== undefined) {
      a = aRaw.endsWith("%") ? Number.parseFloat(aRaw) / 100 : Number.parseFloat(aRaw);
    }
    return {
      r: Math.min(255, Math.max(0, Number.parseFloat(rRaw!) * 255)),
      g: Math.min(255, Math.max(0, Number.parseFloat(gRaw!) * 255)),
      b: Math.min(255, Math.max(0, Number.parseFloat(bRaw!) * 255)),
      a: Math.min(1, Math.max(0, Number.isNaN(a) ? 1 : a)),
    };
  }
  return null;
}

export function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  const outA = fg.a + bg.a * (1 - fg.a);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / outA,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / outA,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / outA,
    a: outA,
  };
}

export function relativeLuminance(color: RgbaColor): number {
  const linearize = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

export function contrastRatio(a: RgbaColor, b: RgbaColor): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export function buildPikabuVisualHtml(
  theme: VisualTheme,
  profile: VisualProfile = "desktop",
  options?: { showFloorAd?: boolean },
): string {
  const bodyMatch = postHtml.match(/<body>([\s\S]*)<\/body>/);
  const innerBody = bodyMatch?.[1] ?? "";
  const themeAttr = theme === "dark" ? ' data-theme-dark=""' : "";
  const htmlClass = profile === "mobile" ? ' class="mv"' : "";
  const headerMarkup =
    profile === "mobile"
      ? '<header class="header"><span>☰ Пост</span><span>Пикабу</span></header>'
      : "";
  const mobileChrome =
    profile === "mobile"
      ? `<div class="story-action-bar" aria-hidden="true"><span>▲ 4398 ▼</span><span>💬 10</span></div>${
          options?.showFloorAd
            ? '<div class="pikabu-floor-ad" aria-hidden="true">Yandex RTB Floor Ad</div>'
            : ""
        }`
      : "";
  return `<!doctype html>
<html lang="ru"${htmlClass}${themeAttr}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Тестовый пост — Pikabu Visual Audit</title>
    <link rel="stylesheet" href="/pikabu-theme.css" />
    <script src="/fixture.js" defer></script>
  </head>
  <body>
    ${headerMarkup}
    <div class="pikabu-shell">
      <main class="pikabu-main">
        <div class="story-comments">
          ${innerBody}
        </div>
        <div class="pikabu-under-comments" aria-hidden="true"></div>
      </main>
      <aside class="pikabu-sidebar" aria-label="Боковая колонка">Боковая колонка Pikabu</aside>
    </div>
    ${mobileChrome}
  </body>
</html>`;
}

export async function preparePikabuVisualPage(
  page: Page,
  options: {
    theme: VisualTheme;
    viewport: VisualViewport;
    withUserscript: boolean;
    showFloorAd?: boolean;
  },
): Promise<void> {
  const profile = options.viewport.profile;
  await page.setViewportSize({ width: options.viewport.width, height: options.viewport.height });
  await page.emulateMedia({ colorScheme: options.theme, reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const tracker = { totalScore: 0, entryCount: 0, rawScore: 0, rawEntryCount: 0 };
    (window as unknown as Record<string, unknown>)["__pikabuClsTracker"] = tracker;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value?: number;
            hadRecentInput?: boolean;
            sources?: Array<{ node?: Node | null }>;
          };
          if (!shift.hadRecentInput && typeof shift.value === "number") {
            tracker.rawScore += shift.value;
            tracker.rawEntryCount += 1;
            const sources = shift.sources ?? [];
            const onlyBelowBottomControls =
              sources.length > 0 &&
              sources.every((source) => {
                const el = source.node instanceof Element ? source.node : null;
                return Boolean(el?.closest('section[data-role="answer"], .pikabu-under-comments'));
              });
            if (!onlyBelowBottomControls) {
              tracker.totalScore += shift.value;
              tracker.entryCount += 1;
            }
          }
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      // Layout Instability API unavailable.
    }
  });
  await page.route("**/*", (route) => route.abort());
  await page.route("https://pikabu.ru/pikabu-theme.css", (route) =>
    route.fulfill({ contentType: "text/css; charset=utf-8", body: pikabuThemeCss }),
  );
  await page.route("https://pikabu.ru/fixture.js", (route) =>
    route.fulfill({ path: fixtureScriptPath, contentType: "text/javascript" }),
  );
  await page.route(
    (url) => url.origin + url.pathname === VISUAL_POST_URL,
    (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: buildPikabuVisualHtml(
          options.theme,
          profile,
          options.showFloorAd === undefined ? undefined : { showFloorAd: options.showFloorAd },
        ),
      }),
  );
  if (options.withUserscript) {
    await installUserscript(page);
  }
}

export async function resetCls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tracker = (
      window as unknown as Record<
        string,
        | { totalScore: number; entryCount: number; rawScore: number; rawEntryCount: number }
        | undefined
      >
    )["__pikabuClsTracker"];
    if (!tracker) return;
    tracker.totalScore = 0;
    tracker.entryCount = 0;
  });
}

export async function measureTabBar(page: Page): Promise<TabBarSnapshot> {
  return page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>(".story-comments__menu");
    if (!menu) throw new Error("Missing .story-comments__menu in visual fixture");
    const m = menu.getBoundingClientRect();
    const borderBottom = Number.parseFloat(getComputedStyle(menu).borderBottomWidth) || 0;
    const tabs = Array.from(menu.querySelectorAll<HTMLElement>(".menu__item")).map((tab) => {
      const r = tab.getBoundingClientRect();
      return {
        text: (tab.textContent ?? "").trim(),
        top: Math.round(r.top * 100) / 100,
        bottom: Math.round(r.bottom * 100) / 100,
        height: Math.round(r.height * 100) / 100,
        left: Math.round(r.left * 100) / 100,
        right: Math.round(r.right * 100) / 100,
      };
    });
    const activeTab = menu.querySelector<HTMLElement>(".menu__item_current");
    const activeTabUnderlineGapPx = activeTab
      ? Math.round(
          Math.abs(m.bottom - borderBottom - activeTab.getBoundingClientRect().bottom) * 100,
        ) / 100
      : null;
    const host = document.querySelector<HTMLElement>('[data-pikabu-expand-comments="top"]');
    const hostRect = host?.getBoundingClientRect();
    return {
      menu: {
        height: Math.round(m.height * 100) / 100,
        width: Math.round(m.width * 100) / 100,
        top: Math.round(m.top * 100) / 100,
        bottom: Math.round(m.bottom * 100) / 100,
        scrollWidth: menu.scrollWidth,
        clientWidth: menu.clientWidth,
      },
      tabs,
      activeTabUnderlineGapPx,
      topHost: hostRect
        ? {
            width: Math.round(hostRect.width * 100) / 100,
            height: Math.round(hostRect.height * 100) / 100,
            top: Math.round(hostRect.top * 100) / 100,
            bottom: Math.round(hostRect.bottom * 100) / 100,
          }
        : null,
      page: {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      },
    };
  });
}

export function compareTabBarGeometry(
  baseline: TabBarSnapshot,
  current: TabBarSnapshot,
): GeometryDiff {
  const menuHeightDeltaPx =
    Math.round(Math.abs(current.menu.height - baseline.menu.height) * 100) / 100;
  let maxTabTopDeltaPx = 0;
  let maxTabHeightDeltaPx = 0;
  for (let i = 0; i < Math.min(baseline.tabs.length, current.tabs.length); i += 1) {
    const baseTab = baseline.tabs[i]!;
    const curTab = current.tabs[i]!;
    const baseOffsetTop = baseTab.top - baseline.menu.top;
    const curOffsetTop = curTab.top - current.menu.top;
    maxTabTopDeltaPx = Math.max(
      maxTabTopDeltaPx,
      Math.round(Math.abs(curOffsetTop - baseOffsetTop) * 100) / 100,
    );
    maxTabHeightDeltaPx = Math.max(
      maxTabHeightDeltaPx,
      Math.round(Math.abs(curTab.height - baseTab.height) * 100) / 100,
    );
  }
  return {
    menuHeightDeltaPx,
    maxTabTopDeltaPx,
    maxTabHeightDeltaPx,
    activeTabUnderlineGapPx: current.activeTabUnderlineGapPx,
    menuOverflowPx: Math.max(0, current.menu.scrollWidth - current.menu.clientWidth),
    pageOverflowPx: Math.max(0, current.page.scrollWidth - current.page.innerWidth),
  };
}

export async function readCls(page: Page): Promise<ClsReport> {
  return page.evaluate(() => {
    const tracker = (window as unknown as Record<string, ClsReport | undefined>)[
      "__pikabuClsTracker"
    ];
    return {
      totalScore: Math.round((tracker?.totalScore ?? 0) * 10_000) / 10_000,
      entryCount: tracker?.entryCount ?? 0,
    };
  });
}

export async function auditPikabuTokens(page: Page): Promise<TokenAuditReport> {
  return page.evaluate((coreTokens) => {
    const menu = document.querySelector<HTMLElement>(".story-comments__menu");
    if (!menu) throw new Error("Missing .story-comments__menu");
    const discovered = new Set<string>(coreTokens);
    const localDeclared = new Set<string>();
    const varPattern = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
    const declPattern = /(--[a-zA-Z0-9_-]+)\s*:/g;
    for (const host of document.querySelectorAll<HTMLElement>("[data-pikabu-expand-comments]")) {
      const shadow = host.shadowRoot;
      if (!shadow) continue;
      for (const sheet of shadow.adoptedStyleSheets) {
        for (const rule of Array.from(sheet.cssRules)) {
          let decl = declPattern.exec(rule.cssText);
          while (decl) {
            localDeclared.add(decl[1]!);
            decl = declPattern.exec(rule.cssText);
          }
          let match = varPattern.exec(rule.cssText);
          while (match) {
            discovered.add(match[1]!);
            match = varPattern.exec(rule.cssText);
          }
        }
      }
    }
    for (const local of localDeclared) discovered.delete(local);
    const styles = getComputedStyle(menu);
    const consumedTokens = Array.from(discovered).sort();
    const values: Record<string, string> = {};
    const emptyTokens: string[] = [];
    for (const token of consumedTokens) {
      const val = styles.getPropertyValue(token).trim();
      values[token] = val;
      if (!val) emptyTokens.push(token);
    }
    return { consumedTokens, values, emptyTokens };
  }, CORE_PIKABU_TOKENS);
}

export async function auditAxe(page: Page): Promise<AxeAuditReport> {
  const hasHosts = (await page.locator("[data-pikabu-expand-comments]").count()) > 0;
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (hasHosts) {
    builder = builder.include("[data-pikabu-expand-comments]");
  }
  const result = await builder.analyze();
  const mapItems = (items: typeof result.violations): AxeFinding[] =>
    items.map((item) => ({
      id: item.id,
      impact: item.impact ?? null,
      help: item.help,
      nodeCount: item.nodes.length,
      targets: item.nodes.map((node) => node.target.join(" >> ")),
    }));
  return {
    violations: mapItems(result.violations),
    incomplete: mapItems(result.incomplete),
  };
}

export async function auditShadowContrast(page: Page): Promise<ContrastAuditReport> {
  const rawSamples = await page.evaluate(() => {
    type RawSample = {
      hostPlacement: string;
      selector: string;
      kind: "text" | "ui-boundary" | "focus-outline";
      text: string;
      fg: string;
      bgChain: string[];
      parentBgChain: string[];
      minRequired: number;
    };

    const fallbackRootBg = document.documentElement.hasAttribute("data-theme-dark")
      ? "rgb(34, 35, 38)"
      : "rgb(255, 255, 255)";

    const collectBgChain = (start: Element | null): string[] => {
      const chain: string[] = [];
      let node: Element | null = start;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          chain.push(bg);
        }
        if (node.parentElement) {
          node = node.parentElement;
        } else {
          const root = node.getRootNode();
          node = root instanceof ShadowRoot ? root.host : null;
        }
      }
      chain.push(fallbackRootBg);
      return chain;
    };

    const describeElement = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("data-role") ?? el.getAttribute("role");
      const cls =
        el.className && typeof el.className === "string"
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : "";
      return `${tag}${cls}${role ? `[role=${role}]` : ""}`;
    };

    const isVisible = (el: Element): boolean => {
      if (el instanceof HTMLElement && el.hidden) return false;
      const cs = getComputedStyle(el);
      if (
        cs.display === "none" ||
        cs.visibility === "hidden" ||
        Number.parseFloat(cs.opacity) === 0
      ) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const samples: RawSample[] = [];
    for (const host of document.querySelectorAll<HTMLElement>("[data-pikabu-expand-comments]")) {
      if (!isVisible(host) || !host.shadowRoot) continue;
      const hostPlacement = host.dataset["pikabuExpandComments"] ?? "unknown";
      const parentElement = host.parentElement;
      const elements = Array.from(host.shadowRoot.querySelectorAll("*"));
      for (const el of elements) {
        if (!isVisible(el)) continue;
        const cs = getComputedStyle(el);
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join(" ")
          .trim();

        if (directText.length > 0) {
          const fontSize = Number.parseFloat(cs.fontSize) || 14;
          const fontWeight = Number.parseInt(cs.fontWeight, 10) || 400;
          const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
          samples.push({
            hostPlacement,
            selector: describeElement(el),
            kind: "text",
            text: directText.slice(0, 48),
            fg: cs.color,
            bgChain: collectBgChain(el),
            parentBgChain: [],
            minRequired: isLarge ? 3.0 : 4.5,
          });
        }

        if (el.matches("button, input")) {
          const borderWidth = Number.parseFloat(cs.borderTopWidth) || 0;
          const borderStyle = cs.borderTopStyle;
          const hasVisibleBorder =
            borderWidth > 0 &&
            borderStyle !== "none" &&
            cs.borderTopColor !== "rgba(0, 0, 0, 0)" &&
            cs.borderTopColor !== "transparent";
          const parentBgChain = collectBgChain(
            el.parentElement ?? host.parentElement ?? parentElement,
          );
          if (hasVisibleBorder) {
            samples.push({
              hostPlacement,
              selector: describeElement(el),
              kind: "ui-boundary",
              text: (el.textContent ?? el.getAttribute("aria-label") ?? el.tagName)
                .trim()
                .slice(0, 48),
              fg: cs.borderTopColor,
              bgChain: parentBgChain,
              parentBgChain: collectBgChain(el),
              minRequired: 3.0,
            });
          }
        }
      }
    }
    return samples;
  });

  // Also test real :focus-visible outline contrast on the first visible button in each mounted host.
  const focusSamples = await measureFocusOutlineContrast(page);

  const resolveChain = (chain: string[]): RgbaColor => {
    let acc: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const parsed = parseCssColor(chain[i]!);
      if (parsed) acc = compositeOver(parsed, acc);
    }
    return acc;
  };

  const samples: ContrastSample[] = [];
  for (const raw of [...rawSamples, ...focusSamples]) {
    const fgParsed = parseCssColor(raw.fg);
    if (!fgParsed) continue;
    const bg = resolveChain(raw.bgChain);
    const fg = compositeOver(fgParsed, bg);
    let ratio = contrastRatio(fg, bg);
    if (raw.kind === "ui-boundary" && raw.parentBgChain.length > 0) {
      // WCAG 1.4.11: control boundary passes if EITHER border OR control fill achieves >= 3:1 against adjacent surface.
      const fillBg = resolveChain(raw.parentBgChain);
      ratio = Math.max(ratio, contrastRatio(fillBg, bg));
    }
    samples.push({
      hostPlacement: raw.hostPlacement,
      selector: raw.selector,
      kind: raw.kind,
      text: raw.text,
      foreground: raw.fg,
      background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      ratio,
      minRequired: raw.minRequired,
      passed: ratio >= raw.minRequired,
    });
  }

  return {
    samples,
    failures: samples.filter((sample) => !sample.passed),
  };
}

async function measureFocusOutlineContrast(page: Page) {
  type RawFocus = {
    hostPlacement: string;
    selector: string;
    kind: "focus-outline";
    text: string;
    fg: string;
    bgChain: string[];
    parentBgChain: string[];
    minRequired: number;
  };
  const results: RawFocus[] = [];
  const hosts = page.locator("[data-pikabu-expand-comments]");
  const count = await hosts.count();

  for (let i = 0; i < count; i += 1) {
    const host = hosts.nth(i);
    if (!(await host.isVisible())) continue;
    const firstButton = host.locator("button:visible").first();
    if ((await firstButton.count()) === 0) continue;

    // Keyboard focus without scrolling the viewport (keeps offscreen floating shortcuts visible).
    await firstButton.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press("Shift");
    const sample = await firstButton.evaluate((el) => {
      const root = el.getRootNode();
      const hostEl = root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
      const hostPlacement = hostEl?.dataset["pikabuExpandComments"] ?? "unknown";
      const cs = getComputedStyle(el);
      const outlineWidth = Number.parseFloat(cs.outlineWidth) || 0;
      const outlineStyle = cs.outlineStyle;
      if (outlineWidth <= 0 || outlineStyle === "none") return null;
      const fallbackRootBg = document.documentElement.hasAttribute("data-theme-dark")
        ? "rgb(34, 35, 38)"
        : "rgb(255, 255, 255)";
      const chain: string[] = [];
      let node: Element | null = el.parentElement ?? hostEl?.parentElement ?? null;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") chain.push(bg);
        if (node.parentElement) {
          node = node.parentElement;
        } else {
          const r = node.getRootNode();
          node = r instanceof ShadowRoot ? r.host : null;
        }
      }
      chain.push(fallbackRootBg);
      return {
        hostPlacement,
        selector: `${el.tagName.toLowerCase()}:focus-visible`,
        kind: "focus-outline" as const,
        text: (el.textContent ?? el.getAttribute("aria-label") ?? "button").trim().slice(0, 48),
        fg: cs.outlineColor,
        bgChain: chain,
        parentBgChain: [],
        minRequired: 3.0,
      };
    });
    if (sample) results.push(sample);
    await firstButton.evaluate((el) => (el as HTMLElement).blur());
  }
  return results;
}

export function evaluateP0Gates(input: {
  geometryDiff: GeometryDiff;
  cls: ClsReport;
  tokens: TokenAuditReport;
  axe: AxeAuditReport;
  contrast: ContrastAuditReport;
  checkCls?: boolean;
}): { passed: boolean; failures: P0Failure[] } {
  const failures: P0Failure[] = [];

  if (input.geometryDiff.menuHeightDeltaPx > 1) {
    failures.push({
      gate: "geometry",
      message: `Tab-bar height shifted by ${input.geometryDiff.menuHeightDeltaPx}px (limit <= 1px)`,
    });
  }
  if (input.geometryDiff.maxTabTopDeltaPx > 1) {
    failures.push({
      gate: "geometry",
      message: `Native tab vertical position shifted by ${input.geometryDiff.maxTabTopDeltaPx}px (limit <= 1px)`,
    });
  }
  if (input.geometryDiff.maxTabHeightDeltaPx > 1) {
    failures.push({
      gate: "geometry",
      message: `Native tab height changed by ${input.geometryDiff.maxTabHeightDeltaPx}px (limit <= 1px)`,
    });
  }
  if (
    input.geometryDiff.activeTabUnderlineGapPx !== null &&
    input.geometryDiff.activeTabUnderlineGapPx > 1
  ) {
    failures.push({
      gate: "geometry",
      message: `Active tab underline detached by ${input.geometryDiff.activeTabUnderlineGapPx}px (limit <= 1px)`,
    });
  }
  if (input.geometryDiff.menuOverflowPx > 1) {
    failures.push({
      gate: "overflow",
      message: `.story-comments__menu overflows horizontally by ${input.geometryDiff.menuOverflowPx}px`,
    });
  }
  if (input.geometryDiff.pageOverflowPx > 0) {
    failures.push({
      gate: "overflow",
      message: `Page overflows viewport horizontally by ${input.geometryDiff.pageOverflowPx}px`,
    });
  }
  if ((input.checkCls ?? true) && input.cls.totalScore > 0) {
    failures.push({
      gate: "cls",
      message: `Unexpected CLS detected: ${input.cls.totalScore} (${input.cls.entryCount} entries)`,
    });
  }
  if (input.tokens.emptyTokens.length > 0) {
    failures.push({
      gate: "tokens",
      message: `Empty Pikabu CSS tokens: ${input.tokens.emptyTokens.join(", ")}`,
    });
  }
  if (input.axe.violations.length > 0) {
    const ids = input.axe.violations.map((v) => `${v.id}(${v.nodeCount})`).join(", ");
    failures.push({
      gate: "axe",
      message: `axe-core violations: ${ids}`,
    });
  }
  for (const failure of input.contrast.failures) {
    failures.push({
      gate: "contrast",
      message: `${failure.hostPlacement} ${failure.selector} (${failure.kind} "${failure.text}") contrast ${failure.ratio}:1 < ${failure.minRequired}:1 (${failure.foreground} on ${failure.background})`,
    });
  }

  return { passed: failures.length === 0, failures };
}

export async function auditCurrentState(
  page: Page,
  state: string,
  baseline: TabBarSnapshot,
  options?: { checkCls?: boolean },
): Promise<StateAuditMetrics> {
  const geometry = await measureTabBar(page);
  const geometryDiff = compareTabBarGeometry(baseline, geometry);
  const cls = await readCls(page);
  const tokens = await auditPikabuTokens(page);
  const axe = await auditAxe(page);
  const contrast = await auditShadowContrast(page);
  const p0 = evaluateP0Gates({
    geometryDiff,
    cls,
    tokens,
    axe,
    contrast,
    checkCls: options?.checkCls ?? true,
  });
  return { state, geometry, geometryDiff, cls, tokens, axe, contrast, p0 };
}

export interface MobileAuditReport {
  topStripHeight: number | null;
  bottomFooterHeight: number | null;
  minTouchTarget: number | null;
  popoverOverlapsTrigger: boolean;
  popoverOverlapsAd: boolean;
  floatingOverlapsAd: boolean;
  expandedGears: number;
  floatingRibbonVisible: boolean;
  floatingDuplicatesInlineStop: boolean;
  visibleStopCount: number;
}

export async function auditMobileState(page: Page): Promise<MobileAuditReport> {
  return page.evaluate(() => {
    const topHost = document.querySelector<HTMLElement>('[data-pikabu-expand-comments="top"]');
    const topStripHeight = topHost ? Math.round(topHost.getBoundingClientRect().height) : null;
    const bottomHost = document.querySelector<HTMLElement>(
      '[data-pikabu-expand-comments="bottom"]',
    );
    const bottomBar = bottomHost?.shadowRoot?.querySelector<HTMLElement>(".bar");
    const bottomFooterHeight =
      bottomHost && !bottomHost.hidden && bottomBar
        ? Math.round(bottomBar.getBoundingClientRect().height)
        : null;
    const header = document.querySelector<HTMLElement>("header.header");
    const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const floorAd = document.querySelector<HTMLElement>(".pikabu-floor-ad");
    const adRect = floorAd ? floorAd.getBoundingClientRect() : null;

    const touchDims: number[] = [];
    let popoverOverlapsTrigger = false;
    let popoverOverlapsAd = false;
    let floatingOverlapsAd = false;
    let expandedGears = 0;
    let floatingRibbonVisible = false;
    let inlineStopVisibleCount = 0;
    let visibleStopCount = 0;

    for (const host of document.querySelectorAll<HTMLElement>("[data-pikabu-expand-comments]")) {
      const shadow = host.shadowRoot;
      if (!shadow || host.hidden) continue;

      for (const el of shadow.querySelectorAll<HTMLElement>("button, .settings-option")) {
        if (el.hidden || el.closest("[hidden]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        touchDims.push(Math.min(Math.round(r.width), Math.round(r.height)));
      }

      const gear = shadow.querySelector<HTMLElement>('[data-role="settings"]');
      const pop = shadow.querySelector<HTMLElement>("#expansion-settings");
      if (gear?.getAttribute("aria-expanded") === "true") {
        expandedGears += 1;
        if (pop && !pop.hidden) {
          const pr = pop.getBoundingClientRect();
          const tr = gear.getBoundingClientRect();
          if (pr.top < tr.bottom && pr.bottom > tr.top) popoverOverlapsTrigger = true;
          if (adRect && pr.bottom > adRect.top && pr.top < adRect.bottom) popoverOverlapsAd = true;
        }
      }

      const ribbon = shadow.querySelector<HTMLElement>('[data-role="floating-ribbon"]');
      if (ribbon && !ribbon.hidden) {
        floatingRibbonVisible = true;
        if (adRect) {
          const rr = ribbon.getBoundingClientRect();
          if (rr.bottom > adRect.top && rr.top < adRect.bottom) floatingOverlapsAd = true;
        }
      }

      for (const btn of shadow.querySelectorAll<HTMLButtonElement>("button")) {
        if (btn.hidden || btn.closest("[hidden]")) continue;
        if (!btn.textContent?.includes("Остановить")) continue;
        const r = btn.getBoundingClientRect();
        if (r.height > 0 && r.bottom > headerBottom && r.top < window.innerHeight) {
          visibleStopCount += 1;
          if (!btn.classList.contains("floating-stop")) {
            inlineStopVisibleCount += 1;
          }
        }
      }
    }

    return {
      topStripHeight,
      bottomFooterHeight,
      minTouchTarget: touchDims.length > 0 ? Math.min(...touchDims) : null,
      popoverOverlapsTrigger,
      popoverOverlapsAd,
      floatingOverlapsAd,
      expandedGears,
      floatingRibbonVisible,
      floatingDuplicatesInlineStop: floatingRibbonVisible && inlineStopVisibleCount > 0,
      visibleStopCount,
    };
  });
}

export function evaluateMobileP0Gates(
  mobile: MobileAuditReport,
  options?: { expectedExpandedGears?: number; expectFloatingRibbon?: boolean },
): P0Failure[] {
  const failures: P0Failure[] = [];
  if (mobile.topStripHeight !== 56) {
    failures.push({
      gate: "geometry",
      message: `mobile topStripHeight=${mobile.topStripHeight}px (expected 56px)`,
    });
  }
  if (mobile.bottomFooterHeight !== null && mobile.bottomFooterHeight !== 56) {
    failures.push({
      gate: "geometry",
      message: `mobile bottomFooterHeight=${mobile.bottomFooterHeight}px (expected 56px)`,
    });
  }
  if (mobile.minTouchTarget !== null && mobile.minTouchTarget < 44) {
    failures.push({
      gate: "geometry",
      message: `mobile minTouchTarget=${mobile.minTouchTarget}px (expected >= 44px)`,
    });
  }
  if (mobile.popoverOverlapsTrigger) {
    failures.push({
      gate: "geometry",
      message: "mobile settings popover overlaps its gear trigger",
    });
  }
  if (mobile.popoverOverlapsAd) {
    failures.push({
      gate: "geometry",
      message: "mobile settings popover overlaps the floor ad",
    });
  }
  if (mobile.floatingOverlapsAd) {
    failures.push({
      gate: "geometry",
      message: "mobile floating progress ribbon overlaps the floor ad",
    });
  }
  if (options?.expectedExpandedGears !== undefined) {
    if (mobile.expandedGears !== options.expectedExpandedGears) {
      failures.push({
        gate: "geometry",
        message: `mobile expandedGears=${mobile.expandedGears} (expected ${options.expectedExpandedGears})`,
      });
    }
  } else if (mobile.expandedGears > 1) {
    failures.push({
      gate: "geometry",
      message: `mobile expandedGears=${mobile.expandedGears} (expected <= 1)`,
    });
  }
  if (mobile.floatingDuplicatesInlineStop) {
    failures.push({
      gate: "geometry",
      message: "mobile floating ribbon visible alongside an inline Stop control",
    });
  }
  if (options?.expectFloatingRibbon !== undefined) {
    if (mobile.floatingRibbonVisible !== options.expectFloatingRibbon) {
      failures.push({
        gate: "geometry",
        message: `mobile floatingRibbonVisible=${mobile.floatingRibbonVisible} (expected ${options.expectFloatingRibbon})`,
      });
    }
    if (options.expectFloatingRibbon && mobile.visibleStopCount !== 1) {
      failures.push({
        gate: "geometry",
        message: `mobile visibleStopCount=${mobile.visibleStopCount} (expected 1)`,
      });
    }
  }
  return failures;
}

export function assertLightDarkTokenParity(
  lightTokens: TokenAuditReport,
  darkTokens: TokenAuditReport,
): string[] {
  const identicalThemeTokens: string[] = [];
  const mustDiffer = [
    "--color-black-300",
    "--color-bright-800",
    "--color-black-430",
    "--color-black-940",
    "--color-black-800",
    "--color-black-700",
  ];
  for (const token of mustDiffer) {
    if (lightTokens.values[token] && lightTokens.values[token] === darkTokens.values[token]) {
      identicalThemeTokens.push(token);
    }
  }
  return identicalThemeTokens;
}
