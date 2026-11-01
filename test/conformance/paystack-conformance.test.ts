import { describe, expect, it } from "vitest";

import { assertConformance, runConformance } from "../../src/twins/framework/conformance.js";
import { paystackTwin } from "../../src/twins/paystack/definition.js";

describe("T14 Paystack twin conformance", () => {
  it("T14 the Paystack twin passes every shared check", async () => {
    const result = await runConformance(paystackTwin);
    assertConformance(result);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  }, 30_000);
});
