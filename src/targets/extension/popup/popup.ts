import { getWebExtApi } from "../webext-api.ts";
import { mountExtensionPopup, type PopupElements } from "./popup-controller.ts";

function queryElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing popup element #${id}`);
  return el as T;
}

const elements: PopupElements = {
  version: queryElement("popup-version"),
  activeCard: queryElement("active-card"),
  offsiteCard: queryElement("offsite-card"),
  status: queryElement("popup-status"),
  counter: queryElement("popup-counter"),
  actionButton: queryElement<HTMLButtonElement>("popup-action-btn"),
  actionLabel: queryElement("popup-action-label"),
  stopSquare: queryElement("popup-stop-square"),
  offsiteHint: queryElement("popup-offsite-hint"),
  openPikabuLink: queryElement<HTMLAnchorElement>("popup-open-pikabu"),
  autoExpandTitle: queryElement("popup-auto-title"),
  autoExpandDesc: queryElement("popup-auto-desc"),
  autoExpandSwitch: queryElement<HTMLInputElement>("auto-expand-switch"),
};

const api = getWebExtApi();
if (api) {
  const controller = mountExtensionPopup(elements, api, document);
  window.addEventListener("unload", () => controller.dispose(), { once: true });
}
