import { registry } from "../../src/twins/registry.js";
import { expect, gotoPage, selectTwin, test } from "./fixtures.js";
import { setWebhookUrl } from "./support/api.js";
import { expectNoSeriousAxe } from "./support/assertions.js";
import { seedPayment } from "./support/journey.js";
import type { LocalServer } from "./support/local-server.js";
import type { UiSession } from "./support/session.js";

const twins = registry.list();

async function seedWebhookPayment(
  ui: UiSession,
  receiver: LocalServer,
  twinId: string,
  reference: string,
): Promise<void> {
  await setWebhookUrl(ui, twinId, `${receiver.url}/webhook`);
  await seedPayment(ui.session, twinId, reference);
  await receiver.waitForRequest((request) => request.path === "/webhook", 10_000);
}

test.describe("T8 Live activity", () => {
  test("T8 Live activity loads empty and shows real events from each twin", async ({
    dashboard,
    ibejiSession,
  }) => {
    await gotoPage(dashboard, "Live activity");
    await expect(dashboard.getByText("No activity yet.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Live activity empty");

    for (const twin of twins) {
      await seedPayment(ibejiSession.session, twin.id, `live-${twin.id}-${Date.now()}`);
    }
    await dashboard.getByRole("link", { name: "Live activity" }).click();
    await expect(dashboard.getByTestId("event-row").first()).toBeVisible({ timeout: 10_000 });
    for (const twin of twins) {
      await expect(
        dashboard.getByTestId("event-row").filter({ hasText: twin.displayName }).first(),
      ).toBeVisible();
    }
    await expect(dashboard.getByText(/Your app started a Paystack payment/u).first()).toBeVisible();
    await expect(
      dashboard.getByText(/Your app started a Flutterwave payment/u).first(),
    ).toBeVisible();

    await dashboard.getByRole("button", { name: "Details" }).first().click();
    await expect(dashboard.getByText("Event ID")).toBeVisible();
    await expect(dashboard.getByRole("button", { name: "Hide details" })).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Live activity with events and open details");
  });

  test("T8 Live activity pauses, counts, resumes and filters", async ({
    dashboard,
    ibejiSession,
  }) => {
    await gotoPage(dashboard, "Live activity");
    await dashboard.getByRole("button", { name: "Pause activity" }).click();
    await expect(dashboard.getByText("Paused. 0 new events arrived.")).toBeVisible();
    await seedPayment(ibejiSession.session, twins[0]?.id ?? "", `pause-${Date.now()}`);
    await expect(dashboard.getByText(/Paused. \d+ new events arrived\./u)).toBeVisible({
      timeout: 10_000,
    });
    await dashboard.getByRole("button", { name: "Resume" }).click();
    await expect(dashboard.getByTestId("event-row").first()).toBeVisible();

    await dashboard.getByLabel("Event type").selectOption("warnings");
    await expect(dashboard.getByText("No events match this filter.")).toBeVisible();
    await dashboard.getByRole("button", { name: "Clear filters" }).click();
    await expect(dashboard.getByTestId("event-row").first()).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Live activity after pause and filter");
  });
});

test.describe("T8 Failures", () => {
  test("T8 Failures switches one twin on and off", async ({ dashboard }) => {
    await gotoPage(dashboard, "Failures");
    const twin = twins[0];
    expect(twin).toBeDefined();
    if (twin === undefined) {
      return;
    }
    await selectTwin(dashboard, twin.displayName);
    const card = dashboard.getByTestId("failure-server-error");
    await expect(card).toBeVisible();
    await card.getByRole("switch", { name: `Switch on ${twin.displayName}` }).click();
    await expect(card.locator(".status-pill")).toHaveText("On");
    await expect(card.getByRole("list", { name: "Active on" })).toContainText(twin.displayName);
    await expect(dashboard.getByText("1 manual failure is on.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Failures with one rule on");

    await card.getByRole("switch", { name: `Switch off ${twin.displayName}` }).click();
    await expect(card.locator(".status-pill")).toHaveText("Off");
    await expect(dashboard.getByText("No manual failures are on.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Failures with the rule off");
  });

  test("T8 Failures switches on both twins and clears with confirmation", async ({ dashboard }) => {
    await gotoPage(dashboard, "Failures");
    const card = dashboard.getByTestId("failure-server-error");
    await card.getByRole("switch", { name: /Switch on for 2 twins/u }).click();
    await expect(card.locator(".status-pill")).toHaveText("On");
    await expect(card.getByRole("list", { name: "Active on" }).getByRole("listitem")).toHaveCount(
      twins.length,
    );
    await expect(dashboard.getByText("1 manual failure is on.")).toBeVisible();

    await dashboard.getByRole("button", { name: "Clear all failures" }).click();
    const dialog = dashboard.locator("dialog");
    await expect(dashboard.getByRole("heading", { name: "Clear all failures?" })).toBeVisible();
    await expect(
      dialog.getByText(/Records, webhook addresses, test keys and events stay/u),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Failures clear-all confirmation");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(card.locator(".status-pill")).toHaveText("On");

    await dashboard.getByRole("button", { name: "Clear all failures" }).click();
    await dialog.getByRole("button", { name: "Clear all failures" }).click();
    await expect(card.locator(".status-pill")).toHaveText("Off");
    await expect(dashboard.getByText("All failures cleared.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Failures after clear");
  });
});

test.describe("T8 Scenarios", () => {
  test("T8 Scenarios runs on both twins, shows progress and stops", async ({ dashboard }) => {
    await gotoPage(dashboard, "Scenarios");
    await expect(dashboard.getByText("No scenario is running.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Scenarios empty");

    const scenario = dashboard.getByTestId("scenario-bank-outage");
    await expect(scenario.getByText(/Supported twins: Paystack, Flutterwave/u)).toBeVisible();
    await scenario.getByRole("button", { name: "Run scenario" }).click();
    const active = dashboard.locator(".active-scenario");
    await expect(active.getByRole("heading", { name: "Bank outage" })).toBeVisible();
    await expect(active.getByText(/Running on Paystack and Flutterwave/u)).toBeVisible();
    await expect(
      active.getByText(/Step 1 of 1: remove the Server error failure after 2 minutes/u),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Scenarios running");

    await active.getByRole("button", { name: "Stop scenario" }).click();
    await expect(dashboard.getByText("No scenario is running.")).toBeVisible();
    await expect(dashboard.getByText("Scenario stopped.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Scenarios after stop");
  });

  test("T8 Scenarios confirms replacement before running another story", async ({ dashboard }) => {
    await gotoPage(dashboard, "Scenarios");
    await dashboard
      .getByTestId("scenario-checkout-declines")
      .getByRole("button", { name: "Run scenario" })
      .click();
    await expect(
      dashboard.locator(".active-scenario").getByRole("heading", { name: "Checkout declines" }),
    ).toBeVisible();

    await dashboard
      .getByTestId("scenario-bank-outage")
      .getByRole("button", { name: "Run scenario" })
      .click();
    const dialog = dashboard.locator("dialog");
    await expect(dashboard.getByRole("heading", { name: "Run Bank outage?" })).toBeVisible();
    await expect(dialog.getByText(/stops the running scenario first/u)).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Scenarios replacement confirmation");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      dashboard.locator(".active-scenario").getByRole("heading", { name: "Checkout declines" }),
    ).toBeVisible();

    await dashboard
      .getByTestId("scenario-bank-outage")
      .getByRole("button", { name: "Run scenario" })
      .click();
    await dialog.getByRole("button", { name: "Run scenario" }).click();
    await expect(
      dashboard.locator(".active-scenario").getByRole("heading", { name: "Bank outage" }),
    ).toBeVisible();
    await dashboard
      .locator(".active-scenario")
      .getByRole("button", { name: "Stop scenario" })
      .click();
  });
});

test.describe("T8 Webhooks", () => {
  test("T8 Webhooks loads empty", async ({ dashboard }) => {
    await gotoPage(dashboard, "Webhooks");
    await expect(dashboard.getByText("No webhooks yet.")).toBeVisible();
    await expect(dashboard.getByText("Set a webhook URL, then make a test payment.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Webhooks empty");
  });

  test("T8 Webhooks shows deliveries for each twin, expands attempts and resends", async ({
    dashboard,
    ibejiSession,
    receiver,
  }) => {
    for (const twin of twins) {
      await seedWebhookPayment(ibejiSession, receiver, twin.id, `webhook-${twin.id}-${Date.now()}`);
    }
    await gotoPage(dashboard, "Webhooks");
    const deliveries = dashboard.getByTestId(/^delivery-/u);
    await expect(deliveries).toHaveCount(twins.length, { timeout: 10_000 });
    for (const twin of twins) {
      await expect(deliveries.filter({ hasText: twin.displayName }).first()).toBeVisible();
    }

    const first = deliveries.first();
    await first.getByText("Show attempts").click();
    await expect(first.getByText("First 4 KB of the response")).toBeVisible();
    await expect(first.getByText("Local test receiver")).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Webhooks with an expanded delivery");

    const before = receiver.requests.length;
    await first.getByRole("button", { name: "Resend" }).click();
    await expect(dashboard.getByText("Delivery queued again.")).toBeVisible();
    await expect.poll(() => receiver.requests.length, { timeout: 10_000 }).toBeGreaterThan(before);
    await expect(dashboard.getByTestId(/^delivery-/u)).toHaveCount(twins.length + 1, {
      timeout: 10_000,
    });

    await dashboard.getByLabel("Status").selectOption("unreachable");
    await expect(dashboard.getByText("No deliveries match this status.")).toBeVisible();
    await dashboard.getByLabel("Status").selectOption("delivered");
    await expect(dashboard.getByTestId(/^delivery-/u).first()).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Webhooks with filtered deliveries");
  });

  test("T8 Webhooks explains private and public address refusals", async ({ dashboard }) => {
    await gotoPage(dashboard, "Webhooks");
    const editor = dashboard.getByTestId("webhook-editor-paystack");
    const input = editor.getByRole("textbox", { name: "Webhook URL" });
    await input.fill("http://10.0.0.1/hook");
    await editor.getByRole("button", { name: "Save webhook URL" }).click();
    await expect(editor.getByText(/a private network address/u)).toBeVisible();
    await expect(
      editor.locator(".error-details").getByText(/--allow-private-webhooks/u),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Webhooks private address refusal");

    await input.fill("http://203.0.113.1/hook");
    await editor.getByRole("button", { name: "Save webhook URL" }).click();
    await expect(editor.getByText(/a public address/u)).toBeVisible();
    await expect(
      editor.locator(".error-details").getByText(/--allow-public-webhooks/u),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Webhooks public address refusal");
  });
});

test.describe("T8 Data", () => {
  test("T8 Data loads empty tables", async ({ dashboard }) => {
    await gotoPage(dashboard, "Data");
    await expect(dashboard.getByText("No records yet.").first()).toBeVisible();
    await expect(
      dashboard.getByText("Make a test request to see records here.").first(),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Data empty");
  });

  test("T8 Data shows real records from each twin and resets with confirmation", async ({
    dashboard,
    ibejiSession,
  }) => {
    const references: string[] = [];
    for (const twin of twins) {
      const reference = `data-${twin.id}-${Date.now()}`;
      references.push(reference);
      await seedPayment(ibejiSession.session, twin.id, reference);
    }
    await gotoPage(dashboard, "Data");
    for (const twin of twins) {
      await expect(dashboard.getByTestId(`data-twin-${twin.id}`)).toBeVisible();
    }
    for (const reference of references) {
      await expect(dashboard.getByText(reference, { exact: true }).first()).toBeVisible();
    }
    await expectNoSeriousAxe(dashboard, "Data with records");

    await dashboard.getByRole("button", { name: "Reset all records" }).click();
    const dialog = dashboard.locator("dialog");
    await expect(dashboard.getByRole("heading", { name: "Reset all twin records?" })).toBeVisible();
    await expect(dialog.getByText(/This cannot be undone./u)).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Data reset confirmation");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dashboard.getByText(references[0] ?? "", { exact: true }).first()).toBeVisible();

    await dashboard.getByRole("button", { name: "Reset all records" }).click();
    await dialog.getByRole("button", { name: "Reset all records" }).click();
    await expect(
      dashboard.getByText("Records reset. Queued webhooks were marked abandoned."),
    ).toBeVisible();
    await expect(dashboard.getByText("No records yet.").first()).toBeVisible();
    await expectNoSeriousAxe(dashboard, "Data after reset");
  });
});
