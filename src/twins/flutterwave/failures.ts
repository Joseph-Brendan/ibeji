import type { FailureAdapter, FailureSupport } from "../framework/types.js";
import { rateLimitedResponse, serverErrorResponse } from "./responses.js";

const PAYMENT_ACTIONS = [
  "payment.create",
  "payment.verify",
  "payment.verify_by_reference",
  "payment.list",
] as const;
const REFUND_ACTIONS = ["refund.create", "refund.fetch", "refund.list"] as const;
const TRANSFER_ACTIONS = ["transfer.create", "transfer.fetch", "transfer.list"] as const;
const BANK_ACTIONS = ["bank.list", "bank.resolve"] as const;
const WRITE_ACTIONS = ["payment.create", "refund.create", "transfer.create"] as const;
const ALL_ACTIONS = [
  ...PAYMENT_ACTIONS,
  ...REFUND_ACTIONS,
  ...TRANSFER_ACTIONS,
  ...BANK_ACTIONS,
] as const;
const WEBHOOK_ACTIONS = ["checkout.submit", "refund.create", "transfer.create"] as const;

const ASSUMED = "research/flutterwave.md §14.2 says this needs a real story.";

export const flutterwaveFailureSupport: readonly FailureSupport[] = [
  {
    id: "slow-response",
    source: "docs",
    sourceReference: "research/flutterwave.md §14.2 and §14.1",
    actions: ALL_ACTIONS,
  },
  {
    id: "timeout-after-commit",
    source: "docs",
    sourceReference: "research/flutterwave.md §14.2 and §14.1",
    actions: WRITE_ACTIONS,
  },
  {
    id: "timeout-before-commit",
    source: "docs",
    sourceReference: "research/flutterwave.md §14.2 and §14.1",
    actions: WRITE_ACTIONS,
  },
  {
    id: "server-error",
    source: "docs",
    sourceReference: "research/flutterwave.md §1.2 and §14.1",
    actions: ALL_ACTIONS,
  },
  {
    id: "rate-limited",
    source: "docs",
    sourceReference: "research/flutterwave.md §14.2 and §14.1",
    actions: ALL_ACTIONS,
  },
  {
    id: "flaky-network",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: ALL_ACTIONS,
  },
  {
    id: "webhook-delayed",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-duplicated",
    source: "docs",
    sourceReference: "research/flutterwave.md §14.2 and §6.1",
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
    sourceReference: "research/flutterwave.md §8",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "payment-declined",
    source: "docs",
    sourceReference: "research/flutterwave.md §14.2 and §3",
    actions: ["checkout.submit"],
  },
  {
    id: "transfer-stuck-pending",
    source: "docs",
    sourceReference: "research/flutterwave.md §14.1 and §11.3",
    actions: ["transfer.create"],
  },
  {
    id: "bank-resolve-fails",
    source: "assumed",
    sourceReference: ASSUMED,
    actions: ["bank.resolve"],
  },
];

export const flutterwaveFailures: FailureAdapter = {
  support: flutterwaveFailureSupport,
  httpError: (plan) =>
    plan.status === 429 ? rateLimitedResponse() : serverErrorResponse(plan.status),
  shapeResult: (plan) => plan.effects,
};
