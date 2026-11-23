import type { PostPageLayout } from "../adapters/pikabu/comment-view.ts";
import type { ExpansionSnapshot } from "../core/expansion-run.ts";

const desktopActionLabels = {
  idle: "Раскрыть все комментарии",
  running: "Остановить",
  stopped: "Продолжить",
  error: "Повторить",
  completed: "",
};

const mobileActionLabels = {
  idle: "Раскрыть все",
  running: "Остановить",
  stopped: "Продолжить",
  error: "Повторить",
  completed: "",
};

const branchPlural = new Intl.PluralRules("ru-RU");
const svgNs = "http://www.w3.org/2000/svg";

export interface MountExpansionControlOptions {
  layout?: PostPageLayout;
  mountTopHost?: (host: HTMLElement) => void;
  getTopInset?: () => number;
}

interface ControlInstance {
  host: HTMLElement;
  shadow: ShadowRoot;
  button: HTMLButtonElement;
  buttonLabel: HTMLSpanElement;
  buttonStopIcon: SVGSVGElement | undefined;
  counter: HTMLSpanElement;
  settings: HTMLButtonElement;
  popover: HTMLDivElement;
  checkbox: HTMLInputElement;
  status: HTMLSpanElement;
  inlineError: HTMLSpanElement | undefined;
  completedText: HTMLSpanElement | undefined;
  closePopover: (suppressFocus?: boolean) => void;
}

function createIcon(pathData: string, viewBox = "0 0 16 16", size = "16") {
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function createScrollBottomIcon(mobile: boolean) {
  return createIcon(
    "M4.5 4.25 8 7.75 11.5 4.25M4.5 8.5 8 12 11.5 8.5",
    "0 0 16 16",
    mobile ? "18" : "16",
  );
}

function createSettingsIcon(mobile: boolean) {
  const size = mobile ? "18" : "16";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const body = document.createElementNS(svgNs, "path");
  body.setAttribute(
    "d",
    "M6.7 2.2h2.6l.35 1.55a4.6 4.6 0 0 1 1.15.66l1.52-.48 1.3 2.25-1.18 1.08a4.7 4.7 0 0 1 0 1.48l1.18 1.08-1.3 2.25-1.52-.48a4.6 4.6 0 0 1-1.15.66l-.35 1.55H6.7l-.35-1.55a4.6 4.6 0 0 1-1.15-.66l-1.52.48-1.3-2.25 1.18-1.08a4.7 4.7 0 0 1 0-1.48L2.38 6.18l1.3-2.25 1.52.48a4.6 4.6 0 0 1 1.15-.66L6.7 2.2Z",
  );
  const center = document.createElementNS(svgNs, "circle");
  center.setAttribute("cx", "8");
  center.setAttribute("cy", "8");
  center.setAttribute("r", "1.85");
  svg.append(body, center);
  return svg;
}

function createStopSquareIcon() {
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("stop-square-icon");
  const rect = document.createElementNS(svgNs, "rect");
  rect.setAttribute("x", "1.5");
  rect.setAttribute("y", "1.5");
  rect.setAttribute("width", "9");
  rect.setAttribute("height", "9");
  rect.setAttribute("rx", "2");
  rect.setAttribute("fill", "currentColor");
  svg.append(rect);
  return svg;
}

function createDesktopControlStylesheet(placement: "top" | "bottom") {
  const stylesheet = new CSSStyleSheet();
  const hostLayout =
    placement === "top"
      ? `
      display: inline-flex;
      flex: 0 0 auto;
    `
      : `
      display: block;
    `;
  const barLayout =
    placement === "top"
      ? `
      display: inline-flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: 6px;
      padding-inline-start: 12px;
      block-size: 32px;
      white-space: nowrap;
    `
      : `
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px 12px;
      padding-block-start: 12px;
      border-top: 1px solid var(--color-black-430, #ebedf2);
      white-space: normal;
    `;
  const statusLayout =
    placement === "top"
      ? `
      min-inline-size: 0;
      max-inline-size: 192px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `
      : `
      min-inline-size: 0;
      overflow-wrap: anywhere;
    `;
  stylesheet.replaceSync(`
    :host {
      ${hostLayout}
      box-sizing: border-box;
      min-inline-size: 0;
      font: inherit;
      font-size: 13px;
      line-height: 16px;
      overflow-anchor: none;
      color: var(--color-black-940, #1b1e24);
      --focus-ring: color-mix(
        in srgb,
        var(--color-primary-900, #65ab3c) 76%,
        var(--color-black-940, #1b1e24)
      );
      --error-text: color-mix(
        in srgb,
        var(--color-danger-800, #f75c48) 58%,
        var(--color-black-940, #1b1e24)
      );
    }
    :host([hidden]) {
      display: none;
    }
    .bar-shell {
      box-sizing: border-box;
      ${placement === "bottom" ? "padding-block-start: var(--s-gap-blocks, 16px);" : ""}
    }
    .bar {
      box-sizing: border-box;
      min-inline-size: 0;
      ${barLayout}
    }
    :host([data-state="completed"]) .status-text {
      max-inline-size: 240px;
    }
    :host([data-state="error"]) .status-text {
      color: var(--error-text);
    }
    .group {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-inline-size: 0;
      flex-wrap: wrap;
    }
    button {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-inline-size: 0;
      max-inline-size: 100%;
      block-size: 32px;
      padding: 0 12px;
      border: 0;
      border-radius: 8px;
      background: var(
        --c-btn-secondary-bgDefault,
        var(--color-black-440, var(--color-black-300, #f7f8fc))
      );
      color: var(--color-black-940, #1b1e24);
      cursor: pointer;
      font: inherit;
      font-weight: 500;
      line-height: 16px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: opacity 150ms ease, transform 150ms ease;
    }
    button:hover {
      background: var(
        --c-btn-secondary-bgHover,
        color-mix(
          in srgb,
          var(--color-black-440, #e7e8ea) 86%,
          var(--color-black-940, #1b1e24)
        )
      );
    }
    button:active {
      background: color-mix(
        in srgb,
        var(--c-btn-secondary-bgHover, var(--color-black-440, #e7e8ea)) 88%,
        var(--color-black-940, #1b1e24)
      );
    }
    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    .icon-button {
      inline-size: 32px;
      block-size: 32px;
      padding: 0;
      flex: 0 0 auto;
      background: transparent;
      color: var(--color-black-800, #444850);
    }
    ${
      placement === "top"
        ? `.icon-button[data-role="settings"] {
      margin-inline-end: -6px;
    }`
        : ""
    }
    .icon-button:hover,
    .icon-button[aria-expanded="true"] {
      background: var(--c-btnIcon-primary-bgHover, rgba(128, 128, 128, 0.14));
      color: var(--color-black-940, #1b1e24);
    }
    .icon-button:active {
      background: var(--c-btnIcon-primary-bgClick, rgba(128, 128, 128, 0.22));
    }
    .icon-button svg,
    .floating-stop svg {
      display: block;
      flex: 0 0 auto;
      pointer-events: none;
    }
    .counter {
      display: inline-flex;
      align-items: center;
      block-size: 24px;
      padding: 0 8px;
      border-radius: 12px;
      background: var(--color-black-300, #f7f8fc);
      color: var(--color-black-800, #444850);
      font-size: 12px;
      font-weight: 500;
      line-height: 16px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .status-text {
      color: var(--color-black-800, #444850);
      font-size: 12px;
      line-height: 16px;
      ${statusLayout}
    }
    .status-text:empty {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      pointer-events: none;
    }
    .settings-popover {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 6px;
      max-inline-size: min(320px, calc(100vw - 16px));
      border: 1px solid var(--color-black-430, #ebedf2);
      border-radius: 8px;
      background: var(--color-bright-800, #fcfdff);
      color: var(--color-black-940, #1b1e24);
      box-shadow: var(--shadow-medium, 0 4px 20px 0 rgba(0, 0, 0, 0.12));
      white-space: normal;
      overscroll-behavior: contain;
      z-index: 1000;
    }
    .settings-popover::backdrop {
      background: transparent;
    }
    .settings-option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      line-height: 18px;
      color: var(--color-black-940, #1b1e24);
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .settings-option:hover {
      background: var(--c-btnIcon-primary-bgHover, rgba(128, 128, 128, 0.1));
    }
    .settings-option span {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .settings-option input {
      inline-size: 16px;
      block-size: 16px;
      margin: 0;
      flex: 0 0 auto;
      accent-color: var(--color-primary-900, #65ab3c);
      cursor: pointer;
    }
    .floating-stop {
      position: fixed;
      z-index: 1000;
      inset-inline-end: max(var(--s-gap-blocks, 16px), env(safe-area-inset-right));
      inset-block-end: max(var(--s-gap-blocks, 16px), env(safe-area-inset-bottom));
      block-size: 36px;
      padding: 0 14px;
      border: 0;
      border-radius: 12px;
      background: var(
        --c-btn-secondary-bgDefault,
        var(--color-black-440, var(--color-black-300, #f7f8fc))
      );
      color: var(--color-black-940, #1b1e24);
      max-inline-size: calc(
        100vw - max(var(--s-gap-blocks, 16px), env(safe-area-inset-left)) -
          max(var(--s-gap-blocks, 16px), env(safe-area-inset-right))
      );
      box-shadow: var(--shadow-medium, 0 4px 20px var(--color-black-alpha-16, rgb(0 0 0 / 0.16)));
    }
    .floating-stop:hover {
      background: var(
        --c-btn-secondary-bgHover,
        color-mix(
          in srgb,
          var(--color-black-440, #e7e8ea) 86%,
          var(--color-black-940, #1b1e24)
        )
      );
    }
    .floating-stop span {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .floating-stop svg {
      color: var(--error-text);
    }
    @media (prefers-reduced-motion: reduce) {
      button {
        transition: none;
      }
    }
    @media (pointer: coarse), (max-width: 480px) {
      :host {
        flex: 1 1 auto;
      }
      .bar {
        flex-wrap: wrap;
        block-size: auto;
        ${placement === "top" ? "padding-inline-start: 0.5rem;" : ""}
        white-space: normal;
      }
      .icon-button[data-role="settings"] {
        margin-inline-end: 0;
      }
      button,
      .settings-option {
        min-block-size: 44px;
      }
      .icon-button {
        min-inline-size: 44px;
      }
    }
    [hidden] {
      display: none !important;
    }
  `);
  return stylesheet;
}

function createMobileControlStylesheet(placement: "top" | "bottom") {
  const stylesheet = new CSSStyleSheet();
  const shellStyles =
    placement === "top"
      ? `
      background: var(--color-bright-800, #fcfdff);
      border-bottom: 1px solid var(--color-black-430, #ebedf2);
      padding: 6px 16px;
      block-size: 56px;
    `
      : `
      padding-block-start: var(--s-gap-blocks, 16px);
    `;
  const barStyles =
    placement === "top"
      ? `
      block-size: 44px;
    `
      : `
      border-top: 1px solid var(--color-black-430, #ebedf2);
      padding-block-start: 8px;
      block-size: 56px;
    `;
  stylesheet.replaceSync(`
    :host {
      display: block;
      box-sizing: border-box;
      min-inline-size: 0;
      font: inherit;
      font-size: 13px;
      line-height: 16px;
      overflow-anchor: none;
      color: var(--color-black-940, #1b1e24);
      --focus-ring: color-mix(
        in srgb,
        var(--color-primary-900, #65ab3c) 76%,
        var(--color-black-940, #1b1e24)
      );
      --error-text: color-mix(
        in srgb,
        var(--color-danger-800, #f75c48) 58%,
        var(--color-black-940, #1b1e24)
      );
      --mobile-btn-bg: color-mix(
        in srgb,
        var(--color-black-440, #e7e8ea) 68%,
        var(--c-btn-secondary-bgDefault, #dcdee5)
      );
    }
    :host([hidden]) {
      display: none;
    }
    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      pointer-events: none;
    }
    .bar-shell {
      box-sizing: border-box;
      ${shellStyles}
    }
    .bar {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-inline-size: 0;
      ${barStyles}
    }
    .left-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-inline-size: 0;
      flex: 1 1 auto;
    }
    .right-group {
      display: flex;
      align-items: center;
      gap: 0;
      flex: 0 0 auto;
      margin-inline-end: -8px;
    }
    .action-button {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-inline-size: 0;
      min-block-size: 44px;
      padding: 0 12px;
      border: 4px solid transparent;
      border-radius: 12px;
      background: var(--mobile-btn-bg);
      background-clip: padding-box;
      color: var(--color-black-940, #1b1e24);
      cursor: pointer;
      font: inherit;
      font-weight: 500;
      line-height: 16px;
      white-space: nowrap;
      flex: 0 0 auto;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: background-color 150ms ease;
    }
    .left-group > .action-button:first-child {
      margin-inline-start: -4px;
    }
    .action-button:hover {
      background: var(--c-btn-secondary-bgDefault, var(--color-black-440, #dcdee5));
      background-clip: padding-box;
    }
    .action-button:active {
      background: var(--c-btn-secondary-bgHover, var(--color-black-440, #ced1d9));
      background-clip: padding-box;
    }
    .action-button:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: -2px;
    }
    .icon-button {
      box-sizing: border-box;
      inline-size: 44px;
      block-size: 44px;
      padding: 0;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--color-black-800, #444850);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: background-color 150ms ease;
    }
    .icon-button:hover,
    .icon-button[aria-expanded="true"] {
      background: var(--c-btnIcon-primary-bgHover, rgba(128, 128, 128, 0.14));
      color: var(--color-black-940, #1b1e24);
    }
    .icon-button:active {
      background: var(--c-btnIcon-primary-bgClick, rgba(128, 128, 128, 0.22));
    }
    .icon-button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    .icon-button svg,
    .stop-square-icon {
      display: block;
      flex: 0 0 auto;
      pointer-events: none;
    }
    .stop-square-icon {
      color: var(--error-text);
    }
    .counter {
      display: inline-flex;
      align-items: center;
      block-size: 24px;
      padding: 0 8px;
      border-radius: 12px;
      background: var(--c-counter-bgTertiary, var(--color-black-300, #f2f3f7));
      color: var(--color-black-800, #444850);
      font-size: 12px;
      font-weight: 500;
      line-height: 16px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .inline-error {
      font-size: 12px;
      font-weight: 500;
      line-height: 16px;
      color: var(--error-text);
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .completed-text {
      font-size: 13px;
      line-height: 18px;
      color: var(--color-black-800, #444850);
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .settings-popover {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 6px;
      max-inline-size: min(320px, calc(100vw - 24px));
      border: 1px solid var(--color-black-430, #ebedf2);
      border-radius: 10px;
      background: var(--color-bright-800, #fcfdff);
      color: var(--color-black-940, #1b1e24);
      box-shadow: var(--shadow-medium, 0 4px 20px 0 rgba(0, 0, 0, 0.12));
      white-space: normal;
      overscroll-behavior: contain;
      z-index: 8000;
    }
    .settings-popover::backdrop {
      background: transparent;
    }
    .settings-option {
      display: flex;
      align-items: center;
      gap: 10px;
      min-block-size: 44px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      line-height: 18px;
      color: var(--color-black-940, #1b1e24);
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .settings-option:hover {
      background: var(--c-btnIcon-primary-bgHover, rgba(128, 128, 128, 0.1));
    }
    .settings-option span {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .settings-option input {
      inline-size: 18px;
      block-size: 18px;
      margin: 0;
      flex: 0 0 auto;
      accent-color: var(--color-primary-900, #65ab3c);
      cursor: pointer;
    }
    .floating-ribbon {
      box-sizing: border-box;
      position: fixed;
      inset-inline: 0;
      top: 0;
      z-index: 6500;
      min-block-size: 48px;
      padding-block: 2px;
      padding-inline-start: max(16px, env(safe-area-inset-left));
      padding-inline-end: max(12px, env(safe-area-inset-right));
      background: var(--color-bright-800, #fcfdff);
      border-bottom: 1px solid var(--color-black-430, #ebedf2);
      box-shadow: var(--shadow-medium, 0 4px 20px var(--color-black-alpha-16, rgb(0 0 0 / 0.16)));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .floating-ribbon[data-flush-top="true"] {
      padding-block-start: max(2px, env(safe-area-inset-top));
    }
    .ribbon-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      min-inline-size: 0;
    }
    .ribbon-label {
      font-size: 13px;
      font-weight: 500;
      line-height: 18px;
      color: var(--color-black-940, #1b1e24);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        transition: none !important;
        animation: none !important;
      }
    }
    [hidden] {
      display: none !important;
    }
  `);
  return stylesheet;
}

export function mountExpansionControl(
  menu: HTMLElement,
  actions: {
    start: (source?: "top" | "bottom") => void;
    stop: () => void;
    saveAutoExpandOnVisit: (enabled: boolean) => Promise<boolean>;
    scrollToBottom?: () => void;
  },
  savedPreference: Promise<boolean>,
  signal?: AbortSignal,
  mountBottomHost?: (host: HTMLElement) => void,
  options?: MountExpansionControlOptions,
) {
  const layout: PostPageLayout = options?.layout ?? "desktop";
  const isMobile = layout === "mobile";
  const actionLabels = isMobile ? mobileActionLabels : desktopActionLabels;
  const document = menu.ownerDocument;
  const page = document.defaultView;
  let running = false;
  let viewportEvents: AbortController | undefined;
  const checkboxes: HTMLInputElement[] = [];
  const instances: ControlInstance[] = [];

  function closeOtherPopovers(except: ControlInstance) {
    for (const instance of instances) {
      if (instance !== except) instance.closePopover(true);
    }
  }

  function createInstance(placement: "top" | "bottom"): ControlInstance {
    const host = document.createElement(!isMobile && placement === "top" ? "span" : "div");
    host.dataset["pikabuExpandComments"] = placement;
    if (isMobile) host.dataset["layout"] = "mobile";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [
      isMobile
        ? createMobileControlStylesheet(placement)
        : createDesktopControlStylesheet(placement),
    ];

    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    const buttonStopIcon = isMobile ? createStopSquareIcon() : undefined;
    if (buttonStopIcon) {
      buttonStopIcon.style.display = "none";
      button.append(buttonStopIcon);
    }
    const buttonLabel = document.createElement("span");
    if (isMobile) {
      button.append(buttonLabel);
    }
    button.addEventListener("click", () => {
      if (running) {
        actions.stop();
      } else {
        actions.start(placement);
      }
    });

    const counter = document.createElement("span");
    counter.className = "counter";
    counter.dataset["role"] = "counter";
    counter.setAttribute("role", "group");

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "icon-button";
    settings.dataset["role"] = "settings";
    settings.title = "Настройки";
    settings.setAttribute("aria-label", "Настройки");
    settings.setAttribute("aria-expanded", "false");
    settings.setAttribute("aria-controls", "expansion-settings");
    settings.setAttribute("aria-haspopup", "dialog");
    settings.append(createSettingsIcon(isMobile));

    const popover = document.createElement("div");
    popover.id = "expansion-settings";
    popover.className = "settings-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Настройки");
    popover.setAttribute("popover", "auto");
    popover.hidden = true;

    const preference = document.createElement("label");
    preference.className = "settings-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "autoExpandOnVisit";
    checkbox.autocomplete = "off";
    checkbox.disabled = true;
    checkboxes.push(checkbox);
    const preferenceText = document.createElement("span");
    preferenceText.textContent = "Раскрывать комментарии при открытии поста";
    preference.append(checkbox, preferenceText);
    popover.append(preference);

    checkbox.addEventListener("change", async () => {
      const enabled = checkbox.checked;
      for (const box of checkboxes) {
        box.checked = enabled;
        box.disabled = true;
      }
      const saved = await actions.saveAutoExpandOnVisit(enabled);
      for (const box of checkboxes) {
        if (!saved) box.checked = !enabled;
        box.disabled = false;
      }
    });

    let popoverEvents: AbortController | undefined;

    function positionPopover() {
      if (!page || popover.hidden) return;
      const anchor = settings.getBoundingClientRect();
      const topInset = Math.max(0, options?.getTopInset?.() ?? 0);
      const width = popover.offsetWidth || 280;
      const height = popover.offsetHeight || 58;
      const margin = 8;
      const left = Math.max(
        margin,
        Math.min(anchor.right - width, page.innerWidth - width - margin),
      );

      let top: number;
      if (isMobile) {
        const minTop = topInset + 6;
        const aboveTop = anchor.top - height - 6;
        const belowTop = anchor.bottom + 6;
        // Reserve floor-ad clearance near bottom edge on mobile.
        const fitsBelow = belowTop + height <= page.innerHeight - 96;
        const fitsAbove = aboveTop >= minTop;
        top =
          placement === "bottom"
            ? fitsAbove
              ? aboveTop
              : Math.min(belowTop, page.innerHeight - height - margin)
            : fitsBelow
              ? belowTop
              : Math.max(minTop, aboveTop);
      } else {
        const menuBottom = placement === "top" ? menu.getBoundingClientRect().bottom : 0;
        const belowTop =
          placement === "top" ? Math.max(anchor.bottom + 6, menuBottom + 4) : anchor.bottom + 6;
        const fitsBelow = belowTop + height <= page.innerHeight - margin;
        top = fitsBelow ? belowTop : Math.max(margin, anchor.top - height - 6);
      }
      popover.style.left = `${Math.round(left)}px`;
      popover.style.top = `${Math.round(top)}px`;
    }

    function syncClosed() {
      popoverEvents?.abort();
      popoverEvents = undefined;
      popover.hidden = true;
      settings.setAttribute("aria-expanded", "false");
    }

    let suppressFocusReturn = false;

    function closePopover(suppressFocus = false) {
      if (popover.hidden) return;
      suppressFocusReturn = suppressFocus;
      if (typeof popover.hidePopover === "function") {
        try {
          popover.hidePopover();
        } catch {
          // Already closed in the top layer.
        }
      }
      syncClosed();
      suppressFocusReturn = false;
    }

    function openPopover() {
      closeOtherPopovers(instance);
      popover.hidden = false;
      if (typeof popover.showPopover === "function") {
        try {
          popover.showPopover();
        } catch {
          // Fallback to fixed positioning when top-layer showPopover is unavailable.
        }
      }
      settings.setAttribute("aria-expanded", "true");
      positionPopover();
      if (page) {
        popoverEvents?.abort();
        popoverEvents = new AbortController();
        const opts = { passive: true, signal: popoverEvents.signal };
        page.addEventListener("scroll", positionPopover, opts);
        page.addEventListener("resize", positionPopover, opts);
        page.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Escape") {
              closePopover(true);
              settings.focus({ preventScroll: true });
            }
          },
          { signal: popoverEvents.signal },
        );
      }
    }

    popover.addEventListener("toggle", (event) => {
      const toggleEvent = event as ToggleEvent;
      if (toggleEvent.newState === "closed") {
        const shouldReturnFocus = !suppressFocusReturn;
        syncClosed();
        if (shouldReturnFocus) {
          settings.focus({ preventScroll: true });
        }
      }
    });

    settings.addEventListener("click", () => {
      if (popover.hidden) {
        openPopover();
      } else {
        closePopover(true);
      }
    });

    function createScrollToBottomButton(): HTMLButtonElement {
      const scrollButton = document.createElement("button");
      scrollButton.type = "button";
      scrollButton.className = "icon-button";
      scrollButton.dataset["role"] = "scroll-to-bottom";
      scrollButton.title = "Перейти к концу комментариев";
      scrollButton.setAttribute("aria-label", "Перейти к концу комментариев");
      scrollButton.append(createScrollBottomIcon(isMobile));
      scrollButton.addEventListener("click", () => actions.scrollToBottom?.());
      return scrollButton;
    }

    const status = document.createElement("span");
    let inlineError: HTMLSpanElement | undefined;
    let completedText: HTMLSpanElement | undefined;

    if (isMobile) {
      status.className = "sr-only";
      if (placement === "top") {
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.setAttribute("aria-atomic", "true");
      } else {
        status.dataset["role"] = "status";
      }

      inlineError = document.createElement("span");
      inlineError.className = "inline-error";
      inlineError.textContent = "Ошибка";
      inlineError.setAttribute("aria-hidden", "true");
      inlineError.hidden = true;

      completedText = document.createElement("span");
      completedText.className = "completed-text";
      completedText.hidden = true;

      const shell = document.createElement("div");
      shell.className = "bar-shell";
      const bar = document.createElement("div");
      bar.className = "bar";
      const leftGroup = document.createElement("div");
      leftGroup.className = "left-group";
      leftGroup.append(button, completedText, inlineError, counter);
      if (placement === "top") {
        leftGroup.append(status);
      }

      const rightGroup = document.createElement("div");
      rightGroup.className = "right-group";
      if (placement === "top" && actions.scrollToBottom) {
        rightGroup.append(createScrollToBottomButton());
      }
      rightGroup.append(settings);

      bar.append(leftGroup, rightGroup);
      shell.append(bar);
      shadow.append(shell, popover);
    } else {
      status.className = "status-text";
      if (placement === "top") {
        status.setAttribute("role", "status");
      } else {
        status.dataset["role"] = "status";
      }

      if (placement === "top") {
        const bar = document.createElement("div");
        bar.className = "bar";
        const elements: HTMLElement[] = [status, counter, button];
        if (actions.scrollToBottom) {
          elements.push(createScrollToBottomButton());
        }
        elements.push(settings);
        bar.append(...elements);
        shadow.append(bar, popover);
      } else {
        const shell = document.createElement("div");
        shell.className = "bar-shell";
        const bar = document.createElement("div");
        bar.className = "bar";
        const primaryGroup = document.createElement("div");
        primaryGroup.className = "group";
        primaryGroup.append(button, status);
        const metaGroup = document.createElement("div");
        metaGroup.className = "group";
        metaGroup.append(counter, settings);
        bar.append(primaryGroup, metaGroup);
        shell.append(bar);
        shadow.append(shell, popover);
      }
    }

    const instance: ControlInstance = {
      host,
      shadow,
      button,
      buttonLabel,
      buttonStopIcon,
      counter,
      settings,
      popover,
      checkbox,
      status,
      inlineError,
      completedText,
      closePopover,
    };
    return instance;
  }

  const top = createInstance("top");
  instances.push(top);

  let floatingContainer: HTMLElement;
  let floatingStopButton: HTMLButtonElement;
  let ribbonCounter: HTMLSpanElement | undefined;

  if (isMobile) {
    const ribbon = document.createElement("div");
    ribbon.className = "floating-ribbon";
    ribbon.dataset["role"] = "floating-ribbon";
    ribbon.setAttribute("role", "region");
    ribbon.setAttribute("aria-label", "Ход раскрытия комментариев");
    ribbon.hidden = true;

    const meta = document.createElement("div");
    meta.className = "ribbon-meta";
    const ribbonLabel = document.createElement("span");
    ribbonLabel.className = "ribbon-label";
    ribbonLabel.textContent = "Раскрываем…";
    ribbonCounter = document.createElement("span");
    ribbonCounter.className = "counter";
    ribbonCounter.dataset["role"] = "ribbon-counter";
    ribbonCounter.setAttribute("role", "group");
    meta.append(ribbonLabel, ribbonCounter);

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "action-button floating-stop";
    const stopLabel = document.createElement("span");
    stopLabel.textContent = actionLabels.running;
    stopBtn.append(createStopSquareIcon(), stopLabel);
    stopBtn.addEventListener("click", actions.stop);

    ribbon.append(meta, stopBtn);
    top.shadow.append(ribbon);
    floatingContainer = ribbon;
    floatingStopButton = stopBtn;
  } else {
    const floatingStop = document.createElement("button");
    floatingStop.type = "button";
    floatingStop.className = "floating-stop";
    const floatingStopLabel = document.createElement("span");
    floatingStopLabel.textContent = actionLabels.running;
    floatingStop.append(createStopSquareIcon(), floatingStopLabel);
    floatingStop.hidden = true;
    floatingStop.addEventListener("click", actions.stop);
    top.shadow.append(floatingStop);
    floatingContainer = floatingStop;
    floatingStopButton = floatingStop;
  }

  if (options?.mountTopHost) {
    options.mountTopHost(top.host);
  } else if (isMobile) {
    menu.after(top.host);
  } else {
    menu.append(top.host);
  }

  const bottom = mountBottomHost ? createInstance("bottom") : undefined;
  if (bottom) {
    instances.push(bottom);
    mountBottomHost?.(bottom.host);
  }

  void savedPreference.then((enabled) => {
    for (const box of checkboxes) {
      box.checked = enabled;
      box.disabled = false;
    }
  });

  signal?.addEventListener(
    "abort",
    () => {
      viewportEvents?.abort();
      for (const instance of instances) instance.closePopover(true);
      top.host.remove();
      bottom?.host.remove();
    },
    { once: true },
  );

  function currentTopInset() {
    return Math.max(0, options?.getTopInset?.() ?? 0);
  }

  function isBottomVisibleInViewport(topInset: number) {
    if (!bottom || bottom.host.hidden || !bottom.host.isConnected) return false;
    const { top: rectTop, bottom: rectBottom } = bottom.host.getBoundingClientRect();
    if (rectTop >= rectBottom) return false;
    const viewportHeight = page?.innerHeight ?? Number.POSITIVE_INFINITY;
    return rectBottom > topInset && rectTop < viewportHeight;
  }

  function updateShortcut() {
    const topInset = currentTopInset();
    if (isMobile) {
      floatingContainer.style.top = `${topInset}px`;
      floatingContainer.dataset["flushTop"] = String(topInset === 0);
    }
    const { top: rectTop, bottom: rectBottom } = top.host.getBoundingClientRect();
    const topOffscreen = rectTop < rectBottom && rectBottom <= topInset;
    const show = running && topOffscreen && !isBottomVisibleInViewport(topInset);
    if (show === !floatingContainer.hidden) return;
    const returnFocus = !show && top.shadow.activeElement === floatingStopButton;
    floatingContainer.hidden = !show;
    if (returnFocus) (top.button.hidden ? top.settings : top.button).focus({ preventScroll: true });
  }

  return (snapshot: ExpansionSnapshot) => {
    const nextRunning = snapshot.state === "running";
    if (running !== nextRunning) {
      running = nextRunning;
      if (running && page) {
        viewportEvents = new AbortController();
        const opts = { passive: true, signal: viewportEvents.signal };
        page.addEventListener("scroll", updateShortcut, opts);
        page.addEventListener("resize", updateShortcut, opts);
      } else {
        viewportEvents?.abort();
      }
    }

    const label = actionLabels[snapshot.state];
    const text = statusText(snapshot);
    const counterDisplay = formatCounter(
      snapshot.loadedCommentsCount,
      snapshot.totalCommentsCount,
      isMobile,
    );

    if (bottom && bottom.host.hidden !== snapshot.initiallyEmpty) {
      bottom.host.hidden = snapshot.initiallyEmpty;
    }

    for (const instance of instances) {
      instance.host.dataset["state"] = snapshot.state;
      instance.button.hidden = snapshot.state === "completed";
      if (isMobile) {
        if (instance.buttonLabel.textContent !== label) instance.buttonLabel.textContent = label;
        if (instance.buttonStopIcon) {
          instance.buttonStopIcon.style.display = nextRunning ? "" : "none";
        }
        if (instance.inlineError) {
          instance.inlineError.hidden = snapshot.state !== "error";
        }
        if (instance.completedText) {
          instance.completedText.hidden = snapshot.state !== "completed";
          if (instance.completedText.textContent !== text) {
            instance.completedText.textContent = text;
            instance.completedText.title = text;
          }
        }
        if (instance === top) {
          const desiredRole = snapshot.state === "error" ? "alert" : "status";
          const desiredLive = snapshot.state === "error" ? "assertive" : "polite";
          if (instance.status.getAttribute("role") !== desiredRole) {
            instance.status.setAttribute("role", desiredRole);
          }
          if (instance.status.getAttribute("aria-live") !== desiredLive) {
            instance.status.setAttribute("aria-live", desiredLive);
          }
        }
      } else if (instance.button.textContent !== label) {
        instance.button.textContent = label;
      }

      if (instance.counter.textContent !== counterDisplay.text) {
        instance.counter.textContent = counterDisplay.text;
        instance.counter.title = counterDisplay.description;
        instance.counter.setAttribute("aria-label", counterDisplay.description);
      }
      if (instance.status.textContent !== text) {
        instance.status.textContent = text;
        if (!isMobile) instance.status.title = text;
      }
    }

    if (ribbonCounter && ribbonCounter.textContent !== counterDisplay.text) {
      ribbonCounter.textContent = counterDisplay.text;
      ribbonCounter.title = counterDisplay.description;
      ribbonCounter.setAttribute("aria-label", counterDisplay.description);
    }

    updateShortcut();
  };
}

function formatCounter(
  loadedCommentsCount: number,
  totalCommentsCount?: number,
  nonBreaking = false,
) {
  if (totalCommentsCount === undefined) {
    return {
      text: `${loadedCommentsCount}`,
      description: `Открыто комментариев: ${loadedCommentsCount}`,
    };
  }
  const displayTotal = Math.max(totalCommentsCount, loadedCommentsCount);
  const sep = nonBreaking ? "\u00a0/\u00a0" : " / ";
  return {
    text: `${loadedCommentsCount}${sep}${displayTotal}`,
    description: `Открыто комментариев: ${loadedCommentsCount} из ${displayTotal}`,
  };
}

function statusText(snapshot: ExpansionSnapshot) {
  switch (snapshot.state) {
    case "idle":
      return "";
    case "running":
      return "Раскрываем комментарии…";
    case "stopped":
      return "Раскрытие остановлено.";
    case "error":
      return "Ошибка загрузки комментариев.";
    case "completed":
      if (snapshot.initiallyEmpty) return "Все комментарии уже раскрыты.";
      if (snapshot.skippedCount === 1) return "Одну ветку не удалось раскрыть.";
      if (snapshot.skippedCount > 0) {
        const count = snapshot.skippedCount;
        const category = branchPlural.select(count);
        const noun = category === "one" ? "ветку" : category === "few" ? "ветки" : "веток";
        return `Не удалось раскрыть ${count} ${noun}.`;
      }
      return "Все комментарии раскрыты.";
  }
}
