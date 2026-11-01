import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { assertContract, type ContractFixture } from "../../src/twins/framework/contract.js";
import type { HttpMethod, JsonValue } from "../../src/twins/framework/types.js";
import { buildTransactionLog, readTransaction } from "../../src/twins/paystack/transactions.js";
import {
  authorizationHeader,
  checkout,
  fetchTransaction,
  initialize,
  listTransactions,
  type PaystackHarness,
  startPaystack,
  verify,
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

async function seed(
  harness: PaystackHarness,
  reference: string,
  outcome: "success" | "declined" | "abandoned",
): Promise<void> {
  const initialized = await initialize(harness, {
    amount: "10000",
    email: "customer.one@example.com",
    currency: "NGN",
    reference,
    metadata: JSON.stringify({ recorder: "ibeji" }),
  });
  expect(initialized.status).toBe(200);
  const paid = await checkout(harness, reference, outcome);
  expect(paid.status).toBe(200);
}

async function seedList(
  harness: PaystackHarness,
  outcomes: readonly ("success" | "declined" | "abandoned")[],
): Promise<readonly string[]> {
  const references = outcomes.map((_outcome, index) => `t3-list-${index}`);
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    const outcome = outcomes[index];
    const reference = references[index];
    if (outcome === undefined || reference === undefined) {
      continue;
    }
    await seed(harness, reference, outcome);
  }
  return references;
}

async function withHarness(run: (harness: PaystackHarness) => Promise<void>): Promise<void> {
  const harness = await startPaystack();
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

describe("T3 Paystack transaction fixtures", () => {
  it("T3 transaction-initialize-success matches its fixture", async () => {
    const recorded = await fixture("transaction-initialize-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-initialize-declined matches its fixture", async () => {
    const recorded = await fixture("transaction-initialize-declined");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-initialize-unpaid matches its fixture", async () => {
    const recorded = await fixture("transaction-initialize-unpaid");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-initialize-invalid-request matches its fixture", async () => {
    const recorded = await fixture("transaction-initialize-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-verify-success matches its fixture", async () => {
    const recorded = await fixture("transaction-verify-success");
    const reference = recorded.path.split("/").at(-1) as string;
    await withHarness(async (harness) => {
      await seed(harness, reference, "success");
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-verify-failed matches its fixture", async () => {
    const recorded = await fixture("transaction-verify-failed");
    const reference = recorded.path.split("/").at(-1) as string;
    await withHarness(async (harness) => {
      await seed(harness, reference, "declined");
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-verify-abandoned matches its fixture", async () => {
    const recorded = await fixture("transaction-verify-abandoned");
    const reference = recorded.path.split("/").at(-1) as string;
    await withHarness(async (harness) => {
      await seed(harness, reference, "abandoned");
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-verify-invalid-request matches its fixture", async () => {
    const recorded = await fixture("transaction-verify-invalid-request");
    await withHarness(async (harness) => {
      const response = await verify(harness, "ibeji-invalid-reference");
      expect(response.status).toBe(400);
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-fetch-success matches its fixture", async () => {
    const recorded = await fixture("transaction-fetch-success");
    await withHarness(async (harness) => {
      await seed(harness, "t3-fetch-success", "success");
      const verified = await verify(harness, "t3-fetch-success");
      const body = (await verified.json()) as { data: { id: number } };
      await assertContract(harness.running, contractFor(recorded, `/transaction/${body.data.id}`));
    });
  });

  it("T3 transaction-fetch-invalid-request matches its fixture", async () => {
    const recorded = await fixture("transaction-fetch-invalid-request");
    await withHarness(async (harness) => {
      const response = await fetchTransaction(harness, "not-a-number");
      expect(response.status).toBe(400);
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-list-success matches its fixture", async () => {
    const recorded = await fixture("transaction-list-success");
    const outcomes = ["declined", "abandoned", "success", "abandoned", "abandoned"] as const;
    await withHarness(async (harness) => {
      const references = await seedList(harness, outcomes);
      const logReference = references[4];
      if (logReference !== undefined) {
        const record = readTransaction(harness.state, logReference);
        if (record !== undefined) {
          harness.state.update("transactions", logReference, {
            ...record,
            log: buildTransactionLog("failed"),
          });
        }
      }
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transaction-list-lenient-input matches its fixture", async () => {
    const recorded = await fixture("transaction-list-lenient-input");
    const outcomes = [
      "declined",
      "abandoned",
      "success",
      "abandoned",
      "abandoned",
      "success",
      "abandoned",
      "success",
      "abandoned",
      "abandoned",
      "abandoned",
      "abandoned",
    ] as const;
    await withHarness(async (harness) => {
      const references = await seedList(harness, outcomes);
      const logReference = references[4];
      if (logReference !== undefined) {
        const record = readTransaction(harness.state, logReference);
        if (record !== undefined) {
          harness.state.update("transactions", logReference, {
            ...record,
            log: buildTransactionLog("failed"),
          });
        }
      }
      for (const [index, length] of [
        [5, 4],
        [7, 2],
      ] as const) {
        const reference = references[index];
        const record =
          reference === undefined ? undefined : readTransaction(harness.state, reference);
        if (record !== undefined) {
          const log = buildTransactionLog("success");
          harness.state.update("transactions", record.reference, {
            ...record,
            log: { ...log, history: log.history.slice(0, length) },
          });
        }
      }
      const response = await listTransactions(harness, "?page=not-a-number");
      expect(response.status).toBe(200);
      await assertContract(harness.running, contractFor(recorded));
    });
  });
});
