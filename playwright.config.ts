import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/ui",
  globalSetup: "./test/setup/global-ui-build.ts",
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    trace: "retain-on-failure",
  },
});
