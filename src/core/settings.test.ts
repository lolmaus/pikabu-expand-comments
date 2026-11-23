import { expect, test, vi } from "vitest";
import { autoExpandOnVisitKey, createSettings } from "./settings.ts";

test("reads and writes Auto-Expand on Visit through asynchronous storage", async () => {
  const values = new Map<string, boolean>();
  const settings = createSettings({
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
    },
  });

  expect(await settings.getAutoExpandOnVisit()).toBe(false);
  await settings.setAutoExpandOnVisit(true);
  expect(await settings.getAutoExpandOnVisit()).toBe(true);
  await settings.setAutoExpandOnVisit(false);
  expect(await settings.getAutoExpandOnVisit()).toBe(false);
  // No-op unsubscribe when storage does not implement subscribe.
  expect(() => settings.subscribeAutoExpandOnVisit(vi.fn())()).not.toThrow();
});

test("forwards external storage updates through subscribeAutoExpandOnVisit", () => {
  let listener: ((value: unknown) => void) | undefined;
  const unsubscribeStorage = vi.fn();
  const settings = createSettings({
    get: async () => false,
    set: async () => {},
    subscribe(key, onChange) {
      expect(key).toBe(autoExpandOnVisitKey);
      listener = onChange;
      return unsubscribeStorage;
    },
  });

  const received: boolean[] = [];
  const unsubscribe = settings.subscribeAutoExpandOnVisit((enabled) => received.push(enabled));
  listener?.(true);
  listener?.(false);
  listener?.("not-a-boolean");
  expect(received).toEqual([true, false, false]);

  unsubscribe();
  expect(unsubscribeStorage).toHaveBeenCalledOnce();
});
