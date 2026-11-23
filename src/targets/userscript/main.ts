import {
  findScrollToBottomTarget,
  measureStickyTopInset,
  mountBottomHost,
  mountTopHost,
  observeCommentView,
} from "../../adapters/pikabu/comment-view.ts";
import { createPostPageAdapter } from "../../adapters/pikabu/post-page.ts";
import { createExpansionRun } from "../../core/expansion-run.ts";
import { createSettings } from "../../core/settings.ts";
import { mountExpansionControl } from "../../ui/expansion-control.ts";
import { createUserscriptStorage } from "./storage.ts";

declare const GM: Parameters<typeof createUserscriptStorage>[0];

function watchPostPage(page: Window) {
  const settings = createSettings(
    createUserscriptStorage({
      getValue: (key) => GM.getValue(key),
      setValue: (key, value) => GM.setValue(key, value),
    }),
  );
  let pendingSave: Promise<boolean> = Promise.resolve(true);
  let activeView: AbortController | undefined;

  observeCommentView(page, (view) => {
    activeView?.abort();
    activeView = undefined;
    if (!view) return;

    activeView = new AbortController();
    const { signal } = activeView;
    const startup = new AbortController();
    const savedPreference = pendingSave
      .then(() => settings.getAutoExpandOnVisit())
      .catch((error: unknown) => {
        console.warn("[Pikabu Expand Comments] Could not read Auto-Expand on Visit.", error);
        return false;
      });
    let bottomHost: HTMLElement | undefined;
    let isRunning = false;
    const postPage = createPostPageAdapter(view.container, view.tabKind);
    const render = mountExpansionControl(
      view.menu,
      {
        start,
        stop: () => run.stop(),
        scrollToBottom() {
          const target = findScrollToBottomTarget(page.document, page, view, bottomHost);
          if (!target) return;
          if (isRunning) postPage.yieldScrollPreservation();
          const reducedMotion = Boolean(
            page.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
          );
          target.element.scrollIntoView({
            block: target.block,
            behavior: isRunning || reducedMotion ? "instant" : "smooth",
          });
        },
        saveAutoExpandOnVisit(enabled) {
          pendingSave = pendingSave
            .then(() => settings.setAutoExpandOnVisit(enabled))
            .then(
              () => true,
              (error: unknown) => {
                console.warn(
                  "[Pikabu Expand Comments] Could not save Auto-Expand on Visit.",
                  error,
                );
                return false;
              },
            );
          return pendingSave;
        },
      },
      savedPreference,
      signal,
      (host) => {
        bottomHost = host;
        mountBottomHost(view, host);
      },
      {
        layout: view.layout,
        mountTopHost: (host) => mountTopHost(view, host),
        getTopInset: () => measureStickyTopInset(page.document, page),
      },
    );
    const run = createExpansionRun(
      postPage,
      (milliseconds) => pause(milliseconds, signal),
      (snapshot) => {
        isRunning = snapshot.state === "running";
        postPage.setRunning(isRunning);
        render(snapshot);
      },
      (error) => {
        const details =
          error instanceof Error ? { message: error.message, state: error.cause } : {};
        console.warn(`[Pikabu Expand Comments] ${JSON.stringify(details)}`);
      },
    );
    signal.addEventListener(
      "abort",
      () => {
        startup.abort();
        run.dispose();
        postPage.setRunning(false);
      },
      { once: true },
    );

    function start(source?: "top" | "bottom") {
      // A manual start consumes the automatic start for this comment view too.
      startup.abort();
      if (source === "bottom" && bottomHost) {
        postPage.lockScrollTarget(bottomHost);
      } else {
        postPage.clearScrollTargetLock();
      }
      void run.start();
    }

    void savedPreference.then((enabled) => {
      if (enabled && !startup.signal.aborted) {
        startWhenReady(view.container, start, startup.signal);
      }
    });
  });
}

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

function startWhenReady(container: HTMLElement, start: () => void, signal: AbortSignal) {
  function check() {
    if (
      document.readyState === "complete" &&
      document.visibilityState === "visible" &&
      container.isConnected
    ) {
      start();
    }
  }

  document.addEventListener("readystatechange", check, { signal });
  document.addEventListener("visibilitychange", check, { signal });
  check();
}

// Userscript managers can wrap the global window independently of window.top.
const pageWindow = document.defaultView;
if (
  pageWindow &&
  pageWindow.top === pageWindow &&
  location.origin === "https://pikabu.ru" &&
  /^\/story\/[^/]+/.test(location.pathname)
) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => watchPostPage(pageWindow), { once: true });
  } else {
    watchPostPage(pageWindow);
  }
}
