import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { RawWebhook } from "../../src/core/webhooks/types.js";
import { flutterwaveWebhooks } from "../../src/twins/flutterwave/webhooks.js";
import { paystackWebhooks } from "../../src/twins/paystack/webhooks.js";

const NOW = new Date(0);

function raw(body: string): RawWebhook {
  return { body, contentType: "application/json" };
}

describe("T2 webhook signer and verifier properties", () => {
  it("T2 Paystack signs any body and rejects every changed body", () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (body, secret) => {
        const credentials = { secret };
        const original = raw(body);
        const headers = paystackWebhooks.sign(original, credentials, { attempt: 1 });
        expect(paystackWebhooks.verify(original, headers, credentials, NOW)).toBe(true);
        expect(paystackWebhooks.verify(raw(`${body}x`), headers, credentials, NOW)).toBe(false);
      }),
      { numRuns: 1_000 },
    );
  });

  it("T2 Flutterwave verifies its shared verif-hash and rejects a wrong secret or non-canonical body", () => {
    const value = fc.record({ first: fc.jsonValue(), second: fc.jsonValue() });
    fc.assert(
      fc.property(value, fc.string({ minLength: 1 }), (record, secret) => {
        const credentials = { webhook: secret };
        const body = JSON.stringify(record);
        const original = raw(body);
        const headers = flutterwaveWebhooks.sign(original, credentials, { attempt: 1 });
        expect(flutterwaveWebhooks.verify(original, headers, credentials, NOW)).toBe(true);
        expect(flutterwaveWebhooks.verify(raw(` ${body}`), headers, credentials, NOW)).toBe(false);
        expect(flutterwaveWebhooks.verify(original, headers, { webhook: `${secret}x` }, NOW)).toBe(
          false,
        );
      }),
      { numRuns: 1_000 },
    );
  });
});
