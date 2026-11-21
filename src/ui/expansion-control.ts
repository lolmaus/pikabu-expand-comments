import type { ExpansionSnapshot } from "../core/expansion-run.ts";

export function mountExpansionControl(menu: HTMLElement, start: () => void) {
  const document = menu.ownerDocument;
  const host = document.createElement("span");
  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`
    :host {
      display: inline-flex;
      align-items: center;
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
  button.textContent = "Раскрыть все комментарии";
  button.addEventListener("click", start);

  const status = document.createElement("span");
  status.setAttribute("role", "status");

  shadow.append(button, status);
  menu.append(host);

  return (snapshot: ExpansionSnapshot) => {
    button.hidden = snapshot.state !== "idle";
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
    case "error":
      return "Не удалось загрузить часть комментариев.";
    case "completed":
      return snapshot.initiallyEmpty
        ? "Все комментарии уже раскрыты."
        : "Все комментарии раскрыты.";
  }
}
