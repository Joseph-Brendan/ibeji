import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { assertContract, type ContractFixture } from "../../src/twins/framework/contract.js";
import type { HttpMethod, JsonValue } from "../../src/twins/framework/types.js";
import {
  authorizationHeader,
  createRefund,
  type FlutterwaveHarness,
  seedPayment,
  startFlutterwave,
} from "../helpers/flutterwave.js";

type RecordedFixture = {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string | number> | null;
  readonly requestBody: string | null;
  readonly status: number;
  readonly responseBody: unknown;
};

async function fixture(name: string): Promise<RecordedFixture> {
  const text = await readFile(`fixtures/flutterwave/${name}.json`, "utf8");
  return JSON.parse(text) as RecordedFixture;
}

function queryOf(values: Record<string, string | number> | null): string {
  if (values === null) {
    return "";
  }
  return `?${new URLSearchParams(
    Object.entries(values).map(([key, value]) => [key, String(value)] as [string, string]),
  ).toString()}`;
}

function contractFor(
  recorded: RecordedFixture,
  overrides: {
    readonly path?: string;
    readonly query?: string;
    readonly body?: string;
  } = {},
): ContractFixture {
  return {
    request: {
      method: recorded.method as HttpMethod,
      path: `${overrides.path ?? recorded.path}${overrides.query ?? queryOf(recorded.query)}`,
      headers: authorizationHeader(),
      ...(recorded.requestBody === null ? {} : { body: overrides.body ?? recorded.requestBody }),
    },
    response: {
      status: recorded.status,
      body: recorded.responseBody as JsonValue,
    },
  };
}

async function withHarness(
  run: (harness: FlutterwaveHarness) => Promise<void>,
  clock?: FakeClock,
): Promise<void> {
  const harness = await startFlutterwave(clock === undefined ? {} : { clock });
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

describe("T3 Flutterwave payment fixtures", () => {
  it("T3 payment-create-success matches its fixture", async () => {
    const recorded = await fixture("payment-create-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-create-for-failed-checkout matches its fixture", async () => {
    const recorded = await fixture("payment-create-for-failed-checkout");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-create-unpaid matches its fixture", async () => {
    const recorded = await fixture("payment-create-unpaid");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-create-invalid-request matches its fixture", async () => {
    const recorded = await fixture("payment-create-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-verify-success matches its fixture", async () => {
    const recorded = await fixture("payment-verify-success");
    const txRef = (recorded.responseBody as { data: { tx_ref: string } }).data.tx_ref;
    await withHarness(async (harness) => {
      const record = await seedPayment(harness, txRef, {
        amount: "7500",
        outcome: "success",
        email: "customer.two@example.com",
      });
      await assertContract(
        harness.running,
        contractFor(recorded, { path: `/v3/transactions/${record.transactionId}/verify` }),
      );
    });
  });

  it("T3 payment-verify-invalid-request matches its fixture", async () => {
    const recorded = await fixture("payment-verify-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-verify-by-reference-success matches its fixture", async () => {
    const recorded = await fixture("payment-verify-by-reference-success");
    const query = recorded.query as { tx_ref: string };
    await withHarness(async (harness) => {
      await seedPayment(harness, query.tx_ref, {
        amount: "7500",
        outcome: "success",
        email: "customer.two@example.com",
      });
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-verify-by-reference-failed matches its fixture", async () => {
    const recorded = await fixture("payment-verify-by-reference-failed");
    const query = recorded.query as { tx_ref: string };
    await withHarness(async (harness) => {
      await seedPayment(harness, query.tx_ref, {
        amount: "7500",
        outcome: "failed",
        email: "customer.three@example.com",
      });
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-verify-by-reference-invalid-request matches its fixture", async () => {
    const recorded = await fixture("payment-verify-by-reference-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-verify-by-reference-unpaid matches its fixture", async () => {
    const recorded = await fixture("payment-verify-by-reference-unpaid");
    const query = recorded.query as { tx_ref: string };
    await withHarness(async (harness) => {
      await seedPayment(harness, query.tx_ref, { amount: "7500" });
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-list-success matches its fixture", async () => {
    const recorded = await fixture("payment-list-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 payment-list-lenient-input matches its fixture", async () => {
    const recorded = await fixture("payment-list-lenient-input");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });
});

describe("T3 Flutterwave refund fixtures", () => {
  it("T3 refund-create-success matches its fixture", async () => {
    const recorded = await fixture("refund-create-success");
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "t3-refund-create", {
        amount: "7500",
        outcome: "success",
      });
      await assertContract(
        harness.running,
        contractFor(recorded, {
          path: `/v3/transactions/${payment.transactionId}/refund`,
        }),
      );
    });
  });

  it("T3 refund-create-invalid-request matches its fixture", async () => {
    const recorded = await fixture("refund-create-invalid-request");
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "t3-refund-invalid", {
        amount: "7500",
        outcome: "success",
      });
      const first = await createRefund(harness, payment.transactionId, { amount: 100 });
      expect(first.status).toBe(200);
      await assertContract(
        harness.running,
        contractFor(recorded, {
          path: `/v3/transactions/${payment.transactionId}/refund`,
        }),
      );
    });
  });

  it("T3 refund-fetch-success matches its fixture", async () => {
    const recorded = await fixture("refund-fetch-success");
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "t3-refund-fetch", {
        amount: "7500",
        outcome: "success",
      });
      const created = await createRefund(harness, payment.transactionId, { amount: 100 });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as { data: { id: number } };
      await assertContract(
        harness.running,
        contractFor(recorded, { path: `/v3/refunds/${createdBody.data.id}` }),
      );
    });
  });

  it("T3 refund-fetch-invalid-request matches its fixture", async () => {
    const recorded = await fixture("refund-fetch-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 refund-list-success matches its fixture", async () => {
    const recorded = await fixture("refund-list-success");
    const clock = new FakeClock(Date.parse("2026-10-28T12:59:03.000Z"));
    await withHarness(async (harness) => {
      const payment = await seedPayment(harness, "t3-refund-list", {
        amount: "7500",
        outcome: "success",
      });
      const created = await createRefund(harness, payment.transactionId, { amount: 100 });
      expect(created.status).toBe(200);
      await assertContract(harness.running, contractFor(recorded));
    }, clock);
  });

  it("T3 refund-list-lenient-input matches its fixture", async () => {
    const recorded = await fixture("refund-list-lenient-input");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });
});
