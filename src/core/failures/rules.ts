import { IbejiError, zodProblemsToError } from "../errors.js";
import type { EventLog } from "../events.js";
import { type FailureId, getFailure, sharedRuleSettingsSchema } from "./catalog.js";
import type { ActiveRule, FiredRule } from "./engine.js";

export type FailureSupport = {
  readonly id: string;
  readonly actions: readonly string[];
  readonly source?: "docs" | "real-story" | "assumed";
};

export type TwinCapability = {
  readonly id: string;
  readonly actions: readonly string[];
  readonly failures: readonly FailureSupport[];
};

export type RuleStoreOptions = {
  readonly twins: readonly TwinCapability[];
  readonly events: EventLog;
  /** Defaults for omitted twins. When omitted, every known twin is eligible. */
  readonly runningTwinIds?: () => readonly string[];
};

export type RuleInput = {
  readonly failureId: string;
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
  readonly twins?: readonly string[] | undefined;
  readonly actions?: string | readonly string[] | undefined;
  readonly scenarioId?: string | undefined;
};

export type RuleFilter = {
  readonly twinId?: string;
  readonly scenarioId?: string;
};

export type Rule = {
  readonly id: string;
  readonly failureId: FailureId;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly twins: readonly string[];
  readonly actions: string | undefined;
  readonly resolvedActions: Readonly<Record<string, readonly string[]>>;
  readonly scenarioId: string | undefined;
  readonly counters: Readonly<Record<string, number>>;
  readonly order: number;
};

type StoredRule = {
  id: string;
  failureId: FailureId;
  settings: Readonly<Record<string, unknown>>;
  twins: string[];
  actions: string | undefined;
  resolvedActions: Map<string, readonly string[]>;
  scenarioId: string | undefined;
  counters: Map<string, number>;
  order: number;
};

type BuiltRule = Omit<StoredRule, "id" | "order">;

function unknownFailure(failureId: string): IbejiError {
  return new IbejiError("UNKNOWN_FAILURE", {
    why: `"${failureId}" is not one of the failure ids in the catalog.`,
  });
}

function unknownTwin(twinId: string): IbejiError {
  return new IbejiError("UNKNOWN_TWIN", {
    why: `"${twinId}" is not a twin the rule store knows about.`,
  });
}

function unsupportedFailure(failureId: string, twinId: string): IbejiError {
  return new IbejiError("FAILURE_NOT_SUPPORTED_BY_TWIN", {
    what: `The ${failureId} failure is not supported by the ${twinId} twin.`,
    why: `The ${twinId} twin's definition does not declare the ${failureId} failure.`,
    fix: `Choose a failure that the ${twinId} twin declares, or wait until its definition adds support.`,
  });
}

function noRunningTwin(failureId: string): IbejiError {
  return new IbejiError("FAILURE_NOT_SUPPORTED_BY_TWIN", {
    what: `No running twin supports the ${failureId} failure.`,
    why: "The rule has no twins, and every running twin does not declare this failure.",
    fix: "Start a twin that supports the failure, or choose the twin explicitly.",
  });
}

function invalidRule(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): IbejiError {
  return zodProblemsToError("INVALID_RULE", issues);
}

function normaliseSelector(
  actions: string | readonly string[] | undefined,
): readonly string[] | undefined {
  if (actions === undefined) {
    return undefined;
  }
  const parts = typeof actions === "string" ? actions.split(",") : actions;
  const tokens = parts.map((part) => part.trim()).filter((part) => part.length > 0);
  return tokens;
}

function selectorMatches(token: string, twinId: string, actionId: string): boolean {
  if (token === actionId || token === `${twinId}.${actionId}`) {
    return true;
  }
  const dot = actionId.indexOf(".");
  const resource = dot === -1 ? actionId : actionId.slice(0, dot);
  return token === resource;
}

function selectorText(actions: string | readonly string[] | undefined): string | undefined {
  const tokens = normaliseSelector(actions);
  return tokens === undefined ? undefined : tokens.join(",");
}

/**
 * Holds every rule in the session. Rules are grouped by failure, twins and
 * resolved actions; their counters are per rule per twin, as C5 requires.
 */
export class RuleStore {
  readonly events: EventLog;
  private readonly twins = new Map<string, TwinCapability>();
  private readonly rules = new Map<string, StoredRule>();
  private readonly clearListeners = new Set<() => void>();
  private readonly runningTwinIds: (() => readonly string[]) | undefined;
  private nextRuleNumber = 1;
  private nextOrder = 1;

  constructor(options: RuleStoreOptions) {
    this.events = options.events;
    this.runningTwinIds = options.runningTwinIds;
    for (const twin of options.twins) {
      this.twins.set(twin.id, twin);
    }
  }

  add(input: RuleInput): Rule {
    const built = this.build(input, input.scenarioId);

    const stored: StoredRule = {
      ...built,
      id: `rule-${this.nextRuleNumber}`,
      order: this.nextOrder,
    };
    this.nextRuleNumber += 1;
    this.nextOrder += 1;
    this.rules.set(stored.id, stored);
    this.emitRule("rule-added", stored);

    return this.cloneRule(stored);
  }

  /** Validate a rule without adding it. Useful before an atomic scenario start. */
  validate(input: RuleInput): void {
    this.build(input, input.scenarioId);
  }

  get(id: string): Rule | undefined {
    const rule = this.rules.get(id);
    return rule === undefined ? undefined : this.cloneRule(rule);
  }

  list(): readonly Rule[] {
    return [...this.rules.values()]
      .sort((left, right) => left.order - right.order)
      .map((rule) => this.cloneRule(rule));
  }

  activeRules(): readonly ActiveRule[] {
    const result: ActiveRule[] = [];

    for (const rule of this.rules.values()) {
      const limit = this.limitFor(rule);
      for (const twinId of rule.twins) {
        result.push({
          id: rule.id,
          failureId: rule.failureId,
          settings: rule.settings,
          twinId,
          actionIds: rule.resolvedActions.get(twinId) as readonly string[],
          used: rule.counters.get(twinId) as number,
          limit,
          order: rule.order,
        });
      }
    }

    return result;
  }

  update(id: string, input: RuleInput): Rule {
    const existing = this.rules.get(id);
    if (existing === undefined) {
      throw new IbejiError("NOT_FOUND", {
        why: `No rule has the id "${id}".`,
      });
    }

    const built = this.build(input, input.scenarioId ?? existing.scenarioId);
    const stored: StoredRule = {
      ...built,
      id: existing.id,
      order: existing.order,
    };
    this.rules.set(id, stored);
    return this.cloneRule(stored);
  }

  remove(id: string): Rule {
    const rule = this.rules.get(id);
    if (rule === undefined) {
      throw new IbejiError("NOT_FOUND", {
        why: `No rule has the id "${id}".`,
      });
    }

    this.rules.delete(id);
    this.emitRule("rule-removed", rule);
    return this.cloneRule(rule);
  }

  /**
   * Remove whole rules, a scenario's rules, or one twin from each matching
   * rule. Returns the number of rule/twin entries removed.
   */
  removeAll(filter: RuleFilter = {}): number {
    let removed = 0;

    for (const rule of [...this.rules.values()]) {
      if (filter.scenarioId !== undefined && rule.scenarioId !== filter.scenarioId) {
        continue;
      }

      if (filter.twinId === undefined) {
        this.rules.delete(rule.id);
        this.emitRule("rule-removed", rule);
        removed += rule.twins.length;
        continue;
      }

      if (!rule.twins.includes(filter.twinId)) {
        continue;
      }

      rule.twins = rule.twins.filter((twinId) => twinId !== filter.twinId);
      rule.counters.delete(filter.twinId);
      rule.resolvedActions.delete(filter.twinId);
      this.emitRule("rule-removed", rule, filter.twinId);
      removed += 1;

      if (rule.twins.length === 0) {
        this.rules.delete(rule.id);
      }
    }

    return removed;
  }

  /** Remove every rule, then tell listeners so a running scenario can stop. */
  clear(): void {
    this.removeAll();
    for (const listener of this.clearListeners) {
      listener();
    }
  }

  onClear(listener: () => void): () => void {
    this.clearListeners.add(listener);
    return () => {
      this.clearListeners.delete(listener);
    };
  }

  recordFired(plan: { readonly firedRules: readonly FiredRule[] }): void {
    for (const firedRule of plan.firedRules) {
      const rule = this.rules.get(firedRule.ruleId);
      if (rule === undefined) {
        continue;
      }
      rule.counters.set(firedRule.twinId, (rule.counters.get(firedRule.twinId) as number) + 1);
    }
  }

  hasTwin(twinId: string): boolean {
    return this.twins.has(twinId);
  }

  hasScenarioRules(scenarioId: string): boolean {
    return [...this.rules.values()].some((rule) => rule.scenarioId === scenarioId);
  }

  private build(input: RuleInput, scenarioId: string | undefined): BuiltRule {
    const definition = getFailure(input.failureId);
    if (definition === undefined) {
      throw unknownFailure(input.failureId);
    }

    const rawSettings = input.settings ?? {};
    const { twins: settingsTwins, actions: settingsActions, ...specificSettings } = rawSettings;

    const shared = sharedRuleSettingsSchema.safeParse({
      twins: input.twins ?? settingsTwins,
      actions: input.actions ?? settingsActions,
    });
    if (!shared.success) {
      throw invalidRule(shared.error.issues);
    }

    const specific = definition.failureSettingsSchema.safeParse(specificSettings);
    if (!specific.success) {
      throw invalidRule(specific.error.issues);
    }

    const requestedTwins = shared.data.twins;
    let twinIds: readonly string[];

    if (requestedTwins !== undefined) {
      twinIds = [...new Set(requestedTwins)];
    } else {
      const running =
        this.runningTwinIds === undefined ? [...this.twins.keys()] : this.runningTwinIds();
      twinIds = [...this.twins.keys()].filter(
        (twinId) =>
          running.includes(twinId) &&
          this.twins.get(twinId)?.failures.some((failure) => failure.id === definition.id),
      );
      if (twinIds.length === 0) {
        throw noRunningTwin(definition.id);
      }
    }

    const selector = shared.data.actions;
    const tokens = normaliseSelector(selector);
    if (tokens !== undefined && tokens.length === 0) {
      throw invalidRule([
        {
          path: ["actions"],
          message: "Expected at least one non-empty action selector.",
        },
      ]);
    }
    const resolvedActions = new Map<string, readonly string[]>();
    const counters = new Map<string, number>();

    for (const twinId of twinIds) {
      const twin = this.twins.get(twinId);
      if (twin === undefined) {
        throw unknownTwin(twinId);
      }

      const support = twin.failures.find((failure) => failure.id === definition.id);
      if (support === undefined) {
        throw unsupportedFailure(definition.id, twinId);
      }

      const supported = new Set(support.actions);
      const available = twin.actions.filter((actionId) => supported.has(actionId));

      if (tokens !== undefined) {
        for (const token of tokens) {
          if (!available.some((actionId) => selectorMatches(token, twinId, actionId))) {
            throw new IbejiError("UNKNOWN_ACTION", {
              what: `The action selector "${token}" does not match any action on the ${twinId} twin.`,
              why: `Valid actions for ${definition.id} on ${twinId}: ${available.join(", ") || "(none)"}.`,
              fix: "Use a resource, a local action id, or a full twin action id shown in the list.",
            });
          }
        }
      }

      const resolved =
        tokens === undefined
          ? available
          : available.filter((actionId) =>
              tokens.some((token) => selectorMatches(token, twinId, actionId)),
            );

      resolvedActions.set(twinId, resolved);
      counters.set(twinId, 0);
    }

    return {
      failureId: definition.id,
      settings: specific.data,
      twins: [...twinIds],
      actions: selectorText(selector),
      resolvedActions,
      scenarioId,
      counters,
    };
  }

  private cloneRule(rule: StoredRule): Rule {
    return {
      id: rule.id,
      failureId: rule.failureId,
      settings: structuredClone(rule.settings),
      twins: [...rule.twins],
      actions: rule.actions,
      resolvedActions: Object.fromEntries(
        [...rule.resolvedActions.entries()].map(([twinId, actions]) => [twinId, [...actions]]),
      ),
      scenarioId: rule.scenarioId,
      counters: Object.fromEntries(rule.counters),
      order: rule.order,
    };
  }

  private limitFor(rule: StoredRule): number | null {
    if (rule.failureId === "server-error" || rule.failureId === "rate-limited") {
      const times = rule.settings.times;
      return typeof times === "number" ? times : null;
    }
    return null;
  }

  private emitRule(
    type: "rule-added" | "rule-removed",
    rule: StoredRule,
    onlyTwinId?: string,
  ): void {
    const twinIds = onlyTwinId === undefined ? rule.twins : [onlyTwinId];
    for (const twinId of twinIds) {
      this.events.publish({
        type,
        scope: twinId,
        summary:
          type === "rule-added"
            ? `Added the ${rule.failureId} failure rule.`
            : `Removed the ${rule.failureId} failure rule.`,
        details: {
          ruleId: rule.id,
          failureId: rule.failureId,
          scenarioId: rule.scenarioId ?? null,
        },
      });
    }
  }
}
