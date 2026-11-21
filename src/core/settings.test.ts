import { expect, test } from "vitest";
import { createSettings } from "./settings.ts";

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
});
