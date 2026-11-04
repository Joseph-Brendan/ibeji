import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { EventLog } from "../../src/core/events.js";
import { getFailure } from "../../src/core/failures/catalog.js";
import { decide, decideWebhook } from "../../src/core/failures/engine.js";
import { RuleStore, type TwinCapability } from "../../src/core/failures/rules.js";
import { loadScenarios } from "../../src/core/scenarios/loader.js";
import { ScenarioRunner } from "../../src/core/scenarios/runner.js";
import type { Scenario } from "../../src/core/scenarios/schema.js";
import { registry } from "../../src/twins/registry.js";

type ExpectedRule = {
  readonly failureId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly actions?: string;
};

type ExpectedScenario = {
  readonly twins: readonly string[];
  readonly rules: readonly ExpectedRule[];
  readonly steps: readonly { readonly afterSeconds: number; readonly removeRule: string }[];
};

const EXPECTED: Readonly<Record<string, ExpectedScenario>> = {
  "kola-case": {
    twins: ["paystack", "flutterwave"],
    rules: [
      {
        failureId: "timeout-after-commit",
        settings: { mode: "hang" },
        actions: "refund.create",
      },
    ],
    steps: [],
  },
  "slow-friday": {
    twins: ["paystack", "flutterwave"],
    rules: [
      { failureId: "slow-response", settings: { seconds: 8 } },
      { failureId: "webhook-delayed", settings: { seconds: 60, jitterSeconds: 120 } },
    ],
    steps: [],
  },
  "bank-outage": {
    twins: ["paystack", "flutterwave"],
    rules: [{ failureId: "server-error", settings: { times: null }, actions: "transfer" }],
    steps: [{ afterSeconds: 120, removeRule: "failing-transfers" }],
  },
  "webhook-storm": {
    twins: ["paystack", "flutterwave"],
    rules: [
      { failureId: "webhook-duplicated", settings: { copies: 2, gapSeconds: 3 } },
      { failureId: "webhook-out-of-order", settings: { windowSeconds: 15 } },
    ],
    steps: [],
  },
  "stuck-payouts": {
    twins: ["paystack", "flutterwave"],
    rules: [
      {
        failureId: "transfer-stuck-pending",
        settings: { seconds: 600, thenFailPercent: 50 },
        actions: "transfer",
      },
    ],
    steps: [],
  },
  "checkout-declines": {
    twins: ["paystack", "flutterwave"],
    rules: [
      {
        failureId: "payment-declined",
        settings: { percent: 50 },
        actions: "checkout.submit",
      },
    ],
    steps: [],
  },
};

function capabilities(): readonly TwinCapability[] {
  return registry.list().map((definition) => ({
    id: definition.id,
    actions: definition.actions.map((action) => action.id),
    failures: definition.failures.support,
  }));
}

async function realScenarios(): Promise<readonly Scenario[]> {
  return loadScenarios("scenarios");
}

describe("C6 shipped scenarios", () => {
  it("C6: ships exactly the six C6 scenarios with the C6 settings", async () => {
    const scenarios = await realScenarios();
    expect(scenarios.map((scenario) => scenario.id).sort()).toEqual(Object.keys(EXPECTED).sort());

    for (const scenario of scenarios) {
      const expected = EXPECTED[scenario.id];
      expect(expected).toBeDefined();
      expect(scenario.twins).toEqual(expected?.twins);
      expect(scenario.rules.map((rule) => rule.failureId)).toEqual(
        expected?.rules.map((rule) => rule.failureId),
      );
      expect(scenario.steps).toEqual(expected?.steps);

      for (const rule of scenario.rules) {
        const expectedRule = expected?.rules.find((item) => item.failureId === rule.failureId);
        expect(rule.settings).toEqual(expectedRule?.settings);
        expect(rule.actions).toBe(expectedRule?.actions);
        const definition = getFailure(rule.failureId);
        expect(definition).toBeDefined();
        expect(definition?.failureSettingsSchema.safeParse(rule.settings).success).toBe(true);
      }
    }
  });

  it("C6: every scenario lists only twins that support all of its failures", async () => {
    const scenarios = await realScenarios();

    for (const scenario of scenarios) {
      for (const twinId of scenario.twins) {
        const definition = registry.require(twinId);
        for (const rule of scenario.rules) {
          const support = definition.failures.support.find((item) => item.id === rule.failureId);
          expect(support).toBeDefined();

          if (rule.actions !== undefined) {
            const tokens = typeof rule.actions === "string" ? [rule.actions] : rule.actions;
            for (const token of tokens) {
              const matches = support?.actions.some(
                (actionId) =>
                  token === actionId ||
                  token === `${twinId}.${actionId}` ||
                  token === actionId.split(".")[0],
              );
              expect(matches).toBe(true);
            }
          }
        }
      }
    }
  });

  for (const scenarioId of Object.keys(EXPECTED)) {
    it(`C6 ${scenarioId}: runs on every supported twin with the fake clock`, async () => {
      const scenarios = await realScenarios();
      const scenario = scenarios.find((item) => item.id === scenarioId);
      const expected = EXPECTED[scenarioId];
      if (scenario === undefined || expected === undefined) {
        throw new Error(`the ${scenarioId} scenario was not loaded`);
      }

      for (const twinId of scenario.twins) {
        const clock = new FakeClock(1_700_000_000_000);
        const events = new EventLog(clock);
        const rules = new RuleStore({
          twins: capabilities(),
          events,
          runningTwinIds: () => [twinId],
        });
        const runner = new ScenarioRunner({
          rules,
          clock,
          scenarios,
          runningTwinIds: () => [twinId],
        });

        runner.start(scenario.id, { twins: [twinId] });
        expect(runner.activeScenarioId).toBe(scenario.id);
        expect(runner.activeTwins).toEqual([twinId]);

        const started = events.after(0).find((event) => event.type === "scenario-started");
        expect(started?.details).toMatchObject({
          scenarioId: scenario.id,
          twins: [twinId],
          rules: scenario.rules.length,
        });
        expect(events.after(0).filter((event) => event.type === "rule-added")).toHaveLength(
          scenario.rules.length,
        );

        const active = rules.list();
        expect(active).toHaveLength(scenario.rules.length);
        for (const rule of active) {
          expect(rule.scenarioId).toBe(scenario.id);
          expect(rule.twins).toEqual([twinId]);
          const expectedRule = expected.rules.find((item) => item.failureId === rule.failureId);
          const effectiveSettings =
            expectedRule === undefined
              ? undefined
              : getFailure(expectedRule.failureId)?.failureSettingsSchema.parse(
                  expectedRule.settings,
                );
          expect(rule.settings).toEqual(effectiveSettings);
          if (expectedRule?.actions !== undefined) {
            expect(rule.resolvedActions[twinId]?.length).toBeGreaterThan(0);
          }
        }

        for (const step of scenario.steps) {
          clock.advanceBy(step.afterSeconds * 1_000);
          const scenarioStep = events.after(0).find((event) => event.type === "scenario-step");
          expect(scenarioStep?.details).toMatchObject({
            scenarioId: scenario.id,
            scenarioRuleId: step.removeRule,
            afterSeconds: step.afterSeconds,
          });
          expect(rules.list().some((rule) => rule.scenarioId === scenario.id)).toBe(false);
        }

        if (scenario.steps.length === 0) {
          expect(rules.list()).toHaveLength(scenario.rules.length);
        }

        runner.stop();
        expect(runner.activeScenarioId).toBeUndefined();
        const finished = events.after(0).find((event) => event.type === "scenario-finished");
        expect(finished?.details).toMatchObject({
          scenarioId: scenario.id,
          reason: "stopped",
        });
      }
    });
  }

  it("C6: every scenario rule produces the failure plan its story describes", async () => {
    const scenarios = await realScenarios();
    const random = { next: () => 0 };

    for (const scenario of scenarios) {
      for (const twinId of scenario.twins) {
        const clock = new FakeClock(1_000);
        const events = new EventLog(clock);
        const rules = new RuleStore({
          twins: capabilities(),
          events,
          runningTwinIds: () => [twinId],
        });
        const runner = new ScenarioRunner({
          rules,
          clock,
          scenarios,
          runningTwinIds: () => [twinId],
        });
        runner.start(scenario.id, { twins: [twinId] });
        const active = rules.activeRules();
        const now = clock.now();

        if (scenario.id === "kola-case") {
          const plan = decide({
            twinId,
            actionId: "refund.create",
            rules: active,
            random,
            now,
          });
          expect(plan.step).toBe("timeout-after-commit");
          expect(plan.actionPerformed).toBe(true);
          expect(plan.connection).toBe("hang");
        }

        if (scenario.id === "slow-friday") {
          const actionId = twinId === "paystack" ? "transaction.list" : "payment.list";
          const plan = decide({ twinId, actionId, rules: active, random, now });
          expect(plan.delayMs).toBe(8_000);
          expect(plan.firedSteps).toContain("slow-response");

          const webhook = decideWebhook({
            twinId,
            actionId: "checkout.submit",
            rules: active,
            random,
            now,
          });
          expect(webhook.send).toBe(true);
          expect(webhook.deliveries[0]?.delayMs).toBeGreaterThanOrEqual(60_000);
          expect(webhook.deliveries[0]?.delayMs).toBeLessThanOrEqual(180_000);
          expect(webhook.firedSteps).toContain("webhook-delayed");
        }

        if (scenario.id === "bank-outage") {
          const plan = decide({
            twinId,
            actionId: "transfer.create",
            rules: active,
            random,
            now,
          });
          expect(plan.step).toBe("server-error");
          expect(plan.status).toBe(500);
          expect(plan.actionPerformed).toBe(false);
        }

        if (scenario.id === "webhook-storm") {
          const webhook = decideWebhook({
            twinId,
            actionId: "checkout.submit",
            rules: active,
            random,
            now,
          });
          expect(webhook.deliveries).toHaveLength(2);
          expect(webhook.deliveries[1]?.dueAt).toBe(now + 3_000);
          expect(webhook.deliveries[0]?.holdUntil).toBe(now + 15_000);
          expect(webhook.firedSteps).toEqual(["webhook-out-of-order", "webhook-duplicated"]);
        }

        if (scenario.id === "stuck-payouts") {
          const plan = decide({
            twinId,
            actionId: "transfer.create",
            rules: active,
            random,
            now,
          });
          expect(plan.effect).toMatchObject({
            kind: "transfer-stuck-pending",
            seconds: 600,
            thenFailPercent: 50,
            endsAt: now + 600_000,
          });
          expect(plan.actionPerformed).toBe(true);
        }

        if (scenario.id === "checkout-declines") {
          const plan = decide({
            twinId,
            actionId: "checkout.submit",
            rules: active,
            random,
            now,
          });
          expect(plan.effect).toMatchObject({ kind: "payment-declined", percent: 50 });
          expect(plan.actionPerformed).toBe(true);
        }

        runner.stop();
      }
    }
  });
});
