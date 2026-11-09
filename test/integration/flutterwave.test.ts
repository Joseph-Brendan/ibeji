import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { fingerprint } from "../../src/core/redact.js";
import { flutterwavePaymentSchema } from "../../src/twins/flutterwave/state.js";
import {
  authorizationHeader,
  checkout,
  checkoutPage,
  createPayment,
  FLUTTERWAVE_TEST_CREDENTIALS,
  type FlutterwaveHarness,
  listPayments,
  paymentRecord,
  seedPayment,
  startFlutterwave,
  verifyPayment,
  verifyPaymentByReference,
} from "../helpers/flutterwave.js";

async function withHarness(run: (harness: FlutterwaveHarness) => Promise<void>): Promise<void> {
  const harness = await startFlutterwave();
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

describe("Flutterwave authentication and credentials", () => {
  it("C4/T6 rejects missing, wrong, public and live keys with Flutterwave's shape", async () => {
    await withHarness(async (harness) => {
      const missing = await fetch(`http://127.0.0.1:${harness.running.port}/v3/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(missing.status).toBe(401);
      expect(await missing.json()).toEqual({
        status: "error",
        message: "Authorization required",
        data: null,
      });

      for (const key of ["FLWSECK_TEST-ibeji_wrong_0001", FLUTTERWAVE_TEST_CREDENTIALS.public]) {
        const response = await fetch(`http://127.0.0.1:${harness.running.port}/v3/payments`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: "{}",
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          status: "error",
          message: "Invalid authorization key",
          data: null,
        });
      }

      const liveKey = "FLWSECK-liveMustNeverWork000000000";
      const live = await fetch(`http://127.0.0.1:${harness.running.port}/v3/payments`, {
        method: "POST",
        headers: { authorization: `Bearer ${liveKey}`, "content-type": "application/json" },
        body: "{}",
      });
      expect(live.status).toBe(401);
      const warning = harness.events.after(0).find((event) => event.type === "warning");
      expect(warning?.details.fingerprint).toBe(fingerprint(liveKey));
      expect(JSON.stringify(warning)).not.toContain(liveKey);
    });
  });

  it("C7 issues Flutterwave public, secret and webhook test values marked as Ibeji", async () => {
    await withHarness(async (harness) => {
      const specs = harness.running.definition.credentials;
      expect(specs.map((spec) => spec.id)).toEqual(["public", "secret", "webhook"]);
      const random = {
        bytes: (length: number) => new Uint8Array(length).fill(7),
      };
      for (const spec of specs) {
        const value = spec.generate(random);
        expect(value.includes("ibeji")).toBe(true);
        expect(spec.isTestFormat(value)).toBe(true);
        expect(spec.isTestFormat(FLUTTERWAVE_TEST_CREDENTIALS[spec.id] ?? "")).toBe(true);
      }
    });
  });
});

describe("Flutterwave hosted payments and checkout", () => {
  it("C4 creates a hosted payment link to the Flutterwave twin checkout", async () => {
    await withHarness(async (harness) => {
      const response = await createPayment(harness, {
        amount: "7500",
        tx_ref: "checkout-flow",
        currency: "NGN",
        redirect_url: "https://example.com/ibeji/flutterwave",
        customer: {
          email: "customer.one@example.com",
          name: "Test Name 1",
        },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; data: { link: string } };
      expect(body.status).toBe("success");
      expect(body.data.link).toBe(
        `http://127.0.0.1:${harness.running.port}/checkout/checkout-flow`,
      );
      const record = paymentRecord(harness, "checkout-flow");
      expect(record?.amount).toBe(750_000);
      expect(record?.status).toBe("unpaid");
    });
  });

  it("C10 serves the Ibeji checkout page with Flutterwave outcomes", async () => {
    await withHarness(async (harness) => {
      await seedPayment(harness, "checkout-page", { amount: "7500" });
      const page = await checkoutPage(harness, "checkout-page");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Ibeji test checkout: Flutterwave twin");
      expect(html).toContain("No real money moves");
      expect(html).toContain("₦7,500.00");
      expect(html).toContain("customer.one@example.com");
      expect(html).toContain("checkout-page");
      expect(html).toContain("Pay successfully");
      expect(html).toContain("Fail payment");
      expect(html).toContain("Cancel payment");
      expect(html).not.toContain("https://checkout.flutterwave.com");
    });
  });

  it("C4/C10 success updates the payment, sends charge.completed and redirects", async () => {
    await withHarness(async (harness) => {
      await seedPayment(harness, "checkout-success", { amount: "7500" });
      const response = await checkout(harness, "checkout-success", "success");
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("location") as string);
      expect(location.origin).toBe("https://example.com");
      expect(location.searchParams.get("status")).toBe("successful");
      expect(location.searchParams.get("tx_ref")).toBe("checkout-success");
      expect(location.searchParams.get("transaction_id")).toBe(
        String(paymentRecord(harness, "checkout-success")?.transactionId),
      );

      const verified = (await (
        await verifyPaymentByReference(harness, "checkout-success")
      ).json()) as {
        data: {
          status: string;
          amount: number;
          app_fee: number;
          card: { token: string; first_6digits: string; last_4digits: string };
        };
      };
      expect(verified.data.status).toBe("successful");
      expect(verified.data.amount).toBe(7500);
      expect(verified.data.app_fee).toBe(105);
      expect(verified.data.card.first_6digits).toBe("553188");
      expect(verified.data.card.last_4digits).toBe("2950");
      expect(typeof verified.data.card.token).toBe("string");
      expect(harness.drafts).toHaveLength(1);
      const successDraft = harness.drafts[0];
      if (successDraft === undefined) {
        throw new Error("expected a charge.completed webhook draft");
      }
      expect(successDraft.key).toBe("charge.completed");
      const webhookData = successDraft.data as {
        status: string;
        meta?: unknown;
        amount_settled?: unknown;
        customer: unknown;
        card: { token?: unknown };
      };
      expect(webhookData.status).toBe("successful");
      expect(webhookData.meta).toBeUndefined();
      expect(webhookData.amount_settled).toBeUndefined();
      expect(webhookData.card.token).toBeUndefined();
      expect(typeof webhookData.customer).toBe("object");
    });
  });

  it("C4/C10 failed and cancelled both produce Flutterwave's failed result", async () => {
    await withHarness(async (harness) => {
      await seedPayment(harness, "checkout-failed", { amount: "7500" });
      const failed = await checkout(harness, "checkout-failed", "failed");
      expect(failed.status).toBe(303);
      expect(new URL(failed.headers.get("location") as string).searchParams.get("status")).toBe(
        "failed",
      );

      await seedPayment(harness, "checkout-cancelled", { amount: "7500" });
      const cancelled = await checkout(harness, "checkout-cancelled", "cancelled");
      expect(cancelled.status).toBe(303);
      expect(new URL(cancelled.headers.get("location") as string).searchParams.get("status")).toBe(
        "failed",
      );

      for (const txRef of ["checkout-failed", "checkout-cancelled"]) {
        const record = paymentRecord(harness, txRef);
        expect(record?.status).toBe("failed");
        const verified = (await (
          await verifyPayment(harness, record?.transactionId as number)
        ).json()) as { data: { status: string; card: { token?: string } } };
        expect(verified.data.status).toBe("failed");
        expect(verified.data.card.token).toBeUndefined();
      }

      expect(harness.drafts).toHaveLength(2);
      expect(harness.drafts.map((draft) => draft.key)).toEqual([
        "charge.completed",
        "charge.completed",
      ]);
      expect(
        harness.drafts.every((draft) => (draft.data as { status: string }).status === "failed"),
      ).toBe(true);
    });
  });

  it("D52 returns the recorded failed-payment fee and card", async () => {
    const recorded = JSON.parse(
      await readFile("fixtures/flutterwave/payment-verify-by-reference-failed.json", "utf8"),
    ) as {
      responseBody: {
        data: {
          app_fee: number;
          card: { first_6digits: string; last_4digits: string };
        };
      };
    };
    await withHarness(async (harness) => {
      await seedPayment(harness, "checkout-fee-failed", {
        amount: "7500",
        outcome: "failed",
      });
      const response = await verifyPaymentByReference(harness, "checkout-fee-failed");
      const body = (await response.json()) as {
        data: {
          app_fee: number;
          card: { first_6digits: string; last_4digits: string };
        };
      };
      expect(body.data.app_fee).toBe(recorded.responseBody.data.app_fee);
      expect(body.data.card.first_6digits).toBe(recorded.responseBody.data.card.first_6digits);
      expect(body.data.card.last_4digits).toBe(recorded.responseBody.data.card.last_4digits);
    });
  });

  it("C4 refuses to verify an unpaid hosted payment", async () => {
    await withHarness(async (harness) => {
      const record = await seedPayment(harness, "checkout-unpaid", { amount: "7500" });
      for (const response of [
        await verifyPaymentByReference(harness, "checkout-unpaid"),
        await verifyPayment(harness, record.transactionId),
      ]) {
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          status: "error",
          message: "No transaction was found for this id",
          data: null,
        });
      }
    });
  });

  it("C4 lists only transactions that reached a checkout outcome and filters them", async () => {
    await withHarness(async (harness) => {
      await seedPayment(harness, "list-success", {
        amount: "1000",
        outcome: "success",
        email: "success@example.com",
      });
      await seedPayment(harness, "list-failed", {
        amount: "2000",
        outcome: "failed",
        email: "failed@example.com",
      });
      await seedPayment(harness, "list-unpaid", { amount: "3000" });

      const all = (await (await listPayments(harness)).json()) as {
        data: unknown[];
        meta: { page_info: { total: number; current_page: number; total_pages: number } };
      };
      expect(all.data).toHaveLength(2);
      expect(all.meta.page_info.total).toBe(2);
      expect(all.meta.page_info.current_page).toBe(1);
      expect(all.meta.page_info.total_pages).toBe(1);

      const failed = (await (
        await listPayments(harness, "?status=failed&customer_email=failed@example.com")
      ).json()) as { data: Array<{ tx_ref: string; id: string; amount: number }> };
      expect(failed.data).toHaveLength(1);
      expect(failed.data[0]?.tx_ref).toBe("list-failed");
      expect(typeof failed.data[0]?.id).toBe("string");
      expect(failed.data[0]?.amount).toBe(2000);
    });
  });

  it("C4 emits a plain-English Flutterwave payment summary", async () => {
    await withHarness(async (harness) => {
      await seedPayment(harness, "summary-payment", { amount: "7500" });
      const requestEvent = harness.events
        .after(0)
        .find((event) => event.type === "request" && event.details.actionId === "payment.create");
      expect(requestEvent?.summary).toBe(
        "Your app started a Flutterwave payment of ₦7,500.00 for customer.one@example.com",
      );
    });
  });

  it("C4 stores main-unit amounts as smallest-unit integers", async () => {
    await withHarness(async (harness) => {
      const created = await createPayment(harness, {
        amount: "12.34",
        tx_ref: "money-units",
        currency: "USD",
        redirect_url: "https://example.com/ibeji/flutterwave",
        customer: { email: "money@example.com" },
      });
      expect(created.status).toBe(200);
      expect(paymentRecord(harness, "money-units")?.amount).toBe(1_234);
      await checkout(harness, "money-units", "success");
      const verified = (await (await verifyPaymentByReference(harness, "money-units")).json()) as {
        data: { amount: number };
      };
      expect(verified.data.amount).toBe(12.34);
    });
  });

  it("C4 rejects too many decimal places in Flutterwave's error shape", async () => {
    await withHarness(async (harness) => {
      const response = await createPayment(harness, {
        amount: "12.345",
        tx_ref: "money-too-many-decimals",
        currency: "USD",
        redirect_url: "https://example.com/ibeji/flutterwave",
        customer: { email: "money@example.com" },
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { status: string; message: string; data: unknown };
      expect(body.status).toBe("error");
      expect(body.message).toContain("2 decimal");
      expect(body.data).toBeNull();
    });
  });

  it("C4 reads a decimal JSON number from the request text and refuses duplicate tx_ref", async () => {
    await withHarness(async (harness) => {
      const body = {
        amount: 12.34,
        tx_ref: "money-json-number",
        currency: "USD",
        redirect_url: "https://example.com/ibeji/flutterwave",
        customer: { email: "money@example.com" },
      };
      const first = await createPayment(harness, body);
      expect(first.status).toBe(200);
      expect(paymentRecord(harness, "money-json-number")?.amount).toBe(1_234);

      const duplicate = await createPayment(harness, body);
      expect(duplicate.status).toBe(400);
      expect(await duplicate.json()).toEqual({
        status: "error",
        message: "tx_ref has already been used",
        data: null,
      });
    });
  });
});

describe("T4 Flutterwave request failures", () => {
  it("T4 slow-response delays the reply through the injected clock", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "slow-response",
        twins: ["flutterwave"],
        actions: "payment.list",
        settings: { seconds: 1 },
      });
      const pending = listPayments(harness);
      for (let step = 0; step < 20; step += 1) {
        harness.clock.advanceBy(1_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect((await pending).status).toBe(200);
    });
  });

  it("T4 timeout-before-commit performs no action", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "timeout-before-commit",
        twins: ["flutterwave"],
        actions: "payment.create",
        settings: { mode: "reset" },
      });
      await expect(
        createPayment(harness, {
          amount: "7500",
          tx_ref: "timeout-before",
          redirect_url: "https://example.com/ibeji/flutterwave",
          customer: { email: "customer.one@example.com" },
        }),
      ).rejects.toThrow();
      expect(paymentRecord(harness, "timeout-before")).toBeUndefined();
    });
  });

  it("T4 timeout-after-commit keeps the created payment", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "timeout-after-commit",
        twins: ["flutterwave"],
        actions: "payment.create",
        settings: { mode: "reset" },
      });
      await expect(
        createPayment(harness, {
          amount: "7500",
          tx_ref: "timeout-after",
          redirect_url: "https://example.com/ibeji/flutterwave",
          customer: { email: "customer.one@example.com" },
        }),
      ).rejects.toThrow();
      const record = paymentRecord(harness, "timeout-after");
      expect(record?.status).toBe("unpaid");
      expect(record?.amount).toBe(750_000);
    });
  });

  it("T4 server-error uses Flutterwave's app_error shape", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "server-error",
        twins: ["flutterwave"],
        actions: "payment.create",
      });
      const response = await createPayment(harness, {});
      expect(response.status).toBe(500);
      const body = (await response.json()) as {
        error_id: string;
        message: string;
        code: string;
      };
      expect(body.code).toBe("app_error");
      expect(body.message).toBe("Application error. Please contact support");
      expect(typeof body.error_id).toBe("string");
    });
  });

  it("T4 rate-limited uses Flutterwave's error shape", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "rate-limited",
        twins: ["flutterwave"],
        actions: "payment.create",
      });
      const response = await createPayment(harness, {});
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        status: "error",
        message: "Too many requests",
        data: null,
      });
    });
  });

  it("T4 flaky-network drops before and after the action", async () => {
    await withHarness(async (harness) => {
      const before = harness.rules.add({
        failureId: "flaky-network",
        twins: ["flutterwave"],
        actions: "payment.create",
        settings: { percent: 100, when: "before" },
      });
      await expect(
        createPayment(harness, {
          amount: "7500",
          tx_ref: "flaky-before",
          redirect_url: "https://example.com/ibeji/flutterwave",
          customer: { email: "customer.one@example.com" },
        }),
      ).rejects.toThrow();
      expect(paymentRecord(harness, "flaky-before")).toBeUndefined();
      harness.rules.remove(before.id);

      const after = harness.rules.add({
        failureId: "flaky-network",
        twins: ["flutterwave"],
        actions: "payment.create",
        settings: { percent: 100, when: "after" },
      });
      await expect(
        createPayment(harness, {
          amount: "7500",
          tx_ref: "flaky-after",
          redirect_url: "https://example.com/ibeji/flutterwave",
          customer: { email: "customer.one@example.com" },
        }),
      ).rejects.toThrow();
      expect(paymentRecord(harness, "flaky-after")?.status).toBe("unpaid");
      harness.rules.remove(after.id);
    });
  });

  it("T4 payment-declined overrides the success button", async () => {
    await withHarness(async (harness) => {
      await seedPayment(harness, "declined-override", { amount: "7500" });
      harness.rules.add({
        failureId: "payment-declined",
        twins: ["flutterwave"],
        actions: "checkout.submit",
        settings: { percent: 100 },
      });
      const page = await checkoutPage(harness, "declined-override");
      expect(await page.text()).toContain("An Ibeji failure rule changed this result");
      const response = await checkout(harness, "declined-override", "success");
      expect(response.status).toBe(303);
      expect(paymentRecord(harness, "declined-override")?.status).toBe("failed");
      expect(harness.drafts).toHaveLength(1);
      const declinedDraft = harness.drafts[0];
      if (declinedDraft === undefined) {
        throw new Error("expected a declined charge.completed webhook draft");
      }
      expect((declinedDraft.data as { status: string }).status).toBe("failed");
    });
  });
});

describe("C4 Flutterwave payment state helpers", () => {
  it("C4 keeps the stored payment shape readable through the state adapter", async () => {
    await withHarness(async (harness) => {
      await seedPayment(harness, "state-shape", { amount: "7500" });
      const record = harness.state.read("payments", "state-shape", flutterwavePaymentSchema);
      expect(record?.amount).toBe(750_000);
      expect(record?.status).toBe("unpaid");
      expect(record?.currency).toBe("NGN");
    });
  });

  it("C4 uses the configured auth header for helper requests", async () => {
    await withHarness(async (harness) => {
      const response = await fetch(`http://127.0.0.1:${harness.running.port}/v3/transactions`, {
        headers: authorizationHeader(),
      });
      expect(response.status).toBe(200);
    });
  });
});
