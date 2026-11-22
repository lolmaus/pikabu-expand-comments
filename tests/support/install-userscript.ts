import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

const userscript = readFileSync(
  new URL("../../dist/userscript/pikabu-expand-comments.user.js", import.meta.url),
  "utf8",
);

export function installUserscript(page: Page) {
  return page.addInitScript({
    content: `globalThis.GM = {
      getValue: async (key) => JSON.parse(localStorage.getItem(key)),
      setValue: async (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    };
    // Simulate a userscript manager that wraps window but leaves window.top unwrapped.
    ((window) => {
      ${userscript}
    })(new Proxy(window, {}));`,
  });
}
