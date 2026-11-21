import type { ExpansionSnapshot } from "../core/expansion-run.ts";

const actionLabels = {
  idle: "Раскрыть все комментарии",
  running: "Остановить",
  stopped: "Продолжить",
  error: "Повторить",
  completed: "",
};

export function mountExpansionControl(
  menu: HTMLElement,
  actions: {
    start: () => void;
    stop: () => void;
    saveAutoExpandOnVisit: (enabled: boolean) => Promise<boolean>;
  },
  savedPreference: Promise<boolean>,
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
      margin-inline: 0.75rem;
      font: inherit;
      color: var(--color-text, inherit);
    }
    button {
      padding: 0.25em 0.6em;
      border: 1px solid currentColor;
      border-radius: 0.25em;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
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
  preference.append(checkbox, " Раскрывать комментарии при открытии поста");
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

  shadow.append(button, settings, preference, status);
  menu.append(host);

  return (snapshot: ExpansionSnapshot) => {
    button.hidden = snapshot.state === "completed";
    onAction = snapshot.state === "running" ? actions.stop : actions.start;
    const label = actionLabels[snapshot.state];
    if (button.textContent !== label) button.textContent = label;
    const text = statusText(snapshot);
    if (status.textContent !== text) status.textContent = text;
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
        return `Не раскрыто веток: ${snapshot.skippedCount}.`;
      }
      return "Все комментарии раскрыты.";
  }
}
