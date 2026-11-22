interface PostPageSnapshot<Loader> {
  loadedCommentsCount: number;
  loaders: readonly Loader[];
  isHydrating: boolean;
}

type ExpansionResult = "expanded" | "next-batch" | "skipped" | "withdrawn" | { timeout: Error };

export interface PostPageAdapter<Loader extends object> {
  read(): PostPageSnapshot<Loader>;
  identify(loader: Loader): object;
  observeChanges(onChange: () => void): (() => void) | void;
  observeManualCollapses(onCollapse: (loader: Loader) => void): (() => void) | void;
  waitForHydration(signal?: AbortSignal): Promise<void>;
  expand(loader: Loader, signal?: AbortSignal): Promise<ExpansionResult>;
}

type ExpansionState = "idle" | "running" | "stopped" | "completed" | "error";

export interface ExpansionSnapshot {
  state: ExpansionState;
  loadedCommentsCount: number;
  expandedStepsCount: number;
  remainingLoadersCount: number;
  skippedCount: number;
  initiallyEmpty: boolean;
}

const stepPauseMs = 150;
const retryDelaysMs = [1000, 2000, 4000];
const consecutiveFailureLimit = 3;

export function createExpansionRun<Loader extends object>(
  postPage: PostPageAdapter<Loader>,
  pause: (milliseconds: number) => Promise<void>,
  render: (snapshot: ExpansionSnapshot) => void,
  reportFailure?: (error: unknown) => void,
) {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let state: ExpansionState = "idle";
  let expandedStepsCount = 0;
  let skippedCount = 0;
  const handled = new WeakSet<object>();
  const unclickable = new WeakSet<object>();
  const failed = new Set<object>();
  let isWorking = false;
  let consecutiveFailures = 0;
  let activeLoader: object | undefined;
  let retry: { identity: object; attempts: number } | undefined;

  function read() {
    const page = postPage.read();
    const loaders = page.loaders.filter((loader) => {
      const identity = postPage.identify(loader);
      return (
        identity !== activeLoader &&
        !handled.has(identity) &&
        !unclickable.has(identity) &&
        !failed.has(identity)
      );
    });
    return { ...page, loaders };
  }

  function publish() {
    if (signal.aborted) return;
    const page = read();
    const initiallyEmpty = state === "idle" && page.loaders.length === 0 && !page.isHydrating;
    render({
      state: initiallyEmpty ? "completed" : state,
      expandedStepsCount,
      initiallyEmpty,
      loadedCommentsCount: page.loadedCommentsCount,
      remainingLoadersCount: page.loaders.length,
      skippedCount,
    });
  }

  function stop() {
    if (state !== "running") return;
    state = "stopped";
    publish();
  }

  function isRunning() {
    return !signal.aborted && state === "running";
  }

  async function start() {
    if (signal.aborted || isRunning() || state === "completed") return;
    if (state === "idle") {
      const page = read();
      if (page.loaders.length === 0 && !page.isHydrating) return;
    }
    if (state === "error") {
      failed.clear();
      consecutiveFailures = 0;
      retry = undefined;
    }

    state = "running";
    publish();
    // Continue may arrive while the previous click is still hydrating.
    if (isWorking) return;
    isWorking = true;

    try {
      while (isRunning()) {
        if (consecutiveFailures >= consecutiveFailureLimit) {
          state = "error";
          break;
        }
        const pending = retry;
        // Only the loader whose attempt timed out may retry while its placeholders remain.
        if (!pending) await postPage.waitForHydration(signal);
        if (!isRunning()) break;

        const { isHydrating, loaders } = read();
        if (isHydrating && !pending) continue;
        retry = undefined;
        const loader = pending
          ? loaders.find((candidate) => postPage.identify(candidate) === pending.identity)
          : loaders[0];
        // A late response or reader action can remove the loader during backoff.
        if (!loader && pending) continue;
        if (!loader) {
          state = failed.size > 0 ? "error" : "completed";
          break;
        }

        const identity = postPage.identify(loader);
        activeLoader = identity;
        const result = await postPage.expand(loader, signal);
        if (signal.aborted) return;
        activeLoader = undefined;
        if (typeof result === "object") {
          const attempts = (pending?.attempts ?? 0) + 1;
          const delay = retryDelaysMs[attempts - 1];
          if (
            delay !== undefined &&
            read().loaders.some((candidate) => postPage.identify(candidate) === identity)
          ) {
            retry = { identity, attempts };
            await pause(delay);
            continue;
          }
          failed.add(identity);
          consecutiveFailures += 1;
          reportFailure?.(result.timeout);
          if (consecutiveFailures >= consecutiveFailureLimit) continue;
        } else if (result === "skipped") {
          unclickable.add(identity);
          skippedCount += 1;
        } else {
          // Pikabu reuses its batch button after successfully loading a page.
          if (result !== "next-batch") handled.add(identity);
          if (result !== "withdrawn") {
            consecutiveFailures = 0;
            expandedStepsCount += 1;
          }
        }
        publish();
        await pause(stepPauseMs);
      }
    } catch (error) {
      if (!signal.aborted) reportFailure?.(error);
      if (isRunning()) state = "error";
    } finally {
      activeLoader = undefined;
      isWorking = false;
      publish();
    }
  }

  const disconnect = postPage.observeChanges(publish);
  const stopObservingCollapses = postPage.observeManualCollapses((loader) => {
    if (!isRunning()) return;
    handled.add(postPage.identify(loader));
    publish();
  });
  publish();
  return {
    start,
    stop,
    dispose() {
      lifetime.abort();
      disconnect?.();
      stopObservingCollapses?.();
    },
  };
}
