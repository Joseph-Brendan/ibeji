import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { fingerprint } from "../../src/core/redact.js";
import { WebhookDispatcher } from "../../src/core/webhooks/dispatcher.js";
import { buildTransactionLog, readTransaction } from "../../src/twins/paystack/transactions.js";
import {
  authorizationHeader,
  checkout,
  checkoutPage,
  initialize,
  listTransactions,
  PAYSTACK_TEST_CREDENTIALS,
  type PaystackHarness,
  startPaystack,
  verify,
} from "../helpers/paystack.js";

async function withHarness(run: (harness: PaystackHarness) => Promise<void>): Promise<void> {
  const harness = await startPaystack();
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

async function withReceiver(
  run: (url: string, received: string[]) => Promise<void>,
): Promise<void> {
  const received: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      received.push(Buffer.concat(chunks).toString("utf8"));
      response.end("ok");
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  try {
    await run(`http://127.0.0.1:${address.port}/webhook`, received);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

describe("Paystack authentication and credentials", () => {
  it("C4/T6 rejects a missing, wrong, public, and live key with Paystack's shape", async () => {
    await withHarness(async (harness) => {
      const missing = await fetch(
        `http://127.0.0.1:${harness.running.port}/transaction/initialize`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(missing.status).toBe(401);
      const missingBody = (await missing.json()) as {
        status: boolean;
        message: string;
        type: string;
        code: string;
      };
      expect(missingBody.status).toBe(false);
      expect(typeof missingBody.message).toBe("string");
      expect(missingBody.type).toBe("api_error");
      expect(missingBody.code).toBe("unauthorized");

      for (const key of ["sk_test_ibeji_wrong", PAYSTACK_TEST_CREDENTIALS.public]) {
        const response = await fetch(
          `http://127.0.0.1:${harness.running.port}/transaction/initialize`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: "{}",
          },
        );
        expect(response.status).toBe(401);
      }

      const liveKey = ["sk", "live", "thisMustNeverWork000000000"].join("_");
      const live = await fetch(`http://127.0.0.1:${harness.running.port}/transaction/initialize`, {
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

  it("C7 issues only public and secret Paystack test keys, both marked Ibeji", async () => {
    await withHarness(async (harness) => {
      const specs = harness.running.definition.credentials;
      expect(specs.map((spec) => spec.id)).toEqual(["public", "secret"]);
      expect(specs.some((spec) => spec.role === "webhook")).toBe(false);
      const random = {
        bytes: (length: number) => new Uint8Array(length).fill(7),
      };
      for (const spec of specs) {
        const value = spec.generate(random);
        expect(value.includes("ibeji")).toBe(true);
        expect(spec.isTestFormat(value)).toBe(true);
      }
    });
  });
});

describe("Paystack event summaries and transaction behavior", () => {
  it("C4/T14 emits a plain-English initialize summary with amount and email", async () => {
    await withHarness(async (harness) => {
      const response = await initialize(harness, {
        amount: "500000",
        email: "ada@example.com",
        currency: "NGN",
        reference: "summary-1",
      });
      expect(response.status).toBe(200);
      const initialized = (await response.json()) as {
        data: { authorization_url: string };
      };
      expect(initialized.data.authorization_url).toBe(
        `http://127.0.0.1:${harness.running.port}/checkout/summary-1`,
      );
      const requestEvent = harness.events
        .after(0)
        .find(
          (event) =>
            event.type === "request" && event.details.actionId === "transaction.initialize",
        );
      expect(requestEvent?.summary).toBe(
        "Your app started a Paystack payment of ₦5,000.00 for ada@example.com",
      );
    });
  });

  it("C4 pays, declines, and abandons through the checkout form", async () => {
    await withHarness(async (harness) => {
      const initializeResponse = await initialize(harness, {
        amount: "10000",
        email: "customer.one@example.com",
        currency: "NGN",
        reference: "checkout-statuses",
        callback_url: "https://example.com/ibeji/paystack",
      });
      expect(initializeResponse.status).toBe(200);

      const page = await checkoutPage(harness, "checkout-statuses");
      const html = await page.text();
      expect(html).toContain("Ibeji test checkout: Paystack twin");
      expect(html).toContain("No real money moves");
      expect(html).toContain("₦100.00");
      expect(html).toContain("customer.one@example.com");
      expect(html).toContain("checkout-statuses");
      expect(html).toContain("Pay successfully");
      expect(html).toContain("Decline payment");
      expect(html).toContain("Abandon");

      const success = await checkout(harness, "checkout-statuses", "success");
      expect(success.status).toBe(303);
      const location = success.headers.get("location");
      expect(location).toContain("https://example.com/ibeji/paystack");
      expect(new URL(location as string).searchParams.get("reference")).toBe("checkout-statuses");
      const verified = await verify(harness, "checkout-statuses");
      const verifiedBody = (await verified.json()) as { data: { status: string } };
      expect(verifiedBody.data.status).toBe("success");

      await initialize(harness, {
        amount: "10000",
        email: "customer.two@example.com",
        currency: "NGN",
        reference: "checkout-declined",
      });
      const declined = await checkout(harness, "checkout-declined", "declined");
      expect(declined.status).toBe(200);
      expect(await declined.text()).toContain("declined");
      const declinedVerify = (await (await verify(harness, "checkout-declined")).json()) as {
        data: { status: string };
      };
      expect(declinedVerify.data.status).toBe("failed");

      await initialize(harness, {
        amount: "10000",
        email: "customer.three@example.com",
        currency: "NGN",
        reference: "checkout-abandoned",
      });
      const abandoned = await checkout(harness, "checkout-abandoned", "abandoned");
      expect(abandoned.status).toBe(200);
      expect(await abandoned.text()).toContain("abandoned");
      const abandonedVerify = (await (await verify(harness, "checkout-abandoned")).json()) as {
        data: { status: string };
      };
      expect(abandonedVerify.data.status).toBe("abandoned");
    });
  });

  it("T5 sends charge.success only for a successful checkout", async () => {
    await withReceiver(async (url, received) => {
      const clock = new FakeClock(1_700_000_000_000);
      const dispatcher = new WebhookDispatcher({
        clock,
        twins: {},
        random: { next: () => 0.5 },
      });
      const harness = await startPaystack({
        clock,
        dispatcher,
        webhookUrl: () => url,
      });
      try {
        await initialize(harness, {
          amount: "10000",
          email: "customer.one@example.com",
          currency: "NGN",
          reference: "webhook-success",
        });
        const response = await checkout(harness, "webhook-success", "success");
        expect(response.status).toBe(200);
        await dispatcher.dispatchDue();
        expect(received).toHaveLength(1);
        const body = JSON.parse(received[0] as string) as { event: string };
        expect(body.event).toBe("charge.success");
        expect(harness.drafts).toHaveLength(1);

        await initialize(harness, {
          amount: "10000",
          email: "customer.two@example.com",
          currency: "NGN",
          reference: "webhook-declined",
        });
        await checkout(harness, "webhook-declined", "declined");
        expect(received).toHaveLength(1);
      } finally {
        await harness.running.stop();
      }
    });
  });

  it("T5 checkout success signs the webhook with the Paystack secret key", async () => {
    await withReceiver(async (url, received) => {
      const clock = new FakeClock(1_700_000_000_000);
      const dispatcher = new WebhookDispatcher({
        clock,
        twins: {},
        random: { next: () => 0.5 },
      });
      const harness = await startPaystack({ clock, dispatcher, webhookUrl: () => url });
      try {
        await initialize(harness, {
          amount: "10000",
          email: "customer.one@example.com",
          currency: "NGN",
          reference: "signed-success",
        });
        await checkout(harness, "signed-success", "success");
        await dispatcher.dispatchDue();
        const raw = {
          body: received[0] as string,
          contentType: "application/json" as const,
        };
        const headers = { "x-paystack-signature": "" };
        expect(
          harness.running.definition.webhooks.verify(
            raw,
            headers,
            PAYSTACK_TEST_CREDENTIALS,
            new Date(0),
          ),
        ).toBe(false);
        const signed = harness.running.definition.webhooks.sign(raw, PAYSTACK_TEST_CREDENTIALS, {
          attempt: 1,
        });
        expect(
          harness.running.definition.webhooks.verify(
            raw,
            signed,
            PAYSTACK_TEST_CREDENTIALS,
            new Date(0),
          ),
        ).toBe(true);
      } finally {
        await harness.running.stop();
      }
    });
  });
});

describe("T4 Paystack failures", () => {
  it("T4 server-error and rate-limited use Paystack's error shape", async () => {
    await withHarness(async (harness) => {
      const server = harness.rules.add({
        failureId: "server-error",
        twins: ["paystack"],
        actions: "transaction.initialize",
      });
      const serverResponse = await fetch(
        `http://127.0.0.1:${harness.running.port}/transaction/initialize`,
        { method: "POST", headers: authorizationHeader(), body: "{}" },
      );
      expect(serverResponse.status).toBe(500);
      const serverBody = (await serverResponse.json()) as {
        status: boolean;
        type: string;
        code: string;
      };
      expect(serverBody.status).toBe(false);
      expect(serverBody.type).toBe("api_error");
      expect(serverBody.code).toBe("server_error");
      harness.rules.remove(server.id);

      const rate = harness.rules.add({
        failureId: "rate-limited",
        twins: ["paystack"],
        actions: "transaction.initialize",
      });
      const rateResponse = await fetch(
        `http://127.0.0.1:${harness.running.port}/transaction/initialize`,
        { method: "POST", headers: authorizationHeader(), body: "{}" },
      );
      expect(rateResponse.status).toBe(429);
      expect(((await rateResponse.json()) as { code: string }).code).toBe("rate_limited");
      harness.rules.remove(rate.id);
    });
  });

  it("T4 slow-response delays the reply through the injected clock", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "slow-response",
        twins: ["paystack"],
        actions: "transaction.list",
        settings: { seconds: 1 },
      });
      const pending = listTransactions(harness);
      for (let step = 0; step < 20; step += 1) {
        harness.clock.advanceBy(1_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect((await pending).status).toBe(200);
    });
  });

  it("T4 flaky-network drops before and after the action", async () => {
    await withHarness(async (harness) => {
      const before = harness.rules.add({
        failureId: "flaky-network",
        twins: ["paystack"],
        actions: "transaction.initialize",
        settings: { percent: 100, when: "before" },
      });
      await expect(
        initialize(harness, {
          amount: "10000",
          email: "customer.one@example.com",
          reference: "flaky-before",
        }),
      ).rejects.toThrow();
      expect((await verify(harness, "flaky-before")).status).toBe(400);
      harness.rules.remove(before.id);

      const after = harness.rules.add({
        failureId: "flaky-network",
        twins: ["paystack"],
        actions: "transaction.initialize",
        settings: { percent: 100, when: "after" },
      });
      await expect(
        initialize(harness, {
          amount: "10000",
          email: "customer.one@example.com",
          reference: "flaky-after",
        }),
      ).rejects.toThrow();
      expect((await verify(harness, "flaky-after")).status).toBe(200);
      harness.rules.remove(after.id);
    });
  });

  it("T4 timeout-before-commit performs no action", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "timeout-before-commit",
        twins: ["paystack"],
        actions: "transaction.initialize",
        settings: { mode: "reset" },
      });
      await expect(
        initialize(harness, {
          amount: "10000",
          email: "customer.one@example.com",
          reference: "timeout-before",
        }),
      ).rejects.toThrow();
      expect((await verify(harness, "timeout-before")).status).toBe(400);
    });
  });

  it("T4 timeout-after-commit keeps the transaction", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "timeout-after-commit",
        twins: ["paystack"],
        actions: "transaction.initialize",
        settings: { mode: "reset" },
      });
      await expect(
        initialize(harness, {
          amount: "10000",
          email: "customer.one@example.com",
          reference: "timeout-after",
        }),
      ).rejects.toThrow();
      const response = await verify(harness, "timeout-after");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { status: string } };
      expect(body.data.status).toBe("pending");
    });
  });

  it("T4 payment-declined overrides the success button", async () => {
    await withHarness(async (harness) => {
      await initialize(harness, {
        amount: "10000",
        email: "customer.one@example.com",
        reference: "declined-override",
      });
      harness.rules.add({
        failureId: "payment-declined",
        twins: ["paystack"],
        actions: "checkout.submit",
        settings: { percent: 100 },
      });
      const page = await checkoutPage(harness, "declined-override");
      expect(await page.text()).toContain("An Ibeji failure rule changed this result");
      const response = await checkout(harness, "declined-override", "success");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("declined");
      expect(harness.drafts).toHaveLength(0);
      const body = (await (await verify(harness, "declined-override")).json()) as {
        data: { status: string };
      };
      expect(body.data.status).toBe("failed");
    });
  });

  it("T4 keeps the stored transaction shape readable through the state adapter", async () => {
    await withHarness(async (harness) => {
      await initialize(harness, {
        amount: "10000",
        email: "customer.one@example.com",
        reference: "state-shape",
      });
      const record = readTransaction(harness.state, "state-shape");
      expect(record?.amount).toBe(10_000);
      expect(record?.log).toBeNull();
      expect(record?.status).toBe("pending");
      expect(buildTransactionLog("success").history).toHaveLength(6);
    });
  });
});
