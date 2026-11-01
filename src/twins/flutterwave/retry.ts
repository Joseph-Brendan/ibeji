import type { RetrySchedule } from "../../core/webhooks/types.js";

/**
 * Flutterwave retries three times, 30 minutes apart, when webhook retries are
 * enabled. `delaysSeconds` are the delays after the first attempt.
 */
export const flutterwaveRetrySchedule: RetrySchedule = {
  source: "docs",
  delaysSeconds: [1_800, 1_800, 1_800],
};
