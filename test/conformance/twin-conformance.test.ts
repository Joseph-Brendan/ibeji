import { describe, expect, it } from "vitest";

import {
  assertConformance,
  CONFORMANCE_CHECKS,
  runConformance,
} from "../../src/twins/framework/conformance.js";
import {
  brokenActionTwin,
  brokenLiveKeyTwin,
  fakeTwinDefinition,
  headerIdempotencyTwin,
} from "../fixtures/fake-twin/definition.js";

describe("T14 twin conformance", () => {
  it("T14 registers every shared check", () => {
    expect(CONFORMANCE_CHECKS.map((check) => check.id)).toEqual([
      "definition-contract",
      "lifecycle",
      "host-and-http-safety",
      "credentials",
      "authentication",
      "action-route-parity",
      "events",
      "failure-support",
      "failure-order",
      "checkout",
      "webhook-build-sign",
      "webhook-verification-failures",
      "webhook-delivery-behaviours",
      "money",
      "idempotency",
      "event-summaries",
      "registry-extensibility",
    ]);
  });

  it("T14 the fake twin passes every check", async () => {
    const result = await runConformance(fakeTwinDefinition);
    assertConformance(result);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks).toHaveLength(CONFORMANCE_CHECKS.length);
  }, 30_000);

  it("T14 a twin that ignores live keys fails the authentication check", async () => {
    const result = await runConformance(brokenLiveKeyTwin(), { only: ["authentication"] });
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual(["authentication"]);
    expect(result.failures[0]?.error).toContain("live form");
    expect(() => {
      assertConformance(result);
    }).toThrow("A twin failed the shared conformance suite.");
  });

  it("T14 a twin whose routes do not match its actions fails the definition contract", async () => {
    const result = await runConformance(brokenActionTwin(), {
      only: ["definition-contract", "lifecycle"],
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.id)).toEqual([
      "definition-contract",
      "lifecycle",
    ]);
  });

  it("T14 a header idempotency adapter passes the idempotency and definition checks", async () => {
    const result = await runConformance(headerIdempotencyTwin(), {
      only: ["idempotency", "definition-contract"],
    });
    expect(result.passed).toBe(true);
  });

  it("T14 reports a non-Error thrown by a broken definition", async () => {
    const broken = {
      ...fakeTwinDefinition,
      routes: () => {
        throw "not an Error";
      },
    };
    const result = await runConformance(broken, { only: ["definition-contract"] });
    expect(result.failures[0]?.error).toBe("not an Error");
  });

  it("T14 describes a failure without a message", () => {
    expect(() => {
      assertConformance({
        passed: false,
        checks: [{ id: "check", ok: false, error: undefined }],
        failures: [{ id: "check", ok: false, error: undefined }],
      });
    }).toThrow("check: failed");
  });

  it("T14 an unknown check filter runs nothing", async () => {
    const result = await runConformance(fakeTwinDefinition, { only: ["not-a-check"] });
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual([]);
  });
});
