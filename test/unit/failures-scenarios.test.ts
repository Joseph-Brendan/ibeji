import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { IbejiError } from "../../src/core/errors.js";
import { EventLog } from "../../src/core/events.js";
import { RuleStore, type TwinCapability } from "../../src/core/failures/rules.js";
import { loadScenarios } from "../../src/core/scenarios/loader.js";
import { ScenarioRunner } from "../../src/core/scenarios/runner.js";
import {
  parseScenario,
  parseScenarioJson,
  type Scenario,
} from "../../src/core/scenarios/schema.js";

const FIXTURES = "test/fixtures/scenarios";

const alpha: TwinCapability = {
  id: "alpha",
  actions: ["payment.create", "refund.create", "refund.fetch"],
  failures: [
    { id: "slow-response", actions: ["refund.create", "refund.fetch"] },
    { id: "payment-declined", actions: ["payment.create"] },
  ],
};

const beta: TwinCapability = {
  id: "beta",
  actions: ["payment.create", "refund.create", "refund.fetch"],
  failures: [
    { id: "slow-response", actions: ["refund.create", "refund.fetch"] },
    { id: "payment-declined", actions: ["payment.create"] },
  ],
};

type Harness = {
  readonly clock: FakeClock;
  readonly events: EventLog;
  readonly rules: RuleStore;
  readonly runner: ScenarioRunner;
  readonly setRunning: (ids: readonly string[]) => void;
};

async function harness(
  running: readonly string[] = ["alpha", "beta"],
  extraScenarios: readonly Scenario[] = [],
): Promise<Harness> {
  const clock = new FakeClock(10_000);
  const events = new EventLog(clock);
  let runningIds = running;
  const rules = new RuleStore({
    twins: [alpha, beta],
    events,
    runningTwinIds: () => runningIds,
  });
  const scenarios = [...(await loadScenarios(FIXTURES)), ...extraScenarios];
  const runner = new ScenarioRunner({
    rules,
    clock,
    scenarios,
    runningTwinIds: () => runningIds,
  });

  return {
    clock,
    events,
    rules,
    runner,
    setRunning: (ids) => {
      runningIds = ids;
    },
  };
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IbejiError);
    if (error instanceof IbejiError) {
      expect(error.code).toBe(code);
    }
    return;
  }
  throw new Error(`expected an ${code} error`);
}

function expectScenarioInvalid(run: () => unknown, fields: readonly string[]): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IbejiError);
    if (error instanceof IbejiError) {
      expect(error.code).toBe("SCENARIO_INVALID");
      for (const field of fields) {
        expect(error.why).toContain(field);
      }
    }
    return;
  }
  throw new Error("the bad scenario was accepted");
}

describe("C6 scenario loading", () => {
  it("C6: loads both small test scenarios from the fixture folder", async () => {
    const scenarios = await loadScenarios(FIXTURES);

    expect(scenarios.map((scenario) => scenario.id)).toEqual(["test-declined", "test-timed-slow"]);
    const timed = scenarios.find((scenario) => scenario.id === "test-timed-slow");
    expect(timed?.rules[0]?.settings).toEqual({ seconds: 8 });
    expect(timed?.steps).toEqual([{ afterSeconds: 30, removeRule: "slow-refunds" }]);
  });

  it("C6: a bad scenario names the file and the field", () => {
    try {
      parseScenario(
        {
          id: "bad",
          story: "Missing its name.",
          twins: ["alpha"],
          rules: [{ id: "one", failureId: "slow-response" }],
        },
        "bad-scenario.json",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("SCENARIO_INVALID");
        expect(error.why).toContain("bad-scenario.json");
        expect(error.why).toContain("name");
      }
      return;
    }
    throw new Error("the bad scenario was accepted");
  });

  it("C6: rejects unknown failures, bad settings, duplicate rule ids and missing step rules", () => {
    const base = {
      id: "bad",
      name: "Bad",
      story: "Bad.",
      twins: ["alpha"],
      rules: [{ id: "one", failureId: "slow-response", settings: { seconds: 8 } }],
    };

    expectScenarioInvalid(
      () =>
        parseScenario(
          { ...base, rules: [{ id: "one", failureId: "not-a-failure" }] },
          "unknown-failure.json",
        ),
      ["unknown-failure.json", "rules.0.failureId"],
    );
    expectScenarioInvalid(
      () =>
        parseScenario(
          {
            ...base,
            rules: [{ id: "one", failureId: "slow-response", settings: { seconds: 0 } }],
          },
          "bad-settings.json",
        ),
      ["bad-settings.json", "rules.0.settings.seconds"],
    );
    expectScenarioInvalid(
      () =>
        parseScenario({ ...base, rules: [base.rules[0], base.rules[0]] }, "duplicate-rules.json"),
      ["duplicate-rules.json", "rules.1.id"],
    );
    expectScenarioInvalid(
      () =>
        parseScenario(
          { ...base, steps: [{ afterSeconds: 1, removeRule: "missing" }] },
          "missing-step-rule.json",
        ),
      ["missing-step-rule.json", "steps.0.removeRule"],
    );
    expectScenarioInvalid(
      () => parseScenario({ ...base, twins: ["alpha", "alpha"] }, "duplicate-twins.json"),
      ["duplicate-twins.json", "twins.1"],
    );
  });

  it("C6: rejects invalid JSON and duplicate scenario ids across files", async () => {
    expectScenarioInvalid(() => parseScenarioJson("{not json", "broken.json"), ["broken.json"]);

    const directory = await mkdtemp(join(tmpdir(), "ibeji-scenarios-"));
    try {
      const scenario = {
        id: "same",
        name: "Same",
        story: "Same.",
        twins: ["alpha"],
        rules: [{ id: "one", failureId: "slow-response" }],
      };
      await writeFile(join(directory, "one.json"), JSON.stringify(scenario));
      await writeFile(join(directory, "two.json"), JSON.stringify(scenario));
      await expect(loadScenarios(directory)).rejects.toThrow(IbejiError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("C6 scenario runner", () => {
  it("C6: applies the scenario's rules for the chosen twins", async () => {
    const { rules, runner } = await harness();
    runner.start("test-timed-slow", { twins: ["alpha"] });

    expect(runner.activeScenarioId).toBe("test-timed-slow");
    expect(runner.activeTwins).toEqual(["alpha"]);
    expect(rules.list()).toHaveLength(1);
    expect(rules.list()[0]).toMatchObject({
      failureId: "slow-response",
      settings: { seconds: 8 },
      scenarioId: "test-timed-slow",
      twins: ["alpha"],
    });
  });

  it("C6: defaults to every supported twin that is running", async () => {
    const { rules, runner } = await harness(["alpha", "beta"]);
    runner.start("test-timed-slow");

    expect(runner.activeTwins).toEqual(["alpha", "beta"]);
    expect(rules.list()).toHaveLength(2);
  });

  it("C6: timed steps fire on time with the fake clock", async () => {
    const { clock, events, rules, runner } = await harness(["alpha"]);
    runner.start("test-timed-slow", { twins: ["alpha"] });

    clock.advanceBy(29_000);
    expect(rules.list()).toHaveLength(1);

    clock.advanceBy(1_000);
    expect(rules.list()).toEqual([]);
    expect(events.after(0).some((event) => event.type === "scenario-step")).toBe(true);
    expect(runner.activeScenarioId).toBe("test-timed-slow");
  });

  it("C6: stopping removes its rules and cancels timed steps", async () => {
    const { clock, events, rules, runner } = await harness(["alpha"]);
    runner.start("test-timed-slow", { twins: ["alpha"] });
    runner.stop();

    expect(runner.activeScenarioId).toBeUndefined();
    expect(rules.list()).toEqual([]);
    clock.advanceBy(30_000);
    expect(events.after(0).filter((event) => event.type === "scenario-step")).toEqual([]);
    expect(
      events
        .after(0)
        .some((event) => event.type === "scenario-finished" && event.details.reason === "stopped"),
    ).toBe(true);
  });

  it("C6: starting a second scenario stops the first", async () => {
    const { events, rules, runner } = await harness(["alpha"]);
    runner.start("test-timed-slow", { twins: ["alpha"] });
    runner.start("test-declined", { twins: ["alpha"] });

    expect(runner.activeScenarioId).toBe("test-declined");
    expect(rules.list()).toHaveLength(1);
    expect(rules.list()[0]?.failureId).toBe("payment-declined");
    expect(
      events
        .after(0)
        .some(
          (event) =>
            event.type === "scenario-finished" && event.details.scenarioId === "test-timed-slow",
        ),
    ).toBe(true);
  });

  it("C6: choosing a twin the scenario does not support is rejected", async () => {
    const { runner } = await harness(["alpha", "beta"]);
    expectCode(
      () => runner.start("test-declined", { twins: ["beta"] }),
      "FAILURE_NOT_SUPPORTED_BY_TWIN",
    );
  });

  it("C6: choosing a twin that is not running is rejected", async () => {
    const { setRunning, runner } = await harness(["alpha", "beta"]);
    setRunning(["alpha"]);
    expectCode(() => runner.start("test-timed-slow", { twins: ["beta"] }), "TWIN_NOT_RUNNING");
  });

  it("C6: an unknown scenario id is rejected", async () => {
    const { runner } = await harness();
    expectCode(() => runner.start("missing"), "UNKNOWN_SCENARIO");
  });

  it("C6: a scenario that names an unknown twin is rejected", async () => {
    const extra: Scenario = {
      id: "unknown-twin",
      name: "Unknown twin",
      story: "A scenario naming a twin the store does not know.",
      twins: ["gamma"],
      rules: [{ id: "slow", failureId: "slow-response", settings: {}, actions: "refund" }],
      steps: [],
    };
    const { runner } = await harness(["alpha", "gamma"], [extra]);
    expectCode(() => runner.start("unknown-twin", { twins: ["gamma"] }), "UNKNOWN_TWIN");
    expectCode(() => runner.start("unknown-twin"), "TWIN_NOT_RUNNING");
  });

  it("C6: no supported twin running gives TWIN_NOT_RUNNING", async () => {
    const { setRunning, runner } = await harness(["alpha", "beta"]);
    setRunning([]);
    expectCode(() => runner.start("test-declined"), "TWIN_NOT_RUNNING");
  });

  it("C6: an invalid start leaves the current scenario running", async () => {
    const { rules, runner } = await harness(["alpha", "beta"]);
    runner.start("test-timed-slow", { twins: ["alpha"] });
    expectCode(
      () => runner.start("test-declined", { twins: ["beta"] }),
      "FAILURE_NOT_SUPPORTED_BY_TWIN",
    );

    expect(runner.activeScenarioId).toBe("test-timed-slow");
    expect(rules.list()[0]?.scenarioId).toBe("test-timed-slow");
  });

  it("C6: clearing all rules stops the scenario", async () => {
    const { clock, events, rules, runner } = await harness(["alpha"]);
    runner.start("test-timed-slow", { twins: ["alpha"] });
    rules.clear();

    expect(runner.activeScenarioId).toBeUndefined();
    expect(rules.list()).toEqual([]);
    clock.advanceBy(30_000);
    expect(
      events
        .after(0)
        .some(
          (event) => event.type === "scenario-finished" && event.details.reason === "rules-cleared",
        ),
    ).toBe(true);
  });

  it("C6: a stopped twin loses only that twin's scenario rules", async () => {
    const { events, rules, runner } = await harness(["alpha", "beta"]);
    runner.start("test-timed-slow");
    runner.twinStopped("alpha");

    expect(runner.activeTwins).toEqual(["beta"]);
    expect(rules.list()).toHaveLength(1);
    expect(rules.list()[0]?.twins).toEqual(["beta"]);
    expect(
      events.after(0).some((event) => event.type === "warning" && event.scope === "alpha"),
    ).toBe(true);

    runner.twinStopped("beta");
    expect(runner.activeScenarioId).toBeUndefined();
    expect(rules.list()).toEqual([]);
    expect(
      events
        .after(0)
        .some(
          (event) =>
            event.type === "scenario-finished" && event.details.reason === "all-twins-stopped",
        ),
    ).toBe(true);
  });

  it("C6: stopping a twin when no scenario is running or the twin is not chosen is a no-op", async () => {
    const { rules, runner } = await harness(["alpha", "beta"]);
    runner.twinStopped("alpha");
    expect(runner.activeScenarioId).toBeUndefined();

    runner.start("test-timed-slow", { twins: ["alpha"] });
    runner.twinStopped("beta");
    expect(runner.activeTwins).toEqual(["alpha"]);
    expect(rules.list()).toHaveLength(1);
    runner.stop();
  });

  it("C6: a timed step after a rule was already removed reports no removed ids", async () => {
    const { clock, events, rules, runner } = await harness(["alpha"]);
    runner.start("test-timed-slow", { twins: ["alpha"] });
    const rule = rules.list()[0];
    if (rule === undefined) {
      throw new Error("the scenario did not add its rule");
    }
    rules.remove(rule.id);

    clock.advanceBy(30_000);
    const step = events.after(0).find((event) => event.type === "scenario-step");
    expect(step?.details.removedRuleIds).toEqual([]);
  });

  it("C6: stopping when no scenario is active and finishing after a second clear are no-ops", async () => {
    const { rules, runner } = await harness();
    runner.stop();
    expect(runner.activeTwins).toEqual([]);
    rules.clear();
    rules.clear();
  });
});
