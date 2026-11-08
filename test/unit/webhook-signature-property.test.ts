import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { RawWebhook } from "../../src/core/webhooks/types.js";
import {
  FLUTTERWAVE_VERIFICATION_HEADER,
  flutterwaveWebhooks,
} from "../../src/twins/flutterwave/webhooks.js";
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

  it("T2 D63 Flutterwave verif-hash: the correct value passes for any JSON body and any changed value fails", () => {
    // A webhook body is JSON. D63 says Flutterwave does not detect a changed
    // body, so a different JSON value with the same verif-hash still passes.
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.jsonValue(),
        fc.string({ minLength: 1 }),
        (firstValue, secondValue, secret) => {
          const credentials = { webhook: secret };
          const first = raw(JSON.stringify(firstValue));
          const headers = flutterwaveWebhooks.sign(first, credentials, { attempt: 1 });
          expect(flutterwaveWebhooks.verify(first, headers, credentials, NOW)).toBe(true);

          const second = raw(JSON.stringify(secondValue));
          expect(flutterwaveWebhooks.verify(second, headers, credentials, NOW)).toBe(true);

          const changedHeaders = {
            ...headers,
            [FLUTTERWAVE_VERIFICATION_HEADER]: `${headers[FLUTTERWAVE_VERIFICATION_HEADER]}x`,
          };
          expect(flutterwaveWebhooks.verify(first, changedHeaders, credentials, NOW)).toBe(false);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
