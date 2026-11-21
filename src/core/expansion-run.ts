export interface PostPageSnapshot {
  loadedCommentsCount: number;
  remainingLoadersCount: number;
  isHydrating: boolean;
}

export interface PostPageAdapter {
  read(): PostPageSnapshot;
  observeChanges(onChange: () => void): () => void;
  waitForHydration(onChange: () => void): Promise<void>;
  expandNext(onChange: () => void): Promise<boolean>;
}

type ExpansionState = "idle" | "running" | "completed" | "error";

export interface ExpansionSnapshot {
  state: ExpansionState;
  loadedCommentsCount: number;
  expandedStepsCount: number;
  remainingLoadersCount: number;
  skippedCount: number;
  initiallyEmpty: boolean;
}

const stepPauseMs = 150;

function hasPendingComments(page: PostPageSnapshot) {
  return page.remainingLoadersCount > 0 || page.isHydrating;
}

export function createExpansionRun(
  postPage: PostPageAdapter,
  pause: (milliseconds: number) => Promise<void>,
  render: (snapshot: ExpansionSnapshot) => void,
) {
  let state: ExpansionState = "idle";
  let expandedStepsCount = 0;
  const stopObserving = postPage.observeChanges(publish);

  function publish(page = postPage.read()) {
    const initiallyEmpty = state === "idle" && !hasPendingComments(page);
    render({
      state: initiallyEmpty ? "completed" : state,
      expandedStepsCount,
      initiallyEmpty,
      loadedCommentsCount: page.loadedCommentsCount,
      remainingLoadersCount: page.remainingLoadersCount,
      skippedCount: 0,
    });
  }

  async function start() {
    if (state !== "idle" || !hasPendingComments(postPage.read())) return;

    stopObserving();
    state = "running";
    publish();
    try {
      while (true) {
        await postPage.waitForHydration(publish);
        if (!(await postPage.expandNext(publish))) break;

        expandedStepsCount += 1;
        const page = postPage.read();
        publish(page);
        if (!hasPendingComments(page)) break;
        await pause(stepPauseMs);
      }
      state = "completed";
    } catch {
      state = "error";
    }
    publish();
  }

  publish();
  return { start };
}
