import type { WebhookDelivery } from "../../src/shared/control.js";
import { registry } from "../../src/twins/registry.js";
import { expect, gotoPage, selectTwin, test } from "./fixtures.js";
import { listWebhooks } from "./support/api.js";
import { expectNoSeriousAxe } from "./support/assertions.js";
import { driverFor, type PaymentHandle, type TwinDriver } from "./support/journey.js";
import type { LocalServer } from "./support/local-server.js";
import type { UiSession } from "./support/session.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function payOnCheckout(
  page: import("@playwright/test").Page,
  driver: TwinDriver,
  ui: UiSession,
  receiver: LocalServer,
  reference: string,
): Promise<PaymentHandle> {
  const payment = await driver.createPayment(ui.session, reference, `${receiver.url}/callback`);
  await page.goto(payment.checkoutUrl);
  await expect(
    page.getByRole("heading", {
      name: `Ibeji test checkout: ${driver.displayName} twin. No real money moves.`,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: driver.checkoutSuccessLabel }).click();
  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(receiver.url)}/callback`, "u"), {
    timeout: 10_000,
  });
  await expect(page.getByText("Local test receiver")).toBeVisible();
  return payment;
}

async function returnToApp(
  page: import("@playwright/test").Page,
  ui: UiSession,
  path: string,
  title: string,
  twinId: string,
): Promise<void> {
  await page.goto(`${ui.session.addresses.control.url}${path}?twin=${encodeURIComponent(twinId)}`);
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await page.bringToFront();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 10_000 });
}

for (const definition of registry.list()) {
  test(`T8 ${definition.id} journey: connect, pay, inspect, delay the webhook and resend`, async ({
    dashboard,
    ibejiSession,
    receiver,
  }) => {
    test.setTimeout(60_000);
    const driver = driverFor(definition.id);

    await selectTwin(dashboard, definition.displayName);
    await gotoPage(dashboard, "Connect your app");
    await expect(
      dashboard.getByRole("heading", { name: `Connect ${definition.displayName}` }),
    ).toBeVisible();
    const editor = dashboard.getByTestId(`webhook-editor-${definition.id}`);
    await editor.getByRole("textbox", { name: "Webhook URL" }).fill(`${receiver.url}/webhook`);
    await editor.getByRole("button", { name: "Save webhook URL" }).click();
    await expect(editor.getByText("Webhook URL saved.")).toBeVisible();

    const firstReference = `journey-${definition.id}-one-${Date.now()}`;
    await payOnCheckout(dashboard, driver, ibejiSession, receiver, firstReference);
    await receiver.waitForRequest(
      (request) => request.path === "/webhook" && request.body.includes(firstReference),
      10_000,
    );
    await returnToApp(dashboard, ibejiSession, "/connect", "Connect your app", definition.id);

    await gotoPage(dashboard, "Live activity");
    await expect(
      dashboard
        .getByTestId("event-row")
        .filter({ hasText: definition.displayName })
        .filter({ hasText: /Submit the/u })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      dashboard.getByText(
        new RegExp(
          `${definition.displayName} twin: Submit the ${definition.displayName} test checkout page responded with HTTP (200|303)`,
          "u",
        ),
      ),
    ).toBeVisible();
    await expectNoSeriousAxe(dashboard, `${definition.displayName} journey Live activity`);

    await gotoPage(dashboard, "Data");
    await expect(dashboard.getByText(firstReference, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expectNoSeriousAxe(dashboard, `${definition.displayName} journey Data`);

    await gotoPage(dashboard, "Failures");
    const card = dashboard.getByTestId("failure-webhook-delayed");
    await expect(card).toBeVisible();
    await card.getByLabel(/Seconds/u).fill("8");
    await card.getByLabel(/Extra random delay/u).fill("0");
    await card.getByRole("switch", { name: `Switch on ${definition.displayName}` }).click();
    await expect(card.locator(".status-pill")).toHaveText("On");
    await expect(dashboard.getByText("Late webhook switched on.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, `${definition.displayName} journey Failures`);

    const secondReference = `journey-${definition.id}-two-${Date.now()}`;
    await payOnCheckout(dashboard, driver, ibejiSession, receiver, secondReference);

    const scheduled = await waitForDelivery(ibejiSession, definition.id, secondReference);
    expect(scheduled.status).toBe("scheduled");
    await returnToApp(dashboard, ibejiSession, "/webhooks", "Webhooks", definition.id);
    const scheduledCard = dashboard
      .getByTestId(/^delivery-/u)
      .filter({ hasText: secondReference })
      .first();
    await expect(scheduledCard).toBeVisible({ timeout: 10_000 });
    await expect(scheduledCard.getByText("Waiting for retry")).toBeVisible();
    await expectNoSeriousAxe(dashboard, `${definition.displayName} journey Webhooks waiting`);

    const late = await receiver.waitForRequest(
      (request) => request.path === "/webhook" && request.body.includes(secondReference),
      15_000,
    );
    expect(late.receivedAt - scheduled.createdAt).toBeGreaterThanOrEqual(7_000);

    const delivered = await waitForDelivery(
      ibejiSession,
      definition.id,
      secondReference,
      "delivered",
    );
    expect(delivered.attempts.length).toBeGreaterThan(0);
    expect(delivered.attempts[0]?.responseStatus).toBe(200);

    await dashboard.reload();
    await expect(dashboard.getByRole("heading", { name: "Webhooks", level: 1 })).toBeVisible();
    const deliveredCard = dashboard
      .getByTestId(/^delivery-/u)
      .filter({ hasText: secondReference })
      .first();
    await expect(deliveredCard).toBeVisible({ timeout: 10_000 });
    await expect(deliveredCard.locator(".status-pill")).toHaveText("Delivered");
    await deliveredCard.getByText("Show attempts").click();
    await expect(deliveredCard.getByText("HTTP 200.")).toBeVisible();
    await expectNoSeriousAxe(dashboard, `${definition.displayName} journey Webhooks delivered`);
  });
}

async function waitForDelivery(
  ui: UiSession,
  twinId: string,
  reference: string,
  status?: string,
): Promise<WebhookDelivery> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const deliveries = await listWebhooks(ui, twinId);
    const delivery = deliveries.find((item) => item.raw.body.includes(reference));
    if (delivery !== undefined && (status === undefined || delivery.status === status)) {
      return delivery;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No ${status ?? "any"} webhook delivery for ${reference} arrived within 10 seconds.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
