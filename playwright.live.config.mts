import { defineConfig } from "@playwright/test";
import config from "./playwright.config.mts";

export default defineConfig(config, {
  testDir: "tests/live",
  timeout: 75_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: { viewport: { width: 1280, height: 800 } },
});
