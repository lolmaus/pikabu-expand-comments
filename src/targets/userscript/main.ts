import { createPostPageAdapter } from "../../adapters/pikabu/post-page.ts";
import { createExpansionRun } from "../../core/expansion-run.ts";
import { mountExpansionControl } from "../../ui/expansion-control.ts";

function mount() {
  const menu = document.querySelector<HTMLElement>(".story-comments__menu");
  const container = document.querySelector<HTMLElement>(".comments__container");
  if (!menu || !container) return;

  const render = mountExpansionControl(menu, {
    start: () => void run.start(),
    stop: () => run.stop(),
  });
  const run = createExpansionRun(
    createPostPageAdapter(container),
    (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    render,
    (error) => {
      const details = error instanceof Error ? { message: error.message, state: error.cause } : {};
      console.warn(`[Pikabu Expand Comments] ${JSON.stringify(details)}`);
    },
  );
}

// Userscript managers can wrap the global window independently of window.top.
const pageWindow = document.defaultView;
if (
  pageWindow?.top === pageWindow &&
  location.origin === "https://pikabu.ru" &&
  /^\/story\/[^/]+/.test(location.pathname)
) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}
