import type {
  ActionContext,
  ActionDefinition,
  JsonValue,
  TwinRequest,
  TwinStateStore,
  TwinWebhookDraft,
} from "../framework/types.js";
import { accountNameFor, bankNameFor, findBank } from "./banks.js";
import { flutterwaveMoney } from "./money.js";
import { isoTimestamp, majorFromMinor, parseJsonObject, readRawAmountText } from "./payments.js";
import {
  duplicateTransferReferenceResponse,
  flutterwaveResponses,
  invalidBodyResponse,
  invalidTransferAmountResponse,
  invalidTransferIdResponse,
  invalidTransferPageResponse,
  transferAmountRequiredResponse,
  transferFieldRequiredResponse,
  transferNotFoundResponse,
} from "./responses.js";
import type { FlutterwaveTransfer } from "./state.js";
import { flutterwaveTransferSchema } from "./state.js";

const TRANSFERS = "transfers";
const DEFAULT_TEST_DELAY_MS = 10 * 60 * 1_000;

let nextTransferId = 26_251;

function nextTransferNumber(): number {
  const id = nextTransferId;
  nextTransferId += 1;
  return id;
}

function amountTextOf(body: Record<string, unknown>, rawBody: Uint8Array): string | undefined {
  const raw = readRawAmountText(rawBody);
  if (raw !== undefined) {
    return raw;
  }
  return typeof body.amount === "string" ? body.amount : undefined;
}

function readCurrency(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function metaOf(value: unknown): FlutterwaveTransfer["meta"] {
  return value === undefined || value === null ? null : (value as FlutterwaveTransfer["meta"]);
}

/**
 * The transfer fee formula is not documented. This is a local placeholder so
 * the response has a number; it is not a Flutterwave fact.
 */
function feeFor(amountMinor: number): number {
  return Math.floor((amountMinor * 8) / 1_000);
}

export function transferRecord(state: TwinStateStore, id: string): FlutterwaveTransfer | undefined {
  return state.read(TRANSFERS, id, flutterwaveTransferSchema);
}

export function listStoredTransfers(state: TwinStateStore): readonly FlutterwaveTransfer[] {
  return state.list(TRANSFERS, flutterwaveTransferSchema);
}

function findTransferByReference(
  state: TwinStateStore,
  reference: string,
): FlutterwaveTransfer | undefined {
  return listStoredTransfers(state).find((transfer) => transfer.reference === reference);
}

/**
 * The create and fetch/list API objects share most fields. The create sample
 * returns status NEW; the test-transfer guide says test transfers then remain
 * PENDING. The stored record is PENDING and only the create response uses NEW.
 *
 * Source: documentation, not recorded.
 */
function transferApiData(
  transfer: FlutterwaveTransfer,
  statusOverride?: "NEW",
): Record<string, unknown> {
  return {
    id: transfer.transferId,
    account_number: transfer.accountNumber,
    bank_code: transfer.bankCode,
    full_name: transfer.fullName,
    created_at: transfer.createdAt,
    currency: transfer.currency,
    debit_currency: transfer.debitCurrency,
    amount: majorFromMinor(transfer.amount),
    fee: majorFromMinor(transfer.fee),
    status: statusOverride ?? transfer.status,
    reference: transfer.reference,
    meta: transfer.meta,
    narration: transfer.narration,
    approver: null,
    complete_message: transfer.completeMessage,
    requires_approval: transfer.requiresApproval,
    is_approved: transfer.isApproved,
    bank_name: transfer.bankName,
    debit_currency_amount: null,
    rate: null,
  };
}

// Source: documentation, not recorded.
function transferWebhookData(transfer: FlutterwaveTransfer): Record<string, unknown> {
  return {
    id: transfer.transferId,
    account_number: transfer.accountNumber,
    bank_name: transfer.bankName,
    bank_code: transfer.bankCode,
    fullname: transfer.fullName,
    created_at: transfer.createdAt,
    currency: transfer.currency,
    debit_currency: transfer.debitCurrency,
    amount: majorFromMinor(transfer.amount),
    fee: majorFromMinor(transfer.fee),
    status: transfer.status,
    reference: transfer.reference,
    meta: transfer.meta,
    narration: transfer.narration,
    approver: null,
    complete_message: transfer.completeMessage,
    requires_approval: transfer.requiresApproval,
    is_approved: transfer.isApproved,
  };
}

function emitTransferWebhook(context: ActionContext, transfer: FlutterwaveTransfer): void {
  const draft: TwinWebhookDraft = {
    key: "transfer.completed",
    actionId: "transfer.create",
    resourceId: transfer.id,
    occurredAt: context.clock.now(),
    data: transferWebhookData(transfer) as unknown as JsonValue,
  };
  context.webhooks.emit(draft);
}

/**
 * The success text is from the documented webhook sample. The failure text is
 * a local placeholder because a complete failure story is not documented.
 */
function completeMessageFor(status: "SUCCESSFUL" | "FAILED"): string {
  return status === "SUCCESSFUL"
    ? "Successful"
    : "DISBURSE FAILED: The bank could not complete this transfer";
}

function transitionTransfer(
  context: ActionContext,
  transferId: string,
  status: "SUCCESSFUL" | "FAILED",
): void {
  const current = transferRecord(context.state, transferId);
  if (current === undefined || current.status !== "PENDING") {
    return;
  }

  const updated: FlutterwaveTransfer = {
    ...current,
    status,
    updatedAt: isoTimestamp(context.clock),
    completeMessage: completeMessageFor(status),
  };
  context.state.update(TRANSFERS, updated.id, updated);
  emitTransferWebhook(context, updated);
}

function suffixMinutes(match: RegExpExecArray | null): number | undefined {
  if (match === null) {
    return undefined;
  }
  const raw = match[1];
  if (raw === undefined || !/^\d+$/u.test(raw)) {
    return undefined;
  }
  const minutes = Number(raw);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : undefined;
}

/**
 * Flutterwave's test-transfer guide documents these reference suffixes:
 * _PMCK succeeds after 10 minutes, _PMCK_ST_F fails after 10 minutes, and
 * DU_n changes the delay to n minutes. Transfers without a suffix stay
 * PENDING, which is the documented default for test transfers.
 *
 * Source: documentation, not recorded in the saved fixtures.
 */
export function testTransferSchedule(
  reference: string,
): { readonly status: "SUCCESSFUL" | "FAILED"; readonly delayMs: number } | undefined {
  const failedWithDelay = /_PMCK_ST_FDU_(\d+)$/u.exec(reference);
  const failedMinutes = suffixMinutes(failedWithDelay);
  if (failedMinutes !== undefined) {
    return { status: "FAILED", delayMs: failedMinutes * 60_000 };
  }

  const successWithDelay = /_PMCKDU_(\d+)$/u.exec(reference);
  const successMinutes = suffixMinutes(successWithDelay);
  if (successMinutes !== undefined) {
    return { status: "SUCCESSFUL", delayMs: successMinutes * 60_000 };
  }

  if (/_PMCK_ST_F$/u.test(reference)) {
    return { status: "FAILED", delayMs: DEFAULT_TEST_DELAY_MS };
  }
  if (/_PMCK$/u.test(reference)) {
    return { status: "SUCCESSFUL", delayMs: DEFAULT_TEST_DELAY_MS };
  }
  return undefined;
}

function scheduleTransfer(context: ActionContext, transfer: FlutterwaveTransfer): void {
  const stuck = context.failures.transferStuckPending;
  if (stuck !== undefined) {
    if (typeof stuck.seconds === "number") {
      context.clock.setTimeout(() => {
        transitionTransfer(
          context,
          transfer.id,
          stuck.thenFailed === true ? "FAILED" : "SUCCESSFUL",
        );
      }, stuck.seconds * 1_000);
    }
    return;
  }

  const scheduled = testTransferSchedule(transfer.reference);
  if (scheduled === undefined) {
    return;
  }
  context.clock.setTimeout(() => {
    transitionTransfer(context, transfer.id, scheduled.status);
  }, scheduled.delayMs);
}

function generatedReference(context: ActionContext): string {
  return `ibeji-flutterwave-${context.clock.now()}-${context.random.int(100_000, 999_999)}`;
}

function uniqueReference(context: ActionContext, requested: string): string | undefined {
  if (requested.length === 0) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generatedReference(context);
      if (findTransferByReference(context.state, candidate) === undefined) {
        return candidate;
      }
    }
    return undefined;
  }
  if (findTransferByReference(context.state, requested) !== undefined) {
    return undefined;
  }
  return requested;
}

function transferEventSummary(request: TwinRequest): string {
  const body = parseJsonObject(request.rawBody);
  if (body === undefined) {
    return "Your app tried to start a Flutterwave transfer.";
  }
  const amountText = amountTextOf(body, request.rawBody);
  const currency = readCurrency(body.currency) || "NGN";
  const accountNumber = typeof body.account_number === "string" ? body.account_number.trim() : "";
  const bankCode = typeof body.account_bank === "string" ? body.account_bank.trim() : "";
  const providedName =
    typeof body.beneficiary_name === "string" ? body.beneficiary_name.trim() : "";
  const name =
    providedName.length > 0
      ? providedName
      : /^\d{10}$/u.test(accountNumber) && findBank(bankCode) !== undefined
        ? accountNameFor(accountNumber, bankCode)
        : undefined;

  if (amountText === undefined) {
    return "Your app tried to start a Flutterwave transfer.";
  }
  try {
    const amount = flutterwaveMoney.parseServiceAmount(amountText, currency);
    const formatted = flutterwaveMoney.formatDisplay(amount, currency);
    return name === undefined
      ? `Your app sent ${formatted} through Flutterwave`
      : `Your app sent ${formatted} to ${name} through Flutterwave`;
  } catch {
    return "Your app tried to start a Flutterwave transfer.";
  }
}

// Source: documentation, not recorded.
function createTransfer(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return invalidBodyResponse();
  }

  const accountBank = typeof body.account_bank === "string" ? body.account_bank.trim() : "";
  if (accountBank.length === 0) {
    return transferFieldRequiredResponse("account_bank");
  }
  const accountNumber = typeof body.account_number === "string" ? body.account_number.trim() : "";
  if (accountNumber.length === 0) {
    return transferFieldRequiredResponse("account_number");
  }

  const amountText = amountTextOf(body, context.request.rawBody);
  if (amountText === undefined) {
    return transferAmountRequiredResponse();
  }

  const currency = readCurrency(body.currency);
  if (currency.length === 0) {
    return transferFieldRequiredResponse("currency");
  }

  let amount: number;
  try {
    amount = flutterwaveMoney.parseServiceAmount(amountText, currency);
    flutterwaveMoney.assertValid(amount, currency);
  } catch {
    return invalidTransferAmountResponse();
  }

  const requestedReference = typeof body.reference === "string" ? body.reference.trim() : "";
  const reference = uniqueReference(context, requestedReference);
  if (reference === undefined) {
    return duplicateTransferReferenceResponse();
  }

  const providedName =
    typeof body.beneficiary_name === "string" ? body.beneficiary_name.trim() : "";
  const fullName =
    providedName.length > 0
      ? providedName
      : /^\d{10}$/u.test(accountNumber) && findBank(accountBank) !== undefined
        ? accountNameFor(accountNumber, accountBank)
        : "Flutterwave Beneficiary";

  const debitCurrency = readCurrency(body.debit_currency) || currency;
  const narration =
    typeof body.narration === "string" && body.narration.trim().length > 0
      ? body.narration.trim()
      : "Flutterwave transfer";
  const now = isoTimestamp(context.clock);
  const transferId = nextTransferNumber();
  const transfer: FlutterwaveTransfer = {
    id: String(transferId),
    transferId,
    accountNumber,
    bankCode: accountBank,
    bankName: bankNameFor(accountBank),
    fullName,
    amount,
    currency,
    debitCurrency,
    fee: feeFor(amount),
    status: "PENDING",
    reference,
    meta: metaOf(body.meta),
    narration,
    createdAt: now,
    updatedAt: now,
    completeMessage: "",
    requiresApproval: 0,
    isApproved: 1,
  };

  context.state.insert(TRANSFERS, transfer);
  scheduleTransfer(context, transfer);

  return flutterwaveResponses.success(context.action, transferApiData(transfer, "NEW"));
}

// Source: documentation, not recorded.
function fetchTransfer(context: ActionContext) {
  const rawId = context.request.params.id ?? "";
  if (!/^\d+$/u.test(rawId)) {
    return invalidTransferIdResponse();
  }
  const transfer = transferRecord(context.state, rawId);
  if (transfer === undefined) {
    return transferNotFoundResponse();
  }
  return flutterwaveResponses.success(context.action, transferApiData(transfer));
}

function queryString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function validDatePrefix(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}

// Source: documentation, not recorded; the recorded list fixture is empty.
function listTransfers(context: ActionContext) {
  const pageValue = queryString(context.request.query.page);
  if (pageValue !== undefined && positiveNumber(pageValue) === undefined) {
    return invalidTransferPageResponse();
  }
  const page = positiveNumber(pageValue) ?? 1;
  const pageSize = positiveNumber(queryString(context.request.query.page_size)) ?? 10;
  const reference = queryString(context.request.query.reference);
  const status = queryString(context.request.query.status)?.toUpperCase();
  const from = validDatePrefix(queryString(context.request.query.from));
  const to = validDatePrefix(queryString(context.request.query.to));

  const filtered = listStoredTransfers(context.state)
    .filter((transfer) => reference === undefined || transfer.reference === reference)
    .filter((transfer) => status === undefined || transfer.status === status)
    .filter((transfer) => from === undefined || transfer.createdAt.slice(0, 10) >= from)
    .filter((transfer) => to === undefined || transfer.createdAt.slice(0, 10) <= to)
    .sort((left, right) => right.transferId - left.transferId);

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize).map((transfer) => transferApiData(transfer));

  return flutterwaveResponses.success(context.action, data, {
    page_info: {
      total,
      current_page: total === 0 ? 0 : page,
      total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  });
}

export const transferActions: readonly ActionDefinition[] = [
  {
    id: "transfer.create",
    method: "POST",
    path: "/v3/transfers",
    summary: "Initiate a transfer",
    kind: "write",
    eventSummary: transferEventSummary,
    handler: createTransfer,
  },
  {
    id: "transfer.fetch",
    method: "GET",
    path: "/v3/transfers/:id",
    summary: "Fetch a transfer",
    kind: "read",
    handler: fetchTransfer,
  },
  {
    id: "transfer.list",
    method: "GET",
    path: "/v3/transfers",
    summary: "List transfers",
    kind: "read",
    handler: listTransfers,
  },
];
