import type { LiveKeyPattern } from "../../shared/live-key-scanner.js";

/**
 * Flutterwave v3 documents live FLWPUBK- and FLWSECK- keys without _TEST.
 * The exact full live-key body is UNCONFIRMED in research/flutterwave.md.
 */
export const flutterwaveLiveKeyPatterns: readonly LiveKeyPattern[] = [
  {
    service: "Flutterwave",
    pattern: /FLWPUBK-(?!TEST-)[A-Za-z0-9._~+/=-]+/gu,
  },
  {
    service: "Flutterwave",
    pattern: /FLWSECK-(?!TEST-)[A-Za-z0-9._~+/=-]+/gu,
  },
];
