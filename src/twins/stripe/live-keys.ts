import type { LiveKeyPattern } from "../../shared/live-key-scanner.js";

/**
 * Stripe documents pk_live_, sk_live_ and rk_live_ prefixes in
 * research/stripe.md section 16. It does not publish the rest of a key.
 * The Stripe twin itself is version 0.2.0 and is not registered in 0.1.0.
 */
export const stripeLiveKeyPatterns: readonly LiveKeyPattern[] = [
  {
    service: "Stripe",
    pattern: /(?:pk|sk|rk)_live_[A-Za-z0-9._~+/=-]+/gu,
  },
];
