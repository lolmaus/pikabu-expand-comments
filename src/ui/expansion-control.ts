import type { ExpansionSnapshot } from "../core/expansion-run.ts";

const actionLabels = {
  idle: "Раскрыть все комментарии",
  running: "Остановить",
  stopped: "Продолжить",
  error: "Повторить",
  completed: "",
};
const branchPlural = new Intl.PluralRules("ru-RU");

interface ControlInstance {
  host: HTMLElement;
  shadow: ShadowRoot;
  button: HTMLButtonElement;
  counter: HTMLSpanElement;
  settings: HTMLButtonElement;
  checkbox: HTMLInputElement;
  status: HTMLSpanElement;
}

function createControlStylesheet(placement: "top" | "bottom") {
  const stylesheet = new CSSStyleSheet();
  const hostLayout =
    placement === "top"
      ? `
      display: inline-flex;
      max-inline-size: calc(100% - 0.5rem);
      margin-inline-start: 0.5rem;
    `
      : `
      display: flex;
      margin-block-start: 0.75rem;
    `;
  stylesheet.replaceSync(`
    :host {
      ${hostLayout}
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      min-inline-size: 0;
      font: inherit;
      white-space: normal;
      overflow-wrap: anywhere;
      overflow-anchor: none;
      color: var(--color-black-940, #1b1e24);
    }
    :host([hidden]) {
      display: none;
    }
    button {
      box-sizing: border-box;
      min-inline-size: 0;
      max-inline-size: 100%;
      padding: 0.375em 0.65em;
      border: 1px solid var(--color-black-400, #e9e9e9);
      border-radius: 0.375em;
      background: var(--color-black-300, #f7f8fc);
      color: inherit;
      cursor: pointer;
      font: inherit;
      white-space: normal;
    }
    button:focus-visible {
      outline: 2px solid var(--color-primary-900, #65ab3c);
      outline-offset: 2px;
    }
    label {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      cursor: pointer;
    }
    input {
      accent-color: var(--color-primary-900, #65ab3c);
    }
    .counter {
      font-variant-numeric: tabular-nums;
      color: var(--color-black-800, #444850);
    }
    [role="status"],
    .status {
      color: var(--color-black-800, #444850);
    }
    .floating-stop {
      position: fixed;
      z-index: 1000;
      inset-inline-end: max(0.75rem, env(safe-area-inset-right));
      inset-block-end: max(0.75rem, env(safe-area-inset-bottom));
      max-inline-size: calc(100vw - 1.5rem);
      box-shadow: 0 2px 8px var(--color-black-alpha-16, rgb(0 0 0 / 0.16));
    }
    @media (pointer: coarse), (max-width: 480px) {
      button, label {
        min-block-size: 44px;
      }
    }
    [role="status"]:empty,
    .status:empty {
      position: absolute;
    }
    [hidden] {
      display: none;
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
) {
  const document = menu.ownerDocument;
  const page = document.defaultView;
  let running = false;
  let viewportEvents: AbortController | undefined;
  const checkboxes: HTMLInputElement[] = [];

  function createInstance(placement: "top" | "bottom"): ControlInstance {
    const host = document.createElement(placement === "top" ? "span" : "div");
    host.dataset["pikabuExpandComments"] = placement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = [createControlStylesheet(placement)];

    const button = document.createElement("button");
    button.type = "button";
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

    const settings = document.createElement("button");
    settings.type = "button";
    settings.textContent = "Настройки";
    settings.setAttribute("aria-expanded", "false");
    settings.setAttribute("aria-controls", "expansion-settings");

    const preference = document.createElement("label");
    preference.id = "expansion-settings";
    preference.hidden = true;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkboxes.push(checkbox);
    const preferenceText = document.createElement("span");
    preferenceText.textContent = "Раскрывать комментарии при открытии поста";
    preference.append(checkbox, preferenceText);

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

    settings.addEventListener("click", () => {
      preference.hidden = !preference.hidden;
      settings.setAttribute("aria-expanded", String(!preference.hidden));
    });

    const status = document.createElement("span");
    if (placement === "top") {
      status.setAttribute("role", "status");
    } else {
      status.className = "status";
      status.dataset["role"] = "status";
    }

    const elements: HTMLElement[] = [button, counter];
    if (placement === "top" && actions.scrollToBottom) {
      const scrollButton = document.createElement("button");
      scrollButton.type = "button";
      scrollButton.dataset["role"] = "scroll-to-bottom";
      scrollButton.textContent = "Вниз ↓";
      scrollButton.title = "Перейти к концу комментариев";
      scrollButton.setAttribute("aria-label", "Перейти к концу комментариев");
      scrollButton.addEventListener("click", () => actions.scrollToBottom?.());
      elements.push(scrollButton);
    }
    elements.push(settings, preference, status);
    shadow.append(...elements);

    return { host, shadow, button, counter, settings, checkbox, status };
  }

  const top = createInstance("top");
  const floatingStop = document.createElement("button");
  floatingStop.type = "button";
  floatingStop.className = "floating-stop";
  floatingStop.textContent = actionLabels.running;
  floatingStop.hidden = true;
  floatingStop.addEventListener("click", actions.stop);
  top.shadow.append(floatingStop);
  menu.append(top.host);

  const bottom = mountBottomHost ? createInstance("bottom") : undefined;
  if (bottom) {
    mountBottomHost?.(bottom.host);
  }
  const instances = bottom ? [top, bottom] : [top];

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
      top.host.remove();
      bottom?.host.remove();
    },
    { once: true },
  );

  function isBottomVisibleInViewport() {
    if (!bottom || bottom.host.hidden || !bottom.host.isConnected) return false;
    const { top: rectTop, bottom: rectBottom } = bottom.host.getBoundingClientRect();
    if (rectTop >= rectBottom) return false;
    const viewportHeight = page?.innerHeight ?? Number.POSITIVE_INFINITY;
    return rectBottom > 0 && rectTop < viewportHeight;
  }

  function updateShortcut() {
    const { top: rectTop, bottom: rectBottom } = top.host.getBoundingClientRect();
    const topOffscreen = rectTop < rectBottom && rectBottom <= 0;
    const show = running && topOffscreen && !isBottomVisibleInViewport();
    if (show === !floatingStop.hidden) return;
    const returnFocus = !show && top.shadow.activeElement === floatingStop;
    floatingStop.hidden = !show;
    if (returnFocus) (top.button.hidden ? top.settings : top.button).focus({ preventScroll: true });
  }

  return (snapshot: ExpansionSnapshot) => {
    const nextRunning = snapshot.state === "running";
    if (running !== nextRunning) {
      running = nextRunning;
      if (running && page) {
        viewportEvents = new AbortController();
        const options = { passive: true, signal: viewportEvents.signal };
        page.addEventListener("scroll", updateShortcut, options);
        page.addEventListener("resize", updateShortcut, options);
      } else {
        viewportEvents?.abort();
      }
    }

    const label = actionLabels[snapshot.state];
    const text = statusText(snapshot);
    const counterDisplay = formatCounter(snapshot.loadedCommentsCount, snapshot.totalCommentsCount);

    if (bottom && bottom.host.hidden !== snapshot.initiallyEmpty) {
      bottom.host.hidden = snapshot.initiallyEmpty;
    }

    for (const instance of instances) {
      instance.button.hidden = snapshot.state === "completed";
      if (instance.button.textContent !== label) instance.button.textContent = label;
      if (instance.counter.textContent !== counterDisplay.text) {
        instance.counter.textContent = counterDisplay.text;
        instance.counter.title = counterDisplay.description;
        instance.counter.setAttribute("aria-label", counterDisplay.description);
      }
      if (instance.status.textContent !== text) instance.status.textContent = text;
    }

    updateShortcut();
  };
}

function formatCounter(loadedCommentsCount: number, totalCommentsCount?: number) {
  if (totalCommentsCount === undefined) {
    return {
      text: `${loadedCommentsCount}`,
      description: `Открыто комментариев: ${loadedCommentsCount}`,
    };
  }
  const displayTotal = Math.max(totalCommentsCount, loadedCommentsCount);
  return {
    text: `${loadedCommentsCount} / ${displayTotal}`,
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
      return "Не удалось загрузить часть комментариев. Можно попробовать ещё раз.";
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
