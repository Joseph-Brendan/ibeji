import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/ui",
  globalSetup: "./test/setup/global-ui-build.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
