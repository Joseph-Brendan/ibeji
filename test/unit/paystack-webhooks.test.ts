import { describe, expect, it } from "vitest";

import type { RawWebhook } from "../../src/core/webhooks/types.js";
import { paystackRetrySchedule } from "../../src/twins/paystack/retry.js";
import { PAYSTACK_SIGNATURE_HEADER, paystackWebhooks } from "../../src/twins/paystack/webhooks.js";

const credentials = { secret: "sk_test_ibeji_signature_fixture" };
const raw: RawWebhook = {
  body: '{"event":"charge.success","data":{"id":1,"amount":500000,"currency":"NGN"}}',
  contentType: "application/json",
};

describe("T5 Paystack webhook signing", () => {
  it("T5 signs the raw body with HMAC-SHA512 and the secret key, matching the documented method", () => {
    const headers = paystackWebhooks.sign(raw, credentials, { attempt: 1 });
    expect(headers[PAYSTACK_SIGNATURE_HEADER]).toBe(
      "124151f9b9fc0f3934781766deb611aa75d5849fb186484f93767856b08de91b022a5ecbbb3934d03770d7c348bcbe074698c126fe4873b1ab962b233b30dcc3",
    );
    expect(paystackWebhooks.verify(raw, headers, credentials, new Date(0))).toBe(true);
  });

  it("T5 rejects a wrong secret, a corrupted signature, and a missing signature", () => {
    expect(paystackWebhooks.verificationFailures).toEqual(["wrong-secret", "corrupted", "missing"]);
    for (const failureMethod of paystackWebhooks.verificationFailures) {
      const headers = paystackWebhooks.sign(raw, credentials, {
        attempt: 1,
        failureMethod,
      });
      expect(paystackWebhooks.verify(raw, headers, credentials, new Date(0))).toBe(false);
    }
    expect(paystackWebhooks.verify(raw, {}, credentials, new Date(0))).toBe(false);
  });

  it("C7/P9 uses the documented hourly test-mode retry schedule", () => {
    expect(paystackRetrySchedule).toEqual({
      source: "docs",
      delaysSeconds: [3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600, 3_600],
    });
  });

  it("C7 builds the charge.success envelope", () => {
    const built = paystackWebhooks.build(
      {
        key: "charge.success",
        actionId: "checkout.submit",
        resourceId: "ref-1",
        occurredAt: 1,
        data: { id: 1, amount: 10000, currency: "NGN" },
      },
      {},
    );
    expect(JSON.parse(built.body)).toEqual({
      event: "charge.success",
      data: { id: 1, amount: 10000, currency: "NGN" },
    });
  });
});
