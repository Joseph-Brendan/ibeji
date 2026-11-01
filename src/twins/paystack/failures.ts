import type { ActiveFailureEffects, FailureAdapter, FailureSupport } from "../framework/types.js";
import { rateLimitedResponse, serverErrorResponse } from "./responses.js";

const TRANSACTION_ACTIONS = [
  "transaction.initialize",
  "transaction.verify",
  "transaction.fetch",
  "transaction.list",
] as const;

const CHECKOUT_ACTIONS = ["checkout.submit"] as const;

export const paystackFailureSupport: readonly FailureSupport[] = [
  {
    id: "slow-response",
    source: "assumed",
    actions: TRANSACTION_ACTIONS,
  },
  {
    id: "timeout-after-commit",
    source: "assumed",
    actions: TRANSACTION_ACTIONS,
  },
  {
    id: "timeout-before-commit",
    source: "assumed",
    actions: TRANSACTION_ACTIONS,
  },
  {
    id: "server-error",
    source: "docs",
    actions: TRANSACTION_ACTIONS,
  },
  {
    id: "rate-limited",
    source: "docs",
    actions: TRANSACTION_ACTIONS,
  },
  {
    id: "flaky-network",
    source: "assumed",
    actions: TRANSACTION_ACTIONS,
  },
  {
    id: "webhook-delayed",
    source: "assumed",
    actions: CHECKOUT_ACTIONS,
  },
  {
    id: "webhook-duplicated",
    source: "assumed",
    actions: CHECKOUT_ACTIONS,
  },
  {
    id: "webhook-out-of-order",
    source: "assumed",
    actions: CHECKOUT_ACTIONS,
  },
  {
    id: "webhook-never-sent",
    source: "assumed",
    actions: CHECKOUT_ACTIONS,
  },
  {
    id: "webhook-verification-fails",
    source: "docs",
    actions: CHECKOUT_ACTIONS,
  },
  {
    id: "payment-declined",
    source: "docs",
    actions: CHECKOUT_ACTIONS,
  },
];

export const paystackFailures: FailureAdapter = {
  support: paystackFailureSupport,
  httpError: (plan) =>
    plan.status === 429 ? rateLimitedResponse() : serverErrorResponse(plan.status),
  shapeResult: (plan): ActiveFailureEffects => plan.effects,
};
