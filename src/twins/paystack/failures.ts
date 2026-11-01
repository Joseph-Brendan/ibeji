import type { ActiveFailureEffects, FailureAdapter, FailureSupport } from "../framework/types.js";
import { rateLimitedResponse, serverErrorResponse } from "./responses.js";

const TRANSACTION_ACTIONS = [
  "transaction.initialize",
  "transaction.verify",
  "transaction.fetch",
  "transaction.list",
] as const;

const CHECKOUT_ACTIONS = ["checkout.submit"] as const;
const REFUND_ACTIONS = ["refund.create", "refund.fetch", "refund.list"] as const;
const REFUND_WRITE_ACTIONS = ["refund.create"] as const;
const BANK_ACTIONS = ["bank.list", "bank.resolve"] as const;
const TRANSFER_ACTIONS = ["transfer.create", "transfer.fetch", "transfer.verify"] as const;
const WEBHOOK_ACTIONS = ["checkout.submit", "refund.create", "transfer.create"] as const;

export const paystackFailureSupport: readonly FailureSupport[] = [
  {
    id: "slow-response",
    source: "assumed",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "timeout-after-commit",
    source: "assumed",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_WRITE_ACTIONS, "transfer.create"],
  },
  {
    id: "timeout-before-commit",
    source: "assumed",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_WRITE_ACTIONS, "transfer.create"],
  },
  {
    id: "server-error",
    source: "docs",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "rate-limited",
    source: "docs",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "flaky-network",
    source: "assumed",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "webhook-delayed",
    source: "assumed",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-duplicated",
    source: "assumed",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-out-of-order",
    source: "assumed",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-never-sent",
    source: "assumed",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-verification-fails",
    source: "docs",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "payment-declined",
    source: "docs",
    actions: CHECKOUT_ACTIONS,
  },
  {
    id: "transfer-stuck-pending",
    source: "docs",
    actions: ["transfer.create"],
  },
  {
    id: "transfer-reversed",
    source: "docs",
    actions: ["transfer.create"],
  },
  {
    id: "bank-resolve-fails",
    source: "assumed",
    actions: ["bank.resolve"],
  },
];

export const paystackFailures: FailureAdapter = {
  support: paystackFailureSupport,
  httpError: (plan) =>
    plan.status === 429 ? rateLimitedResponse() : serverErrorResponse(plan.status),
  shapeResult: (plan): ActiveFailureEffects => plan.effects,
};
