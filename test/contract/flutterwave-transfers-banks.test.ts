import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { assertContract, type ContractFixture } from "../../src/twins/framework/contract.js";
import type { HttpMethod, JsonValue } from "../../src/twins/framework/types.js";
import {
  authorizationHeader,
  createTransfer,
  type FlutterwaveHarness,
  fetchTransfer,
  listBanks,
  resolveAccount,
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
    readonly headers?: Record<string, string>;
  } = {},
): ContractFixture {
  return {
    request: {
      method: recorded.method as HttpMethod,
      path: `${overrides.path ?? recorded.path}${overrides.query ?? queryOf(recorded.query)}`,
      headers: overrides.headers ?? authorizationHeader(),
      ...(recorded.requestBody === null ? {} : { body: overrides.body ?? recorded.requestBody }),
    },
    response: {
      status: recorded.status,
      body: recorded.responseBody as JsonValue,
    },
  };
}

async function withHarness(run: (harness: FlutterwaveHarness) => Promise<void>): Promise<void> {
  const harness = await startFlutterwave();
  try {
    await run(harness);
  } finally {
    await harness.running.stop();
  }
}

describe("T3 Flutterwave bank fixtures", () => {
  it("T3 bank-list-success matches its fixture", async () => {
    const recorded = await fixture("bank-list-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("C4 bank-list-success returns the recorded bank data exactly", async () => {
    const recorded = await fixture("bank-list-success");
    await withHarness(async (harness) => {
      const response = await listBanks(harness, "NG");
      expect(await response.json()).toEqual(recorded.responseBody);
    });
  });

  it("T3 bank-list-invalid-request matches its fixture", async () => {
    const recorded = await fixture("bank-list-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 bank-list-invalid-key matches its fixture and records the auth failure", async () => {
    const recorded = await fixture("bank-list-invalid-key");
    await withHarness(async (harness) => {
      await assertContract(
        harness.running,
        contractFor(recorded, {
          headers: {
            authorization: "Bearer FLWSECK_TEST-ibeji_wrong_key",
            "content-type": "application/json",
          },
        }),
      );
    });
  });

  it("T3 bank-resolve-success matches its fixture", async () => {
    const recorded = await fixture("bank-resolve-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 bank-resolve-invalid-request matches its fixture for malformed input", async () => {
    const recorded = await fixture("bank-resolve-invalid-request");
    await withHarness(async (harness) => {
      const response = await resolveAccount(harness, {
        account_number: "not-a-number",
        account_bank: "044",
      });
      expect(response.status).toBe(400);
      await assertContract(
        harness.running,
        contractFor(recorded, {
          body: JSON.stringify({ account_number: "not-a-number", account_bank: "044" }),
        }),
      );
    });
  });
});

describe("T3 Flutterwave transfer fixtures", () => {
  it("T3 transfer-list-success matches its fixture", async () => {
    const recorded = await fixture("transfer-list-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transfer-list-invalid-request matches its fixture", async () => {
    const recorded = await fixture("transfer-list-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transfer-fetch-lenient-input uses a JSON validation error, not the recorded HTML", async () => {
    await withHarness(async (harness) => {
      const response = await fetchTransfer(harness, "not-a-number");
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({
        status: "error",
        message: "Transfer ID should be numeric",
        data: null,
      });
    });
  });

  it("T3 transfer-create.account-limit records the recorder limit; the twin uses the documented NEW shape", async () => {
    const recorded = await fixture("transfer-create.account-limit");
    expect(recorded.status).toBe(400);
    expect(recorded.responseBody).toMatchObject({
      status: "error",
      message: "Please enable IP Whitelisting to access this service",
      data: null,
    });

    await withHarness(async (harness) => {
      const response = await createTransfer(harness, {
        account_bank: "044",
        account_number: "0000000001",
        amount: "100",
        currency: "NGN",
        reference: "docs-only-create",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        message: string;
        data: { status: string; reference: string; id: number };
      };
      expect(body.status).toBe("success");
      expect(body.message).toBe("Transfer Queued Successfully");
      expect(body.data.status).toBe("NEW");
      expect(body.data.reference).toBe("docs-only-create");
      expect(typeof body.data.id).toBe("number");
    });
  });
});
