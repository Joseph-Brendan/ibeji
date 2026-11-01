import { describe, expect, it } from "vitest";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import { assertConformance, runConformance } from "../../src/twins/framework/conformance.js";

describe("T14 Flutterwave twin conformance", () => {
  it("T14 the Flutterwave twin passes every shared check", async () => {
    const result = await runConformance(flutterwaveTwin);
    assertConformance(result);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  }, 30_000);
});
