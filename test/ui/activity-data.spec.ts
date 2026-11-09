import { expect, type Page, test } from "@playwright/test";

import type { TwinSummary } from "../../src/shared/control.js";
import {
  apiUrl,
  authHeaders,
  type ControlSessionHarness,
  startControlSession,
} from "../helpers/control.js";

async function createRule(
  harness: ControlSessionHarness,
  failureId = "server-error",
): Promise<void> {
  const response = await fetch(apiUrl(harness.session, "/rules"), {
    method: "POST",
    headers: {
      ...authHeaders(harness.session),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      failureId,
      twins: ["paystack"],
      settings: { times: 1, status: 500 },
    }),
  });
  expect(response.status).toBe(200);
}

type EditableTwin = { -readonly [Key in keyof TwinSummary]: TwinSummary[Key] };

async function clearRules(harness: ControlSessionHarness): Promise<void> {
  await fetch(apiUrl(harness.session, "/rules"), {
    method: "DELETE",
    headers: authHeaders(harness.session),
  });
}

async function openLive(page: Page, harness: ControlSessionHarness): Promise<void> {
  await page.goto(harness.session.createLaunchLink());
  await page.getByRole("link", { name: "Live activity" }).click();
  await expect(page.getByRole("heading", { name: "Live activity" })).toBeVisible();
}

test("T8 Live activity pauses, resumes, counts waiting events and filters", async ({ page }) => {
  const harness = await startControlSession({});
  try {
    await openLive(page, harness);
    await expect(page.getByText("No activity yet.")).toBeVisible();
    await page.getByRole("button", { name: "Pause activity" }).click();
    await createRule(harness);

    await expect(page.getByText("Paused. 1 new event arrived.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("event-row")).toHaveCount(0);

    await page.getByLabel("Event type").selectOption("rules");
    await expect(page.getByTestId("event-row")).toHaveCount(0);
    await expect(page.getByText("Paused. 1 new event arrived.", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByTestId("event-row")).toHaveCount(1);
    await expect(page.getByText("A test failure was turned on.")).toBeVisible();

    await page.getByRole("button", { name: "Details" }).first().click();
    await expect(page.getByRole("button", { name: "Hide details" })).toBeVisible();
    await expect(page.getByText("Rule id")).toBeVisible();
    await expect(page.getByText("Event ID")).toBeVisible();

    await page.getByRole("link", { name: /Paystack/u }).click();
    await expect(page.getByTestId("event-row")).toHaveCount(1);
    await page.getByRole("link", { name: /Flutterwave/u }).click();
    await expect(page.getByText("No events match this filter.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("event-row")).toHaveCount(1);
  } finally {
    await clearRules(harness);
    await harness.cleanup();
  }
});

test("T8 Live activity shows the off panel for a stopped twin", async ({ page }) => {
  const harness = await startControlSession({});
  try {
    await page.route("**/_ibeji/api/v1/twins", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { twins: TwinSummary[] };
      const twin = body.twins.find((item) => item.id === "flutterwave");
      if (twin !== undefined) {
        body.twins[body.twins.indexOf(twin)] = {
          ...twin,
          running: false,
          address: null,
          port: null,
        };
      }
      await route.fulfill({ response, json: body });
    });

    await openLive(page, harness);
    await page.getByRole("link", { name: /Flutterwave/u }).click();
    await expect(page.getByText("Flutterwave is off.")).toBeVisible();
    await expect(
      page.getByText(
        "Start it to see new activity for this twin. Choose All twins to see other twins.",
      ),
    ).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 Live activity catches up after a forced reconnection without losing events", async ({
  page,
}) => {
  const harness = await startControlSession({});
  try {
    await createRule(harness);
    const eventsResponse = await fetch(apiUrl(harness.session, "/events?limit=1"), {
      headers: authHeaders(harness.session),
    });
    const eventsBody = (await eventsResponse.json()) as { events: { id: number }[] };
    const baselineId = eventsBody.events[0]?.id;
    expect(baselineId).toBeDefined();

    let streamAttempts = 0;
    let lastEventIdHeader: string | undefined;
    await page.route("**/_ibeji/api/v1/events/stream", async (route) => {
      streamAttempts += 1;
      if (streamAttempts === 1) {
        await route.abort("failed");
        return;
      }
      lastEventIdHeader = route.request().headers()["last-event-id"];
      await route.continue();
    });

    await openLive(page, harness);
    await expect(page.getByTestId("event-row")).toHaveCount(1);
    await expect(page.getByText("Reconnecting.", { exact: true })).toBeVisible();

    await createRule(harness);
    await expect(page.getByTestId("event-row")).toHaveCount(2, { timeout: 10_000 });
    expect(lastEventIdHeader).toBe(String(baselineId));
  } finally {
    await clearRules(harness);
    await harness.cleanup();
  }
});

test("T8 Live activity renders 5,000 events within the measured budget", async ({ page }) => {
  const harness = await startControlSession({});
  try {
    const events = Array.from({ length: 5_000 }, (_, index) => ({
      id: index + 1,
      time: 1_700_000_000_000 + index,
      type: "request",
      scope: "paystack",
      summary: `Test request ${index + 1}.`,
      details: {},
    }));
    await page.route(/\/_ibeji\/api\/v1\/events\?limit=500$/u, async (route) => {
      await route.fulfill({ json: { events } });
    });

    await page.goto(harness.session.createLaunchLink());
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

    const started = Date.now();
    await page.getByRole("link", { name: "Live activity" }).click();
    await expect(page.getByTestId("event-row")).toHaveCount(5_000, { timeout: 10_000 });
    const elapsed = Date.now() - started;
    console.log(`PERF Live activity 5,000 events: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3_000);
  } finally {
    await harness.cleanup();
  }
});

test("T8 Data formats money from the API currency rules and names reset scope", async ({
  page,
}) => {
  const harness = await startControlSession({});
  try {
    await page.route("**/_ibeji/api/v1/twins", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { twins: EditableTwin[] };
      for (const twin of body.twins) {
        twin.currencyRules = {
          zeroDecimal: ["XOF"],
          defaultFractionDigits: 2,
          fractionDigits: { NGN: 2, USD: 2, KWD: 3, XOF: 0 },
        };
        if (twin.id === "flutterwave") {
          twin.running = false;
          twin.address = null;
          twin.port = null;
        }
      }
      await route.fulfill({ response, json: body });
    });
    await page.route("**/_ibeji/api/v1/twins/paystack/state", async (route) => {
      await route.fulfill({
        json: {
          twin: "paystack",
          collections: [
            {
              id: "transactions",
              label: "Transactions",
              columns: [
                { key: "reference", label: "Reference", kind: "text" },
                { key: "amount", label: "Amount", kind: "money" },
                { key: "currency", label: "Currency", kind: "text" },
                { key: "createdAt", label: "Created", kind: "date" },
              ],
              records: [
                {
                  id: "one",
                  reference: "zero",
                  amount: 0,
                  currency: "NGN",
                  createdAt: "2026-11-04T10:00:00.000Z",
                },
                {
                  id: "two",
                  reference: "small",
                  amount: 1,
                  currency: "USD",
                  createdAt: "2026-11-04T10:01:00.000Z",
                },
                {
                  id: "three",
                  reference: "large",
                  amount: 123_456_789_012_345,
                  currency: "NGN",
                  createdAt: "2026-11-04T10:02:00.000Z",
                },
                {
                  id: "four",
                  reference: "xof",
                  amount: 500,
                  currency: "XOF",
                  createdAt: "2026-11-04T10:03:00.000Z",
                },
                {
                  id: "five",
                  reference: "kwd",
                  amount: 1_234,
                  currency: "KWD",
                  createdAt: "2026-11-04T10:04:00.000Z",
                },
              ],
            },
          ],
        },
      });
    });

    await page.goto(harness.session.createLaunchLink());
    await page.getByRole("link", { name: "Data" }).click();
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

    await expect(page.getByText("₦0.00")).toBeVisible();
    await expect(page.getByText("$0.01")).toBeVisible();
    await expect(page.getByText("₦1,234,567,890,123.45")).toBeVisible();
    await expect(page.getByText("XOF 500")).toBeVisible();
    await expect(page.getByText("KWD 1.234")).toBeVisible();

    await page.getByRole("button", { name: "Reset Paystack records" }).click();
    await expect(page.getByRole("heading", { name: "Reset Paystack records?" })).toBeVisible();
    await expect(
      page.getByText(/every payment, refund, transfer, recipient and bank record for Paystack/u),
    ).toBeVisible();
    await expect(
      page.getByText(/It keeps failure rules, scenarios, webhook addresses, test keys and events/u),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Reset all records" }).click();
    await expect(page.getByRole("heading", { name: "Reset all twin records?" })).toBeVisible();
    await expect(page.getByText(/every record for every running twin/u)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: /Flutterwave/u }).click();
    await expect(page.getByText("Flutterwave is off.")).toBeVisible();
    await expect(page.getByText("Start it to see its records.")).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 Live activity shows the C12 error state when activity cannot load", async ({ page }) => {
  const harness = await startControlSession({});
  try {
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

    await openLive(page, harness);
    await expect(page.getByRole("heading", { name: "We couldn't load activity." })).toBeVisible();
    await expect(page.getByText("Activity could not be read.")).toBeVisible();
    await expect(page.getByText("The event log is unavailable.")).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 Data shows empty tables and the all-twin reset scope", async ({ page }) => {
  const harness = await startControlSession({});
  try {
    await page.goto(harness.session.createLaunchLink());
    await page.getByRole("link", { name: "Data" }).click();
    await expect(page.getByText("No records yet.").first()).toBeVisible();
    await expect(page.getByText("Make a test request to see records here.").first()).toBeVisible();

    await page.getByRole("button", { name: "Reset all records" }).click();
    await expect(page.getByRole("heading", { name: "Reset all twin records?" })).toBeVisible();
    await expect(
      page.getByText(/It cancels queued and scheduled webhooks and marks them abandoned/u),
    ).toBeVisible();
    await expect(page.getByText(/This cannot be undone./u)).toBeVisible();
    await page.locator("dialog").getByRole("button", { name: "Reset all records" }).click();
    await expect(
      page.getByText("Records reset. Queued webhooks were marked abandoned."),
    ).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});
