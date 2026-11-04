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

const ASSUMED = "research/paystack.md §14.2 says this needs a real story.";

export const paystackFailureSupport: readonly FailureSupport[] = [
  {
    id: "slow-response",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "timeout-after-commit",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: [...TRANSACTION_ACTIONS, ...REFUND_WRITE_ACTIONS, "transfer.create"],
  },
  {
    id: "timeout-before-commit",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: [...TRANSACTION_ACTIONS, ...REFUND_WRITE_ACTIONS, "transfer.create"],
  },
  {
    id: "server-error",
    source: "docs",
    sourceReference: "research/paystack.md §14.2 and §0.11",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "rate-limited",
    source: "docs",
    sourceReference: "research/paystack.md §14.2 and §7",
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "flaky-network",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: [...TRANSACTION_ACTIONS, ...REFUND_ACTIONS, ...BANK_ACTIONS, ...TRANSFER_ACTIONS],
  },
  {
    id: "webhook-delayed",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-duplicated",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-out-of-order",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-never-sent",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-verification-fails",
    source: "docs",
    sourceReference: "research/paystack.md §8",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "payment-declined",
    source: "docs",
    sourceReference: "research/paystack.md §14.2 and §2",
    actions: CHECKOUT_ACTIONS,
  },
  {
    id: "transfer-stuck-pending",
    source: "docs",
    sourceReference: "research/paystack.md §14.1 and §4.2",
    actions: ["transfer.create"],
  },
  {
    id: "transfer-reversed",
    source: "docs",
    sourceReference: "research/paystack.md §14.1 and §6.2",
    actions: ["transfer.create"],
  },
  {
    id: "bank-resolve-fails",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: ["bank.resolve"],
  },
];

export const paystackFailures: FailureAdapter = {
  support: paystackFailureSupport,
  httpError: (plan) =>
    plan.status === 429 ? rateLimitedResponse() : serverErrorResponse(plan.status),
  shapeResult: (plan): ActiveFailureEffects => plan.effects,
};
