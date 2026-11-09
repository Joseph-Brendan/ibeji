import { describe, expect, it } from "vitest";

import { flutterwaveRefundSchema } from "../../src/twins/flutterwave/state.js";
import {
  createRefund,
  type FlutterwaveHarness,
  fetchRefund,
  listRefunds,
  paymentRecord,
  refundRecord,
  seedPayment,
  startFlutterwave,
} from "../helpers/flutterwave.js";

async function withHarness(run: (harness: FlutterwaveHarness) => Promise<void>): Promise<void> {
  const harness = await startFlutterwave();
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

describe("Flutterwave refunds", () => {
  it("C4 creates a partial refund and returns the create, fetch and list shapes", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "refund-shape", {
        amount: "7500",
        outcome: "success",
      });

      const created = await createRefund(harness, payment.transactionId, { amount: 100 });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as {
        status: string;
        message: string;
        data: {
          id: number;
          amount_refunded: number;
          status: string;
          flw_ref: string;
          destination: string;
          comments: null;
          meta: { source: string; isPartialRefund: boolean; uniquereference: string };
          created_at: string;
          wallet_id: number;
          account_id: number;
          tx_id: number;
        };
      };
      expect(createdBody.status).toBe("success");
      expect(createdBody.message).toBe("Transaction refund initiated");
      expect(createdBody.data.amount_refunded).toBe(100);
      expect(createdBody.data.status).toBe("processing");
      expect(createdBody.data.destination).toBe("payment_source");
      expect(createdBody.data.comments).toBeNull();
      expect(createdBody.data.meta.isPartialRefund).toBe(true);
      expect(createdBody.data.tx_id).toBe(payment.transactionId);

      const fetched = await fetchRefund(harness, createdBody.data.id);
      expect(fetched.status).toBe(200);
      const fetchedBody = (await fetched.json()) as {
        id: number;
        amount_refunded: number;
        status: string;
        comment: null;
        settlement_id: string;
        meta: string;
        transaction_id: number;
      };
      expect(fetchedBody.id).toBe(createdBody.data.id);
      expect(fetchedBody.amount_refunded).toBe(100);
      expect(fetchedBody.status).toBe("processing");
      expect(fetchedBody.comment).toBeNull();
      expect(fetchedBody.settlement_id).toBe("NEW");
      expect(JSON.parse(fetchedBody.meta)).toMatchObject({
        source: "ledgerbalance",
        isPartialRefund: true,
      });
      expect(fetchedBody.transaction_id).toBe(payment.transactionId);

      const listed = (await (await listRefunds(harness)).json()) as {
        data: Array<{ id: number; transaction_id: number }>;
        meta: { page_info: Record<string, number> };
      };
      expect(listed.data).toHaveLength(1);
      expect(listed.data[0]?.transaction_id).toBe(payment.transactionId);
      expect(listed.meta.page_info).toEqual({
        total: 1,
        current_page: 1,
        total_pages: 1,
        page_size: 20,
      });
    });
  });

  it("C4 enforces the NGN minimum and refund limits", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "refund-limits", {
        amount: "7500",
        outcome: "success",
      });

      const belowMinimum = await createRefund(harness, payment.transactionId, { amount: 1 });
      expect(belowMinimum.status).toBe(400);
      expect(await belowMinimum.json()).toMatchObject({
        status: "error",
        message: "Amount should be above NGN100",
        data: null,
      });

      const aboveTransaction = await createRefund(harness, payment.transactionId, {
        amount: 7501,
      });
      expect(aboveTransaction.status).toBe(400);
      expect(((await aboveTransaction.json()) as { message: string }).message).toBe(
        "Amount should not be greater than the transaction amount",
      );

      const first = await createRefund(harness, payment.transactionId, { amount: 7000 });
      expect(first.status).toBe(200);
      harness.clock.advanceBy(120_000);

      const aboveRemaining = await createRefund(harness, payment.transactionId, {
        amount: 600,
      });
      expect(aboveRemaining.status).toBe(400);
      expect(((await aboveRemaining.json()) as { message: string }).message).toBe(
        "Amount should not be greater than the refundable amount",
      );

      const remaining = await createRefund(harness, payment.transactionId, {});
      expect(remaining.status).toBe(200);
      harness.clock.advanceBy(120_000);
      const fullyRefunded = await createRefund(harness, payment.transactionId, {});
      expect(fullyRefunded.status).toBe(400);
      expect(((await fullyRefunded.json()) as { message: string }).message).toBe(
        "Transaction has been fully refunded",
      );
    });
  });

  it("C4 rejects refunds for failed and unknown transactions", async () => {
    await withHarness(async (harness) => {
      const failed = await seedPayment(harness, "refund-failed-source", {
        amount: "7500",
        outcome: "failed",
      });
      const rejected = await createRefund(harness, failed.transactionId, { amount: 100 });
      expect(rejected.status).toBe(400);
      expect(((await rejected.json()) as { message: string }).message).toBe(
        "Transaction was not successful",
      );

      const unknown = await createRefund(harness, 999_999_999, { amount: 100 });
      expect(unknown.status).toBe(400);
      expect(((await unknown.json()) as { message: string }).message).toBe(
        "No transaction was found for this id",
      );
    });
  });

  it("C4 returns Flutterwave's duplicate-partial error while a refund is processing", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "refund-processing", {
        amount: "7500",
        outcome: "success",
      });
      const first = await createRefund(harness, payment.transactionId, { amount: 100 });
      expect(first.status).toBe(200);

      const second = await createRefund(harness, payment.transactionId, { amount: 1 });
      expect(second.status).toBe(400);
      expect(await second.json()).toEqual({
        status: "error",
        message: "Some error occured",
        data: "A partial refund is currently processing on this transaction. Please, try again in 2 mins.",
      });
    });
  });

  it("C4 changes refund status over time and sends the bare refund webhook", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "refund-status", {
        amount: "7500",
        outcome: "success",
      });
      const created = await createRefund(harness, payment.transactionId, { amount: 100 });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as { data: { id: number } };
      const refundDrafts = () => harness.drafts.filter((draft) => draft.key === "refund");
      expect(refundDrafts()).toHaveLength(1);
      const processingDraft = refundDrafts()[0];
      if (processingDraft === undefined) {
        throw new Error("expected a refund webhook draft");
      }
      expect((processingDraft.data as { status: string }).status).toBe("processing");

      const processing = (await (await fetchRefund(harness, createdBody.data.id)).json()) as {
        status: string;
      };
      expect(processing.status).toBe("processing");

      harness.clock.advanceBy(120_000);
      const completed = (await (await fetchRefund(harness, createdBody.data.id)).json()) as {
        status: string;
      };
      expect(completed.status).toBe("completed");
      expect(refundDrafts()).toHaveLength(2);
      const completedDraft = refundDrafts()[1];
      if (completedDraft === undefined) {
        throw new Error("expected a completed refund webhook draft");
      }
      expect((completedDraft.data as { status: string }).status).toBe("completed");
    });
  });

  it("T4 Kola case creates exactly one refund when the reply is lost", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "kola-case", {
        amount: "7500",
        outcome: "success",
      });
      harness.rules.add({
        failureId: "timeout-after-commit",
        twins: ["flutterwave"],
        actions: "refund.create",
        settings: { mode: "hang" },
      });

      const pending = createRefund(harness, payment.transactionId, { amount: 7500 }).catch(
        (error: unknown) => error,
      );
      for (let step = 0; step < 10; step += 1) {
        harness.clock.advanceBy(120_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await expect(pending).resolves.toBeInstanceOf(Error);

      const refunds = harness.state.list("refunds", flutterwaveRefundSchema);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.txRef).toBe("kola-case");
      expect(refunds[0]?.amount).toBe(750_000);

      const listed = (await (await listRefunds(harness)).json()) as { data: unknown[] };
      expect(listed.data).toHaveLength(1);
    });
  });

  it("C4 emits a plain-English Flutterwave refund summary", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "refund-summary", {
        amount: "7500",
        outcome: "success",
        email: "ife@example.com",
      });
      const response = await createRefund(harness, payment.transactionId, { amount: 1500 });
      expect(response.status).toBe(200);

      const requestEvent = harness.events
        .after(0)
        .find((event) => event.type === "request" && event.details.actionId === "refund.create");
      expect(requestEvent?.summary).toBe(
        `Your app refunded ₦1,500.00 through Flutterwave for transaction ${payment.transactionId}`,
      );
    });
  });

  it("C4 keeps comments and filters refunds by transaction, status, currency and reference", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "refund-filter", {
        amount: "7500",
        outcome: "success",
      });
      const created = await createRefund(harness, payment.transactionId, {
        amount: 100,
        comments: "Customer asked for part of the fee back",
      });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as {
        data: { id: number; flw_ref: string; comments: string };
      };
      expect(createdBody.data.comments).toBe("Customer asked for part of the fee back");
      const record = refundRecord(harness, createdBody.data.id);
      expect(record?.comments).toBe("Customer asked for part of the fee back");

      const listed = (await (
        await listRefunds(
          harness,
          `?id=${payment.transactionId}&status=processing&currency=NGN&flw_ref=${encodeURIComponent(createdBody.data.flw_ref)}`,
        )
      ).json()) as { data: unknown[] };
      expect(listed.data).toHaveLength(1);
    });
  });

  it("C4 returns Flutterwave's refund fetch errors", async () => {
    await withHarness(async (harness) => {
      const invalid = await fetchRefund(harness, "not-a-number");
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({
        status: "error",
        message: "Error: not-a-number failed isInt validation",
        data: null,
      });

      const missing = await fetchRefund(harness, 999_999);
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({
        status: "error",
        message: "Error: Refund Id Not Found",
        data: null,
      });
    });
  });

  it("C4 rejects a refund for an unpaid payment", async () => {
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "refund-unpaid", { amount: "7500" });
      const record = paymentRecord(harness, "refund-unpaid");
      expect(record?.transactionId).toBe(payment.transactionId);
      const response = await createRefund(harness, payment.transactionId, { amount: 100 });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { message: string }).message).toBe(
        "Transaction was not successful",
      );
    });
  });
});
