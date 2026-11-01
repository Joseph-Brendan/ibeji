import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { WebhookDispatcher } from "../../src/core/webhooks/dispatcher.js";
import { paystackRefundSchema } from "../../src/twins/paystack/state.js";
import {
  authorizationHeader,
  checkout,
  createRefund,
  fetchRefund,
  initialize,
  listRefunds,
  type PaystackHarness,
  seedSuccessfulTransaction,
  startPaystack,
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

describe("Paystack refunds", () => {
  it("C4 supports partial refunds and enforces the paid and remaining limits", async () => {
    await withHarness(async (harness) => {
      await seedSuccessfulTransaction(harness, "partial-refunds", 10_000);

      const first = await createRefund(harness, {
        transaction: "partial-refunds",
        amount: "4000",
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { data: { id: number; amount: number } };
      expect(firstBody.data.amount).toBe(4_000);

      const fetched = await fetchRefund(harness, String(firstBody.data.id));
      const fetchedBody = (await fetched.json()) as {
        data: {
          amount: number;
          deducted_amount: number;
          fully_deducted: number;
          refund_type: string;
          status: string;
        };
      };
      expect(fetchedBody.data.amount).toBe(4_000);
      expect(fetchedBody.data.deducted_amount).toBe(4_000);
      expect(fetchedBody.data.fully_deducted).toBe(0);
      expect(fetchedBody.data.refund_type).toBe("Partial");
      expect(fetchedBody.data.status).toBe("pending");

      const second = await createRefund(harness, {
        transaction: "partial-refunds",
        amount: "6000",
      });
      expect(second.status).toBe(200);

      const tooMuch = await createRefund(harness, {
        transaction: "partial-refunds",
        amount: "1",
      });
      expect(tooMuch.status).toBe(400);
      const tooMuchBody = (await tooMuch.json()) as {
        status: boolean;
        type: string;
        code: string;
      };
      expect(tooMuchBody.status).toBe(false);
      expect(tooMuchBody.type).toBe("validation_error");
      expect(tooMuchBody.code).toBe("refund_amount_exceeds_remaining");

      const omitted = await createRefund(harness, { transaction: "partial-refunds" });
      expect(omitted.status).toBe(400);
      expect(((await omitted.json()) as { code: string }).code).toBe("transaction_fully_refunded");

      const listed = await listRefunds(harness);
      const listedBody = (await listed.json()) as {
        data: unknown[];
        meta: { total: number; totalRetriable: number; partialAmountLeft: unknown };
      };
      expect(listedBody.data).toHaveLength(2);
      expect(listedBody.meta.total).toBe(2);
      expect(listedBody.meta.totalRetriable).toBe(0);
      expect(listedBody.meta.partialAmountLeft).toBeNull();
    });
  });

  it("C4 rejects refunds above the amount paid and above the remaining total", async () => {
    await withHarness(async (harness) => {
      await seedSuccessfulTransaction(harness, "limit-paid", 10_000);
      const abovePaid = await createRefund(harness, {
        transaction: "limit-paid",
        amount: "10001",
      });
      expect(abovePaid.status).toBe(400);
      expect(((await abovePaid.json()) as { code: string }).code).toBe(
        "amount_exceeds_transaction_amount",
      );

      await seedSuccessfulTransaction(harness, "limit-remaining", 10_000);
      const first = await createRefund(harness, {
        transaction: "limit-remaining",
        amount: "6000",
      });
      expect(first.status).toBe(200);
      const aboveRemaining = await createRefund(harness, {
        transaction: "limit-remaining",
        amount: "5000",
      });
      expect(aboveRemaining.status).toBe(400);
      expect(((await aboveRemaining.json()) as { code: string }).code).toBe(
        "refund_amount_exceeds_remaining",
      );
    });
  });

  it("C4 rejects a transaction that did not succeed", async () => {
    await withHarness(async (harness) => {
      const initialized = await initialize(harness, {
        amount: "10000",
        email: "customer.one@example.com",
        currency: "NGN",
        reference: "failed-refund-source",
      });
      expect(initialized.status).toBe(200);
      const declined = await checkout(harness, "failed-refund-source", "declined");
      expect(declined.status).toBe(200);

      const refund = await createRefund(harness, {
        transaction: "failed-refund-source",
        amount: "1000",
      });
      expect(refund.status).toBe(400);
      const body = (await refund.json()) as { status: boolean; type: string; code: string };
      expect(body.status).toBe(false);
      expect(body.type).toBe("validation_error");
      expect(body.code).toBe("transaction_not_successful");
    });
  });

  it("T4 Kola case creates exactly one refund when the reply is lost", async () => {
    await withHarness(async (harness) => {
      await seedSuccessfulTransaction(harness, "kola-case", 10_000);
      harness.rules.add({
        failureId: "timeout-after-commit",
        twins: ["paystack"],
        actions: "refund.create",
        settings: { mode: "hang" },
      });

      const pending = createRefund(harness, {
        transaction: "kola-case",
        amount: "10000",
      }).catch((error: unknown) => error);
      for (let step = 0; step < 10; step += 1) {
        harness.clock.advanceBy(120_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await expect(pending).resolves.toBeInstanceOf(Error);

      const refunds = harness.state.list("refunds", paystackRefundSchema);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.transactionReference).toBe("kola-case");
      expect(refunds[0]?.amount).toBe(10_000);

      const listed = await listRefunds(harness);
      const body = (await listed.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });
  });

  it("C4/P6 changes refund status over time and sends matching webhooks", async () => {
    await withReceiver(async (url, received) => {
      const clock = new FakeClock(1_700_000_000_000);
      const dispatcher = new WebhookDispatcher({
        clock,
        twins: {},
        random: { next: () => 0.5 },
      });
      const harness = await startPaystack({ clock, dispatcher, webhookUrl: () => url });
      try {
        await seedSuccessfulTransaction(harness, "refund-status", 10_000);
        const created = await createRefund(harness, { transaction: "refund-status" });
        const createdBody = (await created.json()) as { data: { id: number } };
        await dispatcher.dispatchDue();

        let refundEvents = received
          .map(
            (body) =>
              JSON.parse(body) as { event: string; data: { status: string; amount: string } },
          )
          .filter((body) => body.event.startsWith("refund."));
        expect(refundEvents.map((event) => event.event)).toEqual(["refund.pending"]);
        expect(refundEvents[0]?.data.status).toBe("pending");
        expect(refundEvents[0]?.data.amount).toBe("10000");
        expect((await fetchRefund(harness, String(createdBody.data.id))).status).toBe(200);

        clock.advanceBy(60_000);
        await dispatcher.dispatchDue();
        refundEvents = received
          .map(
            (body) =>
              JSON.parse(body) as { event: string; data: { status: string; amount: string } },
          )
          .filter((body) => body.event.startsWith("refund."));
        expect(refundEvents.map((event) => event.event)).toEqual([
          "refund.pending",
          "refund.processing",
        ]);
        const processing = (await (
          await fetchRefund(harness, String(createdBody.data.id))
        ).json()) as { data: { status: string; refunded_at: string | null } };
        expect(processing.data.status).toBe("processing");
        expect(processing.data.refunded_at).toBeNull();

        clock.advanceBy(60_000);
        await dispatcher.dispatchDue();
        refundEvents = received
          .map(
            (body) =>
              JSON.parse(body) as { event: string; data: { status: string; amount: string } },
          )
          .filter((body) => body.event.startsWith("refund."));
        expect(refundEvents.map((event) => event.event)).toEqual([
          "refund.pending",
          "refund.processing",
          "refund.processed",
        ]);
        const processed = (await (
          await fetchRefund(harness, String(createdBody.data.id))
        ).json()) as {
          data: { status: string; refunded_at: string | null; reason: string };
        };
        expect(processed.data.status).toBe("processed");
        expect(typeof processed.data.refunded_at).toBe("string");
        expect(processed.data.reason).toBe("PROCESSED");
      } finally {
        await harness.running.stop();
      }
    });
  });

  it("C4 accepts a transaction ID, filters the list, and keeps custom notes", async () => {
    await withHarness(async (harness) => {
      await seedSuccessfulTransaction(harness, "refund-by-id", 10_000);
      const verified = (await (
        await fetch(`http://127.0.0.1:${harness.running.port}/transaction/verify/refund-by-id`, {
          headers: authorizationHeader(),
        })
      ).json()) as { data: { id: number } };

      const created = await createRefund(harness, {
        transaction: verified.data.id,
        amount: "1000",
        customer_note: "Customer asked for part of the fee back",
        merchant_note: "Goodwill refund",
      });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as {
        data: { customer_note: string; merchant_note: string };
      };
      expect(createdBody.data.customer_note).toBe("Customer asked for part of the fee back");
      expect(createdBody.data.merchant_note).toBe("Goodwill refund");

      const listed = await listRefunds(harness, "?transaction=refund-by-id&currency=NGN");
      const listedBody = (await listed.json()) as { data: unknown[]; meta: { total: number } };
      expect(listedBody.data).toHaveLength(1);
      expect(listedBody.meta.total).toBe(1);

      const missing = await createRefund(harness, {});
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { code: string }).code).toBe("missing_params");

      const badAmount = await createRefund(harness, {
        transaction: "refund-by-id",
        amount: "10.5",
      });
      expect(badAmount.status).toBe(400);
      expect(((await badAmount.json()) as { code: string }).code).toBe("invalid_params");

      const unknown = await fetchRefund(harness, "99999999");
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as { code: string }).code).toBe("refund_not_found");
    });
  });

  it("C4 emits a plain-English refund summary", async () => {
    await withHarness(async (harness) => {
      await seedSuccessfulTransaction(harness, "refund-summary", 200_000, "ife@example.com");
      const response = await createRefund(harness, {
        transaction: "refund-summary",
        amount: "150000",
      });
      expect(response.status).toBe(200);

      const requestEvent = harness.events
        .after(0)
        .find((event) => event.type === "request" && event.details.actionId === "refund.create");
      expect(requestEvent?.summary).toBe(
        "Your app refunded ₦1,500 through Paystack for transaction refund-summary",
      );
    });
  });
});
