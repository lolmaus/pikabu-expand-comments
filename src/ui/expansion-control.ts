import type { ExpansionSnapshot } from "../core/expansion-run.ts";

const actionLabels = {
  idle: "Раскрыть все комментарии",
  running: "Остановить",
  stopped: "Продолжить",
  error: "Повторить",
  completed: "",
};
const branchPlural = new Intl.PluralRules("ru-RU");

export function mountExpansionControl(
  menu: HTMLElement,
  actions: {
    start: () => void;
    stop: () => void;
    saveAutoExpandOnVisit: (enabled: boolean) => Promise<boolean>;
  },
  savedPreference: Promise<boolean>,
  signal?: AbortSignal,
) {
  const document = menu.ownerDocument;
  const host = document.createElement("span");
  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`
    :host {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      min-inline-size: 0;
      max-inline-size: calc(100% - 0.5rem);
      margin-inline-start: 0.5rem;
      font: inherit;
      white-space: normal;
      overflow-wrap: anywhere;
      color: var(--color-black-940, #1b1e24);
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
    [role="status"] {
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
    [role="status"]:empty {
      position: absolute;
    }
    [hidden] {
      display: none;
    }
  `);
  shadow.adoptedStyleSheets = [stylesheet];

  const button = document.createElement("button");
  button.type = "button";
  let onAction = actions.start;
  button.addEventListener("click", () => onAction());

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
  const preferenceText = document.createElement("span");
  preferenceText.textContent = "Раскрывать комментарии при открытии поста";
  preference.append(checkbox, preferenceText);
  void savedPreference.then((enabled) => {
    checkbox.checked = enabled;
    checkbox.disabled = false;
  });
  checkbox.addEventListener("change", async () => {
    const enabled = checkbox.checked;
    checkbox.disabled = true;
    if (!(await actions.saveAutoExpandOnVisit(enabled))) checkbox.checked = !enabled;
    checkbox.disabled = false;
  });

  settings.addEventListener("click", () => {
    preference.hidden = !preference.hidden;
    settings.setAttribute("aria-expanded", String(!preference.hidden));
  });

  const status = document.createElement("span");
  status.setAttribute("role", "status");

  const floatingStop = document.createElement("button");
  floatingStop.type = "button";
  floatingStop.className = "floating-stop";
  floatingStop.textContent = actionLabels.running;
  floatingStop.hidden = true;
  floatingStop.addEventListener("click", actions.stop);

  shadow.append(button, settings, preference, status, floatingStop);
  menu.append(host);

  let running = false;
  let viewportEvents: AbortController | undefined;
  const page = document.defaultView;
  signal?.addEventListener(
    "abort",
    () => {
      viewportEvents?.abort();
      host.remove();
    },
    { once: true },
  );

  function updateShortcut() {
    const { top, bottom } = host.getBoundingClientRect();
    const show = running && top < bottom && bottom <= 0;
    if (show === !floatingStop.hidden) return;
    const returnFocus = !show && shadow.activeElement === floatingStop;
    floatingStop.hidden = !show;
    if (returnFocus) (button.hidden ? settings : button).focus({ preventScroll: true });
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
    button.hidden = snapshot.state === "completed";
    onAction = running ? actions.stop : actions.start;
    const label = actionLabels[snapshot.state];
    if (button.textContent !== label) button.textContent = label;
    const text = statusText(snapshot);
    if (status.textContent !== text) status.textContent = text;
    updateShortcut();
  };
}

function statusText(snapshot: ExpansionSnapshot) {
  switch (snapshot.state) {
    case "idle":
      return "";
    case "running":
      return `Раскрываем комментарии… Сейчас видно ${snapshot.loadedCommentsCount}.`;
    case "stopped":
      return `Раскрытие остановлено. Сейчас видно ${snapshot.loadedCommentsCount}.`;
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
