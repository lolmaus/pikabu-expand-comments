import { defineConfig } from "@playwright/test";

const chromiumExecutable = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    browserName: "chromium",
    launchOptions: {
      chromiumSandbox: false,
      ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
    },
  },
});
