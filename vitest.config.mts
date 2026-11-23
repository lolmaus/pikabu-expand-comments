import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/{core,targets}/**/*.test.ts"],
          exclude: ["src/targets/extension/popup/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/{adapters,ui}/**/*.test.ts", "src/targets/extension/popup/**/*.test.ts"],
        },
      },
    ],
  },
});
