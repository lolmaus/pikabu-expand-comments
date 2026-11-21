interface PostPageSnapshot<Loader> {
  loadedCommentsCount: number;
  loaders: readonly Loader[];
  isHydrating: boolean;
}

export interface PostPageAdapter<Loader extends object> {
  read(): PostPageSnapshot<Loader>;
  identify(loader: Loader): object;
  observeChanges(onChange: () => void): void;
  observeManualCollapses(onCollapse: (loader: Loader) => void): void;
  waitForHydration(): Promise<void>;
  expand(loader: Loader): Promise<"expanded" | "next-batch" | "skipped" | "withdrawn">;
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

export function createExpansionRun<Loader extends object>(
  postPage: PostPageAdapter<Loader>,
  pause: (milliseconds: number) => Promise<void>,
  render: (snapshot: ExpansionSnapshot) => void,
  reportFailure?: (error: unknown) => void,
) {
  let state: ExpansionState = "idle";
  let expandedStepsCount = 0;
  let skippedCount = 0;
  let handled = new WeakSet<object>();
  const unclickable = new WeakSet<object>();
  let isWorking = false;
  let failedStep = false;

  function read() {
    const page = postPage.read();
    const loaders = page.loaders.filter((loader) => {
      const identity = postPage.identify(loader);
      return !handled.has(identity) && !unclickable.has(identity);
    });
    return { ...page, loaders };
  }

  function publish() {
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
    return state === "running";
  }

  async function start() {
    if (isRunning() || state === "completed") return;
    if (state === "idle" || state === "error") {
      const page = read();
      if (state === "idle" && page.loaders.length === 0 && !page.isHydrating) return;
      handled = new WeakSet<object>();
      expandedStepsCount = 0;
      failedStep = false;
    }

    state = "running";
    publish();
    // Continue may arrive while the previous click is still hydrating.
    if (isWorking) return;
    isWorking = true;

    try {
      while (isRunning()) {
        await postPage.waitForHydration();
        if (!isRunning()) break;

        const { isHydrating, loaders } = read();
        if (isHydrating) continue;
        const loader = loaders[0];
        if (!loader) {
          state = failedStep ? "error" : "completed";
          break;
        }

        const identity = postPage.identify(loader);
        handled.add(identity);
        const result = await postPage.expand(loader).catch((error: unknown) => {
          reportFailure?.(error);
          failedStep = true;
          return "failed";
        });
        if (result === "failed") {
          if (isRunning()) state = "error";
          break;
        }
        if (result === "skipped") {
          unclickable.add(identity);
          skippedCount += 1;
        } else if (result !== "withdrawn") {
          // Pikabu reuses its batch button after successfully loading a page.
          if (result === "next-batch") handled.delete(identity);
          expandedStepsCount += 1;
        }
        publish();
        await pause(stepPauseMs);
      }
    } catch (error) {
      reportFailure?.(error);
      if (isRunning()) state = "error";
    } finally {
      isWorking = false;
      publish();
    }
  }

  postPage.observeChanges(publish);
  postPage.observeManualCollapses((loader) => {
    if (!isRunning()) return;
    handled.add(postPage.identify(loader));
    publish();
  });
  publish();
  return { start, stop };
}
