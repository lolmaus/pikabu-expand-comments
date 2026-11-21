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

test("retries timed-out loaders with exponential backoff and halts after three failed steps", async () => {
  vi.useFakeTimers();
  try {
    const snapshots: ExpansionSnapshot[] = [];
    const clicks: { loader: string; time: number }[] = [];
    const loaders = ["skipped", "expanded", "a", "b", "c", "d"].map((id) => ({ id }));
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const timeout = new Error("Timed out");
    const reportFailure = vi.fn();
    let recovered = false;
    const startTime = Date.now();
    const run = createExpansionRun(
      {
        read: () => ({ loadedCommentsCount: 2, loaders, isHydrating: false }),
        identify: (loader) => loader,
        observeChanges: () => {},
        observeManualCollapses: () => {},
        waitForHydration: async () => {},
        async expand(loader) {
          clicks.push({ loader: loader.id, time: Date.now() - startTime });
          if (loader.id === "skipped") return "skipped";
          if (!recovered && loader.id !== "expanded") {
            await pause(15_000);
            return { timeout };
          }
          return "expanded";
        },
      },
      pause,
      (snapshot) => snapshots.push(snapshot),
      reportFailure,
    );

    const firstRun = run.start();
    await vi.runAllTimersAsync();
    await firstRun;
    expect(clicks).toEqual([
      { loader: "skipped", time: 0 },
      { loader: "expanded", time: 150 },
      { loader: "a", time: 300 },
      { loader: "a", time: 16_300 },
      { loader: "a", time: 33_300 },
      { loader: "a", time: 52_300 },
      { loader: "b", time: 67_450 },
      { loader: "b", time: 83_450 },
      { loader: "b", time: 100_450 },
      { loader: "b", time: 119_450 },
      { loader: "c", time: 134_600 },
      { loader: "c", time: 150_600 },
      { loader: "c", time: 167_600 },
      { loader: "c", time: 186_600 },
    ]);
    expect(reportFailure).toHaveBeenCalledTimes(3);
    expect(snapshots.at(-1)).toMatchObject({
      state: "error",
      expandedStepsCount: 1,
      skippedCount: 1,
    });

    recovered = true;
    const retry = run.start();
    await vi.runAllTimersAsync();
    await retry;
    expect(clicks.slice(14).map(({ loader }) => loader)).toEqual(["a", "b", "c", "d"]);
    expect(snapshots.at(-1)).toMatchObject({
      state: "completed",
      expandedStepsCount: 5,
      remainingLoadersCount: 0,
      skippedCount: 1,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("continues past nonconsecutive failures and offers Retry for unfinished loaders", async () => {
  const loaders = [true, true, false, true, false].map((fails, index) => ({ fails, index }));
  const clicked: number[] = [];
  const snapshots: ExpansionSnapshot[] = [];
  const run = createExpansionRun(
    {
      read: () => ({ loadedCommentsCount: 2, loaders, isHydrating: false }),
      identify: (loader) => loader,
      observeChanges: () => {},
      observeManualCollapses: () => {},
      waitForHydration: async () => {},
      async expand(loader) {
        clicked.push(loader.index);
        return loader.fails ? { timeout: new Error("Timed out") } : "expanded";
      },
    },
    async () => {},
    (snapshot) => snapshots.push(snapshot),
  );

  await run.start();
  expect(clicked).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 3, 3, 3, 4]);
  expect(snapshots.at(-1)).toMatchObject({ state: "error", expandedStepsCount: 2 });
});

test("Stop during backoff prevents clicking and Continue retries the same loader", async () => {
  const backoff = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const loader = {};
  const expand = vi
    .fn<PostPageAdapter<object>["expand"]>()
    .mockResolvedValueOnce({ timeout: new Error("Timed out") })
    .mockResolvedValueOnce("expanded");
  const snapshots: ExpansionSnapshot[] = [];
  const run = createExpansionRun(
    {
      read: () => ({ loadedCommentsCount: 2, loaders: [loader], isHydrating: false }),
      identify: (candidate) => candidate,
      observeChanges: () => {},
      observeManualCollapses: () => {},
      waitForHydration: async () => {},
      expand,
    },
    async (delay) => {
      if (delay === 1000) {
        waiting.resolve();
        await backoff.promise;
      }
    },
    (snapshot) => snapshots.push(snapshot),
  );

  const finish = run.start();
  await waiting.promise;
  run.stop();
  backoff.resolve();
  await finish;
  expect(expand).toHaveBeenCalledOnce();
  expect(snapshots.at(-1)).toMatchObject({ state: "stopped" });
  await run.start();
  expect(expand).toHaveBeenCalledTimes(2);
  expect(snapshots.at(-1)).toMatchObject({ state: "completed" });
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
