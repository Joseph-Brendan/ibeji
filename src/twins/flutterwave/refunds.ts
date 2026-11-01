import type {
  ActionContext,
  ActionDefinition,
  JsonValue,
  TwinRequest,
  TwinStateStore,
  TwinWebhookDraft,
} from "../framework/types.js";
import { flutterwaveMoney } from "./money.js";
import {
  isoTimestamp,
  listStoredPayments,
  majorFromMinor,
  parseJsonObject,
  readRawAmountText,
} from "./payments.js";
import {
  flutterwaveResponses,
  invalidBodyResponse,
  invalidRefundAmountResponse,
  jsonResponse,
  refundExceedsRemainingResponse,
  refundExceedsTransactionResponse,
  refundFullyRefundedResponse,
  refundIntValidationResponse,
  refundMinimumResponse,
  refundNotFoundResponse,
  refundProcessingResponse,
  refundTransactionNotFoundResponse,
  refundTransactionNotSuccessfulResponse,
} from "./responses.js";
import type { FlutterwavePayment, FlutterwaveRefund } from "./state.js";
import { flutterwaveRefundSchema } from "./state.js";

const REFUNDS = "refunds";
const ACCOUNT_ID = 1_967_796;
const WALLET_ID = 1_758_359;

/**
 * Flutterwave's refund status list has no exact transition timings. The
 * recorded create response showed completed, but a second partial refund
 * immediately afterwards was rejected as still processing. Ibeji uses a
 * two-minute processing window so the documented duplicate-refund error and
 * status changes can both be tested. This is a local test timing, not a
 * Flutterwave timing.
 */
export const REFUND_COMPLETION_DELAY_MS = 120_000;

let nextRefundId = 110_122;

function nextRefundNumber(): number {
  const id = nextRefundId;
  nextRefundId += 1;
  return id;
}

function queryString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validDatePrefix(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}

export function refundRecord(
  state: TwinStateStore,
  refundId: string,
): FlutterwaveRefund | undefined {
  return state.read(REFUNDS, refundId, flutterwaveRefundSchema);
}

export function listStoredRefunds(state: TwinStateStore): readonly FlutterwaveRefund[] {
  return state.list(REFUNDS, flutterwaveRefundSchema);
}

function refundsFor(state: TwinStateStore, transactionId: number): readonly FlutterwaveRefund[] {
  return listStoredRefunds(state).filter((refund) => refund.transactionId === transactionId);
}

function refundedTotal(state: TwinStateStore, transactionId: number): number {
  return refundsFor(state, transactionId).reduce((sum, refund) => sum + refund.amount, 0);
}

function transactionFor(state: TwinStateStore, rawId: string): FlutterwavePayment | undefined {
  return listStoredPayments(state).find((payment) => String(payment.transactionId) === rawId);
}

function metaString(refund: FlutterwaveRefund): string {
  return JSON.stringify({
    source: refund.metaSource,
    isPartialRefund: refund.metaIsPartialRefund,
    uniquereference: refund.metaUniqueReference,
  });
}

function refundCreateData(refund: FlutterwaveRefund): Record<string, unknown> {
  return {
    id: refund.refundId,
    amount_refunded: majorFromMinor(refund.amount),
    status: refund.status,
    flw_ref: refund.flwRef,
    destination: refund.destination,
    comments: refund.comments,
    meta: {
      source: refund.metaSource,
      isPartialRefund: refund.metaIsPartialRefund,
      uniquereference: refund.metaUniqueReference,
    },
    created_at: refund.createdAt,
    wallet_id: refund.walletId,
    account_id: refund.accountId,
    tx_id: refund.transactionId,
  };
}

function refundFetchData(refund: FlutterwaveRefund): Record<string, unknown> {
  return {
    id: refund.refundId,
    amount_refunded: majorFromMinor(refund.amount),
    status: refund.status,
    flw_ref: refund.flwRef,
    comment: refund.comments,
    settlement_id: refund.settlementId,
    meta: metaString(refund),
    created_at: refund.createdAt,
    account_id: refund.accountId,
    transaction_id: refund.transactionId,
  };
}

function refundWebhookData(refund: FlutterwaveRefund): Record<string, unknown> {
  return {
    id: refund.refundId,
    AmountRefunded: majorFromMinor(refund.amount),
    status: refund.status,
    FlwRef: refund.flwRef,
    destination: refund.destination,
    comments: refund.comments,
    settlement_id: refund.settlementId,
    meta: metaString(refund),
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
    deletedAt: null,
    walletId: refund.walletId,
    AccountId: refund.accountId,
    TransactionId: refund.transactionId,
  };
}

function emitRefundWebhook(context: ActionContext, refund: FlutterwaveRefund): void {
  const draft: TwinWebhookDraft = {
    key: "refund",
    actionId: "refund.create",
    resourceId: refund.id,
    occurredAt: context.clock.now(),
    data: refundWebhookData(refund) as unknown as JsonValue,
  };
  context.webhooks.emit(draft);
}

function completeRefund(context: ActionContext, refundId: string): void {
  const current = refundRecord(context.state, refundId);
  if (current === undefined || current.status !== "processing") {
    return;
  }
  const updated: FlutterwaveRefund = {
    ...current,
    status: "completed",
    updatedAt: isoTimestamp(context.clock),
  };
  context.state.update(REFUNDS, updated.id, updated);
  emitRefundWebhook(context, updated);
}

function scheduleRefundCompletion(context: ActionContext, refundId: string): void {
  context.clock.setTimeout(() => {
    completeRefund(context, refundId);
  }, REFUND_COMPLETION_DELAY_MS);
}

function refundEventSummary(request: TwinRequest, state: TwinStateStore): string {
  const body = parseJsonObject(request.rawBody);
  const rawId = request.params.id ?? "";
  const amountText =
    body === undefined ? undefined : (readRawAmountText(request.rawBody) ?? amountValueText(body));
  if (amountText === undefined) {
    return `Your app created a Flutterwave refund for transaction ${rawId}`;
  }

  const transaction = listStoredPayments(state).find(
    (payment) => String(payment.transactionId) === rawId,
  );
  const currency = transaction?.currency ?? "NGN";
  try {
    const amount = flutterwaveMoney.parseServiceAmount(amountText, currency);
    return `Your app refunded ${flutterwaveMoney.formatDisplay(amount, currency)} through Flutterwave for transaction ${rawId}`;
  } catch {
    return `Your app created a Flutterwave refund for transaction ${rawId}`;
  }
}

function amountValueText(body: Record<string, unknown>): string | undefined {
  if (typeof body.amount === "string" && body.amount.trim().length > 0) {
    return body.amount;
  }
  if (typeof body.amount === "number" && Number.isSafeInteger(body.amount)) {
    return String(body.amount);
  }
  return undefined;
}

function requestAmountMinor(body: Record<string, unknown>, rawBody: Uint8Array): number | null {
  const text = readRawAmountText(rawBody) ?? amountValueText(body);
  if (text === undefined) {
    return null;
  }
  return flutterwaveMoney.parseServiceAmount(text, "NGN");
}

function minimumFor(currency: string): number | undefined {
  if (currency === "NGN") {
    return 100;
  }
  if (currency === "KES") {
    return 10;
  }
  return undefined;
}

function createRefund(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return invalidBodyResponse();
  }

  const rawTransactionId = context.request.params.id ?? "";
  if (!/^\d+$/u.test(rawTransactionId)) {
    return refundTransactionNotFoundResponse();
  }

  const transaction = transactionFor(context.state, rawTransactionId);
  if (transaction === undefined || transaction.status !== "successful") {
    return transaction === undefined
      ? refundTransactionNotFoundResponse()
      : refundTransactionNotSuccessfulResponse();
  }

  let requested: number | null;
  try {
    requested = requestAmountMinor(body, context.request.rawBody);
  } catch {
    return invalidRefundAmountResponse();
  }

  const refunded = refundedTotal(context.state, transaction.transactionId);
  const remaining = transaction.amount - refunded;
  const amount = requested === null ? remaining : requested;

  if (amount <= 0) {
    return refundFullyRefundedResponse();
  }
  if (amount > transaction.amount) {
    return refundExceedsTransactionResponse();
  }
  if (amount > remaining) {
    return refundExceedsRemainingResponse();
  }

  const partial = amount < transaction.amount;
  if (
    partial &&
    refundsFor(context.state, transaction.transactionId).some(
      (refund) => refund.status === "processing",
    )
  ) {
    return refundProcessingResponse();
  }

  const minimum = minimumFor(transaction.currency);
  if (requested !== null && minimum !== undefined && amount < minimum * 100) {
    return refundMinimumResponse(transaction.currency, minimum);
  }

  const now = isoTimestamp(context.clock);
  const refundId = nextRefundNumber();
  const refund: FlutterwaveRefund = {
    id: String(refundId),
    refundId,
    transactionId: transaction.transactionId,
    txRef: transaction.txRef,
    amount,
    currency: transaction.currency,
    status: "processing",
    flwRef: transaction.flwRef ?? "N/A",
    destination: "payment_source",
    comments: typeof body.comments === "string" ? body.comments : null,
    createdAt: now,
    updatedAt: now,
    settlementId: "NEW",
    walletId: WALLET_ID,
    accountId: ACCOUNT_ID,
    metaSource: "ledgerbalance",
    metaIsPartialRefund: partial,
    metaUniqueReference: String(context.random.int(10_000_000_000, 99_999_999_999)),
  };

  context.state.insert(REFUNDS, refund);
  emitRefundWebhook(context, refund);
  scheduleRefundCompletion(context, refund.id);

  return flutterwaveResponses.success(context.action, refundCreateData(refund));
}

function fetchRefund(context: ActionContext) {
  const rawId = context.request.params.id ?? "";
  if (!/^\d+$/u.test(rawId)) {
    return refundIntValidationResponse(rawId);
  }
  const refund = refundRecord(context.state, rawId);
  if (refund === undefined) {
    return refundNotFoundResponse();
  }
  return jsonResponse(200, refundFetchData(refund));
}

function listRefunds(context: ActionContext) {
  const fromRaw = queryString(context.request.query.from);
  const toRaw = queryString(context.request.query.to);
  const from = validDatePrefix(fromRaw);
  const to = validDatePrefix(toRaw);
  if ((fromRaw !== undefined && from === undefined) || (toRaw !== undefined && to === undefined)) {
    return flutterwaveResponses.success(context.action, [], {
      page_info: { total: 0, current_page: 0, total_pages: 0, page_size: 0 },
    });
  }

  const status = queryString(context.request.query.status);
  const currency = queryString(context.request.query.currency)?.toUpperCase();
  const flwRef = queryString(context.request.query.flw_ref);
  const transactionId = queryString(context.request.query.id);

  const filtered = listStoredRefunds(context.state)
    .filter((refund) => from === undefined || refund.createdAt.slice(0, 10) >= from)
    .filter((refund) => to === undefined || refund.createdAt.slice(0, 10) <= to)
    .filter((refund) => status === undefined || refund.status === status)
    .filter((refund) => currency === undefined || refund.currency === currency)
    .filter((refund) => flwRef === undefined || refund.flwRef === flwRef)
    .filter(
      (refund) => transactionId === undefined || String(refund.transactionId) === transactionId,
    )
    .sort((left, right) => right.refundId - left.refundId);

  const total = filtered.length;
  return flutterwaveResponses.success(context.action, filtered.map(refundFetchData), {
    page_info: {
      total,
      current_page: total === 0 ? 0 : 1,
      total_pages: total === 0 ? 0 : 1,
      page_size: total === 0 ? 0 : 20,
    },
  });
}

export const refundActions: readonly ActionDefinition[] = [
  {
    id: "refund.create",
    method: "POST",
    path: "/v3/transactions/:id/refund",
    summary: "Refund a transaction",
    kind: "write",
    eventSummary: refundEventSummary,
    handler: createRefund,
  },
  {
    id: "refund.fetch",
    method: "GET",
    path: "/v3/refunds/:id",
    summary: "Fetch a refund",
    kind: "read",
    handler: fetchRefund,
  },
  {
    id: "refund.list",
    method: "GET",
    path: "/v3/refunds",
    summary: "List refunds",
    kind: "read",
    handler: listRefunds,
  },
];
