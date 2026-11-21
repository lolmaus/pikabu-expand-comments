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
  actions: { start: () => void; stop: () => void },
) {
  const document = menu.ownerDocument;
  const host = document.createElement("span");
  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`
    :host {
      display: inline-flex;
      align-items: center;
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

  const status = document.createElement("span");
  status.setAttribute("role", "status");

  shadow.append(button, status);
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
