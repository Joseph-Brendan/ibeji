import { describe, expect, it } from "vitest";

import { accountNameFor } from "../../src/twins/flutterwave/banks.js";
import {
  authorizationHeader,
  createTransfer,
  type FlutterwaveHarness,
  fetchTransfer,
  listBanks,
  listTransfers,
  resolveAccount,
  startFlutterwave,
  transferRecord,
} from "../helpers/flutterwave.js";

async function withHarness(run: (harness: FlutterwaveHarness) => Promise<void>): Promise<void> {
  const harness = await startFlutterwave();
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

async function makeTransfer(
  harness: FlutterwaveHarness,
  reference: string,
  options: {
    readonly amount?: string;
    readonly accountNumber?: string;
    readonly bankCode?: string;
    readonly name?: string;
  } = {},
): Promise<{ readonly id: number; readonly data: Record<string, unknown> }> {
  const body: Record<string, unknown> = {
    account_bank: options.bankCode ?? "044",
    account_number: options.accountNumber ?? "0000000001",
    amount: options.amount ?? "5500",
    currency: "NGN",
    reference,
    narration: "School fees",
  };
  if (options.name !== undefined) {
    body.beneficiary_name = options.name;
  }
  const response = await createTransfer(harness, body);
  expect(response.status).toBe(200);
  const parsed = (await response.json()) as {
    data: Record<string, unknown> & { id: number };
  };
  return { id: parsed.data.id, data: parsed.data };
}

describe("Flutterwave banks", () => {
  it("C4 lists the recorded NG banks and returns Flutterwave's error for another country", async () => {
    await withHarness(async (harness) => {
      const response = await listBanks(harness, "NG");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        message: string;
        data: Array<{ id: number; code: string; name: string }>;
      };
      expect(body.status).toBe("success");
      expect(body.message).toBe("Banks fetched successfully");
      expect(body.data).toHaveLength(598);
      expect(body.data[0]).toEqual({ id: 132, code: "560", name: "Test Name 3" });

      const missing = await listBanks(harness, "INVALID");
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        status: "error",
        message: "No banks found for country code",
        data: null,
      });
    });
  });

  it("C4 resolves a well-formed account, rejects malformed input and unknown banks", async () => {
    await withHarness(async (harness) => {
      const response = await resolveAccount(harness, {
        account_number: "0000000001",
        account_bank: "044",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        message: string;
        data: { account_name: string; account_number: string };
      };
      expect(body.message).toBe("Account details fetched");
      expect(body.data.account_number).toBe("0000000001");
      expect(body.data.account_name).toBe(accountNameFor("0000000001", "044"));
      expect(body.data.account_name.length).toBeGreaterThan(0);

      const malformed = await resolveAccount(harness, {
        account_number: "not-a-number",
        account_bank: "044",
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({
        status: "error",
        message: "invalid account",
        data: null,
      });

      const unknownBank = await resolveAccount(harness, {
        account_number: "0000000001",
        account_bank: "123456",
      });
      expect(unknownBank.status).toBe(400);
      expect(await unknownBank.json()).toEqual({
        status: "error",
        message: "invalid account",
        data: null,
      });

      const missingFields = await resolveAccount(harness, {});
      expect(missingFields.status).toBe(400);
      expect(await missingFields.json()).toEqual({
        status: "error",
        message: "invalid account",
        data: null,
      });

      const invalidBody = await fetch(
        `http://127.0.0.1:${harness.running.port}/v3/accounts/resolve`,
        {
          method: "POST",
          headers: authorizationHeader(),
          body: "not-json",
        },
      );
      expect(invalidBody.status).toBe(400);
      expect(await invalidBody.json()).toEqual({
        status: "error",
        message: "Invalid JSON body",
        data: null,
      });
    });
  });

  it("C4 resolves any well-formed numeric account for a known bank", async () => {
    await withHarness(async (harness) => {
      const response = await resolveAccount(harness, {
        account_number: "0000000002",
        account_bank: "044",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { account_number: string; account_name: string };
      };
      expect(body.data.account_number).toBe("0000000002");
      expect(body.data.account_name).toBe(accountNameFor("0000000002", "044"));
    });
  });
});

describe("Flutterwave transfers", () => {
  it("C4 creates a transfer with the documented NEW response and then PENDING state", async () => {
    await withHarness(async (harness) => {
      const created = await makeTransfer(harness, "transfer-shape", {
        amount: "5500",
        name: "Chinedu Okafor",
      });
      expect(created.data.status).toBe("NEW");
      expect(created.data.account_number).toBe("0000000001");
      expect(created.data.bank_code).toBe("044");
      expect(created.data.full_name).toBe("Chinedu Okafor");
      expect(created.data.amount).toBe(5500);
      expect(typeof created.data.fee).toBe("number");
      expect(created.data.reference).toBe("transfer-shape");
      expect(created.data.requires_approval).toBe(0);
      expect(created.data.is_approved).toBe(1);
      expect(typeof created.data.id).toBe("number");
      expect(created.data.complete_message).toBe("");

      const record = transferRecord(harness, created.id);
      expect(record?.status).toBe("PENDING");
      expect(record?.amount).toBe(550_000);

      const fetched = await fetchTransfer(harness, created.id);
      expect(fetched.status).toBe(200);
      const fetchedBody = (await fetched.json()) as {
        message: string;
        data: { status: string; full_name: string; complete_message: string };
      };
      expect(fetchedBody.message).toBe("Transfer fetched");
      expect(fetchedBody.data.status).toBe("PENDING");
      expect(fetchedBody.data.full_name).toBe("Chinedu Okafor");
    });
  });

  it("C4 follows the documented _PMCKDU_ test schedule and sends transfer.completed", async () => {
    await withHarness(async (harness) => {
      const created = await makeTransfer(harness, "lifecycle_PMCKDU_1");
      expect(harness.drafts).toHaveLength(0);

      const pending = (await (await fetchTransfer(harness, created.id)).json()) as {
        data: { status: string };
      };
      expect(pending.data.status).toBe("PENDING");

      harness.clock.advanceBy(60_000);
      const successful = (await (await fetchTransfer(harness, created.id)).json()) as {
        data: { status: string; complete_message: string; reference: string };
      };
      expect(successful.data.status).toBe("SUCCESSFUL");
      expect(successful.data.complete_message).toBe("Successful");
      expect(successful.data.reference).toBe("lifecycle_PMCKDU_1");

      expect(harness.drafts).toHaveLength(1);
      expect(harness.drafts[0]?.key).toBe("transfer.completed");
      const data = harness.drafts[0]?.data as {
        status: string;
        fullname: string;
        reference: string;
      };
      expect(data.status).toBe("SUCCESSFUL");
      expect(data.fullname).toBe(accountNameFor("0000000001", "044"));
      expect(data.reference).toBe("lifecycle_PMCKDU_1");

      const listed = (await (await listTransfers(harness)).json()) as {
        data: Array<{ id: number; status: string }>;
        meta: { page_info: { total: number; current_page: number; total_pages: number } };
      };
      expect(listed.data).toHaveLength(1);
      expect(listed.data[0]?.id).toBe(created.id);
      expect(listed.data[0]?.status).toBe("SUCCESSFUL");
      expect(listed.meta.page_info).toEqual({
        total: 1,
        current_page: 1,
        total_pages: 1,
      });
    });
  });

  it("C4 follows the documented _PMCK_ST_FDU_ failure schedule", async () => {
    await withHarness(async (harness) => {
      const created = await makeTransfer(harness, "lifecycle_PMCK_ST_FDU_1");
      harness.clock.advanceBy(60_000);
      const failed = (await (await fetchTransfer(harness, created.id)).json()) as {
        data: { status: string; complete_message: string };
      };
      expect(failed.data.status).toBe("FAILED");
      expect(failed.data.complete_message).toContain("DISBURSE FAILED");
      expect(harness.drafts).toHaveLength(1);
      const failedDraft = harness.drafts[0];
      if (failedDraft === undefined) {
        throw new Error("expected a failed transfer webhook draft");
      }
      expect((failedDraft.data as { status: string }).status).toBe("FAILED");
    });
  });

  it("C4 leaves a transfer without a test suffix PENDING", async () => {
    await withHarness(async (harness) => {
      const created = await makeTransfer(harness, "plain-transfer-reference");
      harness.clock.advanceBy(10 * 60_000);
      const fetched = (await (await fetchTransfer(harness, created.id)).json()) as {
        data: { status: string };
      };
      expect(fetched.data.status).toBe("PENDING");
      expect(harness.drafts).toHaveLength(0);
    });
  });

  it("C4 generates a reference and follows the default _PMCK test delays", async () => {
    await withHarness(async (harness) => {
      const generated = await createTransfer(harness, {
        account_bank: "044",
        account_number: "0000000001",
        amount: "100",
        currency: "NGN",
      });
      expect(generated.status).toBe(200);
      const generatedBody = (await generated.json()) as { data: { reference: string } };
      expect(generatedBody.data.reference).toMatch(/^ibeji-flutterwave-/u);

      const success = await makeTransfer(harness, "default_PMCK");
      const failure = await makeTransfer(harness, "default_PMCK_ST_F");
      harness.clock.advanceBy(10 * 60_000);

      const successBody = (await (await fetchTransfer(harness, success.id)).json()) as {
        data: { status: string };
      };
      const failureBody = (await (await fetchTransfer(harness, failure.id)).json()) as {
        data: { status: string };
      };
      expect(successBody.data.status).toBe("SUCCESSFUL");
      expect(failureBody.data.status).toBe("FAILED");
    });
  });

  it("C4 filters transfers and paginates them", async () => {
    await withHarness(async (harness) => {
      await makeTransfer(harness, "filter-one", { amount: "100" });
      await makeTransfer(harness, "filter-two", { amount: "200" });
      const today = new Date(harness.clock.now()).toISOString().slice(0, 10);

      const byReference = (await (
        await listTransfers(harness, "?reference=filter-one")
      ).json()) as { data: unknown[]; meta: { page_info: { total: number } } };
      expect(byReference.data).toHaveLength(1);
      expect(byReference.meta.page_info.total).toBe(1);

      const byStatus = (await (await listTransfers(harness, "?status=pending")).json()) as {
        data: unknown[];
      };
      expect(byStatus.data).toHaveLength(2);

      const byDate = (await (
        await listTransfers(harness, `?from=${today}&to=${today}`)
      ).json()) as { data: unknown[] };
      expect(byDate.data).toHaveLength(2);

      const future = (await (await listTransfers(harness, "?from=2099-01-01")).json()) as {
        data: unknown[];
      };
      expect(future.data).toHaveLength(0);

      const paged = (await (await listTransfers(harness, "?page=1&page_size=1")).json()) as {
        data: unknown[];
        meta: { page_info: { total: number; current_page: number; total_pages: number } };
      };
      expect(paged.data).toHaveLength(1);
      expect(paged.meta.page_info).toMatchObject({
        total: 2,
        current_page: 1,
        total_pages: 2,
      });
    });
  });

  it("C4 validates transfer requests, references and pages", async () => {
    await withHarness(async (harness) => {
      const missingAmount = await createTransfer(harness, {
        account_bank: "044",
        account_number: "0000000001",
        currency: "NGN",
      });
      expect(missingAmount.status).toBe(400);
      expect(await missingAmount.json()).toEqual({
        status: "error",
        message: "amount is required",
        data: null,
      });

      const missingAccount = await createTransfer(harness, {
        account_bank: "044",
        amount: "100",
        currency: "NGN",
      });
      expect(missingAccount.status).toBe(400);
      expect(((await missingAccount.json()) as { message: string }).message).toBe(
        "account_number is required",
      );

      const missingBank = await createTransfer(harness, {
        account_number: "0000000001",
        amount: "100",
        currency: "NGN",
      });
      expect(missingBank.status).toBe(400);
      expect(((await missingBank.json()) as { message: string }).message).toBe(
        "account_bank is required",
      );

      const missingCurrency = await createTransfer(harness, {
        account_bank: "044",
        account_number: "0000000001",
        amount: "100",
      });
      expect(missingCurrency.status).toBe(400);
      expect(((await missingCurrency.json()) as { message: string }).message).toBe(
        "currency is required",
      );

      const badAmount = await createTransfer(harness, {
        account_bank: "044",
        account_number: "0000000001",
        amount: "not-a-number",
        currency: "NGN",
      });
      expect(badAmount.status).toBe(400);
      expect(((await badAmount.json()) as { status: string }).status).toBe("error");

      await makeTransfer(harness, "duplicate-transfer-reference");
      const duplicate = await createTransfer(harness, {
        account_bank: "044",
        account_number: "0000000001",
        amount: "100",
        currency: "NGN",
        reference: "duplicate-transfer-reference",
      });
      expect(duplicate.status).toBe(400);
      expect(await duplicate.json()).toEqual({
        status: "error",
        message: "reference has already been used",
        data: null,
      });

      const invalidPage = await listTransfers(harness, "?page=not-a-number");
      expect(invalidPage.status).toBe(400);
      expect(await invalidPage.json()).toEqual({
        status: "error",
        message: "page parameter must be a positive integer",
        data: null,
      });

      const missing = await fetchTransfer(harness, 999_999);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        status: "error",
        message: "Transfer not found",
        data: null,
      });
    });
  });

  it("C4 emits a plain-English Flutterwave transfer summary", async () => {
    await withHarness(async (harness) => {
      await makeTransfer(harness, "transfer-summary", { amount: "5500" });
      const requestEvent = harness.events
        .after(0)
        .find((event) => event.type === "request" && event.details.actionId === "transfer.create");
      expect(requestEvent?.summary).toBe(
        `Your app sent ₦5,500.00 to ${accountNameFor("0000000001", "044")} through Flutterwave`,
      );
    });
  });

  it("C4 summarizes transfers without a resolved name and handles bad amounts", async () => {
    await withHarness(async (harness) => {
      const unnamed = await makeTransfer(harness, "summary-unnamed", {
        amount: "100",
        accountNumber: "123",
      });
      expect(unnamed.id).toBeGreaterThan(0);
      const unnamedEvent = harness.events
        .after(0)
        .find((event) => event.type === "request" && event.details.actionId === "transfer.create");
      expect(unnamedEvent?.summary).toBe("Your app sent ₦100.00 through Flutterwave");

      const invalid = await createTransfer(harness, {
        account_bank: "044",
        account_number: "0000000001",
        amount: "bad-amount",
        currency: "NGN",
      });
      expect(invalid.status).toBe(400);
      const invalidSummary = harness.events
        .after(0)
        .filter((event) => event.type === "request" && event.details.actionId === "transfer.create")
        .at(-1);
      expect(invalidSummary?.summary).toBe("Your app tried to start a Flutterwave transfer.");
    });
  });
});

describe("T4 Flutterwave transfer failures", () => {
  it("T4 transfer-stuck-pending resolves failed with thenFailPercent 100", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "transfer-stuck-pending",
        twins: ["flutterwave"],
        actions: "transfer.create",
        settings: { seconds: 1, thenFailPercent: 100 },
      });
      const created = await makeTransfer(harness, "stuck-fail");
      harness.clock.advanceBy(1_000);
      const fetched = (await (await fetchTransfer(harness, created.id)).json()) as {
        data: { status: string };
      };
      expect(fetched.data.status).toBe("FAILED");
      expect(harness.drafts.some((draft) => draft.key === "transfer.completed")).toBe(true);
    });
  });

  it("T4 transfer-stuck-pending resolves successful with thenFailPercent 0", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "transfer-stuck-pending",
        twins: ["flutterwave"],
        actions: "transfer.create",
        settings: { seconds: 1, thenFailPercent: 0 },
      });
      const created = await makeTransfer(harness, "stuck-success");
      harness.clock.advanceBy(1_000);
      const fetched = (await (await fetchTransfer(harness, created.id)).json()) as {
        data: { status: string };
      };
      expect(fetched.data.status).toBe("SUCCESSFUL");
      expect(harness.drafts.some((draft) => draft.key === "transfer.completed")).toBe(true);
    });
  });

  it("T4 transfer-stuck-pending without seconds stays pending until switched off", async () => {
    await withHarness(async (harness) => {
      harness.rules.add({
        failureId: "transfer-stuck-pending",
        twins: ["flutterwave"],
        actions: "transfer.create",
        settings: { seconds: null, thenFailPercent: 100 },
      });
      const created = await makeTransfer(harness, "stuck-forever");
      harness.clock.advanceBy(86_400_000);
      const fetched = (await (await fetchTransfer(harness, created.id)).json()) as {
        data: { status: string };
      };
      expect(fetched.data.status).toBe("PENDING");
      expect(harness.drafts).toHaveLength(0);
    });
  });

  it("T4 bank-resolve-fails returns Flutterwave's error and timeout shapes", async () => {
    await withHarness(async (harness) => {
      const errorRule = harness.rules.add({
        failureId: "bank-resolve-fails",
        twins: ["flutterwave"],
        actions: "bank.resolve",
        settings: { mode: "error" },
      });
      const failed = await resolveAccount(harness, {
        account_number: "0000000001",
        account_bank: "044",
      });
      expect(failed.status).toBe(400);
      expect(await failed.json()).toEqual({
        status: "error",
        message: "Account lookup failed",
        data: null,
      });
      harness.rules.remove(errorRule.id);

      harness.rules.add({
        failureId: "bank-resolve-fails",
        twins: ["flutterwave"],
        actions: "bank.resolve",
        settings: { mode: "timeout" },
      });
      const timedOut = await resolveAccount(harness, {
        account_number: "0000000001",
        account_bank: "044",
      });
      expect(timedOut.status).toBe(503);
      expect(await timedOut.json()).toEqual({
        status: "error",
        message: "An error occurred. Please contact support",
        data: null,
      });
    });
  });

  it("T4 transfer-reversed is refused for Flutterwave (C21 D33)", async () => {
    await withHarness(async (harness) => {
      expect(() => {
        harness.rules.add({
          failureId: "transfer-reversed",
          twins: ["flutterwave"],
          actions: "transfer.create",
        });
      }).toThrow(/not supported/u);
      expect(harness.rules.activeRules()).toEqual([]);
    });
  });
});
