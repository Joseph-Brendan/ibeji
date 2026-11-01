import { describe, expect, it } from "vitest";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import { flutterwaveRetrySchedule } from "../../src/twins/flutterwave/retry.js";
import type { JsonValue, TwinWebhookDraft } from "../../src/twins/framework/types.js";
import { authorizationHeader, FLUTTERWAVE_TEST_CREDENTIALS } from "../helpers/flutterwave.js";

function chargeDraft(status: "successful" | "failed"): TwinWebhookDraft {
  return {
    key: "charge.completed",
    actionId: "checkout.submit",
    resourceId: "tx-ref-1",
    occurredAt: 1_000,
    data: {
      id: 10_579_745,
      tx_ref: "tx-ref-1",
      status,
      amount: 7_500,
      currency: "NGN",
    } as unknown as JsonValue,
  };
}

function refundDraft(status: "processing" | "completed"): TwinWebhookDraft {
  return {
    key: "refund",
    actionId: "refund.create",
    resourceId: "110122",
    occurredAt: 1_000,
    data: {
      id: 110_122,
      AmountRefunded: 100,
      status,
      FlwRef: "FLW-MOCK-ibeji-10579745",
    } as unknown as JsonValue,
  };
}

describe("T5 Flutterwave webhook verification", () => {
  const adapter = flutterwaveTwin.webhooks;

  it("T5 uses the documented verif-hash shared secret, not an HMAC signature", () => {
    const raw = adapter.build(chargeDraft("successful"), {});
    const first = adapter.sign(raw, FLUTTERWAVE_TEST_CREDENTIALS, { attempt: 1 });
    const second = adapter.sign(raw, FLUTTERWAVE_TEST_CREDENTIALS, { attempt: 2 });
    expect(first["verif-hash"]).toBe(FLUTTERWAVE_TEST_CREDENTIALS.webhook);
    expect(second).toEqual(first);
    expect(Object.keys(first)).toEqual(["verif-hash"]);

    expect(adapter.verify(raw, first, FLUTTERWAVE_TEST_CREDENTIALS, new Date(0))).toBe(true);
    const webhookSecret = FLUTTERWAVE_TEST_CREDENTIALS.webhook ?? "";
    expect(
      adapter.verify(
        raw,
        { "Verif-Hash": webhookSecret },
        FLUTTERWAVE_TEST_CREDENTIALS,
        new Date(0),
      ),
    ).toBe(true);
  });

  it("T5 rejects wrong, corrupted and missing verif-hash values", () => {
    const raw = adapter.build(chargeDraft("successful"), {});
    for (const method of ["wrong-secret", "corrupted", "missing"] as const) {
      const headers = adapter.sign(raw, FLUTTERWAVE_TEST_CREDENTIALS, {
        attempt: 1,
        failureMethod: method,
      });
      expect(adapter.verify(raw, headers, FLUTTERWAVE_TEST_CREDENTIALS, new Date(0)), method).toBe(
        false,
      );
    }
  });

  it("T5 rejects a tampered body", () => {
    const raw = adapter.build(chargeDraft("successful"), {});
    const headers = adapter.sign(raw, FLUTTERWAVE_TEST_CREDENTIALS, { attempt: 1 });
    expect(
      adapter.verify(
        { ...raw, body: `${raw.body} ` },
        headers,
        FLUTTERWAVE_TEST_CREDENTIALS,
        new Date(0),
      ),
    ).toBe(false);
  });

  it("T5 builds charge.completed for success and failure and a bare refund object", () => {
    const success = adapter.build(chargeDraft("successful"), {});
    const successBody = JSON.parse(success.body) as {
      event: string;
      "event.type"?: string;
      data: { status: string };
    };
    expect(successBody.event).toBe("charge.completed");
    expect(successBody["event.type"]).toBeUndefined();
    expect(successBody.data.status).toBe("successful");

    const failed = adapter.build(chargeDraft("failed"), {});
    const failedBody = JSON.parse(failed.body) as {
      event: string;
      "event.type"?: string;
      data: { status: string };
    };
    expect(failedBody.event).toBe("charge.completed");
    expect(failedBody["event.type"]).toBe("CARD_TRANSACTION");
    expect(failedBody.data.status).toBe("failed");

    const refund = adapter.build(refundDraft("completed"), {});
    const refundBody = JSON.parse(refund.body) as Record<string, unknown>;
    expect(refundBody.event).toBeUndefined();
    expect(refundBody.id).toBe(110_122);
    expect(refundBody.status).toBe("completed");
  });

  it("T5 writes plain-English Flutterwave summaries and uses the documented retry schedule", () => {
    const charge = chargeDraft("successful");
    const chargeRaw = adapter.build(charge, {});
    expect(adapter.summarize(charge, chargeRaw)).toBe(
      "Flutterwave payment successful for NGN 7,500.00",
    );

    const refund = refundDraft("processing");
    const refundRaw = adapter.build(refund, {});
    expect(adapter.summarize(refund, refundRaw)).toBe(
      "Flutterwave refund processing for NGN 100.00",
    );

    expect(flutterwaveRetrySchedule).toEqual({
      source: "docs",
      delaysSeconds: [1_800, 1_800, 1_800],
    });
  });

  it("T5 has Flutterwave-specific auth and checkout definitions", () => {
    expect(flutterwaveTwin.defaultPort).toBe(4402);
    expect(flutterwaveTwin.id).toBe("flutterwave");
    expect(authorizationHeader().authorization).toContain("FLWSECK_TEST-");
  });
});
