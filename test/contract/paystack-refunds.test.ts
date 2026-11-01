import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { assertContract, type ContractFixture } from "../../src/twins/framework/contract.js";
import type { HttpMethod, JsonValue } from "../../src/twins/framework/types.js";
import {
  authorizationHeader,
  createRefund,
  fetchRefund,
  listRefunds,
  type PaystackHarness,
  seedSuccessfulTransaction,
  startPaystack,
} from "../helpers/paystack.js";

type RecordedFixture = {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string | number> | null;
  readonly requestBody: string | null;
  readonly status: number;
  readonly responseBody: unknown;
};

async function fixture(name: string): Promise<RecordedFixture> {
  const text = await readFile(`fixtures/paystack/${name}.json`, "utf8");
  return JSON.parse(text) as RecordedFixture;
}

function contractFor(recorded: RecordedFixture, pathOverride?: string): ContractFixture {
  const query =
    recorded.query === null
      ? ""
      : `?${new URLSearchParams(
          Object.entries(recorded.query).map(
            ([key, value]) => [key, String(value)] as [string, string],
          ),
        ).toString()}`;
  return {
    request: {
      method: recorded.method as HttpMethod,
      path: `${pathOverride ?? recorded.path}${query}`,
      headers: authorizationHeader(),
      ...(recorded.requestBody === null ? {} : { body: recorded.requestBody }),
    },
    response: {
      status: recorded.status,
      body: recorded.responseBody as JsonValue,
    },
  };
}

async function withHarness(run: (harness: PaystackHarness) => Promise<void>): Promise<void> {
  const harness = await startPaystack();
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

async function createOneRefund(harness: PaystackHarness, reference: string): Promise<number> {
  await seedSuccessfulTransaction(harness, reference);
  const response = await createRefund(harness, { transaction: reference });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { id: number } };
  return body.data.id;
}

describe("T3 Paystack refund fixtures", () => {
  it("T3 refund-create-success matches its fixture", async () => {
    const recorded = await fixture("refund-create-success");
    const requestBody = JSON.parse(recorded.requestBody as string) as { transaction: string };
    await withHarness(async (harness) => {
      await seedSuccessfulTransaction(harness, requestBody.transaction);
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 refund-create-invalid-request matches its fixture", async () => {
    const recorded = await fixture("refund-create-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 refund-fetch-success matches its fixture", async () => {
    const recorded = await fixture("refund-fetch-success");
    await withHarness(async (harness) => {
      const id = await createOneRefund(harness, "t3-refund-fetch");
      const response = await fetchRefund(harness, String(id));
      expect(response.status).toBe(200);
      await assertContract(harness.running, contractFor(recorded, `/refund/${id}`));
    });
  });

  it("T3 refund-fetch-invalid-request matches its fixture", async () => {
    const recorded = await fixture("refund-fetch-invalid-request");
    await withHarness(async (harness) => {
      const response = await fetchRefund(harness, "not-a-number");
      expect(response.status).toBe(401);
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 refund-list-success matches its fixture", async () => {
    const recorded = await fixture("refund-list-success");
    await withHarness(async (harness) => {
      await createOneRefund(harness, "t3-refund-list");
      const response = await listRefunds(harness, "?perPage=5&page=1");
      expect(response.status).toBe(200);
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 refund-list-lenient-input matches its fixture", async () => {
    const recorded = await fixture("refund-list-lenient-input");
    await withHarness(async (harness) => {
      await createOneRefund(harness, "t3-refund-lenient");
      const response = await listRefunds(harness, "?page=not-a-number");
      expect(response.status).toBe(200);
      await assertContract(harness.running, contractFor(recorded));
    });
  });
});
