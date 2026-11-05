import { describe, expect, it } from "vitest";

import { IbejiError } from "../../src/core/errors.js";
import {
  formatCredential,
  formatEvent,
  formatRule,
  formatSettings,
  formatTime,
  formatWebhook,
  plural,
} from "../../src/mcp/output.js";
import { asIbejiError } from "../../src/mcp/session.js";
import { fallbackGuide } from "../../src/mcp/tools.js";
import type {
  Rule,
  TwinSummary,
  WebhookAttempt,
  WebhookDelivery,
} from "../../src/shared/control.js";

const twin: TwinSummary = {
  id: "demo",
  displayName: "Demo",
  running: true,
  address: "http://127.0.0.1:4500",
  port: 4500,
  actions: [],
  failures: [],
  currencyRules: {
    zeroDecimal: [],
    defaultFractionDigits: 2,
    fractionDigits: {},
  },
  labelColourToken: "twin-label-1",
};

const attempt: WebhookAttempt = {
  attempt: 1,
  startedAt: 1,
  finishedAt: 2,
  outcome: "delivered",
  requestUrl: "http://127.0.0.1:9000/hook",
  remoteAddress: "127.0.0.1",
  responseStatus: 200,
  responseHeaders: {},
  responseBody: "ok",
  error: undefined,
  errorCode: undefined,
};

function delivery(attempts: readonly WebhookAttempt[]): WebhookDelivery {
  return {
    id: "webhook-1",
    eventId: "evt-1",
    twinId: "demo",
    actionId: "refund.create",
    raw: { body: "{}", contentType: "application/json" },
    status: "delivered",
    attempts,
    createdAt: 1,
    scheduledAt: undefined,
    holdUntil: undefined,
    failureMethod: undefined,
    resendOf: undefined,
    reason: undefined,
    url: undefined,
    sequence: 1,
  };
}

describe("MCP output helpers", () => {
  it("T11 uses a generic fallback guide when a twin has no connection guide", () => {
    const withAddress = fallbackGuide(twin);
    expect(withAddress.steps[0]?.body).toContain("http://127.0.0.1:4500");
    expect(withAddress.agentInstruction).toContain("Demo");

    const withoutAddress = fallbackGuide({ ...twin, running: false, address: null });
    expect(withoutAddress.steps[0]?.body).toContain("the twin address shown by Ibeji");
  });

  it("T11 keeps every Ibeji error and wraps an unexpected error with what, why and fix", () => {
    const known = new IbejiError("BAD_REQUEST");
    expect(asIbejiError(known)).toBe(known);

    const wrapped = asIbejiError(new Error("boom"));
    expect(wrapped.code).toBe("INTERNAL");
    expect(wrapped.why).toContain("boom");
    expect(wrapped.fix.length).toBeGreaterThan(0);

    const text = asIbejiError("plain text");
    expect(text.code).toBe("INTERNAL");
    expect(text.why).toBe("plain text");
  });

  it("T11 formats failure settings, rules, times, events, webhooks and credentials", () => {
    expect(formatSettings({})).toBe("defaults");
    expect(formatSettings({ times: null, status: 503 })).toBe("times=empty, status=503");

    const rule: Rule = {
      id: "rule-1",
      failureId: "server-error",
      settings: {},
      twins: ["demo"],
      actions: undefined,
      resolvedActions: { demo: [] },
      scenarioId: undefined,
      counters: {},
      order: 1,
    };
    expect(formatRule(rule)).toContain("all supported");
    expect(formatRule(rule)).toContain("defaults");

    expect(formatTime("not-a-date")).toBe("not-a-date");
    expect(formatTime(0)).toBe("1970-01-01T00:00:00.000Z");

    const event = formatEvent({
      id: 3,
      time: 0,
      type: "rule-added",
      scope: "demo",
      summary: "Added a rule.",
      details: {},
    });
    expect(event).toContain("#3");
    expect(event).toContain("rule-added");

    expect(formatWebhook(delivery([]))).toContain("no attempts");
    expect(formatWebhook(delivery([attempt]))).toContain("1 attempt, last response HTTP 200");
    expect(formatWebhook(delivery([attempt, { ...attempt, attempt: 2 }]))).toContain("2 attempts");

    expect(
      formatCredential({
        id: "secret",
        label: "Secret key",
        role: "secret",
        secret: true,
        value: "sk_test_demo",
      }),
    ).toBe("- Secret key (secret): sk_test_demo");

    expect(plural(1, "event", "events")).toBe("event");
    expect(plural(2, "event", "events")).toBe("events");
  });
});
