import { describe, expect, it } from "vitest";

import {
  FAILURE_BY_ID,
  FAILURE_CATALOG,
  FAILURE_IDS,
  FAILURE_SETTINGS_JSON_SCHEMAS,
  getFailure,
} from "../../src/core/failures/catalog.js";

const expectedDefaults: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "slow-response": { seconds: 5 },
  "timeout-after-commit": { mode: "hang" },
  "timeout-before-commit": { mode: "hang" },
  "server-error": { times: 3, status: 500 },
  "rate-limited": { times: 3 },
  "flaky-network": { percent: 20, when: "before" },
  "webhook-delayed": { seconds: 60, jitterSeconds: 0 },
  "webhook-duplicated": { copies: 2, gapSeconds: 5 },
  "webhook-out-of-order": { windowSeconds: 15 },
  "webhook-never-sent": { percent: 100 },
  "webhook-verification-fails": { method: "wrong-secret" },
  "payment-declined": { percent: 100 },
  // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
  "authentication-required": { then: "fail" },
  "transfer-stuck-pending": { seconds: null, thenFailPercent: 0 },
  "transfer-reversed": { afterSeconds: 60, percent: 100 },
  "bank-resolve-fails": { mode: "error" },
};

describe("C5 failure catalog", () => {
  it("C5: contains every C5 failure and no extra failure", () => {
    expect(FAILURE_IDS).toEqual(Object.keys(expectedDefaults));
    expect(FAILURE_CATALOG).toHaveLength(FAILURE_IDS.length);
    expect(FAILURE_CATALOG.map((failure) => failure.id)).toEqual(FAILURE_IDS);
  });

  it("C5: every failure has a stable id, name and two placeholder descriptions", () => {
    for (const failure of FAILURE_CATALOG) {
      expect(failure.id).toBeDefined();
      expect(failure.name.length).toBeGreaterThan(0);
      expect(failure.description.realLife).toContain("Step 5.2");
      expect(failure.description.whatToCheck).toContain("Step 5.2");
    }
  });

  it("C5: every failure applies the exact C5 defaults", () => {
    for (const id of FAILURE_IDS) {
      expect(FAILURE_BY_ID[id].failureSettingsSchema.parse({})).toEqual(expectedDefaults[id]);
    }
  });

  it("C5: every settings schema includes the shared twins and actions settings", () => {
    for (const failure of FAILURE_CATALOG) {
      expect(
        failure.settingsSchema.parse({
          twins: ["alpha"],
          actions: "refund.create",
        }),
      ).toMatchObject({ twins: ["alpha"], actions: "refund.create" });
    }
  });

  it("C5: every settings schema rejects unknown settings", () => {
    for (const failure of FAILURE_CATALOG) {
      expect(failure.failureSettingsSchema.safeParse({ notASetting: true }).success).toBe(false);
    }
  });

  it("C5: every settings schema is exported as JSON Schema", () => {
    for (const id of FAILURE_IDS) {
      const jsonSchema = FAILURE_SETTINGS_JSON_SCHEMAS[id];
      expect(jsonSchema.type).toBe("object");
      expect(jsonSchema.additionalProperties).toBe(false);
      expect(jsonSchema.properties).toHaveProperty("twins");
      expect(jsonSchema.properties).toHaveProperty("actions");
      expect(FAILURE_BY_ID[id].settingsJsonSchema).toEqual(jsonSchema);
    }
  });

  it("C5: the catalog stores no twin ids and no twin support", () => {
    for (const failure of FAILURE_CATALOG) {
      expect("twins" in failure).toBe(false);
      expect("supportedTwins" in failure).toBe(false);
    }
  });

  it("C5: getFailure returns known failures and rejects unknown ones", () => {
    expect(getFailure("slow-response")?.id).toBe("slow-response");
    expect(getFailure("not-a-failure")).toBeUndefined();
  });
});
