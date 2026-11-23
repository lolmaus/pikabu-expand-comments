import { expect, test, vi } from "vitest";
import { createExtensionStorage } from "./storage.ts";
import type { StorageChangesMap, StorageOnChangedListener } from "./webext-api.ts";

function createFakeStorageApi() {
  const data = new Map<string, unknown>();
  const listeners = new Set<StorageOnChangedListener>();
  return {
    data,
    listeners,
    api: {
      storage: {
        local: {
          async get(keys: string | string[]) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, unknown> = {};
            for (const key of list) {
              if (data.has(key)) out[key] = data.get(key);
            }
            return out;
          },
          async set(items: Record<string, unknown>) {
            const changes: StorageChangesMap = {};
            for (const [key, value] of Object.entries(items)) {
              changes[key] = { oldValue: data.get(key), newValue: value };
              data.set(key, value);
            }
            for (const listener of listeners) listener(changes, "local");
          },
        },
        onChanged: {
          addListener(listener: StorageOnChangedListener) {
            listeners.add(listener);
          },
          removeListener(listener: StorageOnChangedListener) {
            listeners.delete(listener);
          },
        },
      },
    },
    emit(changes: StorageChangesMap, areaName: string) {
      for (const listener of listeners) listener(changes, areaName);
    },
  };
}

test("reads and writes boolean values through storage.local", async () => {
  const fake = createFakeStorageApi();
  const storage = createExtensionStorage(fake.api);

  expect(await storage.get("autoExpandOnVisit")).toBeUndefined();
  await storage.set("autoExpandOnVisit", true);
  expect(await storage.get("autoExpandOnVisit")).toBe(true);
  await storage.set("autoExpandOnVisit", false);
  expect(await storage.get("autoExpandOnVisit")).toBe(false);
});

test("filters storage.onChanged to areaName === local and guards unchanged keys (Firefox Bugzilla 1833153)", () => {
  const fake = createFakeStorageApi();
  const storage = createExtensionStorage(fake.api);
  const received: unknown[] = [];

  const unsubscribe = storage.subscribe!("autoExpandOnVisit", (value) => {
    received.push(value);
  });

  // Ignore non-local storage areas (sync / session).
  fake.emit({ autoExpandOnVisit: { oldValue: false, newValue: true } }, "sync");
  expect(received).toEqual([]);

  // Ignore unrelated keys.
  fake.emit({ otherKey: { oldValue: 1, newValue: 2 } }, "local");
  expect(received).toEqual([]);

  // Ignore unchanged values emitted alongside another key (Firefox Bugzilla 1833153).
  fake.emit(
    {
      autoExpandOnVisit: { oldValue: true, newValue: true },
      otherKey: { oldValue: 2, newValue: 3 },
    },
    "local",
  );
  expect(received).toEqual([]);

  // Forward genuine local changes.
  fake.emit({ autoExpandOnVisit: { oldValue: false, newValue: true } }, "local");
  fake.emit({ autoExpandOnVisit: { oldValue: true, newValue: false } }, "local");
  expect(received).toEqual([true, false]);

  // Unsubscribe removes the listener cleanly.
  unsubscribe();
  expect(fake.listeners.size).toBe(0);
  const spy = vi.fn();
  const unsub2 = storage.subscribe!("autoExpandOnVisit", spy);
  unsub2();
  fake.emit({ autoExpandOnVisit: { oldValue: false, newValue: true } }, "local");
  expect(spy).not.toHaveBeenCalled();
});
