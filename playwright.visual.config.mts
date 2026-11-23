import { defineConfig } from "@playwright/test";
import config from "./playwright.config.mts";

export default defineConfig(config, {
  testDir: "tests/visual",
  retries: 0,
});
