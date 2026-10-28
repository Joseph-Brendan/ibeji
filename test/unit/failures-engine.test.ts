import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FAILURE_IDS, type FailureId, getFailure } from "../../src/core/failures/catalog.js";
import {
  type ActiveRule,
  assertNever,
  decide,
  decideWebhook,
  type RequestPlan,
  type RequestStep,
  type WebhookPlan,
  type WebhookStep,
} from "../../src/core/failures/engine.js";
import { SeededRandom } from "../../src/core/random.js";

const NOW = 1_700_000_000_000;
const ACTION = "refund.create";

function definition(id: FailureId) {
  const failure = getFailure(id);
  if (failure === undefined) {
    throw new Error(`missing catalog failure ${id}`);
  }
  return failure;
}

function makeRule(
  failureId: FailureId,
  options: {
    readonly ruleId?: string;
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly twinId?: string;
    readonly actionIds?: readonly string[];
    readonly used?: number;
    readonly limit?: number | null;
    readonly order?: number;
  } = {},
): ActiveRule {
  return {
    id: options.ruleId ?? `${failureId}-${options.order ?? 1}`,
    failureId,
    settings: definition(failureId).failureSettingsSchema.parse(options.settings ?? {}),
    twinId: options.twinId ?? "alpha",
    actionIds: options.actionIds ?? [ACTION],
    used: options.used ?? 0,
    limit: options.limit ?? null,
    order: options.order ?? 1,
  };
}

function randomSource(...values: readonly number[]): { next: () => number } {
  let index = 0;
  return {
    next: () => {
      const value = values[index] ?? 0;
      index += 1;
      return value;
    },
  };
}

function requestPlan(failureId: FailureId, settings: Readonly<Record<string, unknown>>) {
  return decide({
    twinId: "alpha",
    actionId: ACTION,
    rules: [makeRule(failureId, { settings })],
    random: randomSource(0),
    now: NOW,
  });
}

function webhookPlan(failureId: FailureId, settings: Readonly<Record<string, unknown>>) {
  return decideWebhook({
    twinId: "alpha",
    actionId: ACTION,
    rules: [makeRule(failureId, { settings })],
    random: randomSource(0.5),
    now: NOW,
  });
}

const maxSettings: Readonly<Record<FailureId, Readonly<Record<string, unknown>>>> = {
  "slow-response": { seconds: 120 },
  "timeout-after-commit": { mode: "reset" },
  "timeout-before-commit": { mode: "reset" },
  "server-error": { times: 10_000, status: 599 },
  "rate-limited": { times: 10_000 },
  "flaky-network": { percent: 100, when: "after" },
  "webhook-delayed": { seconds: 3_600, jitterSeconds: 3_600 },
  "webhook-duplicated": { copies: 5, gapSeconds: 300 },
  "webhook-out-of-order": { windowSeconds: 300 },
  "webhook-never-sent": { percent: 100 },
  "webhook-verification-fails": { method: "stale-timestamp" },
  "payment-declined": { percent: 100 },
  // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
  "authentication-required": { then: "succeed" },
  "transfer-stuck-pending": { seconds: 86_400, thenFailPercent: 100 },
  "transfer-reversed": { afterSeconds: 86_400, percent: 100 },
  "bank-resolve-fails": { mode: "timeout" },
};

const requestFailureIds = FAILURE_IDS.filter((id) => !id.startsWith("webhook-"));
const webhookFailureIds: readonly FailureId[] = [
  "webhook-delayed",
  "webhook-duplicated",
  "webhook-out-of-order",
  "webhook-never-sent",
  "webhook-verification-fails",
];

const requestStepByFailure: Readonly<Record<string, RequestStep>> = {
  "slow-response": "slow-response",
  "timeout-after-commit": "timeout-after-commit",
  "timeout-before-commit": "timeout-before-commit",
  "server-error": "server-error",
  "rate-limited": "rate-limited",
  "flaky-network": "flaky-network-before",
  "payment-declined": "result",
  "authentication-required": "result",
  "transfer-stuck-pending": "result",
  "transfer-reversed": "result",
  "bank-resolve-fails": "result",
};

const requestRank: Readonly<Record<string, number>> = {
  "flaky-network-before": 1,
  "rate-limited": 2,
  "server-error": 3,
  "timeout-before-commit": 4,
  result: 5,
  "timeout-after-commit": 6,
  "flaky-network-after": 7,
  "slow-response": 8,
};

const webhookStepByFailure: Readonly<Record<string, WebhookStep>> = {
  "webhook-never-sent": "webhook-never-sent",
  "webhook-verification-fails": "webhook-verification-fails",
  "webhook-out-of-order": "webhook-out-of-order",
  "webhook-delayed": "webhook-delayed",
  "webhook-duplicated": "webhook-duplicated",
};

const webhookRank: Readonly<Record<string, number>> = {
  "webhook-never-sent": 1,
  "webhook-verification-fails": 2,
  "webhook-out-of-order": 3,
  "webhook-delayed": 4,
  "webhook-duplicated": 5,
};

function orderSettings(id: FailureId): Readonly<Record<string, unknown>> {
  if (id === "flaky-network") {
    return { percent: 100, when: "before" };
  }
  if (id === "slow-response") {
    return { seconds: 7 };
  }
  if (id === "payment-declined") {
    return { percent: 100 };
  }
  if (id === "transfer-reversed") {
    return { percent: 100 };
  }
  return {};
}

function isValidRequestPlan(plan: RequestPlan): boolean {
  const steps: readonly string[] = [
    "flaky-network-before",
    "rate-limited",
    "server-error",
    "timeout-before-commit",
    "result",
    "timeout-after-commit",
    "flaky-network-after",
    "slow-response",
    "action",
  ];
  return (
    steps.includes(plan.step) &&
    plan.firedSteps.every((step) => steps.includes(step)) &&
    typeof plan.actionPerformed === "boolean" &&
    (plan.status === undefined ||
      (Number.isInteger(plan.status) && plan.status >= 100 && plan.status <= 599)) &&
    Number.isInteger(plan.delayMs) &&
    plan.delayMs >= 0 &&
    ["normal", "hang", "reset", "dropped"].includes(plan.connection) &&
    (plan.connection === "hang"
      ? plan.connectionHangMs === 120_000
      : plan.connectionHangMs === undefined)
  );
}

function isValidWebhookPlan(plan: WebhookPlan, now: number): boolean {
  const steps: readonly string[] = [
    "webhook-never-sent",
    "webhook-verification-fails",
    "webhook-out-of-order",
    "webhook-delayed",
    "webhook-duplicated",
  ];
  return (
    typeof plan.send === "boolean" &&
    plan.firedSteps.every((step) => steps.includes(step)) &&
    (plan.send
      ? plan.notSentReason === undefined &&
        plan.deliveries.length >= 1 &&
        plan.deliveries.length <= 5
      : plan.notSentReason === "webhook-never-sent" && plan.deliveries.length === 0) &&
    plan.deliveries.every(
      (delivery) =>
        Number.isInteger(delivery.index) &&
        delivery.dueAt >= now &&
        Number.isInteger(delivery.delayMs) &&
        delivery.delayMs >= 0 &&
        (delivery.verificationFailure === undefined ||
          typeof delivery.verificationFailure === "string") &&
        (delivery.holdUntil === undefined || delivery.holdUntil >= now),
    )
  );
}

describe("T2 failure engine properties", () => {
  const generatedRules = fc.array(
    fc.record({
      failureId: fc.constantFrom(...FAILURE_IDS),
      twinId: fc.constantFrom("alpha", "beta"),
      actionId: fc.constantFrom("payment.create", "refund.create", "transfer.create"),
      used: fc.integer({ min: 0, max: 5 }),
      limit: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
      order: fc.integer({ min: 1, max: 20 }),
    }),
    { minLength: 1, maxLength: 4 },
  );

  it("T2: decide() always returns a valid decision", () => {
    fc.assert(
      fc.property(
        generatedRules,
        fc.constantFrom("alpha", "beta"),
        fc.constantFrom("payment.create", "refund.create", "transfer.create"),
        fc.integer({ min: 0, max: 4_294_967_295 }),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        (rules, twinId, actionId, seed, now) => {
          const active = rules.map((rule, index) =>
            makeRule(rule.failureId, {
              ruleId: `rule-${index}`,
              twinId: rule.twinId,
              actionIds: [rule.actionId],
              used: rule.used,
              limit: rule.limit,
              order: rule.order,
            }),
          );
          const plan = decide({
            twinId,
            actionId,
            rules: active,
            random: new SeededRandom(seed),
            now,
          });
          expect(isValidRequestPlan(plan)).toBe(true);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("T2: decide() is deterministic for the same inputs", () => {
    fc.assert(
      fc.property(
        generatedRules,
        fc.constantFrom("alpha", "beta"),
        fc.constantFrom("payment.create", "refund.create", "transfer.create"),
        fc.integer({ min: 0, max: 4_294_967_295 }),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        (rules, twinId, actionId, seed, now) => {
          const active = rules.map((rule, index) =>
            makeRule(rule.failureId, {
              ruleId: `rule-${index}`,
              twinId: rule.twinId,
              actionIds: [rule.actionId],
              used: rule.used,
              limit: rule.limit,
              order: rule.order,
            }),
          );
          const first = decide({
            twinId,
            actionId,
            rules: active,
            random: new SeededRandom(seed),
            now,
          });
          const second = decide({
            twinId,
            actionId,
            rules: active,
            random: new SeededRandom(seed),
            now,
          });
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("T2: decideWebhook() always returns a valid decision", () => {
    fc.assert(
      fc.property(
        generatedRules,
        fc.constantFrom("alpha", "beta"),
        fc.constantFrom("payment.create", "refund.create", "transfer.create"),
        fc.integer({ min: 0, max: 4_294_967_295 }),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        (rules, twinId, actionId, seed, now) => {
          const active = rules.map((rule, index) =>
            makeRule(rule.failureId, {
              ruleId: `rule-${index}`,
              twinId: rule.twinId,
              actionIds: [rule.actionId],
              used: rule.used,
              limit: rule.limit,
              order: rule.order,
            }),
          );
          const plan = decideWebhook({
            twinId,
            actionId,
            rules: active,
            random: new SeededRandom(seed),
            now,
          });
          expect(isValidWebhookPlan(plan, now)).toBe(true);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("T2: decideWebhook() is deterministic for the same inputs", () => {
    fc.assert(
      fc.property(
        generatedRules,
        fc.constantFrom("alpha", "beta"),
        fc.constantFrom("payment.create", "refund.create", "transfer.create"),
        fc.integer({ min: 0, max: 4_294_967_295 }),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        (rules, twinId, actionId, seed, now) => {
          const active = rules.map((rule, index) =>
            makeRule(rule.failureId, {
              ruleId: `rule-${index}`,
              twinId: rule.twinId,
              actionIds: [rule.actionId],
              used: rule.used,
              limit: rule.limit,
              order: rule.order,
            }),
          );
          const first = decideWebhook({
            twinId,
            actionId,
            rules: active,
            random: new SeededRandom(seed),
            now,
          });
          const second = decideWebhook({
            twinId,
            actionId,
            rules: active,
            random: new SeededRandom(seed),
            now,
          });
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe("T4 failure engine, one test per failure", () => {
  it.each(FAILURE_IDS)("T4 %s: default and maximum settings match C5", (id) => {
    const defaults = definition(id).failureSettingsSchema.parse({});
    const maximum = definition(id).failureSettingsSchema.parse(maxSettings[id]);

    switch (id) {
      case "slow-response": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low).toMatchObject({
          actionPerformed: true,
          step: "slow-response",
          delayMs: 5_000,
          connection: "normal",
          status: undefined,
        });
        expect(high.delayMs).toBe(120_000);
        return;
      }
      case "timeout-after-commit": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low).toMatchObject({
          actionPerformed: true,
          connection: "hang",
          connectionHangMs: 120_000,
          delayMs: 0,
        });
        expect(high.connection).toBe("reset");
        expect(high.connectionHangMs).toBeUndefined();
        return;
      }
      case "timeout-before-commit": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low).toMatchObject({
          actionPerformed: false,
          connection: "hang",
          connectionHangMs: 120_000,
        });
        expect(high.connection).toBe("reset");
        return;
      }
      case "server-error": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low).toMatchObject({
          actionPerformed: false,
          status: 500,
          step: "server-error",
          firedSteps: ["server-error"],
        });
        expect(high.status).toBe(599);
        return;
      }
      case "rate-limited": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low).toMatchObject({ actionPerformed: false, status: 429 });
        expect(high.status).toBe(429);
        return;
      }
      case "flaky-network": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low).toMatchObject({
          actionPerformed: false,
          connection: "dropped",
          step: "flaky-network-before",
        });
        expect(high).toMatchObject({
          actionPerformed: true,
          connection: "dropped",
          step: "flaky-network-after",
        });
        return;
      }
      case "webhook-delayed": {
        const low = webhookPlan(id, defaults);
        const high = webhookPlan(id, maximum);
        expect(low.deliveries[0]).toMatchObject({
          dueAt: NOW + 60_000,
          delayMs: 60_000,
        });
        expect(high.deliveries[0]?.delayMs).toBe(5_400_000);
        return;
      }
      case "webhook-duplicated": {
        const low = webhookPlan(id, defaults);
        const high = webhookPlan(id, maximum);
        expect(low.deliveries).toHaveLength(2);
        expect(low.deliveries[1]?.dueAt).toBe(NOW + 5_000);
        expect(high.deliveries).toHaveLength(5);
        expect(high.deliveries[4]?.dueAt).toBe(NOW + 4 * 300_000);
        return;
      }
      case "webhook-out-of-order": {
        const low = webhookPlan(id, defaults);
        const high = webhookPlan(id, maximum);
        expect(low.deliveries[0]?.holdUntil).toBe(NOW + 15_000);
        expect(high.deliveries[0]?.holdUntil).toBe(NOW + 300_000);
        return;
      }
      case "webhook-never-sent": {
        const low = webhookPlan(id, defaults);
        const high = webhookPlan(id, maximum);
        expect(low).toMatchObject({
          send: false,
          notSentReason: "webhook-never-sent",
          deliveries: [],
        });
        expect(high.send).toBe(false);
        return;
      }
      case "webhook-verification-fails": {
        const low = webhookPlan(id, defaults);
        const high = webhookPlan(id, maximum);
        expect(low.deliveries[0]?.verificationFailure).toBe("wrong-secret");
        expect(high.deliveries[0]?.verificationFailure).toBe("stale-timestamp");
        return;
      }
      case "payment-declined": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low.effect).toEqual({ kind: "payment-declined", percent: 100 });
        expect(high.effect?.kind).toBe("payment-declined");
        return;
      }
      case "authentication-required": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
        expect(low.effect).toEqual({ kind: "authentication-required", then: "fail" });
        // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
        expect(high.effect).toEqual({ kind: "authentication-required", then: "succeed" });
        return;
      }
      case "transfer-stuck-pending": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low.effect).toEqual({
          kind: "transfer-stuck-pending",
          seconds: null,
          thenFailPercent: 0,
          thenFailed: false,
          endsAt: undefined,
        });
        expect(high.effect).toEqual({
          kind: "transfer-stuck-pending",
          seconds: 86_400,
          thenFailPercent: 100,
          thenFailed: true,
          endsAt: NOW + 86_400_000,
        });
        return;
      }
      case "transfer-reversed": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low.effect).toEqual({
          kind: "transfer-reversed",
          afterSeconds: 60,
          percent: 100,
          reversed: true,
          reverseAt: NOW + 60_000,
        });
        expect(high.effect?.kind).toBe("transfer-reversed");
        return;
      }
      case "bank-resolve-fails": {
        const low = requestPlan(id, defaults);
        const high = requestPlan(id, maximum);
        expect(low.effect).toEqual({ kind: "bank-resolve-fails", mode: "error" });
        expect(high.effect).toEqual({ kind: "bank-resolve-fails", mode: "timeout" });
        return;
      }
      default:
        return assertNever(id);
    }
  });
});

const requestPairs = requestFailureIds.flatMap((left, index) =>
  requestFailureIds.slice(index + 1).map((right) => [left, right] as const),
);

const webhookPairs = webhookFailureIds.flatMap((left, index) =>
  webhookFailureIds.slice(index + 1).map((right) => [left, right] as const),
);

describe("C5 order of application", () => {
  it.each(requestPairs)("C5 order: %s before %s", (left, right) => {
    const leftRule = makeRule(left, {
      settings: orderSettings(left),
      order: 1,
      ruleId: "left",
    });
    const rightRule = makeRule(right, {
      settings: orderSettings(right),
      order: 2,
      ruleId: "right",
    });
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [leftRule, rightRule],
      random: randomSource(0),
      now: NOW,
    });

    const leftStep = requestStepByFailure[left];
    const rightStep = requestStepByFailure[right];
    if (leftStep === undefined || rightStep === undefined) {
      throw new Error("a request failure has no step");
    }
    const leftWins = (requestRank[leftStep] ?? 99) < (requestRank[rightStep] ?? 99);
    const expected = leftWins ? left : right;

    expect(plan.firedRules[0]?.failureId).toBe(expected);
    expect(plan.firedSteps[0]).toBe(leftWins ? leftStep : rightStep);
  });

  it.each(webhookPairs)("C5 webhook order: %s before %s", (left, right) => {
    const leftRule = makeRule(left, { order: 1, ruleId: "left" });
    const rightRule = makeRule(right, { order: 2, ruleId: "right" });
    const plan = decideWebhook({
      twinId: "alpha",
      actionId: ACTION,
      rules: [leftRule, rightRule],
      random: randomSource(0),
      now: NOW,
    });

    const leftStep = webhookStepByFailure[left];
    const rightStep = webhookStepByFailure[right];
    if (leftStep === undefined || rightStep === undefined) {
      throw new Error("a webhook failure has no step");
    }
    const leftWins = (webhookRank[leftStep] ?? 99) < (webhookRank[rightStep] ?? 99);
    const expected = leftWins ? left : right;

    expect(plan.firedRules[0]?.failureId).toBe(expected);
    expect(plan.firedSteps[0]).toBe(leftWins ? leftStep : rightStep);
  });

  it("C5: flaky-network after runs after the action and gives slow-response no reply", () => {
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [
        makeRule("slow-response", { settings: { seconds: 9 }, order: 1 }),
        makeRule("flaky-network", {
          settings: { percent: 100, when: "after" },
          order: 2,
        }),
      ],
      random: randomSource(0),
      now: NOW,
    });

    expect(plan.actionPerformed).toBe(true);
    expect(plan.connection).toBe("dropped");
    expect(plan.delayMs).toBe(0);
    expect(plan.firedSteps).toEqual(["flaky-network-after"]);
  });

  it("C5: flaky-network after keeps the result effect it already shaped", () => {
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [
        makeRule("payment-declined", { settings: { percent: 100 }, order: 1 }),
        makeRule("flaky-network", {
          settings: { percent: 100, when: "after" },
          order: 2,
        }),
      ],
      random: randomSource(0),
      now: NOW,
    });

    expect(plan.actionPerformed).toBe(true);
    expect(plan.connection).toBe("dropped");
    expect(plan.firedSteps).toEqual(["result", "flaky-network-after"]);
    expect(plan.effect?.kind).toBe("payment-declined");
  });

  it("C5: timeout-after-commit runs after the result and gives no reply", () => {
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [
        makeRule("payment-declined", { settings: { percent: 100 }, order: 1 }),
        makeRule("timeout-after-commit", { order: 2 }),
      ],
      random: randomSource(0.5),
      now: NOW,
    });

    expect(plan.actionPerformed).toBe(true);
    expect(plan.connection).toBe("hang");
    expect(plan.firedSteps).toEqual(["result", "timeout-after-commit"]);
    expect(plan.effect?.kind).toBe("payment-declined");
  });
});

describe("C5 counters and twin scoping", () => {
  it("C5: a rule stops firing when its times counter is used up", () => {
    const rule = makeRule("server-error", { limit: 2, used: 2 });
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [rule],
      random: randomSource(),
      now: NOW,
    });

    expect(plan.step).toBe("action");
    expect(plan.actionPerformed).toBe(true);
    expect(plan.firedRules).toEqual([]);
  });

  it("C5: a newer used-up rule does not hide an older available rule", () => {
    const older = makeRule("server-error", {
      settings: { status: 501 },
      order: 1,
      ruleId: "older",
      limit: null,
    });
    const newer = makeRule("server-error", {
      settings: { status: 599 },
      order: 2,
      ruleId: "newer",
      limit: 1,
      used: 1,
    });
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [older, newer],
      random: randomSource(),
      now: NOW,
    });

    expect(plan.status).toBe(501);
    expect(plan.firedRules[0]?.ruleId).toBe("older");
  });

  it("C5: the most recently added rule of the same failure wins", () => {
    const older = makeRule("server-error", {
      settings: { status: 501 },
      order: 1,
    });
    const newer = makeRule("server-error", {
      settings: { status: 599 },
      order: 2,
    });
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [newer, older],
      random: randomSource(),
      now: NOW,
    });

    expect(plan.status).toBe(599);
    expect(plan.firedRules[0]?.ruleId).toBe(newer.id);
  });

  it("C5: a rule for one twin never fires for another twin", () => {
    const plan = decide({
      twinId: "beta",
      actionId: ACTION,
      rules: [makeRule("server-error", { twinId: "alpha" })],
      random: randomSource(),
      now: NOW,
    });

    expect(plan.step).toBe("action");
    expect(plan.firedRules).toEqual([]);
  });

  it("C5: a rule only fires for its own actions", () => {
    const plan = decide({
      twinId: "alpha",
      actionId: "payment.create",
      rules: [makeRule("server-error", { actionIds: ["refund.create"] })],
      random: randomSource(),
      now: NOW,
    });

    expect(plan.step).toBe("action");
  });

  it("C5: a probabilistic declined payment can miss and leave the action unchanged", () => {
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [
        makeRule("payment-declined", {
          settings: { percent: 50 },
          order: 1,
        }),
      ],
      random: randomSource(0.9),
      now: NOW,
    });

    expect(plan.effect).toBeUndefined();
    expect(plan.firedSteps).toEqual([]);
  });

  it("C5: a probabilistic reversed transfer can miss", () => {
    const plan = decide({
      twinId: "alpha",
      actionId: ACTION,
      rules: [
        makeRule("transfer-reversed", {
          settings: { percent: 50 },
          order: 1,
        }),
      ],
      random: randomSource(0.9),
      now: NOW,
    });

    expect(plan.effect).toBeUndefined();
    expect(plan.firedSteps).toEqual([]);
  });

  it("C5: every duplicate webhook follows verification, hold and delay", () => {
    const plan = decideWebhook({
      twinId: "alpha",
      actionId: ACTION,
      rules: [
        makeRule("webhook-verification-fails", {
          settings: { method: "corrupted" },
          order: 1,
        }),
        makeRule("webhook-out-of-order", {
          settings: { windowSeconds: 10 },
          order: 2,
        }),
        makeRule("webhook-delayed", {
          settings: { seconds: 5, jitterSeconds: 0 },
          order: 3,
        }),
        makeRule("webhook-duplicated", {
          settings: { copies: 3, gapSeconds: 2 },
          order: 4,
        }),
      ],
      random: randomSource(),
      now: NOW,
    });

    expect(plan.firedSteps).toEqual([
      "webhook-verification-fails",
      "webhook-out-of-order",
      "webhook-delayed",
      "webhook-duplicated",
    ]);
    expect(plan.deliveries).toHaveLength(3);
    for (const delivery of plan.deliveries) {
      expect(delivery.verificationFailure).toBe("corrupted");
      expect(delivery.holdUntil).toBe(NOW + 10_000);
      expect(delivery.dueAt).toBe(NOW + delivery.index * 2_000 + 5_000);
    }
  });

  it("C5: a missing-webhook rule that misses leaves the other rules in charge", () => {
    const plan = decideWebhook({
      twinId: "alpha",
      actionId: ACTION,
      rules: [
        makeRule("webhook-never-sent", {
          settings: { percent: 50 },
          order: 1,
        }),
        makeRule("webhook-delayed", {
          settings: { seconds: 4, jitterSeconds: 0 },
          order: 2,
        }),
      ],
      random: randomSource(0.9),
      now: NOW,
    });

    expect(plan.send).toBe(true);
    expect(plan.firedRules.map((rule) => rule.failureId)).toEqual(["webhook-delayed"]);
    expect(plan.deliveries[0]?.dueAt).toBe(NOW + 4_000);
  });

  it("C5: webhook rules also obey twin and action scoping", () => {
    const plan = decideWebhook({
      twinId: "beta",
      actionId: "payment.create",
      rules: [makeRule("webhook-never-sent", { twinId: "alpha" })],
      random: randomSource(),
      now: NOW,
    });

    expect(plan.send).toBe(true);
    expect(plan.firedSteps).toEqual([]);
  });

  it("C5: an unknown failure id reaches the request never check", () => {
    const bad: ActiveRule = {
      ...makeRule("slow-response"),
      failureId: "not-a-failure" as FailureId,
    };
    expect(() =>
      decide({
        twinId: "alpha",
        actionId: ACTION,
        rules: [bad],
        random: randomSource(),
        now: NOW,
      }),
    ).toThrow("unknown failure");
  });

  it("C5: an unknown failure id reaches the webhook never check", () => {
    const bad: ActiveRule = {
      ...makeRule("slow-response"),
      failureId: "not-a-failure" as FailureId,
    };
    expect(() =>
      decideWebhook({
        twinId: "alpha",
        actionId: ACTION,
        rules: [bad],
        random: randomSource(),
        now: NOW,
      }),
    ).toThrow("unknown failure");
  });

  it("C5: the never-exhaustive switch helper reports an internal error", () => {
    expect(() => assertNever("not-a-failure" as never)).toThrow("unknown failure");
  });
});
