import { test as base, expect, type Page } from "@playwright/test";

import { type LocalServer, startLocalServer } from "./support/local-server.js";
import { startUiSession, type UiSession } from "./support/session.js";

type TestFixtures = {
  readonly twinSet: readonly string[] | undefined;
  readonly ibejiSession: UiSession;
  readonly receiver: LocalServer;
  readonly dashboard: Page;
};

export const test = base.extend<TestFixtures>({
  twinSet: [undefined, { option: true }],
  ibejiSession: async ({ twinSet }, use) => {
    const session = await startUiSession(twinSet);
    try {
      await use(session);
    } finally {
      await session.cleanup();
    }
  },
  receiver: async ({ browserName }, use) => {
    void browserName;
    const receiver = await startLocalServer();
    try {
      await use(receiver);
    } finally {
      await receiver.close();
    }
  },
  dashboard: async ({ page, ibejiSession }, use) => {
    await page.goto(ibejiSession.session.launchLink);
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await use(page);
  },
});

export { expect };

export async function openDashboard(page: Page, ui: UiSession): Promise<void> {
  await page.goto(ui.session.launchLink);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible({
    timeout: 15_000,
  });
}

export async function gotoPage(page: Page, name: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

export async function selectTwin(page: Page, displayName: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Choose a twin" })
    .getByRole("link", { name: new RegExp(displayName, "u") })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Choose a twin" }).getByRole("link", {
      name: new RegExp(`${displayName}.*off|${displayName}.*running`, "u"),
    }),
  ).toHaveAttribute("aria-current", "true");
}
