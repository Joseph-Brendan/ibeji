import { registry } from "../../src/twins/registry.js";
import { expect, gotoPage, openDashboard, selectTwin, test } from "./fixtures.js";
import { expectNoSeriousAxe } from "./support/assertions.js";

const twins = registry.list();
const onTwin = twins[0];
const offTwin = twins[1];

test.describe("T8 twin not running", () => {
  test.use({ twinSet: onTwin === undefined ? [] : [onTwin.id] });

  test("T8 Home shows the off twin", async ({ dashboard }) => {
    expect(offTwin).toBeDefined();
    if (offTwin === undefined) {
      return;
    }
    await selectTwin(dashboard, offTwin.displayName);
    await expect(
      dashboard.getByText(
        `${offTwin.displayName} is off. To turn it on, run ibeji start --twins ${offTwin.id}.`,
      ),
    ).toBeVisible();
    await expect(dashboard.getByText("Available when this twin is running.")).toBeVisible();
    await expect(
      dashboard.getByRole("button", { name: `Copy Secret key for ${offTwin.displayName}` }),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Home with the off twin");
  });

  test("T8 Connect your app shows the off twin", async ({ dashboard }) => {
    expect(offTwin).toBeDefined();
    if (offTwin === undefined) {
      return;
    }
    await gotoPage(dashboard, "Connect your app");
    await dashboard.getByRole("link", { name: /All twins/u }).click();
    await dashboard.getByTestId(`guide-card-${offTwin.id}`).click();
    await expect(
      dashboard.getByText(
        `${offTwin.displayName} is off. Start it with ibeji start --twins ${offTwin.id}.`,
      ),
    ).toBeVisible();
    await expect(
      dashboard.getByText("Base URL is not available while this twin is off."),
    ).toBeVisible();
    await expect(
      dashboard.getByRole("button", { name: `Copy Secret key for ${offTwin.displayName}` }),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Connect with the off twin");
  });

  test("T8 Live activity shows the off twin", async ({ dashboard }) => {
    expect(offTwin).toBeDefined();
    if (offTwin === undefined) {
      return;
    }
    await gotoPage(dashboard, "Live activity");
    await selectTwin(dashboard, offTwin.displayName);
    await expect(dashboard.getByTestId("activity-twin-off")).toBeVisible();
    await expect(dashboard.getByText(`${offTwin.displayName} is off.`)).toBeVisible();
    await expect(
      dashboard.getByText(
        "Start it to see new activity for this twin. Choose All twins to see other twins.",
      ),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Live activity with the off twin");
  });

  test("T8 Failures disables the off twin", async ({ dashboard }) => {
    expect(offTwin).toBeDefined();
    if (offTwin === undefined) {
      return;
    }
    await gotoPage(dashboard, "Failures");
    await selectTwin(dashboard, offTwin.displayName);
    const card = dashboard.getByTestId("failure-server-error");
    await expect(
      card.getByRole("checkbox", { name: new RegExp(offTwin.displayName, "u") }),
    ).toBeDisabled();
    await expect(
      card.getByText(
        `Start ${offTwin.displayName} with ibeji start --twins ${offTwin.id} to use it.`,
      ),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Failures with the off twin");
  });

  test("T8 Scenarios disables the off twin", async ({ dashboard }) => {
    expect(offTwin).toBeDefined();
    if (offTwin === undefined) {
      return;
    }
    await gotoPage(dashboard, "Scenarios");
    await selectTwin(dashboard, offTwin.displayName);
    const card = dashboard.getByTestId("scenario-bank-outage");
    await expect(
      card.getByRole("checkbox", { name: new RegExp(offTwin.displayName, "u") }),
    ).toBeDisabled();
    await expect(
      card.getByText(
        new RegExp(
          `${offTwin.displayName} is off\\. Start it with ibeji start --twins ${offTwin.id}`,
          "u",
        ),
      ),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Scenarios with the off twin");
  });

  test("T8 Webhooks keeps the off twin URL editor", async ({ dashboard }) => {
    expect(offTwin).toBeDefined();
    if (offTwin === undefined) {
      return;
    }
    await gotoPage(dashboard, "Webhooks");
    await selectTwin(dashboard, offTwin.displayName);
    await expect(dashboard.getByTestId(`webhook-editor-${offTwin.id}`)).toBeVisible();
    await expect(dashboard.getByText(`${offTwin.displayName} is off.`)).toBeVisible();
    await expect(
      dashboard.getByText("You can still set its webhook URL. Deliveries appear when it runs."),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Webhooks with the off twin");
  });

  test("T8 Data shows the off twin panel", async ({ dashboard }) => {
    expect(offTwin).toBeDefined();
    if (offTwin === undefined) {
      return;
    }
    await gotoPage(dashboard, "Data");
    await selectTwin(dashboard, offTwin.displayName);
    await expect(dashboard.getByTestId("data-twin-off")).toBeVisible();
    await expect(dashboard.getByText(`${offTwin.displayName} is off.`)).toBeVisible();
    await expect(dashboard.getByText("Start it to see its records.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Data with the off twin");
  });
});

test.describe("T8 page error states", () => {
  test("T8 Live activity shows the C12 error", async ({ page, ibejiSession }) => {
    await page.route(/\/_ibeji\/api\/v1\/events\?limit=500$/u, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL",
            what: "Activity could not be read.",
            why: "The event log is unavailable.",
            fix: "Try again.",
          },
        }),
      });
    });
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Live activity");
    await expect(page.getByRole("heading", { name: "We couldn't load activity." })).toBeVisible();
    await expect(page.getByText("Activity could not be read.")).toBeVisible();
    await expectNoSeriousAxe(page, "Live activity error");
  });

  test("T8 Failures shows the C12 error", async ({ dashboard }) => {
    await dashboard.route("**/_ibeji/api/v1/failures", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL",
            what: "Failures could not be read.",
            why: "The catalogue is unavailable.",
            fix: "Try again.",
          },
        }),
      });
    });
    await gotoPage(dashboard, "Failures");
    await expect(pageHeading(dashboard, "We couldn't load failures.")).toBeVisible();
    await expect(dashboard.getByText("Failures could not be read.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Failures error");
  });

  test("T8 Scenarios shows the C12 error", async ({ dashboard }) => {
    await dashboard.route("**/_ibeji/api/v1/scenarios", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL",
            what: "Scenarios could not be read.",
            why: "The scenario files are unavailable.",
            fix: "Try again.",
          },
        }),
      });
    });
    await gotoPage(dashboard, "Scenarios");
    await expect(pageHeading(dashboard, "We couldn't run that scenario.")).toBeVisible();
    await expect(dashboard.getByText("Scenarios could not be read.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Scenarios error");
  });

  test("T8 Webhooks shows the C12 error", async ({ dashboard }) => {
    await dashboard.route("**/_ibeji/api/v1/webhooks", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL",
            what: "Webhooks could not be read.",
            why: "The delivery store is unavailable.",
            fix: "Try again.",
          },
        }),
      });
    });
    await gotoPage(dashboard, "Webhooks");
    await expect(pageHeading(dashboard, "We couldn't load webhooks.")).toBeVisible();
    await expect(dashboard.getByText("Webhooks could not be read.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Webhooks error");
  });

  test("T8 Data shows the C12 error", async ({ dashboard }) => {
    await dashboard.route("**/_ibeji/api/v1/twins/paystack/state", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "INTERNAL",
            what: "Records could not be read.",
            why: "The state store is unavailable.",
            fix: "Try again.",
          },
        }),
      });
    });
    await gotoPage(dashboard, "Data");
    await expect(pageHeading(dashboard, "We couldn't load those records.")).toBeVisible();
    await expect(dashboard.getByText("Records could not be read.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Data error");
  });
});

test.describe("T8 disconnected banner", () => {
  test("T8 Home shows the disconnected banner", async ({ page, ibejiSession }) => {
    await disconnectStream(page);
    await openDashboard(page, ibejiSession);
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(page.getByText(/^Last updated at /u)).toBeVisible();
    await expectNoSeriousAxe(page, "Home disconnected");
  });

  test("T8 Connect shows the disconnected banner", async ({ page, ibejiSession }) => {
    await disconnectStream(page);
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Connect your app");
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(page.getByTestId("connect-page")).toBeVisible();
    await expectNoSeriousAxe(page, "Connect disconnected");
  });

  test("T8 Live activity shows the disconnected banner", async ({ page, ibejiSession }) => {
    await disconnectStream(page);
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Live activity");
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(page.getByText("Reconnecting.", { exact: true })).toBeVisible();
    await expectNoSeriousAxe(page, "Live activity disconnected");
  });

  test("T8 Failures shows the disconnected banner", async ({ page, ibejiSession }) => {
    await disconnectStream(page);
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Failures");
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(
      page.getByText("Ibeji is not answering. Changes are paused until it returns."),
    ).toBeVisible();
    await expectNoSeriousAxe(page, "Failures disconnected");
  });

  test("T8 Scenarios shows the disconnected banner", async ({ page, ibejiSession }) => {
    await disconnectStream(page);
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Scenarios");
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(
      page.getByText("Ibeji is not answering. Scenario controls are paused."),
    ).toBeVisible();
    await expectNoSeriousAxe(page, "Scenarios disconnected");
  });

  test("T8 Webhooks shows the disconnected banner", async ({ page, ibejiSession }) => {
    await disconnectStream(page);
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Webhooks");
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(
      page.getByText("Ibeji is not answering. Resend and URL changes are paused until it returns."),
    ).toBeVisible();
    await expectNoSeriousAxe(page, "Webhooks disconnected");
  });

  test("T8 Data shows the disconnected banner", async ({ page, ibejiSession }) => {
    await disconnectStream(page);
    await openDashboard(page, ibejiSession);
    await gotoPage(page, "Data");
    await expect(page.getByRole("heading", { name: "Connection lost." })).toBeVisible();
    await expect(
      page.getByText("Ibeji is not answering. Records may be out of date."),
    ).toBeVisible();
    await expectNoSeriousAxe(page, "Data disconnected");
  });
});

function pageHeading(page: import("@playwright/test").Page, name: string) {
  return page.getByRole("heading", { name });
}

async function disconnectStream(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/_ibeji/api/v1/events/stream", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL" } }),
    });
  });
}
