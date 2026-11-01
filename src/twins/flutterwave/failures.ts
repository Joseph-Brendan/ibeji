import type { FailureAdapter, FailureSupport } from "../framework/types.js";
import { rateLimitedResponse, serverErrorResponse } from "./responses.js";

const PAYMENT_ACTIONS = [
  "payment.create",
  "payment.verify",
  "payment.verify_by_reference",
  "payment.list",
] as const;
const REFUND_ACTIONS = ["refund.create", "refund.fetch", "refund.list"] as const;
const WRITE_ACTIONS = ["payment.create", "refund.create"] as const;
const ALL_ACTIONS = [...PAYMENT_ACTIONS, ...REFUND_ACTIONS] as const;
const WEBHOOK_ACTIONS = ["checkout.submit", "refund.create"] as const;

export const flutterwaveFailureSupport: readonly FailureSupport[] = [
  {
    id: "slow-response",
    source: "docs",
    actions: ALL_ACTIONS,
  },
  {
    id: "timeout-after-commit",
    source: "docs",
    actions: WRITE_ACTIONS,
  },
  {
    id: "timeout-before-commit",
    source: "docs",
    actions: WRITE_ACTIONS,
  },
  {
    id: "server-error",
    source: "docs",
    actions: ALL_ACTIONS,
  },
  {
    id: "rate-limited",
    source: "docs",
    actions: ALL_ACTIONS,
  },
  {
    id: "flaky-network",
    source: "assumed",
    actions: ALL_ACTIONS,
  },
  {
    id: "webhook-delayed",
    source: "assumed",
    actions: WEBHOOK_ACTIONS,
  },
  {
    id: "webhook-duplicated",
    source: "docs",
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
    actions: ["checkout.submit"],
  },
];

export const flutterwaveFailures: FailureAdapter = {
  support: flutterwaveFailureSupport,
  httpError: (plan) =>
    plan.status === 429 ? rateLimitedResponse() : serverErrorResponse(plan.status),
  shapeResult: (plan) => plan.effects,
};
