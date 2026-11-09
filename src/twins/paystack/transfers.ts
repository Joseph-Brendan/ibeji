import type {
  ActionContext,
  ActionDefinition,
  JsonValue,
  TwinRequest,
  TwinStateStore,
  TwinWebhookDraft,
} from "../framework/types.js";
import { paystackMoney } from "./money.js";
import { findRecipient, recipientData } from "./recipients.js";
import {
  duplicateTransferReferenceResponse,
  invalidTransferAmountResponse,
  invalidTransferIdentifierResponse,
  invalidTransferReferenceResponse,
  invalidTransferSourceResponse,
  missingTransferFieldsResponse,
  paystackResponses,
  recipientNotFoundResponse,
  transferNotFoundResponse,
} from "./responses.js";
import type { PaystackRecipient, PaystackTransfer } from "./state.js";
import { paystackTransferSchema } from "./state.js";
import { parseJsonObject } from "./transactions.js";

const TRANSFERS = "transfers";
const INTEGRATION_ID = 1_044_674;

/**
 * Paystack's test-transfer guide says test transfers always succeed because
 * there is no processing. Ibeji adds a short local pending phase so transfer
 * status changes and webhooks can be tested with the injected clock.
 *
 * Source: documentation, not recorded.
 */
export const TRANSFER_SUCCESS_DELAY_MS = 1_000;

let nextTransferId = 860_703_114;
let nextRequestId = 1_068_439_313;

function nextTransferNumber(): number {
  const id = nextTransferId;
  nextTransferId += 1;
  return id;
}

function nextRequestNumber(): number {
  const id = nextRequestId;
  nextRequestId += 1;
  return id;
}

function isoTimestamp(clock: { readonly now: () => number }): string {
  return new Date(clock.now()).toISOString();
}

function readAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function referenceIsValid(reference: string): boolean {
  return /^[a-z0-9_-]{16,50}$/u.test(reference);
}

function findTransferByIdOrCode(
  state: ActionContext["state"],
  identifier: string,
): PaystackTransfer | undefined {
  return state
    .list(TRANSFERS, paystackTransferSchema)
    .find(
      (transfer) =>
        String(transfer.transferId) === identifier || transfer.transferCode === identifier,
    );
}

function findTransferByReference(
  state: ActionContext["state"],
  reference: string,
): PaystackTransfer | undefined {
  return state
    .list(TRANSFERS, paystackTransferSchema)
    .find((transfer) => transfer.reference === reference);
}

function recipientOf(
  state: ActionContext["state"],
  transfer: PaystackTransfer,
): PaystackRecipient | undefined {
  return findRecipient(state, transfer.recipientCode);
}

// Source: documentation, not recorded.
function initiateData(
  transfer: PaystackTransfer,
  recipient: PaystackRecipient,
): Record<string, unknown> {
  return {
    transfersessionid: [],
    transfertrials: [],
    domain: "test",
    amount: transfer.amount,
    currency: transfer.currency,
    reference: transfer.reference,
    source: transfer.source,
    source_details: null,
    reason: transfer.reason,
    status: transfer.status,
    failures: null,
    transfer_code: transfer.transferCode,
    titan_code: null,
    transferred_at: transfer.transferredAt,
    id: transfer.transferId,
    integration: INTEGRATION_ID,
    request: transfer.requestId,
    recipient: recipient.recipientId,
    createdAt: transfer.createdAt,
    updatedAt: transfer.updatedAt,
  };
}

// Source: documentation, not recorded.
function fetchData(
  transfer: PaystackTransfer,
  recipient: PaystackRecipient,
): Record<string, unknown> {
  return {
    domain: "test",
    amount: transfer.amount,
    currency: transfer.currency,
    reference: transfer.reference,
    source: transfer.source,
    source_details: null,
    reason: transfer.reason,
    status: transfer.status,
    failures: null,
    transfer_code: transfer.transferCode,
    titan_code: null,
    transferred_at: transfer.transferredAt,
    id: transfer.transferId,
    integration: INTEGRATION_ID,
    request: transfer.requestId,
    recipient: recipientData(recipient),
    createdAt: transfer.createdAt,
    updatedAt: transfer.updatedAt,
    session: { provider: null, id: null },
    fee_charged: 0,
    fees_breakdown: null,
    gateway_response: null,
  };
}

// Source: documentation, not recorded.
function webhookData(
  transfer: PaystackTransfer,
  recipient: PaystackRecipient,
): Record<string, unknown> {
  return {
    amount: transfer.amount,
    createdAt: transfer.createdAt,
    currency: transfer.currency,
    domain: "test",
    failures: null,
    id: transfer.transferId,
    integration: {
      id: INTEGRATION_ID,
      is_live: false,
      business_name: "Ibeji",
      logo_path: "",
    },
    reason: transfer.reason,
    reference: transfer.reference,
    source: transfer.source,
    source_details: null,
    status: transfer.status,
    titan_code: null,
    transfer_code: transfer.transferCode,
    transferred_at: transfer.transferredAt,
    updatedAt: transfer.updatedAt,
    recipient: recipientData(recipient),
    session: { provider: null, id: null },
    fee_charged: 0,
    gateway_response: null,
  };
}

function emitTransferWebhook(
  context: ActionContext,
  transfer: PaystackTransfer,
  recipient: PaystackRecipient,
): void {
  const draft: TwinWebhookDraft = {
    key: `transfer.${transfer.status}`,
    actionId: "transfer.create",
    resourceId: transfer.id,
    occurredAt: context.clock.now(),
    data: webhookData(transfer, recipient) as unknown as JsonValue,
  };
  context.webhooks.emit(draft);
}

function transitionTransfer(
  context: ActionContext,
  transferId: string,
  status: "success" | "failed" | "reversed",
): void {
  const current = context.state.read(TRANSFERS, transferId, paystackTransferSchema);
  if (current === undefined) {
    return;
  }
  if (status === "success" && current.status !== "pending") {
    return;
  }
  if (status === "failed" && current.status !== "pending") {
    return;
  }
  if (status === "reversed" && (current.status === "reversed" || current.status === "failed")) {
    return;
  }

  const recipient = recipientOf(context.state, current);
  if (recipient === undefined) {
    return;
  }

  const now = isoTimestamp(context.clock);
  const updated: PaystackTransfer = {
    ...current,
    status,
    updatedAt: now,
    transferredAt:
      status === "success" || status === "reversed" ? (current.transferredAt ?? now) : null,
  };
  context.state.update(TRANSFERS, updated.id, updated);
  emitTransferWebhook(context, updated, recipient);
}

// Source: documentation, not recorded.
function scheduleTransfer(context: ActionContext, transfer: PaystackTransfer): void {
  const stuck = context.failures.transferStuckPending;
  const reversal = context.failures.transferReversal;

  if (stuck !== undefined) {
    if (typeof stuck.seconds === "number") {
      context.clock.setTimeout(() => {
        transitionTransfer(context, transfer.id, stuck.thenFailed === true ? "failed" : "success");
      }, stuck.seconds * 1_000);
    }
    return;
  }

  if (reversal !== undefined) {
    const reversalDelay = reversal.afterSeconds * 1_000;
    const successDelay = Math.max(1, Math.min(TRANSFER_SUCCESS_DELAY_MS, reversalDelay - 1));
    context.clock.setTimeout(() => {
      transitionTransfer(context, transfer.id, "success");
    }, successDelay);
    context.clock.setTimeout(() => {
      transitionTransfer(context, transfer.id, "reversed");
    }, reversalDelay);
    return;
  }

  context.clock.setTimeout(() => {
    transitionTransfer(context, transfer.id, "success");
  }, TRANSFER_SUCCESS_DELAY_MS);
}

function transferEventSummary(request: TwinRequest, state: TwinStateStore): string {
  const body = parseJsonObject(request.rawBody);
  if (body === undefined) {
    return "Your app tried to create a Paystack transfer.";
  }
  const amount = readAmount(body.amount);
  const recipientCode = typeof body.recipient === "string" ? body.recipient : undefined;
  const recipient = recipientCode === undefined ? undefined : findRecipient(state, recipientCode);
  const currency =
    typeof body.currency === "string" && body.currency.trim().length > 0
      ? body.currency.trim().toUpperCase()
      : "NGN";

  if (amount === undefined) {
    return "Your app created a Paystack transfer.";
  }
  const formatted = paystackMoney.formatDisplay(amount, currency);
  if (recipient === undefined) {
    return `Your app sent ${formatted} through Paystack`;
  }
  return `Your app sent ${formatted} to ${recipient.name} through Paystack`;
}

// Source: documentation, not recorded.
function createTransfer(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return missingTransferFieldsResponse();
  }

  const source = typeof body.source === "string" ? body.source : "";
  const recipientCode = typeof body.recipient === "string" ? body.recipient : "";
  const reference = typeof body.reference === "string" ? body.reference : "";
  const amount = readAmount(body.amount);

  if (source.length === 0 || recipientCode.length === 0 || reference.length === 0) {
    return missingTransferFieldsResponse();
  }
  if (source !== "balance") {
    return invalidTransferSourceResponse();
  }
  if (amount === undefined) {
    return invalidTransferAmountResponse();
  }
  if (!referenceIsValid(reference)) {
    return invalidTransferReferenceResponse();
  }

  const recipient = findRecipient(context.state, recipientCode);
  if (recipient === undefined) {
    return recipientNotFoundResponse();
  }

  // Source: documentation, not recorded.
  // Research says a transfer reference is unique and a retry with the same
  // reference avoids a second credit. An identical retry returns the original
  // transfer; reusing it for a different transfer is rejected.
  const currency =
    typeof body.currency === "string" && body.currency.trim().length > 0
      ? body.currency.trim().toUpperCase()
      : "NGN";
  const existing = findTransferByReference(context.state, reference);
  if (existing !== undefined) {
    if (
      existing.recipientCode === recipientCode &&
      existing.amount === amount &&
      existing.currency === currency
    ) {
      return paystackResponses.success(context.action, initiateData(existing, recipient));
    }
    return duplicateTransferReferenceResponse();
  }

  const now = isoTimestamp(context.clock);
  const transferId = nextTransferNumber();
  const transferCode = `TRF_ibeji${transferId}`;
  const transfer: PaystackTransfer = {
    id: transferCode,
    transferId,
    reference,
    recipientCode,
    amount,
    currency,
    reason: typeof body.reason === "string" ? body.reason : "Ibeji transfer",
    source,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    transferredAt: null,
    requestId: nextRequestNumber(),
    transferCode,
  };
  context.state.insert(TRANSFERS, transfer);
  scheduleTransfer(context, transfer);

  return paystackResponses.success(context.action, initiateData(transfer, recipient));
}

// Source: documentation, not recorded.
function fetchTransfer(context: ActionContext) {
  const identifier = context.request.params.id_or_code ?? "";
  if (!/^\d+$/u.test(identifier) && !/^TRF_[A-Za-z0-9]+$/u.test(identifier)) {
    return invalidTransferIdentifierResponse();
  }
  const transfer = findTransferByIdOrCode(context.state, identifier);
  if (transfer === undefined) {
    return transferNotFoundResponse();
  }
  const recipient = recipientOf(context.state, transfer);
  if (recipient === undefined) {
    return transferNotFoundResponse();
  }
  return paystackResponses.success(context.action, fetchData(transfer, recipient));
}

// Source: documentation, not recorded.
function verifyTransfer(context: ActionContext) {
  const reference = context.request.params.reference ?? "";
  if (!referenceIsValid(reference)) {
    return invalidTransferReferenceResponse();
  }
  const transfer = findTransferByReference(context.state, reference);
  if (transfer === undefined) {
    return transferNotFoundResponse();
  }
  const recipient = recipientOf(context.state, transfer);
  if (recipient === undefined) {
    return transferNotFoundResponse();
  }
  return paystackResponses.success(context.action, fetchData(transfer, recipient));
}

export const transferActions: readonly ActionDefinition[] = [
  {
    id: "transfer.create",
    method: "POST",
    path: "/transfer",
    summary: "Initiate a transfer",
    kind: "write",
    eventSummary: transferEventSummary,
    handler: createTransfer,
  },
  {
    id: "transfer.verify",
    method: "GET",
    path: "/transfer/verify/:reference",
    summary: "Verify a transfer",
    kind: "read",
    handler: verifyTransfer,
  },
  {
    id: "transfer.fetch",
    method: "GET",
    path: "/transfer/:id_or_code",
    summary: "Fetch a transfer",
    kind: "read",
    handler: fetchTransfer,
  },
];
