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
    let remaining = 2;
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const postPage: PostPageAdapter = {
      read: () => ({
        loadedCommentsCount: loaded,
        remainingLoadersCount: remaining,
        isHydrating: false,
      }),
      observeChanges: () => () => {},
      waitForHydration: async () => {},
      async expandNext(onChange) {
        clickTimes.push(Date.now());
        await pause(40);
        loaded += 1;
        remaining -= 1;
        onChange();
        return true;
      },
    };

    const startTime = Date.now();
    const run = createExpansionRun(postPage, pause, (snapshot) => snapshots.push(snapshot));
    expect(snapshots.at(-1)).toMatchObject({ state: "idle", remainingLoadersCount: 2 });

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

    await vi.advanceTimersByTimeAsync(41);
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

test("completes immediately when the Post Page has no pending comments", async () => {
  const snapshots: ExpansionSnapshot[] = [];
  const run = createExpansionRun(
    {
      read: () => ({ loadedCommentsCount: 2, remainingLoadersCount: 0, isHydrating: false }),
      observeChanges: () => () => {},
      waitForHydration: async () => {},
      async expandNext() {
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
