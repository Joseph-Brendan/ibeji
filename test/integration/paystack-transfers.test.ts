import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { WebhookDispatcher } from "../../src/core/webhooks/dispatcher.js";
import { paystackTransferSchema } from "../../src/twins/paystack/state.js";
import { TRANSFER_SUCCESS_DELAY_MS } from "../../src/twins/paystack/transfers.js";
import {
  createRecipient,
  createTransfer,
  fetchTransfer,
  type PaystackHarness,
  resolveAccount,
  startPaystack,
  verifyTransfer,
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

async function makeRecipient(
  harness: PaystackHarness,
  name = "Emeka Obi",
  accountNumber = "0000000001",
  bankCode = "057",
): Promise<string> {
  const response = await createRecipient(harness, {
    type: "nuban",
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: "NGN",
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { data: { recipient_code: string } };
  return body.data.recipient_code;
}

async function makeTransfer(
  harness: PaystackHarness,
  recipient: string,
  reference = "ibeji_transfer_0001",
  amount = 2_000_000,
): Promise<Response> {
  return createTransfer(harness, {
    source: "balance",
    amount,
    recipient,
    reference,
    reason: "School fees",
    currency: "NGN",
  });
}

describe("Paystack banks and transfer recipients", () => {
  it("C4 returns the recorded bank list and 292 banks for Nigeria", async () => {
    await withHarness(async (harness) => {
      const response = await fetch(
        `http://127.0.0.1:${harness.running.port}/bank?country=nigeria`,
        {
          headers: { authorization: "Bearer sk_test_ibeji_fixture_secret_0001" },
        },
      );
      const body = (await response.json()) as { data: unknown[]; message: string };
      expect(response.status).toBe(200);
      expect(body.message).toBe("Banks retrieved");
      expect(body.data).toHaveLength(292);
    });
  });

  it("C4 creates recipients, resolves fictional names, and reuses a duplicate account", async () => {
    await withHarness(async (harness) => {
      const first = await createRecipient(harness, {
        type: "nuban",
        name: "Emeka Obi",
        account_number: "0000000001",
        bank_code: "057",
        currency: "NGN",
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as {
        data: {
          id: number;
          name: string;
          recipient_code: string;
          details: { account_name: string; bank_name: string };
        };
      };
      expect(firstBody.data.name).toBe("Emeka Obi");
      expect(typeof firstBody.data.details.account_name).toBe("string");
      expect(firstBody.data.details.account_name.length).toBeGreaterThan(0);
      expect(typeof firstBody.data.recipient_code).toBe("string");

      const duplicate = await createRecipient(harness, {
        type: "nuban",
        name: "Emeka Obi",
        account_number: "0000000001",
        bank_code: "057",
        currency: "NGN",
      });
      expect(duplicate.status).toBe(201);
      expect(((await duplicate.json()) as { data: { id: number } }).data.id).toBe(
        firstBody.data.id,
      );

      const resolved = await resolveAccount(harness, "?account_number=0000000001&bank_code=057");
      const resolvedBody = (await resolved.json()) as {
        data: { account_name: string };
      };
      expect(resolvedBody.data.account_name).toBe(firstBody.data.details.account_name);
    });
  });

  it("C4 creates the documentation-only authorization_code recipient", async () => {
    await withHarness(async (harness) => {
      const response = await createRecipient(harness, {
        type: "authorization",
        name: "Ngozi Okonkwo",
        authorization_code: "AUTH_ibeji_test_0001",
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        data: {
          type: string;
          recipient_code: string;
          details: {
            authorization_code: string | null;
            account_number: string | null;
            bank_code: string | null;
          };
        };
      };
      expect(body.data.type).toBe("authorization");
      expect(body.data.recipient_code).toMatch(/^RCP_/u);
      expect(body.data.details.authorization_code).toBe("AUTH_ibeji_test_0001");
      expect(body.data.details.account_number).toBeNull();
      expect(body.data.details.bank_code).toBeNull();
    });
  });
});

describe("Paystack transfers", () => {
  it("C4 runs the normal pending-to-success life cycle and sends transfer.success", async () => {
    await withReceiver(async (url, received) => {
      const clock = new FakeClock(1_700_000_000_000);
      const dispatcher = new WebhookDispatcher({
        clock,
        twins: {},
        random: { next: () => 0.5 },
      });
      const harness = await startPaystack({ clock, dispatcher, webhookUrl: () => url });
      try {
        const recipient = await makeRecipient(harness);
        const created = await makeTransfer(harness, recipient);
        expect(created.status).toBe(200);
        const createdBody = (await created.json()) as {
          data: { id: number; reference: string; status: string; recipient: number };
        };
        expect(createdBody.data.status).toBe("pending");
        expect(createdBody.data.reference).toBe("ibeji_transfer_0001");
        expect(typeof createdBody.data.id).toBe("number");
        expect(typeof createdBody.data.recipient).toBe("number");

        const pending = (await (
          await fetchTransfer(harness, String(createdBody.data.id))
        ).json()) as { data: { status: string; recipient: { name: string } } };
        expect(pending.data.status).toBe("pending");
        expect(pending.data.recipient.name).toBe("Emeka Obi");

        clock.advanceBy(TRANSFER_SUCCESS_DELAY_MS);
        await dispatcher.dispatchDue();
        const successEvents = received
          .map((body) => JSON.parse(body) as { event: string; data: { status: string } })
          .filter((body) => body.event === "transfer.success");
        expect(successEvents).toHaveLength(1);
        expect(successEvents[0]?.data.status).toBe("success");

        const success = (await (
          await fetchTransfer(harness, String(createdBody.data.id))
        ).json()) as {
          data: { status: string; transferred_at: string | null; recipient: { name: string } };
        };
        expect(success.data.status).toBe("success");
        expect(typeof success.data.transferred_at).toBe("string");
        expect(success.data.recipient.name).toBe("Emeka Obi");

        const verified = (await (await verifyTransfer(harness, "ibeji_transfer_0001")).json()) as {
          data: { status: string; id: number };
        };
        expect(verified.data.status).toBe("success");
        expect(verified.data.id).toBe(createdBody.data.id);
      } finally {
        await harness.running.stop();
      }
    });
  });

  it("C4 emits a plain-English transfer summary", async () => {
    await withHarness(async (harness) => {
      const recipient = await makeRecipient(harness);
      await makeTransfer(harness, recipient);
      const requestEvent = harness.events
        .after(0)
        .find((event) => event.type === "request" && event.details.actionId === "transfer.create");
      expect(requestEvent?.summary).toBe("Your app sent ₦20,000 to Emeka Obi through Paystack");
    });
  });

  it("C4 treats a transfer reference as unique so a retry cannot double-credit", async () => {
    await withHarness(async (harness) => {
      const recipient = await makeRecipient(harness, "Ifeoma Nwosu", "0000000002", "057");
      const first = await makeTransfer(harness, recipient, "ibeji_transfer_unique", 1_000);
      const firstBody = (await first.json()) as { data: { id: number; status: string } };
      expect(first.status).toBe(200);
      expect(firstBody.data.status).toBe("pending");

      const retry = await makeTransfer(harness, recipient, "ibeji_transfer_unique", 1_000);
      const retryBody = (await retry.json()) as { data: { id: number; status: string } };
      expect(retry.status).toBe(200);
      expect(retryBody.data.id).toBe(firstBody.data.id);
      expect(retryBody.data.status).toBe("pending");

      const transfers = harness.state
        .list("transfers", paystackTransferSchema)
        .filter((transfer) => transfer.reference === "ibeji_transfer_unique");
      expect(transfers).toHaveLength(1);

      const mismatch = await makeTransfer(harness, recipient, "ibeji_transfer_unique", 2_000);
      expect(mismatch.status).toBe(400);
      expect(((await mismatch.json()) as { code: string }).code).toBe("duplicate_reference");
    });
  });

  it("C4 rejects incomplete transfers, unknown recipients and malformed identifiers", async () => {
    await withHarness(async (harness) => {
      const missing = await createTransfer(harness, { source: "balance", amount: 100 });
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { code: string }).code).toBe("missing_params");

      const unknownRecipient = await makeTransfer(harness, "RCP_missing", "ibeji_transfer_missing");
      expect(unknownRecipient.status).toBe(400);
      expect(((await unknownRecipient.json()) as { code: string }).code).toBe(
        "recipient_not_found",
      );

      const recipient = await makeRecipient(harness);
      const badReference = await makeTransfer(harness, recipient, "short");
      expect(badReference.status).toBe(400);
      expect(((await badReference.json()) as { code: string }).code).toBe("invalid_params");

      const badAmount = await makeTransfer(harness, recipient, "ibeji_transfer_bad_amount", 0);
      expect(badAmount.status).toBe(400);

      const badSource = await createTransfer(harness, {
        source: "card",
        amount: 1_000,
        recipient,
        reference: "ibeji_transfer_bad_source",
      });
      expect(badSource.status).toBe(400);
      expect(((await badSource.json()) as { code: string }).code).toBe("invalid_params");

      expect((await fetchTransfer(harness, "ref-1")).status).toBe(400);
      expect((await fetchTransfer(harness, "99999999")).status).toBe(404);
      expect((await verifyTransfer(harness, "ref-1")).status).toBe(400);
      expect((await verifyTransfer(harness, "ibeji_transfer_unknown")).status).toBe(404);
    });
  });
});

describe("T4 Paystack transfer failures", () => {
  it("T4 transfer-stuck-pending resolves failed with thenFailPercent 100", async () => {
    await withHarness(async (harness) => {
      const recipient = await makeRecipient(harness);
      harness.rules.add({
        failureId: "transfer-stuck-pending",
        twins: ["paystack"],
        actions: "transfer.create",
        settings: { seconds: 1, thenFailPercent: 100 },
      });
      const created = await makeTransfer(harness, recipient, "ibeji_transfer_stuck_fail");
      const createdBody = (await created.json()) as { data: { id: number; status: string } };
      expect(createdBody.data.status).toBe("pending");

      harness.clock.advanceBy(1_000);
      const fetched = (await (
        await fetchTransfer(harness, String(createdBody.data.id))
      ).json()) as { data: { status: string } };
      expect(fetched.data.status).toBe("failed");
      expect(harness.drafts.some((draft) => draft.key === "transfer.failed")).toBe(true);
    });
  });

  it("T4 transfer-stuck-pending resolves successful with thenFailPercent 0", async () => {
    await withHarness(async (harness) => {
      const recipient = await makeRecipient(harness);
      harness.rules.add({
        failureId: "transfer-stuck-pending",
        twins: ["paystack"],
        actions: "transfer.create",
        settings: { seconds: 1, thenFailPercent: 0 },
      });
      const created = await makeTransfer(harness, recipient, "ibeji_transfer_stuck_ok");
      const createdBody = (await created.json()) as { data: { id: number } };
      harness.clock.advanceBy(1_000);
      const fetched = (await (
        await fetchTransfer(harness, String(createdBody.data.id))
      ).json()) as { data: { status: string } };
      expect(fetched.data.status).toBe("success");
      expect(harness.drafts.some((draft) => draft.key === "transfer.success")).toBe(true);
    });
  });

  it("T4 transfer-stuck-pending without seconds stays pending until switched off", async () => {
    await withHarness(async (harness) => {
      const recipient = await makeRecipient(harness);
      harness.rules.add({
        failureId: "transfer-stuck-pending",
        twins: ["paystack"],
        actions: "transfer.create",
        settings: { seconds: null, thenFailPercent: 100 },
      });
      const created = await makeTransfer(harness, recipient, "ibeji_transfer_stuck_forever");
      const createdBody = (await created.json()) as { data: { id: number } };
      harness.clock.advanceBy(86_400_000);
      const fetched = (await (
        await fetchTransfer(harness, String(createdBody.data.id))
      ).json()) as { data: { status: string } };
      expect(fetched.data.status).toBe("pending");
      expect(harness.drafts.filter((draft) => draft.key.startsWith("transfer."))).toHaveLength(0);
    });
  });

  it("T4 transfer-reversed marks a transfer reversed after its delay", async () => {
    await withHarness(async (harness) => {
      const recipient = await makeRecipient(harness);
      harness.rules.add({
        failureId: "transfer-reversed",
        twins: ["paystack"],
        actions: "transfer.create",
        settings: { afterSeconds: 1, percent: 100 },
      });
      const created = await makeTransfer(harness, recipient, "ibeji_transfer_reversed");
      const createdBody = (await created.json()) as { data: { id: number } };
      harness.clock.advanceBy(1_000);
      const fetched = (await (
        await fetchTransfer(harness, String(createdBody.data.id))
      ).json()) as { data: { status: string } };
      expect(fetched.data.status).toBe("reversed");
      expect(harness.drafts.some((draft) => draft.key === "transfer.reversed")).toBe(true);
    });
  });

  it("T4 bank-resolve-fails returns error and timeout in Paystack's shape", async () => {
    await withHarness(async (harness) => {
      const errorRule = harness.rules.add({
        failureId: "bank-resolve-fails",
        twins: ["paystack"],
        actions: "bank.resolve",
        settings: { mode: "error" },
      });
      const failed = await resolveAccount(harness, "?account_number=0000000001&bank_code=001");
      expect(failed.status).toBe(400);
      expect(((await failed.json()) as { code: string }).code).toBe("bank_resolve_failed");
      harness.rules.remove(errorRule.id);

      harness.rules.add({
        failureId: "bank-resolve-fails",
        twins: ["paystack"],
        actions: "bank.resolve",
        settings: { mode: "timeout" },
      });
      const timedOut = await resolveAccount(harness, "?account_number=0000000001&bank_code=001");
      expect(timedOut.status).toBe(504);
      expect(((await timedOut.json()) as { code: string }).code).toBe("bank_resolve_timeout");
    });
  });
});
