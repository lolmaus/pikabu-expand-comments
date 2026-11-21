import { expect, test, vi } from "vitest";
import {
  createExpansionRun,
  type ExpansionSnapshot,
  type PostPageAdapter,
} from "./expansion-run.ts";

test("runs one step at a time, waiting for hydration and pacing the next click", async () => {
  vi.useFakeTimers();
  try {
    const snapshots: ExpansionSnapshot[] = [];
    const clickTimes: number[] = [];
    let loaded = 1;
    // Pikabu can reuse the same button after a successful Comment Batch.
    const batch = {};
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const postPage: PostPageAdapter<object> = {
      read: () => ({
        loadedCommentsCount: loaded,
        loaders: loaded < 3 ? [batch] : [],
        isHydrating: false,
      }),
      identify: (loader) => loader,
      observeChanges: () => {},
      observeManualCollapses: () => {},
      waitForHydration: async () => {},
      async expand(loader) {
        expect(loader).toBe(batch);
        clickTimes.push(Date.now());
        await pause(40);
        loaded += 1;
        return "next-batch";
      },
    };

    const startTime = Date.now();
    const run = createExpansionRun(postPage, pause, (snapshot) => snapshots.push(snapshot));
    expect(snapshots.at(-1)).toMatchObject({ state: "idle", remainingLoadersCount: 1 });

    const runFinished = run.start();
    await run.start();
    await vi.advanceTimersByTimeAsync(189);
    expect(clickTimes).toEqual([startTime]);
    expect(snapshots.at(-1)).toEqual({
      state: "running",
      loadedCommentsCount: 2,
      expandedStepsCount: 1,
      remainingLoadersCount: 1,
      skippedCount: 0,
      initiallyEmpty: false,
    });

    await vi.runAllTimersAsync();
    await runFinished;
    expect(clickTimes).toEqual([startTime, startTime + 190]);
    expect(snapshots.at(-1)).toEqual({
      state: "completed",
      loadedCommentsCount: 3,
      expandedStepsCount: 2,
      remainingLoadersCount: 0,
      skippedCount: 0,
      initiallyEmpty: false,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("stops with a click in flight and continues without repeating handled loaders", async () => {
  const firstStep = Promise.withResolvers<void>();
  const snapshots: ExpansionSnapshot[] = [];
  const first = { id: "first" };
  const readerCollapsed = { id: "reader-collapsed" };
  const last = { id: "last" };
  const clicked: string[] = [];
  const loaders = [first, last];
  let onCollapse: (loader: typeof first) => void = () => {};

  const run = createExpansionRun(
    {
      read: () => ({ loadedCommentsCount: 3, loaders, isHydrating: false }),
      identify: (loader) => loader,
      observeChanges: () => {},
      observeManualCollapses(callback) {
        onCollapse = callback;
      },
      waitForHydration: async () => {},
      async expand(loader) {
        clicked.push(loader.id);
        if (loader === first) await firstStep.promise;
        // An attempted branch can stay present or reappear in the available loaders.
        return "expanded";
      },
    },
    async () => {},
    (snapshot) => snapshots.push(snapshot),
  );

  const finished = run.start();
  await Promise.resolve();
  loaders.unshift(readerCollapsed);
  onCollapse(readerCollapsed);
  run.stop();
  expect(clicked).toEqual(["first"]);
  expect(snapshots.at(-1)).toMatchObject({
    state: "stopped",
    loadedCommentsCount: 3,
    remainingLoadersCount: 1,
  });

  await run.start();
  expect(clicked).toEqual(["first"]);
  firstStep.resolve();
  await finished;
  expect(clicked).toEqual(["first", "last"]);
  expect(snapshots.at(-1)).toMatchObject({ state: "completed", remainingLoadersCount: 0 });
});

test("a fresh run retries earlier attempts while continuing to exclude unclickable loaders", async () => {
  const unclickable = { id: "unclickable" };
  const attempted = { id: "attempted" };
  const stalled = { id: "stalled" };
  const clicked: string[] = [];
  let shouldFail = true;
  const snapshots: ExpansionSnapshot[] = [];
  const run = createExpansionRun(
    {
      read: () => ({
        loadedCommentsCount: 2,
        loaders: [unclickable, attempted, stalled],
        isHydrating: false,
      }),
      identify: (loader) => loader,
      observeChanges: () => {},
      observeManualCollapses: () => {},
      waitForHydration: async () => {},
      async expand(loader) {
        clicked.push(loader.id);
        if (loader === unclickable) return "skipped";
        if (loader === stalled && shouldFail) throw new Error("Timed out");
        return "expanded";
      },
    },
    async () => {},
    (snapshot) => snapshots.push(snapshot),
  );

  await run.start();
  expect(snapshots.at(-1)).toMatchObject({ state: "error", skippedCount: 1 });
  shouldFail = false;
  await run.start();
  expect(clicked).toEqual(["unclickable", "attempted", "stalled", "attempted", "stalled"]);
  expect(snapshots.at(-1)).toMatchObject({
    state: "completed",
    remainingLoadersCount: 0,
    skippedCount: 1,
  });
});

test("a failure after Stop remains retryable after Continue handles the remaining loaders", async () => {
  const firstStep = Promise.withResolvers<void>();
  const stalled = { id: "stalled" };
  const remaining = { id: "remaining" };
  const loaders = [stalled, remaining];
  const clicked: string[] = [];
  const snapshots: ExpansionSnapshot[] = [];
  const run = createExpansionRun(
    {
      read: () => ({ loadedCommentsCount: 2, loaders, isHydrating: false }),
      identify: (loader) => loader,
      observeChanges: () => {},
      observeManualCollapses: () => {},
      waitForHydration: async () => {},
      async expand(loader) {
        clicked.push(loader.id);
        if (loader === stalled) await firstStep.promise;
        return "expanded";
      },
    },
    async () => {},
    (snapshot) => snapshots.push(snapshot),
  );

  const finish = run.start();
  await Promise.resolve();
  run.stop();
  firstStep.reject(new Error("Timed out"));
  await finish;
  expect(snapshots.at(-1)).toMatchObject({ state: "stopped" });
  await run.start();
  expect(clicked).toEqual(["stalled", "remaining"]);
  expect(snapshots.at(-1)).toMatchObject({ state: "error" });
});

test("completes immediately when the Post Page has no pending comments", async () => {
  const snapshots: ExpansionSnapshot[] = [];
  const run = createExpansionRun(
    {
      read: () => ({ loadedCommentsCount: 2, loaders: [], isHydrating: false }),
      identify: (loader) => loader,
      observeChanges: () => {},
      observeManualCollapses: () => {},
      waitForHydration: async () => {},
      async expand() {
        throw new Error("An empty Post Page has nothing to click.");
      },
    },
    async () => {},
    (snapshot) => snapshots.push(snapshot),
  );
  await run.start();

  expect(snapshots).toEqual([
    {
      state: "completed",
      loadedCommentsCount: 2,
      expandedStepsCount: 0,
      remainingLoadersCount: 0,
      skippedCount: 0,
      initiallyEmpty: true,
    },
  ]);
});
