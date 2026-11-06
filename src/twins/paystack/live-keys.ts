import type { LiveKeyPattern } from "../../shared/live-key-scanner.js";

/**
 * Paystack documents only the pk_live_ and sk_live_ prefixes. The exact key
 * length and restricted-key format are UNCONFIRMED in research/paystack.md.
 */
export const paystackLiveKeyPatterns: readonly LiveKeyPattern[] = [
  {
    service: "Paystack",
    pattern: /(?:pk|sk)_live_[A-Za-z0-9._~+/=-]+/gu,
  },
];
