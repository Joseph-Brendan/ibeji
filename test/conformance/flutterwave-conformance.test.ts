import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { EventLog } from "../../src/core/events.js";
import { RuleStore } from "../../src/core/failures/rules.js";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import { assertConformance, runConformance } from "../../src/twins/framework/conformance.js";

describe("T14 Flutterwave twin conformance", () => {
  it("T14 the Flutterwave twin passes every shared check", async () => {
    const result = await runConformance(flutterwaveTwin);
    assertConformance(result);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  }, 30_000);

  it("T14 Flutterwave refuses transfer-reversed because v3 has no reversal (C21 D33)", () => {
    const clock = new FakeClock(100);
    const events = new EventLog(clock);
    const rules = new RuleStore({
      twins: [
        {
          id: flutterwaveTwin.id,
          actions: flutterwaveTwin.actions.map((action) => action.id),
          failures: flutterwaveTwin.failures.support,
        },
      ],
      events,
    });

    expect(
      flutterwaveTwin.failures.support.some((support) => support.id === "transfer-reversed"),
    ).toBe(false);
    expect(() => {
      rules.add({
        failureId: "transfer-reversed",
        twins: [flutterwaveTwin.id],
        actions: "transfer.create",
      });
    }).toThrow(/not supported/u);
  });
});
