import { IbejiError } from "../errors.js";
import type { FailureId } from "./catalog.js";

export const HANG_LIMIT_MS = 120_000;

export type RandomSource = {
  readonly next: () => number;
};

export type ActiveRule = {
  readonly id: string;
  readonly failureId: FailureId;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly twinId: string;
  readonly actionIds: readonly string[];
  readonly used: number;
  readonly limit: number | null;
  readonly order: number;
};

export type RequestStep =
  | "flaky-network-before"
  | "rate-limited"
  | "server-error"
  | "timeout-before-commit"
  | "result"
  | "timeout-after-commit"
  | "flaky-network-after"
  | "slow-response"
  | "action";

export type WebhookStep =
  | "webhook-never-sent"
  | "webhook-verification-fails"
  | "webhook-out-of-order"
  | "webhook-delayed"
  | "webhook-duplicated";

export type FailureStep = Exclude<RequestStep, "action"> | WebhookStep;

export type FiredRule = {
  readonly ruleId: string;
  readonly failureId: FailureId;
  readonly twinId: string;
  readonly step: FailureStep;
};

export type ConnectionEnd = "normal" | "hang" | "reset" | "dropped";

export type FailureEffect =
  | {
      readonly kind: "payment-declined";
      readonly percent: number;
    }
  | {
      readonly kind: "authentication-required";
      readonly then: "succeed" | "fail";
    }
  | {
      readonly kind: "transfer-stuck-pending";
      readonly seconds: number | null;
      readonly thenFailPercent: number;
      readonly thenFailed: boolean;
      readonly endsAt: number | undefined;
    }
  | {
      readonly kind: "transfer-reversed";
      readonly afterSeconds: number;
      readonly percent: number;
      readonly reversed: boolean;
      readonly reverseAt: number;
    }
  | {
      readonly kind: "bank-resolve-fails";
      readonly mode: "error" | "timeout";
    };

export type RequestPlan = {
  readonly step: RequestStep;
  readonly actionPerformed: boolean;
  readonly status: number | undefined;
  readonly delayMs: number;
  readonly connection: ConnectionEnd;
  readonly connectionHangMs: number | undefined;
  readonly effect: FailureEffect | undefined;
  readonly firedSteps: readonly RequestStep[];
  readonly firedRules: readonly FiredRule[];
};

export type WebhookDeliveryPlan = {
  readonly index: number;
  readonly dueAt: number;
  readonly delayMs: number;
  readonly verificationFailure: string | undefined;
  readonly holdUntil: number | undefined;
};

export type WebhookPlan = {
  readonly send: boolean;
  readonly notSentReason: "webhook-never-sent" | undefined;
  readonly deliveries: readonly WebhookDeliveryPlan[];
  readonly firedSteps: readonly WebhookStep[];
  readonly firedRules: readonly FiredRule[];
};

export type RequestDecisionInput = {
  readonly twinId: string;
  readonly actionId: string;
  readonly rules: readonly ActiveRule[];
  readonly random: RandomSource;
  readonly now: number;
};

export type WebhookDecisionInput = {
  readonly twinId: string;
  readonly actionId: string;
  readonly rules: readonly ActiveRule[];
  readonly random: RandomSource;
  readonly now: number;
};

export function assertNever(value: never): never {
  throw new IbejiError("INTERNAL", {
    what: "The failure engine reached an unknown failure.",
    why: `The failure id "${String(value)}" has no engine step.`,
    fix: "Add the failure to the catalog and to every exhaustive engine switch.",
  });
}

type RequestPhase = "pre" | "flaky" | "result" | "post" | "slow" | "webhook-only";

function requestPhaseOf(id: FailureId): RequestPhase {
  switch (id) {
    case "rate-limited":
    case "server-error":
    case "timeout-before-commit":
      return "pre";
    case "flaky-network":
      return "flaky";
    case "payment-declined":
    case "authentication-required":
    case "transfer-stuck-pending":
    case "transfer-reversed":
    case "bank-resolve-fails":
      return "result";
    case "timeout-after-commit":
      return "post";
    case "slow-response":
      return "slow";
    case "webhook-delayed":
    case "webhook-duplicated":
    case "webhook-out-of-order":
    case "webhook-never-sent":
    case "webhook-verification-fails":
      return "webhook-only";
    default:
      return assertNever(id);
  }
}

function webhookStepOf(id: FailureId): WebhookStep | undefined {
  switch (id) {
    case "webhook-never-sent":
      return "webhook-never-sent";
    case "webhook-verification-fails":
      return "webhook-verification-fails";
    case "webhook-out-of-order":
      return "webhook-out-of-order";
    case "webhook-delayed":
      return "webhook-delayed";
    case "webhook-duplicated":
      return "webhook-duplicated";
    case "slow-response":
    case "timeout-after-commit":
    case "timeout-before-commit":
    case "server-error":
    case "rate-limited":
    case "flaky-network":
    case "payment-declined":
    case "authentication-required":
    case "transfer-stuck-pending":
    case "transfer-reversed":
    case "bank-resolve-fails":
      return undefined;
    default:
      return assertNever(id);
  }
}

function numberSetting(settings: Readonly<Record<string, unknown>>, key: string): number {
  return settings[key] as number;
}

function stringSetting(settings: Readonly<Record<string, unknown>>, key: string): string {
  return settings[key] as string;
}

function nullableNumberSetting(
  settings: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = settings[key];
  return value === null ? null : (value as number);
}

function chance(random: RandomSource, percent: number): boolean {
  if (percent >= 100) {
    return true;
  }
  if (percent <= 0) {
    return false;
  }
  return random.next() * 100 < percent;
}

function isAvailable(rule: ActiveRule, twinId: string, actionId: string): boolean {
  return (
    rule.twinId === twinId &&
    rule.actionIds.includes(actionId) &&
    (rule.limit === null || rule.used < rule.limit)
  );
}

function latest(
  rules: readonly ActiveRule[],
  predicate: (rule: ActiveRule) => boolean,
): ActiveRule | undefined {
  let found: ActiveRule | undefined;

  for (const rule of rules) {
    if (predicate(rule) && (found === undefined || rule.order > found.order)) {
      found = rule;
    }
  }

  return found;
}

function fired(rule: ActiveRule, step: FailureStep): FiredRule {
  return {
    ruleId: rule.id,
    failureId: rule.failureId,
    twinId: rule.twinId,
    step,
  };
}

function plan(
  step: RequestStep,
  actionPerformed: boolean,
  status: number | undefined,
  delayMs: number,
  connection: ConnectionEnd,
  effect: FailureEffect | undefined,
  firedRules: readonly FiredRule[],
  firedSteps: readonly RequestStep[],
): RequestPlan {
  return {
    step: firedSteps[0] ?? step,
    actionPerformed,
    status,
    delayMs,
    connection,
    connectionHangMs: connection === "hang" ? HANG_LIMIT_MS : undefined,
    effect,
    firedSteps,
    firedRules,
  };
}

function resultEffect(
  rule: ActiveRule,
  random: RandomSource,
  now: number,
): FailureEffect | undefined {
  switch (rule.failureId) {
    case "payment-declined": {
      const percent = numberSetting(rule.settings, "percent");
      return chance(random, percent) ? { kind: "payment-declined", percent } : undefined;
    }
    case "authentication-required":
      return {
        kind: "authentication-required",
        // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
        then: stringSetting(rule.settings, "then") === "succeed" ? "succeed" : "fail",
      };
    case "transfer-stuck-pending": {
      const seconds = nullableNumberSetting(rule.settings, "seconds");
      const thenFailPercent = numberSetting(rule.settings, "thenFailPercent");
      return {
        kind: "transfer-stuck-pending",
        seconds,
        thenFailPercent,
        thenFailed: chance(random, thenFailPercent),
        endsAt: seconds === null ? undefined : now + seconds * 1_000,
      };
    }
    case "transfer-reversed": {
      const afterSeconds = numberSetting(rule.settings, "afterSeconds");
      const percent = numberSetting(rule.settings, "percent");
      if (!chance(random, percent)) {
        return undefined;
      }
      return {
        kind: "transfer-reversed",
        afterSeconds,
        percent,
        reversed: true,
        reverseAt: now + afterSeconds * 1_000,
      };
    }
    case "bank-resolve-fails":
      return {
        kind: "bank-resolve-fails",
        mode: stringSetting(rule.settings, "mode") === "timeout" ? "timeout" : "error",
      };
  }
}

/**
 * Decide what a request failure plan is. The function is pure: it reads only
 * its arguments and never reads a clock, Math.random, the network, or a file.
 */
export function decide(input: RequestDecisionInput): RequestPlan {
  const matching = input.rules.filter((rule) => isAvailable(rule, input.twinId, input.actionId));

  const flakyBefore = latest(
    matching,
    (rule) =>
      requestPhaseOf(rule.failureId) === "flaky" &&
      stringSetting(rule.settings, "when") === "before",
  );

  if (
    flakyBefore !== undefined &&
    chance(input.random, numberSetting(flakyBefore.settings, "percent"))
  ) {
    return plan(
      "flaky-network-before",
      false,
      undefined,
      0,
      "dropped",
      undefined,
      [fired(flakyBefore, "flaky-network-before")],
      ["flaky-network-before"],
    );
  }

  const rateLimited = latest(matching, (rule) => rule.failureId === "rate-limited");

  if (rateLimited !== undefined) {
    const slow = latest(matching, (rule) => requestPhaseOf(rule.failureId) === "slow");
    const delayMs = slow === undefined ? 0 : numberSetting(slow.settings, "seconds") * 1_000;
    return plan(
      "rate-limited",
      false,
      429,
      delayMs,
      "normal",
      undefined,
      slow === undefined
        ? [fired(rateLimited, "rate-limited")]
        : [fired(rateLimited, "rate-limited"), fired(slow, "slow-response")],
      slow === undefined ? ["rate-limited"] : ["rate-limited", "slow-response"],
    );
  }

  const serverError = latest(matching, (rule) => rule.failureId === "server-error");

  if (serverError !== undefined) {
    const slow = latest(matching, (rule) => requestPhaseOf(rule.failureId) === "slow");
    const delayMs = slow === undefined ? 0 : numberSetting(slow.settings, "seconds") * 1_000;
    return plan(
      "server-error",
      false,
      numberSetting(serverError.settings, "status"),
      delayMs,
      "normal",
      undefined,
      slow === undefined
        ? [fired(serverError, "server-error")]
        : [fired(serverError, "server-error"), fired(slow, "slow-response")],
      slow === undefined ? ["server-error"] : ["server-error", "slow-response"],
    );
  }

  const timeoutBefore = latest(matching, (rule) => rule.failureId === "timeout-before-commit");

  if (timeoutBefore !== undefined) {
    const mode = stringSetting(timeoutBefore.settings, "mode");
    return plan(
      "timeout-before-commit",
      false,
      undefined,
      0,
      mode === "hang" ? "hang" : "reset",
      undefined,
      [fired(timeoutBefore, "timeout-before-commit")],
      ["timeout-before-commit"],
    );
  }

  const resultRule = latest(matching, (rule) => requestPhaseOf(rule.failureId) === "result");
  const effect =
    resultRule === undefined ? undefined : resultEffect(resultRule, input.random, input.now);

  const timeoutAfter = latest(matching, (rule) => rule.failureId === "timeout-after-commit");

  if (timeoutAfter !== undefined) {
    const mode = stringSetting(timeoutAfter.settings, "mode");
    const steps: RequestStep[] =
      effect === undefined ? ["timeout-after-commit"] : ["result", "timeout-after-commit"];
    const firedRules: FiredRule[] =
      resultRule === undefined || effect === undefined
        ? [fired(timeoutAfter, "timeout-after-commit")]
        : [fired(resultRule, "result"), fired(timeoutAfter, "timeout-after-commit")];

    return plan(
      "timeout-after-commit",
      true,
      undefined,
      0,
      mode === "hang" ? "hang" : "reset",
      effect,
      firedRules,
      steps,
    );
  }

  const flakyAfter = latest(
    matching,
    (rule) =>
      requestPhaseOf(rule.failureId) === "flaky" &&
      stringSetting(rule.settings, "when") === "after",
  );

  if (
    flakyAfter !== undefined &&
    chance(input.random, numberSetting(flakyAfter.settings, "percent"))
  ) {
    const steps: RequestStep[] =
      effect === undefined ? ["flaky-network-after"] : ["result", "flaky-network-after"];
    const firedRules: FiredRule[] =
      resultRule === undefined || effect === undefined
        ? [fired(flakyAfter, "flaky-network-after")]
        : [fired(resultRule, "result"), fired(flakyAfter, "flaky-network-after")];

    return plan("flaky-network-after", true, undefined, 0, "dropped", effect, firedRules, steps);
  }

  const slow = latest(matching, (rule) => requestPhaseOf(rule.failureId) === "slow");
  const delayMs = slow === undefined ? 0 : numberSetting(slow.settings, "seconds") * 1_000;
  const firedSteps: RequestStep[] = [];
  const firedRules: FiredRule[] = [];

  if (effect !== undefined && resultRule !== undefined) {
    firedSteps.push("result");
    firedRules.push(fired(resultRule, "result"));
  }
  if (slow !== undefined && delayMs > 0) {
    firedSteps.push("slow-response");
    firedRules.push(fired(slow, "slow-response"));
  }

  return plan(
    firedSteps[0] ?? "action",
    true,
    undefined,
    delayMs,
    "normal",
    effect,
    firedRules,
    firedSteps,
  );
}

/**
 * Decide what a webhook delivery plan is, following the C5 webhook order.
 * This function is pure in the same way as decide().
 */
export function decideWebhook(input: WebhookDecisionInput): WebhookPlan {
  const matching = input.rules.filter((rule) => isAvailable(rule, input.twinId, input.actionId));

  const neverSent = latest(
    matching,
    (rule) => webhookStepOf(rule.failureId) === "webhook-never-sent",
  );

  if (
    neverSent !== undefined &&
    chance(input.random, numberSetting(neverSent.settings, "percent"))
  ) {
    return {
      send: false,
      notSentReason: "webhook-never-sent",
      deliveries: [],
      firedSteps: ["webhook-never-sent"],
      firedRules: [fired(neverSent, "webhook-never-sent")],
    };
  }

  const verification = latest(
    matching,
    (rule) => webhookStepOf(rule.failureId) === "webhook-verification-fails",
  );
  const outOfOrder = latest(
    matching,
    (rule) => webhookStepOf(rule.failureId) === "webhook-out-of-order",
  );
  const delayed = latest(matching, (rule) => webhookStepOf(rule.failureId) === "webhook-delayed");
  const duplicated = latest(
    matching,
    (rule) => webhookStepOf(rule.failureId) === "webhook-duplicated",
  );

  const copies = duplicated === undefined ? 1 : numberSetting(duplicated.settings, "copies");
  const gapMs =
    duplicated === undefined ? 0 : numberSetting(duplicated.settings, "gapSeconds") * 1_000;
  const holdUntil =
    outOfOrder === undefined
      ? undefined
      : input.now + numberSetting(outOfOrder.settings, "windowSeconds") * 1_000;
  const verificationFailure =
    verification === undefined ? undefined : stringSetting(verification.settings, "method");

  const deliveries: WebhookDeliveryPlan[] = [];
  for (let index = 0; index < copies; index += 1) {
    let delayMs = 0;
    if (delayed !== undefined) {
      const seconds = numberSetting(delayed.settings, "seconds");
      const jitterSeconds = numberSetting(delayed.settings, "jitterSeconds");
      const jitterMs =
        jitterSeconds === 0 ? 0 : Math.floor(input.random.next() * (jitterSeconds * 1_000 + 1));
      delayMs = seconds * 1_000 + jitterMs;
    }

    deliveries.push({
      index,
      dueAt: input.now + index * gapMs + delayMs,
      delayMs,
      verificationFailure,
      holdUntil,
    });
  }

  const firedSteps: WebhookStep[] = [];
  const firedRules: FiredRule[] = [];

  if (verification !== undefined) {
    firedSteps.push("webhook-verification-fails");
    firedRules.push(fired(verification, "webhook-verification-fails"));
  }
  if (outOfOrder !== undefined) {
    firedSteps.push("webhook-out-of-order");
    firedRules.push(fired(outOfOrder, "webhook-out-of-order"));
  }
  if (delayed !== undefined) {
    firedSteps.push("webhook-delayed");
    firedRules.push(fired(delayed, "webhook-delayed"));
  }
  if (duplicated !== undefined) {
    firedSteps.push("webhook-duplicated");
    firedRules.push(fired(duplicated, "webhook-duplicated"));
  }

  return {
    send: true,
    notSentReason: undefined,
    deliveries,
    firedSteps,
    firedRules,
  };
}
