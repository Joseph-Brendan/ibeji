import { expect, type Page, test } from "@playwright/test";

import { FakeClock } from "../../src/core/clock.js";
import type { WebhookDelivery } from "../../src/shared/control.js";
import { type ControlSessionHarness, startControlSession } from "../helpers/control.js";

async function openPage(page: Page, harness: ControlSessionHarness, name: string): Promise<void> {
  await page.goto(harness.session.createLaunchLink());
  await page.getByRole("heading", { name: "Home" }).waitFor();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

function webhookDelivery(): WebhookDelivery {
  const now = Date.now();
  return {
    id: "delivery-1",
    eventId: "paystack-charge.success-ref-1-1700000000000",
    twinId: "paystack",
    actionId: "transaction.initialize",
    raw: {
      body: JSON.stringify({ event: "charge.success", data: { status: "success" } }),
      contentType: "application/json",
    },
    status: "delivered",
    attempts: [
      {
        attempt: 1,
        startedAt: now - 1_000,
        finishedAt: now,
        outcome: "delivered",
        requestUrl: "http://127.0.0.1:3000/hook",
        remoteAddress: "127.0.0.1",
        responseStatus: 200,
        responseHeaders: { "content-type": "text/plain" },
        responseBody: "ok",
        error: undefined,
        errorCode: undefined,
      },
    ],
    createdAt: now,
    scheduledAt: undefined,
    holdUntil: undefined,
    failureMethod: undefined,
    resendOf: undefined,
    reason: undefined,
    url: "http://127.0.0.1:3000/hook",
    sequence: 1,
  };
}

test("T8 Connect your app checks each twin without contacting the app", async ({ page }) => {
  const harness = await startControlSession({ clock: new FakeClock(Date.now()) });
  try {
    await openPage(page, harness, "Connect your app");
    await expect(page.getByText("Choose a twin to connect.")).toBeVisible();
    await expect(page.getByTestId("guide-card-paystack")).toBeVisible();
    await expect(page.getByTestId("guide-card-flutterwave")).toBeVisible();
    await page.getByTestId("guide-card-paystack").click();
    await expect(page.getByRole("heading", { name: "Connect Paystack" })).toBeVisible();
    await expect(
      page.getByText("No requests have reached Paystack in the last 5 minutes."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy base URL for Paystack" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Copy Public key for Paystack/iu }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy instruction for Paystack" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What to change in your app" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Safety first" })).toBeVisible();

    await page
      .getByRole("navigation", { name: "Choose a twin" })
      .getByRole("link", { name: /Flutterwave/u })
      .click();
    await expect(page.getByRole("heading", { name: "Connect Flutterwave" })).toBeVisible();
    await expect(page.getByTestId("webhook-editor-paystack")).toHaveCount(0);
    await expect(page.getByTestId("webhook-editor-flutterwave")).toBeVisible();
    await expect(
      page.getByText("No requests have reached Flutterwave in the last 5 minutes."),
    ).toBeVisible();

    const paystack = harness.session.addresses.twins.paystack;
    const flutterwave = harness.session.addresses.twins.flutterwave;
    expect(paystack).toBeDefined();
    expect(flutterwave).toBeDefined();
    if (paystack === undefined || flutterwave === undefined) {
      throw new Error("both twins must be running");
    }

    await fetch(`${paystack.url}/transaction/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await fetch(`${flutterwave.url}/v3/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    await expect(page.getByText(/Last request: POST \/v3\/payments at/u)).toBeVisible();
    await page
      .getByRole("navigation", { name: "Choose a twin" })
      .getByRole("link", { name: /Paystack/u })
      .click();
    await expect(page.getByText(/Last request: POST \/transaction\/initialize at/u)).toBeVisible();
    await expect(page.getByText(/Ibeji answered with HTTP 401/u)).toBeVisible();
    await page.getByRole("button", { name: "Check again" }).click();

    const editor = page.getByTestId("webhook-editor-paystack");
    await editor.getByRole("textbox", { name: "Webhook URL" }).fill("http://127.0.0.1:3000/hook");
    await editor.getByRole("button", { name: "Save webhook URL" }).click();
    await expect(editor.getByText("Webhook URL saved.")).toBeVisible();

    await page
      .getByRole("navigation", { name: "Choose a twin" })
      .getByRole("link", { name: /Flutterwave/u })
      .click();
    const flutterwaveEditor = page.getByTestId("webhook-editor-flutterwave");
    await expect(flutterwaveEditor.getByRole("textbox", { name: "Webhook URL" })).toHaveValue("");
    await expect(flutterwaveEditor.getByText("No webhook URL set.")).toBeVisible();

    await page
      .getByRole("navigation", { name: "Choose a twin" })
      .getByRole("link", { name: /Paystack/u })
      .click();
    await expect(editor.getByRole("textbox", { name: "Webhook URL" })).toHaveValue(
      "http://127.0.0.1:3000/hook",
    );
    await editor.getByRole("button", { name: "Clear webhook URL" }).click();
    await expect(editor.getByText("Webhook URL cleared.")).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 Webhooks shows address rule failures for private and public URLs", async ({ page }) => {
  const harness = await startControlSession({});
  try {
    await openPage(page, harness, "Webhooks");
    await expect(page.getByTestId("webhook-editor-paystack")).toBeVisible();
    await expect(page.getByTestId("webhook-editor-flutterwave")).toBeVisible();
    const editor = page.getByTestId("webhook-editor-paystack");

    await editor.getByRole("textbox", { name: "Webhook URL" }).fill("http://10.0.0.1/hook");
    await editor.getByRole("button", { name: "Save webhook URL" }).click();
    await expect(
      page.getByRole("heading", { name: "We couldn't save that webhook URL." }),
    ).toBeVisible();
    await expect(editor.getByText(/a private network address/u)).toBeVisible();
    await expect(
      editor.locator(".error-details").getByText(/--allow-private-webhooks/u),
    ).toBeVisible();

    await editor.getByRole("textbox", { name: "Webhook URL" }).fill("http://203.0.113.1/hook");
    await editor.getByRole("button", { name: "Save webhook URL" }).click();
    await expect(editor.getByText(/a public address/u)).toBeVisible();
    await expect(
      editor.locator(".error-details").getByText(/--allow-public-webhooks/u),
    ).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 Webhooks shows a delivery, its response and resends it", async ({ page }) => {
  const harness = await startControlSession({});
  try {
    const delivery = webhookDelivery();
    await page.route(/\/_ibeji\/api\/v1\/webhooks$/u, async (route) => {
      await route.fulfill({ json: { deliveries: [delivery] } });
    });
    await page.route(/\/_ibeji\/api\/v1\/webhooks\/delivery-1\/resend$/u, async (route) => {
      await route.fulfill({ json: { delivery } });
    });

    await openPage(page, harness, "Webhooks");
    const card = page.getByTestId("delivery-delivery-1");
    await expect(card).toBeVisible();
    await expect(card.getByText("Delivered", { exact: true })).toBeVisible();
    await expect(card.getByText("Charge success")).toBeVisible();
    await expect(card.getByText(/1 attempt/u)).toBeVisible();

    await card.getByText("Show attempts").click();
    await expect(card.getByText("Attempt 1")).toBeVisible();
    await expect(card.getByText("HTTP 200.")).toBeVisible();
    await expect(card.getByText("First 4 KB of the response")).toBeVisible();
    await expect(card.getByText("ok", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Resend" }).click();
    await expect(page.getByText("Delivery queued again.")).toBeVisible();

    await page.getByLabel("Status").selectOption("unreachable");
    await expect(page.getByText("No deliveries match this status.")).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 a live-key warning names the service, hides the key and returns after another key", async ({
  page,
}) => {
  const harness = await startControlSession({});
  try {
    const paystack = harness.session.addresses.twins.paystack;
    const flutterwave = harness.session.addresses.twins.flutterwave;
    if (paystack === undefined || flutterwave === undefined) {
      throw new Error("both twins must be running");
    }

    await page.goto(harness.session.createLaunchLink());
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

    const firstKey = ["sk", "live", "firstBannerKey000000000"].join("_");
    await fetch(`${paystack.url}/transaction/initialize`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstKey}` },
    });
    const paystackBanner = page.locator(".live-key-banner").filter({ hasText: "Paystack" });
    await expect(paystackBanner).toBeVisible();
    await expect(paystackBanner).toContainText(
      "A live key was sent to the Paystack twin. Live keys must never be used with Ibeji.",
    );
    await expect(paystackBanner.locator("code")).toHaveText(/^[0-9a-f]{8}$/u);
    await expect(
      paystackBanner.getByRole("link", { name: "Read the safety guidance" }),
    ).toHaveAttribute("href", "/connect#safety");
    expect(await page.locator("body").textContent()).not.toContain(firstKey);
    await expect(page.locator(".live-key-banners")).toHaveCSS(
      "background-color",
      "rgb(143, 29, 33)",
    );

    await paystackBanner
      .getByRole("button", { name: "Dismiss live-key warning for Paystack" })
      .click();
    await expect(paystackBanner).not.toBeVisible();

    await page.getByRole("link", { name: "Webhooks", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Webhooks", level: 1 })).toBeVisible();

    const flutterwaveKey = "FLWSECK-liveFlutterwaveKey000000000";
    await fetch(`${flutterwave.url}/v3/payments`, {
      method: "POST",
      headers: { authorization: `Bearer ${flutterwaveKey}` },
    });
    const flutterwaveBanner = page.locator(".live-key-banner").filter({ hasText: "Flutterwave" });
    await expect(flutterwaveBanner).toBeVisible();
    expect(await page.locator("body").textContent()).not.toContain(flutterwaveKey);
    await flutterwaveBanner
      .getByRole("button", { name: "Dismiss live-key warning for Flutterwave" })
      .click();

    const secondKey = ["sk", "live", "secondBannerKey00000000"].join("_");
    await fetch(`${paystack.url}/transaction/initialize`, {
      method: "POST",
      headers: { authorization: `Bearer ${secondKey}` },
    });
    await expect(page.locator(".live-key-banner").filter({ hasText: "Paystack" })).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});

test("T8 saving a loopback webhook URL succeeds and can be cleared", async ({ page }) => {
  const harness = await startControlSession({});
  try {
    await openPage(page, harness, "Webhooks");
    const editor = page.getByTestId("webhook-editor-paystack");
    await editor
      .getByRole("textbox", { name: "Webhook URL" })
      .fill("http://127.0.0.1:3000/ibeji-hook");
    await editor.getByRole("button", { name: "Save webhook URL" }).click();
    await expect(page.getByText("Webhook URL saved.")).toBeVisible();
    await expect(editor.getByText("Saved address.")).toBeVisible();

    await editor.getByRole("button", { name: "Clear webhook URL" }).click();
    await expect(page.getByText("Webhook URL cleared.")).toBeVisible();
    await expect(editor.getByText("No webhook URL set.")).toBeVisible();
  } finally {
    await harness.cleanup();
  }
});
