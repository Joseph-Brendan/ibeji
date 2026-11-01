import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkout,
  createPayment,
  FLUTTERWAVE_TEST_CREDENTIALS,
  fetchRefund,
  paymentRecord,
  startFlutterwave,
} from "../helpers/flutterwave.js";

type FlutterwaveResponse<T> = {
  readonly status?: string;
  readonly message?: string;
  readonly data?: T;
};

type VerifiedTransaction = {
  readonly id: number;
  readonly tx_ref: string;
  readonly status: string;
  readonly amount: number;
};

type Refund = {
  readonly id: number;
  readonly amount_refunded: number;
  readonly status: string;
  readonly tx_id: number;
};

type FlutterwaveClient = {
  readonly Transaction: {
    readonly verify: (payload: {
      readonly id: number;
    }) => Promise<FlutterwaveResponse<VerifiedTransaction>>;
    readonly verify_by_tx: (payload: {
      readonly tx_ref: string;
    }) => Promise<FlutterwaveResponse<VerifiedTransaction>>;
    readonly refund: (payload: {
      readonly id: string;
      readonly amount: number;
    }) => Promise<FlutterwaveResponse<Refund>>;
  };
};

type FlutterwaveConstructor = new (
  publicKey: string,
  secretKey: string,
  baseUrl?: string,
) => FlutterwaveClient;

type FakeRequest = EventEmitter & {
  setTimeout: (milliseconds: number, callback: () => void) => FakeRequest;
  write: (chunk: unknown) => boolean;
  end: () => void;
  destroy: () => void;
};

type HttpsModule = {
  request: (...args: unknown[]) => FakeRequest;
};

type PackageJson = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
};

const require = createRequire(import.meta.url);
const loaded: unknown = require("flutterwave-node-v3");
const Flutterwave = loaded as FlutterwaveConstructor;
const httpsModule = require("node:https") as HttpsModule;
const originalRequest = httpsModule.request;

function fakeRequest(): FakeRequest {
  const request = new EventEmitter() as FakeRequest;
  request.setTimeout = () => request;
  request.write = () => true;
  request.end = () => {
    queueMicrotask(() => {
      request.emit("error", new Error("Ibeji blocks SDK telemetry"));
    });
  };
  request.destroy = () => {
    request.emit("error", new Error("Ibeji blocks SDK telemetry"));
  };
  return request;
}

beforeAll(() => {
  httpsModule.request = () => fakeRequest();
});

afterAll(() => {
  httpsModule.request = originalRequest;
});

describe("T15 Flutterwave official library compatibility", () => {
  it("T15 the official flutterwave-node-v3 library verifies a hosted payment and creates a refund", async () => {
    const harness = await startFlutterwave();
    try {
      const txRef = "compat-flutterwave-001";
      // The official v3 library has no /v3/payments method. The hosted
      // payment is created with the twin API; the library is then pointed at
      // the twin for verification and refund.
      const created = await createPayment(harness, {
        amount: "7500",
        tx_ref: txRef,
        currency: "NGN",
        redirect_url: "https://example.com/ibeji/flutterwave",
        customer: {
          email: "compat@example.com",
          name: "Compatibility Test",
        },
      });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as { data: { link: string } };
      expect(createdBody.data.link).toContain(`/checkout/${txRef}`);

      const paid = await checkout(harness, txRef, "success");
      expect(paid.status).toBe(303);
      const record = paymentRecord(harness, txRef);
      if (record === undefined) {
        throw new Error("the compatible payment was not stored");
      }
      expect(record.status).toBe("successful");

      const publicKey = FLUTTERWAVE_TEST_CREDENTIALS.public;
      const secretKey = FLUTTERWAVE_TEST_CREDENTIALS.secret;
      if (publicKey === undefined || secretKey === undefined) {
        throw new Error("Flutterwave compatibility credentials are missing");
      }
      const flw = new Flutterwave(
        publicKey,
        secretKey,
        `http://127.0.0.1:${harness.running.port}/`,
      );

      const verified = await flw.Transaction.verify_by_tx({ tx_ref: txRef });
      expect(verified.status).toBe("success");
      expect(verified.data?.status).toBe("successful");
      expect(verified.data?.tx_ref).toBe(txRef);
      expect(verified.data?.amount).toBe(7500);

      const byId = await flw.Transaction.verify({ id: record.transactionId });
      expect(byId.status).toBe("success");
      expect(byId.data?.id).toBe(record.transactionId);

      const refund = await flw.Transaction.refund({
        id: String(record.transactionId),
        amount: 100,
      });
      expect(refund.status).toBe("success");
      expect(refund.message).toBe("Transaction refund initiated");
      expect(refund.data?.amount_refunded).toBe(100);
      expect(typeof refund.data?.id).toBe("number");

      const refundId = refund.data?.id;
      if (refundId === undefined) {
        throw new Error("the library did not return a refund id");
      }
      const fetched = await fetchRefund(harness, refundId);
      expect(fetched.status).toBe(200);
      const fetchedBody = (await fetched.json()) as {
        status: string;
        amount_refunded: number;
        transaction_id: number;
      };
      expect(fetchedBody.status).toBe("processing");
      expect(fetchedBody.amount_refunded).toBe(100);
      expect(fetchedBody.transaction_id).toBe(record.transactionId);
    } finally {
      await harness.running.stop();
    }
  });

  it("T15 official compatibility libraries are dev dependencies only", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as PackageJson;
    expect(packageJson.dependencies).not.toHaveProperty("flutterwave-node-v3");
    expect(packageJson.dependencies).not.toHaveProperty("@paystack/paystack-sdk");
    expect(packageJson.devDependencies?.["flutterwave-node-v3"]).toBe("1.4.1");
  });
});
