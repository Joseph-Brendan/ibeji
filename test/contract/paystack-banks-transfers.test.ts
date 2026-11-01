import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { assertContract, type ContractFixture } from "../../src/twins/framework/contract.js";
import type { HttpMethod, JsonValue } from "../../src/twins/framework/types.js";
import {
  authorizationHeader,
  listBanks,
  type PaystackHarness,
  resolveAccount,
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
  overrides: { readonly path?: string; readonly query?: string; readonly body?: string } = {},
): ContractFixture {
  return {
    request: {
      method: recorded.method as HttpMethod,
      path: `${overrides.path ?? recorded.path}${overrides.query ?? queryOf(recorded.query)}`,
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

describe("T3 Paystack bank fixtures", () => {
  it("T3 bank-list-success matches its fixture", async () => {
    const recorded = await fixture("bank-list-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 bank-list-lenient-input matches its fixture", async () => {
    const recorded = await fixture("bank-list-lenient-input");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("C4 bank-list-success returns the recorded bank data exactly", async () => {
    const recorded = await fixture("bank-list-success");
    await withHarness(async (harness) => {
      const response = await listBanks(harness, "?country=nigeria");
      expect(await response.json()).toEqual(recorded.responseBody);
    });
  });

  it("T3 bank-list-invalid-key response shape matches, while C4 auth still rejects the key", async () => {
    const recorded = await fixture("bank-list-invalid-key");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
      const rejected = await fetch(`http://127.0.0.1:${harness.running.port}/bank`, {
        headers: { authorization: "Bearer sk_test_ibeji_wrong_key" },
      });
      expect(rejected.status).toBe(401);
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
      const response = await resolveAccount(harness, "?account_number=abc&bank_code=057");
      expect(response.status).toBe(400);
      await assertContract(
        harness.running,
        contractFor(recorded, { query: "?account_number=abc&bank_code=057" }),
      );
    });
  });
});

describe("T3 Paystack transfer recipient fixtures", () => {
  it("T3 transfer-recipient-create-success matches its fixture", async () => {
    const recorded = await fixture("transfer-recipient-create-success");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("T3 transfer-recipient-create-invalid-request matches its fixture", async () => {
    const recorded = await fixture("transfer-recipient-create-invalid-request");
    await withHarness(async (harness) => {
      await assertContract(harness.running, contractFor(recorded));
    });
  });

  it("C4 returns a bank list and resolves an account from the fixed name list", async () => {
    await withHarness(async (harness) => {
      const banks = await listBanks(harness, "?country=nigeria");
      const banksBody = (await banks.json()) as { data: unknown[] };
      expect(banksBody.data).toHaveLength(292);

      const resolved = await resolveAccount(harness, "?account_number=0000000001&bank_code=001");
      const resolvedBody = (await resolved.json()) as {
        data: { account_number: string; account_name: string; bank_id: number };
      };
      expect(resolvedBody.data.account_number).toBe("0000000001");
      expect(typeof resolvedBody.data.account_name).toBe("string");
      expect(resolvedBody.data.account_name.length).toBeGreaterThan(0);
      expect(resolvedBody.data.bank_id).toBe(24);

      const unknownBank = await resolveAccount(
        harness,
        "?account_number=0000000001&bank_code=999999",
      );
      expect(unknownBank.status).toBe(400);
      expect(((await unknownBank.json()) as { code: string }).code).toBe("invalid_bank_code");
    });
  });
});
