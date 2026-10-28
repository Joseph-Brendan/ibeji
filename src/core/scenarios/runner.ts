import type { Clock } from "../clock.js";
import { IbejiError } from "../errors.js";
import type { RuleStore } from "../failures/rules.js";
import type { Scenario, ScenarioStep } from "./schema.js";

export type ScenarioRunnerOptions = {
  readonly rules: RuleStore;
  readonly clock: Clock;
  readonly scenarios: readonly Scenario[];
  readonly runningTwinIds: () => readonly string[];
};

export type StartScenarioOptions = {
  readonly twins?: readonly string[];
};

type ActiveRun = {
  readonly scenario: Scenario;
  twins: string[];
  readonly timers: number[];
  readonly ruleIdsByScenarioRule: ReadonlyMap<string, readonly string[]>;
};

/**
 * Runs one scenario at a time. It owns the rules it adds and removes them when
 * the scenario stops, when its twins stop, or when all rules are cleared.
 */
export class ScenarioRunner {
  private readonly rules: RuleStore;
  private readonly clock: Clock;
  private readonly scenarios = new Map<string, Scenario>();
  private readonly runningTwinIds: () => readonly string[];
  private active: ActiveRun | undefined;

  constructor(options: ScenarioRunnerOptions) {
    this.rules = options.rules;
    this.clock = options.clock;
    this.runningTwinIds = options.runningTwinIds;
    for (const scenario of options.scenarios) {
      this.scenarios.set(scenario.id, scenario);
    }

    this.rules.onClear(() => {
      this.finish("rules-cleared");
    });
  }

  get activeScenarioId(): string | undefined {
    return this.active?.scenario.id;
  }

  get activeTwins(): readonly string[] {
    return this.active === undefined ? [] : [...this.active.twins];
  }

  start(scenarioId: string, options: StartScenarioOptions = {}): void {
    const scenario = this.scenarios.get(scenarioId);
    if (scenario === undefined) {
      throw new IbejiError("UNKNOWN_SCENARIO", {
        why: `"${scenarioId}" is not one of the loaded scenarios.`,
      });
    }

    const running = new Set(this.runningTwinIds());
    const requested = options.twins === undefined ? [] : [...new Set(options.twins)];
    const chosen: string[] = [];

    if (requested.length > 0) {
      for (const twinId of requested) {
        if (!scenario.twins.includes(twinId)) {
          throw new IbejiError("FAILURE_NOT_SUPPORTED_BY_TWIN", {
            what: `The ${scenario.id} scenario does not support the ${twinId} twin.`,
            why: `The scenario declares support for: ${scenario.twins.join(", ")}.`,
            fix: "Choose one of the twins the scenario supports.",
          });
        }
        if (!this.rules.hasTwin(twinId)) {
          throw new IbejiError("UNKNOWN_TWIN", {
            why: `"${twinId}" is not a twin the rule store knows about.`,
          });
        }
        if (!running.has(twinId)) {
          throw new IbejiError("TWIN_NOT_RUNNING", {
            what: `The ${twinId} twin is not running.`,
            why: `The ${scenario.id} scenario can only run on a twin that is part of the current session.`,
            fix: "Start the twin, or choose a running twin.",
          });
        }
        chosen.push(twinId);
      }
    } else {
      for (const twinId of scenario.twins) {
        if (running.has(twinId) && this.rules.hasTwin(twinId)) {
          chosen.push(twinId);
        }
      }
      if (chosen.length === 0) {
        throw new IbejiError("TWIN_NOT_RUNNING", {
          what: `No running twin supports the ${scenario.id} scenario.`,
          why: "Every twin the scenario supports is stopped or unknown.",
          fix: "Start one of the scenario's supported twins and try again.",
        });
      }
    }

    const inputs = scenario.rules.flatMap((rule) =>
      chosen.map((twinId) => ({
        failureId: rule.failureId,
        settings: rule.settings,
        twins: [twinId],
        actions: rule.actions,
        scenarioId: scenario.id,
      })),
    );

    for (const input of inputs) {
      this.rules.validate(input);
    }

    if (this.active !== undefined) {
      this.stop();
    }

    const ruleIdsByScenarioRule = new Map<string, string[]>();
    for (const rule of scenario.rules) {
      const ruleIds: string[] = [];
      for (const twinId of chosen) {
        const added = this.rules.add({
          failureId: rule.failureId,
          settings: rule.settings,
          twins: [twinId],
          actions: rule.actions,
          scenarioId: scenario.id,
        });
        ruleIds.push(added.id);
      }
      ruleIdsByScenarioRule.set(rule.id, ruleIds);
    }

    const timers: number[] = [];
    const active: ActiveRun = {
      scenario,
      twins: chosen,
      timers,
      ruleIdsByScenarioRule,
    };
    this.active = active;

    for (const step of scenario.steps) {
      timers.push(
        this.clock.setTimeout(() => {
          this.runStep(active, step);
        }, step.afterSeconds * 1_000),
      );
    }

    this.rules.events.publish({
      type: "scenario-started",
      scope: "ibeji",
      summary: `Started the ${scenario.name} scenario.`,
      details: {
        scenarioId: scenario.id,
        twins: chosen,
        rules: inputs.length,
      },
    });
  }

  stop(): void {
    if (this.active === undefined) {
      return;
    }

    const scenarioId = this.active.scenario.id;
    this.cancelTimers(this.active);
    this.rules.removeAll({ scenarioId });
    this.active = undefined;
    this.publishFinished(scenarioId, "stopped");
  }

  twinStopped(twinId: string): void {
    if (this.active === undefined || !this.active.twins.includes(twinId)) {
      return;
    }

    const scenarioId = this.active.scenario.id;
    this.rules.removeAll({ scenarioId, twinId });
    this.active.twins = this.active.twins.filter((id) => id !== twinId);
    this.rules.events.publish({
      type: "warning",
      scope: twinId,
      summary: `The ${scenarioId} scenario removed its rules for the stopped twin.`,
      details: { scenarioId, twinId },
    });

    if (this.active.twins.length === 0) {
      this.finish("all-twins-stopped");
    }
  }

  private runStep(active: ActiveRun, step: ScenarioStep): void {
    const ruleIds = active.ruleIdsByScenarioRule.get(step.removeRule) as readonly string[];
    const removed: string[] = [];
    for (const ruleId of ruleIds) {
      if (this.rules.get(ruleId) !== undefined) {
        this.rules.remove(ruleId);
        removed.push(ruleId);
      }
    }

    this.rules.events.publish({
      type: "scenario-step",
      scope: "ibeji",
      summary: `The ${active.scenario.name} scenario removed a timed rule.`,
      details: {
        scenarioId: active.scenario.id,
        scenarioRuleId: step.removeRule,
        removedRuleIds: removed,
        afterSeconds: step.afterSeconds,
      },
    });
  }

  private finish(reason: string): void {
    if (this.active === undefined) {
      return;
    }

    const scenarioId = this.active.scenario.id;
    this.cancelTimers(this.active);
    this.active = undefined;
    this.publishFinished(scenarioId, reason);
  }

  private cancelTimers(active: ActiveRun): void {
    for (const handle of active.timers) {
      this.clock.clearTimeout(handle);
    }
  }

  private publishFinished(scenarioId: string, reason: string): void {
    this.rules.events.publish({
      type: "scenario-finished",
      scope: "ibeji",
      summary: `The ${scenarioId} scenario stopped.`,
      details: { scenarioId, reason },
    });
  }
}
