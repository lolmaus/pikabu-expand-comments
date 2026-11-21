import { createPostPageAdapter } from "../../adapters/pikabu/post-page.ts";
import { createExpansionRun } from "../../core/expansion-run.ts";
import { createSettings } from "../../core/settings.ts";
import { mountExpansionControl } from "../../ui/expansion-control.ts";
import { createUserscriptStorage } from "./storage.ts";

declare const GM: Parameters<typeof createUserscriptStorage>[0];

const commentsContainer = ".comments__container";

function mount(): boolean {
  const menu = document.querySelector<HTMLElement>(".story-comments__menu");
  const container = document.querySelector<HTMLElement>(commentsContainer);
  if (!menu || !container) return false;

  const startup = new AbortController();
  const settings = createSettings(
    createUserscriptStorage({
      getValue: (key) => GM.getValue(key),
      setValue: (key, value) => GM.setValue(key, value),
    }),
  );
  const savedPreference = settings.getAutoExpandOnVisit().catch((error: unknown) => {
    console.warn("[Pikabu Expand Comments] Could not read Auto-Expand on Visit.", error);
    return false;
  });
  const render = mountExpansionControl(
    menu,
    {
      start,
      stop: () => run.stop(),
      async saveAutoExpandOnVisit(enabled) {
        try {
          await settings.setAutoExpandOnVisit(enabled);
          return true;
        } catch (error) {
          console.warn("[Pikabu Expand Comments] Could not save Auto-Expand on Visit.", error);
          return false;
        }
      },
    },
    savedPreference,
  );
  const run = createExpansionRun(
    createPostPageAdapter(container),
    (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    render,
    (error) => {
      const details = error instanceof Error ? { message: error.message, state: error.cause } : {};
      console.warn(`[Pikabu Expand Comments] ${JSON.stringify(details)}`);
    },
  );

  function start() {
    // A manual start consumes the automatic start for this visit too.
    startup.abort();
    void run.start();
  }

  void savedPreference.then((enabled) => {
    if (enabled && !startup.signal.aborted) startWhenReady(start, startup.signal);
  });
  return true;
}

function observePostPage(check: () => void) {
  const observer = new MutationObserver(check);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  return observer;
}

function startWhenReady(start: () => void, signal: AbortSignal) {
  function check() {
    if (
      document.readyState === "complete" &&
      document.visibilityState === "visible" &&
      document.querySelector(commentsContainer)
    ) {
      start();
    }
  }

  const observer = observePostPage(check);
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  document.addEventListener("readystatechange", check, { signal });
  document.addEventListener("visibilitychange", check, { signal });
  check();
}

function mountWhenAvailable() {
  if (mount()) return;
  const observer = observePostPage(() => {
    if (mount()) observer.disconnect();
  });
}

// Userscript managers can wrap the global window independently of window.top.
const pageWindow = document.defaultView;
if (
  pageWindow?.top === pageWindow &&
  location.origin === "https://pikabu.ru" &&
  /^\/story\/[^/]+/.test(location.pathname)
) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWhenAvailable, { once: true });
  } else {
    mountWhenAvailable();
  }
}
