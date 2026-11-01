import type { RetrySchedule } from "../../core/webhooks/types.js";

/**
 * Paystack test mode retries hourly for 10 hours. `delaysSeconds` are the
 * delays after the first attempt, so ten hourly entries are ten retries.
 */
export const paystackRetrySchedule: RetrySchedule = {
  source: "docs",
  delaysSeconds: [3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600],
};
