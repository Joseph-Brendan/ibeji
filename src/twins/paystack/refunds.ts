import type {
  ActionContext,
  ActionDefinition,
  JsonValue,
  TwinWebhookDraft,
} from "../framework/types.js";
import { paystackMoney } from "./money.js";
import {
  invalidAmountResponse,
  invalidBodyResponse,
  invalidRefundIdResponse,
  paystackResponses,
  refundAmountExceedsPaidResponse,
  refundAmountExceedsRemainingResponse,
  refundFullyRefundedResponse,
  refundNotFoundResponse,
  refundTransactionNotFoundResponse,
  refundTransactionNotSuccessfulResponse,
  refundTransactionRequiredResponse,
} from "./responses.js";
import type { PaystackRefund, PaystackTransaction } from "./state.js";
import { paystackRefundSchema } from "./state.js";
import { listStoredTransactions, parseJsonObject } from "./transactions.js";

const REFUNDS = "refunds";
const INTEGRATION_ID = 1_044_674;
const REFUNDED_BY = "gmail";

/**
 * The research file records the refund status names but not their exact
 * timings. These are Ibeji's local test timings, not Paystack facts.
 */
export const REFUND_PROCESSING_DELAY_MS = 60_000;
export const REFUND_PROCESSED_DELAY_MS = 120_000;
export const REFUND_EXPECTED_MS = 9 * 24 * 60 * 60 * 1_000;

let nextRefundId = 18_884_372;

function nextRefundNumber(): number {
  const id = nextRefundId;
  nextRefundId += 1;
  return id;
}

function isoTimestamp(clock: { readonly now: () => number }): string {
  return new Date(clock.now()).toISOString();
}

function queryString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRefundAmount(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/u.test(trimmed)) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  return undefined;
}

function transactionIdentifier(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return undefined;
}

function metadataString(metadata: PaystackTransaction["metadata"]): string | null {
  if (metadata === null) {
    return null;
  }
  return typeof metadata === "string" ? metadata : JSON.stringify(metadata);
}

function findTransaction(
  state: ActionContext["state"],
  identifier: string,
): PaystackTransaction | undefined {
  return listStoredTransactions(state).find(
    (transaction) =>
      transaction.reference === identifier || String(transaction.transactionId) === identifier,
  );
}

function refundsFor(
  state: ActionContext["state"],
  transactionReference: string,
): readonly PaystackRefund[] {
  return state
    .list(REFUNDS, paystackRefundSchema)
    .filter((refund) => refund.transactionReference === transactionReference);
}

function refundedTotal(state: ActionContext["state"], transactionReference: string): number {
  return refundsFor(state, transactionReference).reduce((sum, refund) => sum + refund.amount, 0);
}

function refundType(amount: number, transactionAmount: number): "Full" | "Partial" {
  return amount === transactionAmount ? "Full" : "Partial";
}

function refundCustomer(refund: PaystackRefund): Record<string, unknown> {
  return {
    id: refund.customerId,
    first_name: null,
    last_name: null,
    email: refund.email,
    customer_code: refund.customerCode,
    phone: null,
    metadata: null,
    risk_action: "default",
    international_format_phone: null,
  };
}

function createTransactionObject(transaction: PaystackTransaction): Record<string, unknown> {
  return {
    id: transaction.transactionId,
    domain: "test",
    reference: transaction.reference,
    receipt_number: null,
    amount: transaction.amount,
    gateway_response_code: null,
    response_code: null,
    paid_at: transaction.paidAt ?? transaction.createdAt,
    channel: "card",
    currency: transaction.currency,
    metadata: metadataString(transaction.metadata),
    authorization: {
      exp_month: null,
      exp_year: null,
      account_name: null,
      receiver_bank_account_number: null,
      receiver_bank: null,
    },
    customer: {
      international_format_phone: null,
    },
    plan: {},
    subaccount: {
      currency: null,
      is_verified: false,
    },
    split: {},
    order_id: null,
    paidAt: transaction.paidAt ?? transaction.createdAt,
    requested_amount: transaction.amount,
    pos_transaction_data: null,
    source: null,
    fees_breakdown: null,
    connect: null,
  };
}

function createRefundData(
  refund: PaystackRefund,
  transaction: PaystackTransaction,
): Record<string, unknown> {
  return {
    integration: INTEGRATION_ID,
    transaction: createTransactionObject(transaction),
    id: refund.refundId,
    domain: "test",
    currency: refund.currency,
    amount: refund.amount,
    status: refund.status,
    expected_at: refund.expectedAt,
    channel: "test",
    refunded_by: REFUNDED_BY,
    customer_note: refund.customerNote,
    merchant_note: refund.merchantNote,
    deducted_amount: 0,
    fully_deducted: false,
    reason: "PENDING",
    customer: null,
    initiated_by: REFUNDED_BY,
    session_id: null,
  };
}

function refundData(refund: PaystackRefund): Record<string, unknown> {
  return {
    integration: INTEGRATION_ID,
    transaction: refund.transactionId,
    dispute: null,
    settlement: null,
    id: refund.refundId,
    domain: "test",
    currency: refund.currency,
    amount: refund.amount,
    status: refund.status,
    refunded_at: refund.refundedAt,
    refunded_by: REFUNDED_BY,
    customer_note: refund.customerNote,
    merchant_note: refund.merchantNote,
    deducted_amount: refund.amount,
    fully_deducted: refund.amount === refund.transactionAmount ? 1 : 0,
    createdAt: refund.createdAt,
    bank_reference: null,
    transaction_reference: refund.transactionReference,
    reason: refund.reason,
    customer: refundCustomer(refund),
    initiated_by: REFUNDED_BY,
    refund_type: refundType(refund.amount, refund.transactionAmount),
    transaction_amount: refund.transactionAmount,
    refund_channel: "Original Payment",
    session_id: null,
    retriable: false,
  };
}

function webhookData(refund: PaystackRefund): Record<string, unknown> {
  return {
    status: refund.status,
    transaction_reference: refund.transactionReference,
    refund_reference: null,
    amount: String(refund.amount),
    currency: refund.currency,
    processor: "instant-transfer",
    customer: {
      first_name: null,
      last_name: null,
      email: refund.email,
    },
    integration: INTEGRATION_ID,
    domain: "test",
  };
}

function emitRefundWebhook(context: ActionContext, refund: PaystackRefund): void {
  const draft: TwinWebhookDraft = {
    key: `refund.${refund.status}`,
    actionId: "refund.create",
    resourceId: refund.id,
    occurredAt: context.clock.now(),
    data: webhookData(refund) as unknown as JsonValue,
  };
  context.webhooks.emit(draft);
}

function transitionRefund(
  context: ActionContext,
  refundId: string,
  status: "processing" | "processed",
): void {
  const current = context.state.read(REFUNDS, refundId, paystackRefundSchema);
  if (current === undefined) {
    return;
  }
  if (status === "processing" && current.status !== "pending") {
    return;
  }
  if (status === "processed" && current.status === "processed") {
    return;
  }

  const updated: PaystackRefund = {
    ...current,
    status,
    reason: status.toUpperCase(),
    refundedAt: status === "processed" ? isoTimestamp(context.clock) : current.refundedAt,
  };
  context.state.update(REFUNDS, refundId, updated);
  emitRefundWebhook(context, updated);
}

function scheduleRefundStatus(context: ActionContext, refundId: string): void {
  context.clock.setTimeout(() => {
    transitionRefund(context, refundId, "processing");
  }, REFUND_PROCESSING_DELAY_MS);
  context.clock.setTimeout(() => {
    transitionRefund(context, refundId, "processed");
  }, REFUND_PROCESSED_DELAY_MS);
}

function defaultNotes(transaction: PaystackTransaction): {
  customerNote: string;
  merchantNote: string;
} {
  const base = `Refund for transaction ${transaction.reference}`;
  return {
    customerNote: base,
    merchantNote: `${base} by ${transaction.email}`,
  };
}

function refundEventSummary(request: { readonly rawBody: Uint8Array }): string {
  const body = parseJsonObject(request.rawBody);
  if (body === undefined) {
    return "Your app tried to create a Paystack refund.";
  }
  const identifier = transactionIdentifier(body.transaction);
  const amountValue = readRefundAmount(body.amount);
  if (identifier === undefined) {
    return "Your app tried to create a Paystack refund.";
  }
  if (amountValue === null || amountValue === undefined) {
    return `Your app created a Paystack refund for transaction ${identifier}`;
  }
  const currency =
    typeof body.currency === "string" && body.currency.trim().length > 0
      ? body.currency.trim().toUpperCase()
      : "NGN";
  const formatted = paystackMoney.formatDisplay(amountValue, currency);
  const readable = formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
  return `Your app refunded ${readable} through Paystack for transaction ${identifier}`;
}

function createRefund(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return invalidBodyResponse();
  }

  const identifier = transactionIdentifier(body.transaction);
  if (identifier === undefined) {
    return refundTransactionRequiredResponse();
  }

  const transaction = findTransaction(context.state, identifier);
  if (transaction === undefined) {
    return refundTransactionNotFoundResponse();
  }
  if (transaction.status !== "success") {
    return refundTransactionNotSuccessfulResponse();
  }

  const requestedAmount = readRefundAmount(body.amount);
  if (requestedAmount === undefined) {
    return invalidAmountResponse();
  }

  const remaining = transaction.amount - refundedTotal(context.state, transaction.reference);
  const amount = requestedAmount === null ? remaining : requestedAmount;

  if (amount <= 0) {
    return refundFullyRefundedResponse();
  }
  if (amount > transaction.amount) {
    return refundAmountExceedsPaidResponse();
  }
  if (amount > remaining) {
    return refundAmountExceedsRemainingResponse();
  }

  const now = isoTimestamp(context.clock);
  const notes = defaultNotes(transaction);
  const refundId = nextRefundNumber();
  const refund: PaystackRefund = {
    id: String(refundId),
    refundId,
    transactionId: transaction.transactionId,
    transactionReference: transaction.reference,
    transactionAmount: transaction.amount,
    transactionPaidAt: transaction.paidAt ?? transaction.createdAt,
    transactionMetadata: metadataString(transaction.metadata),
    currency: transaction.currency,
    email: transaction.email,
    customerId: transaction.customerId,
    customerCode: transaction.customerCode,
    amount,
    status: "pending",
    createdAt: now,
    expectedAt: new Date(context.clock.now() + REFUND_EXPECTED_MS).toISOString(),
    refundedAt: null,
    customerNote: typeof body.customer_note === "string" ? body.customer_note : notes.customerNote,
    merchantNote: typeof body.merchant_note === "string" ? body.merchant_note : notes.merchantNote,
    reason: "PENDING",
  };

  context.state.insert(REFUNDS, refund);
  emitRefundWebhook(context, refund);
  scheduleRefundStatus(context, refund.id);

  return paystackResponses.success(context.action, createRefundData(refund, transaction));
}

function fetchRefund(context: ActionContext) {
  const rawId = context.request.params.id ?? "";
  if (!/^\d+$/u.test(rawId)) {
    return invalidRefundIdResponse();
  }
  const refund = context.state.read(REFUNDS, rawId, paystackRefundSchema);
  if (refund === undefined) {
    return refundNotFoundResponse();
  }
  return paystackResponses.success(context.action, refundData(refund));
}

function listRefunds(context: ActionContext) {
  const perPage = Math.min(positiveInteger(queryString(context.request.query.perPage), 50), 100);
  const page = positiveInteger(queryString(context.request.query.page), 1);
  const transactionFilter = queryString(context.request.query.transaction);
  const currencyFilter = queryString(context.request.query.currency)?.toUpperCase();

  const filtered = context.state
    .list(REFUNDS, paystackRefundSchema)
    .filter(
      (refund) =>
        transactionFilter === undefined ||
        refund.transactionReference === transactionFilter ||
        String(refund.transactionId) === transactionFilter,
    )
    .filter((refund) => currencyFilter === undefined || refund.currency === currencyFilter)
    .sort((left, right) => right.refundId - left.refundId);

  const start = (page - 1) * perPage;
  const data = filtered.slice(start, start + perPage).map(refundData);
  const total = filtered.length;
  const totalRetriable = filtered.filter(
    (refund) => refund.status === "failed" || refund.status === "needs-attention",
  ).length;

  return paystackResponses.success(context.action, data, {
    total,
    skipped: start,
    perPage,
    page,
    pageCount: Math.ceil(total / perPage),
    totalRetriable,
    partialAmountLeft: null,
  });
}

export const refundActions: readonly ActionDefinition[] = [
  {
    id: "refund.create",
    method: "POST",
    path: "/refund",
    summary: "Create a refund",
    kind: "write",
    eventSummary: refundEventSummary,
    handler: createRefund,
  },
  {
    id: "refund.fetch",
    method: "GET",
    path: "/refund/:id",
    summary: "Fetch a refund",
    kind: "read",
    handler: fetchRefund,
  },
  {
    id: "refund.list",
    method: "GET",
    path: "/refund",
    summary: "List refunds",
    kind: "read",
    handler: listRefunds,
  },
];
