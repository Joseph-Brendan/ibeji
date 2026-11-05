import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/setup/global-ui-build.ts", "test/setup/global-cli-build.ts"],
    setupFiles: ["test/setup/t7-network.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        branches: 90,
        "src/core/**/*.ts": {
          lines: 100,
          branches: 100,
        },
        "src/twins/framework/**/*.ts": {
          lines: 100,
          branches: 100,
        },
      },
    },
  },
});
