import { fingerprint } from "../../src/core/redact.js";
import { expect, test } from "./fixtures.js";

const TEST_KEYS = [
  "pk_live_UI_REMOVAL_PAYSTACK_PUBLIC_1234567890",
  "sk_live_UI_REMOVAL_PAYSTACK_SECRET_1234567890",
  "FLWPUBK-UI_REMOVAL_FLUTTERWAVE_PUBLIC_1234567890",
  "FLWSECK-UI_REMOVAL_FLUTTERWAVE_SECRET_1234567890",
  "pk_live_UI_REMOVAL_STRIPE_PUBLIC_1234567890",
  "sk_live_UI_REMOVAL_STRIPE_SECRET_1234567890",
  "rk_live_UI_REMOVAL_STRIPE_RESTRICTED_1234567890",
] as const;

function keyPieces(key: string): readonly string[] {
  const pieces: string[] = [];
  for (let index = 0; index <= key.length - 12; index += 1) {
    pieces.push(key.slice(index, index + 12));
  }
  return pieces;
}

function containsKeyPiece(text: string, key: string): boolean {
  return keyPieces(key).some((piece) => text.includes(piece));
}

test("T6/D43 the Live activity and Data pages show only fingerprints", async ({
  dashboard,
  ibejiSession,
}) => {
  const session = ibejiSession.session;
  const paystack = session.twins.get("paystack");
  const flutterwave = session.twins.get("flutterwave");
  expect(paystack).toBeDefined();
  expect(flutterwave).toBeDefined();
  if (paystack === undefined || flutterwave === undefined) {
    throw new Error("expected both twins");
  }
  const paystackAddress = paystack.address.url;
  const flutterwaveAddress = flutterwave.address.url;
  const paystackSecret = session.credentials.paystack?.secret ?? "";
  const flutterwaveSecret = session.credentials.flutterwave?.secret ?? "";

  for (const [index, key] of TEST_KEYS.entries()) {
    const paystackResponse = await fetch(
      `${paystackAddress}/transaction/initialize?note=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${paystackSecret}`,
          "content-type": "application/json",
          "x-review-key": key,
        },
        body: JSON.stringify({
          email: key,
          amount: "10000",
          reference: `ui-removal-paystack-${index}`,
          metadata: { nested: { note: key } },
          callback_url: "http://127.0.0.1:1/return",
        }),
      },
    );
    expect(paystackResponse.status, `Paystack request ${index}`).toBe(200);
    const paystackBody = (await paystackResponse.json()) as {
      data?: { authorization_url?: string };
    };
    const authorizationUrl = paystackBody.data?.authorization_url;
    expect(authorizationUrl).toBeDefined();
    if (authorizationUrl !== undefined) {
      const checkout = await fetch(authorizationUrl, {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: paystackAddress,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "outcome=success",
      });
      expect(checkout.status).toBeLessThan(400);
    }

    const flutterwaveResponse = await fetch(
      `${flutterwaveAddress}/v3/payments?note=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${flutterwaveSecret}`,
          "content-type": "application/json",
          "x-review-key": key,
        },
        body: JSON.stringify({
          amount: 7500,
          tx_ref: `ui-removal-flutterwave-${index}`,
          currency: "NGN",
          redirect_url: "http://127.0.0.1:1/return",
          customer: { email: key },
          meta: { nested: { note: key } },
        }),
      },
    );
    expect(flutterwaveResponse.status, `Flutterwave request ${index}`).toBe(200);
    const flutterwaveBody = (await flutterwaveResponse.json()) as {
      data?: { link?: string };
    };
    const checkoutLink = flutterwaveBody.data?.link;
    expect(checkoutLink).toBeDefined();
    if (checkoutLink !== undefined) {
      const checkout = await fetch(checkoutLink, {
        method: "POST",
        redirect: "manual",
        headers: {
          origin: flutterwaveAddress,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "outcome=success",
      });
      expect(checkout.status).toBeLessThan(400);
    }
  }

  await dashboard.getByRole("link", { name: "Live activity", exact: true }).click();
  await expect(dashboard.getByRole("heading", { name: "Live activity", level: 1 })).toBeVisible();
  const liveText = (await dashboard.locator("body").textContent()) ?? "";
  for (const key of TEST_KEYS) {
    expect(containsKeyPiece(liveText, key), "Live activity contains a key piece").toBe(false);
  }
  expect(liveText).toContain(`[live key removed: ${fingerprint(TEST_KEYS[0])}]`);

  await dashboard.getByRole("link", { name: "Data", exact: true }).click();
  await expect(dashboard.getByRole("heading", { name: "Data", level: 1 })).toBeVisible();
  const dataText = (await dashboard.locator("body").textContent()) ?? "";
  for (const key of TEST_KEYS) {
    expect(containsKeyPiece(dataText, key), "Data contains a key piece").toBe(false);
  }
});
