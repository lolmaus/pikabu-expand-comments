import {
  findScrollToBottomTarget,
  measureStickyTopInset,
  mountBottomHost,
  mountTopHost,
  observeCommentView,
} from "../../adapters/pikabu/comment-view.ts";
import { createPostPageAdapter } from "../../adapters/pikabu/post-page.ts";
import { createExpansionRun, type ExpansionSnapshot } from "../../core/expansion-run.ts";
import { createSettings, type StoragePort } from "../../core/settings.ts";
import { mountExpansionControl } from "../../ui/expansion-control.ts";

export interface PostPageRuntimeState {
  hasCommentView: boolean;
  snapshot: ExpansionSnapshot | null;
}

export interface PostPageController {
  getState(): PostPageRuntimeState;
  start(): boolean;
  stop(): boolean;
  dispose(): void;
}

export interface WatchPostPageOptions {
  storage: StoragePort;
  onSnapshot?: (state: PostPageRuntimeState) => void;
}

export function isPikabuPostPageWindow(page: Window | null): page is Window {
  return Boolean(
    page &&
    page.top === page &&
    page.location.origin === "https://pikabu.ru" &&
    /^\/story\/[^/]+/.test(page.location.pathname),
  );
}

export function watchPostPage(page: Window, options: WatchPostPageOptions): PostPageController {
  const settings = createSettings(options.storage);
  let pendingSave: Promise<boolean> = Promise.resolve(true);
  let activeView: AbortController | undefined;
  let activeStart: ((source?: "top" | "bottom") => void) | undefined;
  let activeStop: (() => void) | undefined;
  let currentState: PostPageRuntimeState = { hasCommentView: false, snapshot: null };

  function emitState(nextState: PostPageRuntimeState) {
    currentState = nextState;
    options.onSnapshot?.(currentState);
  }

  const stopObserving = observeCommentView(page, (view) => {
    activeView?.abort();
    activeView = undefined;
    activeStart = undefined;
    activeStop = undefined;
    if (!view) {
      emitState({ hasCommentView: false, snapshot: null });
      return;
    }

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
        subscribeAutoExpandOnVisit: (onChange) => settings.subscribeAutoExpandOnVisit(onChange),
      },
    );
    const run = createExpansionRun(
      postPage,
      (milliseconds) => pause(milliseconds, signal),
      (snapshot) => {
        isRunning = snapshot.state === "running";
        postPage.setRunning(isRunning);
        render(snapshot);
        emitState({ hasCommentView: true, snapshot });
      },
      (error) => {
        const details =
          error instanceof Error ? { message: error.message, state: error.cause } : {};
        console.warn(`[Pikabu Expand Comments] ${JSON.stringify(details)}`);
      },
    );

    activeStart = start;
    activeStop = () => run.stop();

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
        startWhenReady(page.document, view.container, start, startup.signal);
      }
    });
  });

  return {
    getState: () => currentState,
    start() {
      if (!activeStart) return false;
      activeStart();
      return true;
    },
    stop() {
      if (!activeStop) return false;
      activeStop();
      return true;
    },
    dispose() {
      stopObserving();
      activeView?.abort();
      activeView = undefined;
      activeStart = undefined;
      activeStop = undefined;
    },
  };
}

export function bootPostPage(page: Window | null, onReady: (pageWindow: Window) => void): void {
  if (!isPikabuPostPageWindow(page)) return;
  if (page.document.readyState === "loading") {
    page.document.addEventListener("DOMContentLoaded", () => onReady(page), { once: true });
  } else {
    onReady(page);
  }
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

function startWhenReady(
  doc: Document,
  container: HTMLElement,
  start: () => void,
  signal: AbortSignal,
) {
  function check() {
    if (
      doc.readyState === "complete" &&
      doc.visibilityState === "visible" &&
      container.isConnected
    ) {
      start();
    }
  }

  doc.addEventListener("readystatechange", check, { signal });
  doc.addEventListener("visibilitychange", check, { signal });
  check();
}
