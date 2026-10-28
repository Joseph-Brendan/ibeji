import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { IbejiError } from "../../src/core/errors.js";
import { EventLog } from "../../src/core/events.js";
import { decide, type FiredRule } from "../../src/core/failures/engine.js";
import {
  RuleStore,
  type RuleStoreOptions,
  type TwinCapability,
} from "../../src/core/failures/rules.js";

const alpha: TwinCapability = {
  id: "alpha",
  actions: ["payment.create", "payment.verify", "refund.create", "refund.fetch", "transfer.create"],
  failures: [
    { id: "slow-response", actions: ["refund.create", "refund.fetch"] },
    { id: "server-error", actions: ["payment.create", "refund.create"] },
    { id: "rate-limited", actions: ["payment.create"] },
    { id: "webhook-delayed", actions: ["payment.create"] },
    { id: "payment-declined", actions: ["payment.create"] },
    { id: "transfer-stuck-pending", actions: ["transfer.create"] },
  ],
};

const beta: TwinCapability = {
  id: "beta",
  actions: ["payment.create", "refund.create", "refund.fetch", "transfer.create"],
  failures: [
    { id: "slow-response", actions: ["refund.create", "refund.fetch"] },
    { id: "server-error", actions: ["payment.create"] },
    { id: "webhook-duplicated", actions: ["payment.create"] },
    { id: "payment-declined", actions: ["payment.create"] },
  ],
};

function setup(running: readonly string[] = ["alpha"]): {
  readonly store: RuleStore;
  readonly events: EventLog;
  readonly setRunning: (ids: readonly string[]) => void;
} {
  let runningIds = running;
  const events = new EventLog(new FakeClock());
  const options: RuleStoreOptions = {
    twins: [alpha, beta],
    events,
    runningTwinIds: () => runningIds,
  };
  return {
    store: new RuleStore(options),
    events,
    setRunning: (ids) => {
      runningIds = ids;
    },
  };
}

const firedRule: FiredRule = {
  ruleId: "rule-1",
  failureId: "server-error",
  twinId: "alpha",
  step: "server-error",
};

describe("C5 rules", () => {
  it("C5: adds a rule with C5 defaults, default running twin and default actions", () => {
    const { store } = setup();
    const rule = store.add({ failureId: "slow-response" });

    expect(rule.id).toBe("rule-1");
    expect(rule.failureId).toBe("slow-response");
    expect(rule.settings).toEqual({ seconds: 5 });
    expect(rule.twins).toEqual(["alpha"]);
    expect(rule.actions).toBeUndefined();
    expect(rule.resolvedActions).toEqual({
      alpha: ["refund.create", "refund.fetch"],
    });
    expect(rule.scenarioId).toBeUndefined();
    expect(rule.counters).toEqual({ alpha: 0 });
    expect(store.list()).toHaveLength(1);
  });

  it("C5: resolves a resource, a local action id and a full action id", () => {
    const { store } = setup();
    const resource = store.add({
      failureId: "server-error",
      twins: ["alpha"],
      actions: "refund",
    });
    const local = store.add({
      failureId: "server-error",
      twins: ["alpha"],
      actions: "payment.create",
    });
    const full = store.add({
      failureId: "server-error",
      twins: ["alpha"],
      actions: "alpha.refund.create",
    });

    expect(resource.resolvedActions.alpha).toEqual(["refund.create"]);
    expect(local.resolvedActions.alpha).toEqual(["payment.create"]);
    expect(full.resolvedActions.alpha).toEqual(["refund.create"]);
  });

  it("C5: accepts a selector list and the shared settings inside settings", () => {
    const { store } = setup();
    const rule = store.add({
      failureId: "server-error",
      settings: {
        times: 2,
        twins: ["alpha"],
        actions: ["refund.create", "payment.create"],
      },
    });

    expect(rule.settings).toEqual({ times: 2, status: 500 });
    expect(rule.twins).toEqual(["alpha"]);
    expect(rule.actions).toBe("refund.create,payment.create");
    expect(rule.resolvedActions.alpha).toEqual(["payment.create", "refund.create"]);
  });

  it("C5: explicit twins and actions override the shared settings", () => {
    const { store } = setup(["alpha", "beta"]);
    const rule = store.add({
      failureId: "payment-declined",
      settings: { twins: ["alpha"], actions: "refund" },
      twins: ["beta"],
      actions: "payment",
    });

    expect(rule.twins).toEqual(["beta"]);
    expect(rule.resolvedActions).toEqual({ beta: ["payment.create"] });
  });

  it("C5: unknown failure ids are rejected", () => {
    const { store } = setup();
    expect(() => store.add({ failureId: "not-a-failure" })).toThrow(IbejiError);
    try {
      store.add({ failureId: "not-a-failure" });
    } catch (error) {
      if (error instanceof IbejiError) {
        expect(error.code).toBe("UNKNOWN_FAILURE");
      }
    }
  });

  it("C5: a failure aimed at a twin that does not support it is rejected", () => {
    const { store } = setup(["alpha", "beta"]);
    try {
      store.add({ failureId: "transfer-stuck-pending", twins: ["beta"] });
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("FAILURE_NOT_SUPPORTED_BY_TWIN");
        expect(error.message).toContain("transfer-stuck-pending");
        expect(error.message).toContain("beta");
      }
      return;
    }
    throw new Error("the unsupported failure was accepted");
  });

  it("C5: unknown twins are rejected", () => {
    const { store } = setup();
    expect(() => store.add({ failureId: "slow-response", twins: ["gamma"] })).toThrow(IbejiError);
    try {
      store.add({ failureId: "slow-response", twins: ["gamma"] });
    } catch (error) {
      if (error instanceof IbejiError) {
        expect(error.code).toBe("UNKNOWN_TWIN");
      }
    }
  });

  it("C5: invalid settings produce one INVALID_RULE listing every field", () => {
    const { store } = setup();
    try {
      store.add({
        failureId: "server-error",
        settings: { times: 0, status: 200 },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("INVALID_RULE");
        expect(error.why).toContain("times");
        expect(error.why).toContain("status");
      }
      return;
    }
    throw new Error("the invalid settings were accepted");
  });

  it("C5: empty twins and an empty action selector are rejected", () => {
    const { store } = setup();
    expect(() => store.add({ failureId: "slow-response", twins: [] })).toThrow(IbejiError);
    expect(() => store.add({ failureId: "slow-response", twins: ["alpha"], actions: "" })).toThrow(
      IbejiError,
    );
    expect(() => store.add({ failureId: "slow-response", twins: ["alpha"], actions: "," })).toThrow(
      IbejiError,
    );
  });

  it("C5: an action selector that matches nothing throws UNKNOWN_ACTION with valid ids", () => {
    const { store } = setup();
    try {
      store.add({
        failureId: "server-error",
        twins: ["alpha"],
        actions: "transfer",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("UNKNOWN_ACTION");
        expect(error.why).toContain("payment.create");
        expect(error.why).toContain("refund.create");
      }
      return;
    }
    throw new Error("the unknown action was accepted");
  });

  it("C5: no running twin supporting the failure is rejected", () => {
    const { store } = setup();
    try {
      store.add({ failureId: "authentication-required" });
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("FAILURE_NOT_SUPPORTED_BY_TWIN");
      }
      return;
    }
    throw new Error("a rule with no supporting twin was accepted");
  });

  it("C5: validate checks a rule without changing the store", () => {
    const { store } = setup();
    store.validate({ failureId: "slow-response", twins: ["alpha"] });
    expect(store.list()).toEqual([]);
    expect(() => store.validate({ failureId: "server-error", settings: { times: 0 } })).toThrow(
      IbejiError,
    );
  });

  it("C5: adding and removing rules emit events for every affected twin", () => {
    const { store, events } = setup(["alpha", "beta"]);
    const rule = store.add({ failureId: "payment-declined", twins: ["alpha", "beta"] });
    store.remove(rule.id);

    const added = events.after(0).filter((event) => event.type === "rule-added");
    const removed = events.after(0).filter((event) => event.type === "rule-removed");

    expect(added).toHaveLength(2);
    expect(added.map((event) => event.scope)).toEqual(["alpha", "beta"]);
    expect(removed).toHaveLength(2);
    expect(removed[0]?.details).toMatchObject({
      ruleId: rule.id,
      failureId: "payment-declined",
      scenarioId: null,
    });
  });

  it("C5: update replaces a rule and resets its counters", () => {
    const { store } = setup();
    const rule = store.add({ failureId: "server-error" });
    store.recordFired({ firedRules: [firedRule] });
    const updated = store.update(rule.id, {
      failureId: "server-error",
      settings: { status: 503 },
      twins: ["alpha"],
    });

    expect(updated.id).toBe(rule.id);
    expect(updated.order).toBe(rule.order);
    expect(updated.settings.status).toBe(503);
    expect(updated.counters.alpha).toBe(0);
  });

  it("C5: an invalid update leaves the existing rule untouched", () => {
    const { store } = setup();
    const rule = store.add({ failureId: "server-error" });
    expect(() =>
      store.update(rule.id, {
        failureId: "server-error",
        settings: { times: 0 },
      }),
    ).toThrow(IbejiError);

    expect(store.list()[0]?.settings).toEqual({ times: 3, status: 500 });
  });

  it("C5: update and remove reject a missing rule", () => {
    const { store } = setup();
    expect(() => store.update("missing", { failureId: "server-error" })).toThrow(IbejiError);
    expect(() => store.remove("missing")).toThrow(IbejiError);
  });

  it("C5: counters are kept separately for each twin and record only fired rules", () => {
    const { store } = setup(["alpha", "beta"]);
    const rule = store.add({ failureId: "server-error", twins: ["alpha", "beta"] });

    store.recordFired({ firedRules: [firedRule] });
    store.recordFired({
      firedRules: [{ ...firedRule, ruleId: "missing", twinId: "alpha" }],
    });

    expect(store.list()[0]?.counters).toEqual({ alpha: 1, beta: 0 });
    expect(store.list()[0]?.id).toBe(rule.id);
  });

  it("C5: a times-limited rule stops firing across the actions it covers", () => {
    const { store } = setup();
    store.add({
      failureId: "server-error",
      settings: { times: 1 },
      twins: ["alpha"],
      actions: "refund",
    });
    const random = { next: () => 0 };
    const first = decide({
      twinId: "alpha",
      actionId: "refund.create",
      rules: store.activeRules(),
      random,
      now: 1,
    });
    store.recordFired(first);

    const second = decide({
      twinId: "alpha",
      actionId: "refund.fetch",
      rules: store.activeRules(),
      random,
      now: 2,
    });

    expect(first.status).toBe(500);
    expect(second.status).toBeUndefined();
    expect(second.step).toBe("action");
  });

  it("C5: activeRules exposes per-twin counters and times limits", () => {
    const { store } = setup(["alpha", "beta"]);
    store.add({
      failureId: "server-error",
      settings: { times: 2 },
      twins: ["alpha", "beta"],
      actions: "payment",
    });
    const unlimited = store.add({
      failureId: "server-error",
      settings: { times: null },
      twins: ["alpha"],
      actions: "refund",
    });
    store.add({ failureId: "slow-response", twins: ["alpha"] });
    store.recordFired({ firedRules: [firedRule] });

    const active = store.activeRules();
    const limitedAlpha = active.find((rule) => rule.twinId === "alpha" && rule.limit === 2);
    const limitedBeta = active.find((rule) => rule.twinId === "beta" && rule.limit === 2);
    const unlimitedRule = active.find((rule) => rule.id === unlimited.id);
    const slow = active.find((rule) => rule.failureId === "slow-response");

    expect(limitedAlpha?.used).toBe(1);
    expect(limitedBeta?.used).toBe(0);
    expect(unlimitedRule?.limit).toBeNull();
    expect(slow?.limit).toBeNull();
  });

  it("C5: removeAll can remove a scenario, one twin, or everything", () => {
    const { store } = setup(["alpha", "beta"]);
    const scenario = store.add({
      failureId: "payment-declined",
      twins: ["alpha", "beta"],
      scenarioId: "scenario-one",
    });
    const other = store.add({
      failureId: "slow-response",
      twins: ["alpha"],
    });

    expect(store.removeAll({ scenarioId: "scenario-one", twinId: "alpha" })).toBe(1);
    expect(store.get(scenario.id)?.twins).toEqual(["beta"]);
    expect(store.hasScenarioRules("scenario-one")).toBe(true);
    expect(store.removeAll({ twinId: "alpha" })).toBe(1);
    expect(store.get(other.id)).toBeUndefined();
    expect(store.removeAll()).toBe(1);
    expect(store.list()).toEqual([]);
    expect(store.removeAll()).toBe(0);
  });

  it("C5: clear removes every rule and notifies listeners once", () => {
    const { store } = setup();
    let cleared = 0;
    const unsubscribe = store.onClear(() => {
      cleared += 1;
    });
    store.add({ failureId: "slow-response" });
    store.clear();
    expect(cleared).toBe(1);
    expect(store.list()).toEqual([]);

    unsubscribe();
    store.clear();
    expect(cleared).toBe(1);
  });

  it("C5: hasTwin and get expose only known and live records", () => {
    const { store } = setup();
    expect(store.hasTwin("alpha")).toBe(true);
    expect(store.hasTwin("gamma")).toBe(false);
    expect(store.get("missing")).toBeUndefined();
    expect(store.hasScenarioRules("missing")).toBe(false);
  });

  it("C5: returned rules are copies", () => {
    const { store } = setup();
    const rule = store.add({ failureId: "server-error" });
    const settings = rule.settings as { status: number };
    settings.status = 999;
    rule.twins.slice();

    expect(store.list()[0]?.settings.status).toBe(500);
  });

  it("C5: duplicate twins in one request are de-duplicated", () => {
    const { store } = setup(["alpha"]);
    const rule = store.add({
      failureId: "slow-response",
      twins: ["alpha", "alpha"],
    });
    expect(rule.twins).toEqual(["alpha"]);
  });

  it("C5: defaults to every known twin when no running-twin function is supplied", () => {
    const events = new EventLog(new FakeClock());
    const store = new RuleStore({ twins: [alpha], events });
    const rule = store.add({ failureId: "slow-response" });
    expect(rule.twins).toEqual(["alpha"]);
  });

  it("C5: an action id without a dot is matched as its own resource", () => {
    const events = new EventLog(new FakeClock());
    const flat: TwinCapability = {
      id: "flat",
      actions: ["refund"],
      failures: [{ id: "slow-response", actions: ["refund"] }],
    };
    const store = new RuleStore({
      twins: [flat],
      events,
      runningTwinIds: () => ["flat"],
    });

    try {
      store.add({
        failureId: "slow-response",
        twins: ["flat"],
        actions: "other",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("UNKNOWN_ACTION");
      }
      return;
    }
    throw new Error("the selector against a flat action id was accepted");
  });

  it("C5: an empty valid-action list is named in UNKNOWN_ACTION", () => {
    const events = new EventLog(new FakeClock());
    const empty: TwinCapability = {
      id: "empty",
      actions: [],
      failures: [{ id: "slow-response", actions: [] }],
    };
    const store = new RuleStore({
      twins: [empty],
      events,
      runningTwinIds: () => ["empty"],
    });

    try {
      store.add({
        failureId: "slow-response",
        twins: ["empty"],
        actions: "refund",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IbejiError);
      if (error instanceof IbejiError) {
        expect(error.code).toBe("UNKNOWN_ACTION");
        expect(error.why).toContain("(none)");
      }
      return;
    }
    throw new Error("the selector against no actions was accepted");
  });
});
