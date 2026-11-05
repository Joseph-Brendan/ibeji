import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";

import { FakeClock } from "../../core/clock.js";
import { IbejiError, isIbejiError } from "../../core/errors.js";
import { EventLog } from "../../core/events.js";
import { FAILURE_IDS } from "../../core/failures/catalog.js";
import { decide, decideWebhook, type WebhookPlan } from "../../core/failures/engine.js";
import { RuleStore } from "../../core/failures/rules.js";
import { SeededRandom } from "../../core/random.js";
import { fingerprint } from "../../core/redact.js";
import { WebhookDispatcher } from "../../core/webhooks/dispatcher.js";
import type { RawWebhook, WebhookHeaders } from "../../core/webhooks/types.js";
import { createTwinRegistry } from "../registry.js";
import { compareContractBody } from "./contract.js";
import type { RunningTwin } from "./server.js";
import { startTwin } from "./server.js";
import { MemoryIdempotencyStore } from "./state.js";
import type {
  ActionDefinition,
  ActiveFailureEffects,
  CryptoRandom,
  HttpMethod,
  IdempotencyAdapter,
  JsonValue,
  TwinCredentials,
  TwinDefinition,
  TwinRequest,
  TwinWebhookDraft,
} from "./types.js";

export type ConformanceCheck = {
  readonly id: string;
  readonly run: (definition: TwinDefinition) => Promise<void>;
};

export type ConformanceCheckResult = {
  readonly id: string;
  readonly ok: boolean;
  readonly error: string | undefined;
};

export type ConformanceResult = {
  readonly passed: boolean;
  readonly checks: readonly ConformanceCheckResult[];
  readonly failures: readonly ConformanceCheckResult[];
};

export type ConformanceOptions = {
  readonly only?: readonly string[];
};

type Harness = {
  readonly running: RunningTwin;
  readonly events: EventLog;
  readonly rules: RuleStore;
  readonly credentials: TwinCredentials;
  readonly clock: FakeClock;
};

function deterministicRandom(seed: number): CryptoRandom {
  let value = seed;
  return {
    bytes: (length) => {
      const result = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        value = (value * 33 + 17) % 256;
        result[index] = value;
      }
      return result;
    },
  };
}

function credentialsFor(definition: TwinDefinition): TwinCredentials {
  const credentials: Record<string, string> = {};
  for (const spec of definition.credentials) {
    credentials[spec.id] = spec.generate(deterministicRandom(spec.id.length + 7));
  }
  return credentials;
}

function secretOf(definition: TwinDefinition, credentials: TwinCredentials): string {
  const spec = definition.credentials.find((item) => item.role === "secret");
  assert.ok(spec, "a twin must declare at least one secret credential");
  const value = credentials[spec.id];
  assert.ok(value, "the secret credential must have a value");
  return value;
}

function liveKeyFor(definition: TwinDefinition, credentials: TwinCredentials): string {
  const secret = secretOf(definition, credentials);
  const candidates = [
    secret.replace("_test_", "_live_"),
    secret.replace("_TEST-", "-"),
    secret.replace("TEST", "LIVE"),
    secret.replace("test", "live"),
  ];
  const liveKey = candidates.find((candidate) => definition.auth.isLiveKey(candidate));
  assert.ok(liveKey, "a twin must recognise the live form of its own key");
  return liveKey;
}

function concretePath(action: ActionDefinition): string {
  // A country path parameter needs a real country-shaped sample; all other
  // path parameters use the shared non-404 probe value.
  return action.path.replace(/:[A-Za-z0-9_]+/gu, (parameter) =>
    parameter === ":country" ? "NG" : "ref-1",
  );
}

function nonCheckoutAction(definition: TwinDefinition): ActionDefinition {
  const action = definition.actions.find((item) => item.kind !== "checkout");
  assert.ok(action, "a twin must declare at least one non-checkout action");
  return action;
}

function checkoutAction(definition: TwinDefinition, method: HttpMethod): ActionDefinition {
  const action = definition.actions.find(
    (item) => item.kind === "checkout" && item.method === method,
  );
  assert.ok(action, `a twin must declare a ${method} checkout action`);
  return action;
}

type RawResponse = {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
};

function rawRequest(options: {
  readonly port: number;
  readonly path: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    if (options.body !== undefined) {
      headers["content-length"] = String(Buffer.byteLength(options.body));
    }
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: options.port,
        path: options.path,
        method: options.method,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode as number,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([name, value]) => [
                name.toLowerCase(),
                String(value),
              ]),
            ),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

async function startFor(definition: TwinDefinition): Promise<Harness> {
  const clock = new FakeClock(1_000);
  const events = new EventLog(clock);
  const rules = new RuleStore({
    twins: [
      {
        id: definition.id,
        actions: definition.actions.map((action) => action.id),
        failures: definition.failures.support,
      },
    ],
    events,
  });
  const credentials = credentialsFor(definition);
  const running = await startTwin(definition, { credentials, events, rules, clock });
  return { running, events, rules, credentials, clock };
}

function actionHeaders(
  definition: TwinDefinition,
  credentials: TwinCredentials,
): Record<string, string> {
  return {
    authorization: `Bearer ${secretOf(definition, credentials)}`,
    "content-type": "application/json",
  };
}

function webhookDraft(definition: TwinDefinition): TwinWebhookDraft {
  const event = definition.webhooks.events[0];
  assert.ok(event, "a twin must declare at least one webhook event");
  const actionId = event.actions[0];
  assert.ok(actionId, "a webhook event must name an action");
  return {
    key: event.key,
    actionId,
    resourceId: "pay_1",
    occurredAt: 1_000,
    data: { id: "pay_1", amount: 1_000, currency: "USD" },
  };
}

function emptyWebhookPlan(): WebhookPlan {
  return {
    send: true,
    notSentReason: undefined,
    deliveries: [
      {
        index: 0,
        dueAt: 0,
        delayMs: 0,
        verificationFailure: undefined,
        holdUntil: undefined,
      },
    ],
    firedSteps: [],
    firedRules: [],
  };
}

const definitionContract: ConformanceCheck = {
  id: "definition-contract",
  run: async (definition) => {
    assert.match(definition.id, /^[a-z][a-z0-9_-]*$/u);
    assert.ok(definition.displayName.trim().length > 0);
    assert.ok(Number.isInteger(definition.defaultPort));
    assert.ok(definition.defaultPort > 0 && definition.defaultPort <= 65_535);

    const actionIds = new Set<string>();
    const routes = new Set<string>();
    const registered: ActionDefinition[] = [];
    definition.routes({
      add(action) {
        registered.push(action);
      },
    });
    assert.equal(registered.length, definition.actions.length);
    for (const action of definition.actions) {
      assert.match(action.id, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u);
      assert.ok(!actionIds.has(action.id), `duplicate action id ${action.id}`);
      actionIds.add(action.id);
      assert.ok(action.path.startsWith("/"));
      assert.ok(action.summary.trim().length > 0);
      assert.ok(["GET", "POST", "PUT", "DELETE"].includes(action.method));
      assert.equal(typeof action.handler, "function");
      routes.add(`${action.method} ${action.path}`);
    }
    assert.equal(routes.size, definition.actions.length);
    assert.equal(registered.length, definition.actions.length);
    for (const route of registered) {
      assert.ok(actionIds.has(route.id));
      assert.ok(definition.actions.includes(route));
    }

    const failureIds = new Set<string>();
    for (const support of definition.failures.support) {
      assert.ok(!failureIds.has(support.id), `duplicate failure support ${support.id}`);
      failureIds.add(support.id);
      assert.ok(["docs", "real-story", "assumed"].includes(support.source));
      for (const actionId of support.actions) {
        assert.ok(actionIds.has(actionId));
      }
    }

    const webhookKeys = new Set<string>();
    for (const event of definition.webhooks.events) {
      assert.ok(event.key.trim().length > 0);
      assert.ok(!webhookKeys.has(event.key), `duplicate webhook event ${event.key}`);
      webhookKeys.add(event.key);
      for (const actionId of event.actions) {
        assert.ok(actionIds.has(actionId));
      }
    }
    assert.ok(definition.webhooks.events.length > 0);

    const credentialIds = new Set<string>();
    for (const spec of definition.credentials) {
      assert.ok(!credentialIds.has(spec.id), `duplicate credential ${spec.id}`);
      credentialIds.add(spec.id);
      assert.ok(["public", "secret", "webhook"].includes(spec.role));
      assert.equal(typeof spec.generate, "function");
      assert.equal(typeof spec.isTestFormat, "function");
    }
    assert.ok(definition.credentials.length > 0);

    const outcomeIds = new Set<string>();
    for (const outcome of definition.checkout.outcomes) {
      assert.ok(!outcomeIds.has(outcome.id), `duplicate checkout outcome ${outcome.id}`);
      outcomeIds.add(outcome.id);
    }
    assert.ok(definition.checkout.outcomes.length > 0);

    assert.ok(["none", "header"].includes(definition.idempotency.mode));
    if (definition.idempotency.mode === "header") {
      assert.ok(definition.idempotency.headerName.trim().length > 0);
      assert.ok(definition.idempotency.maxKeyLength > 0);
      assert.ok(definition.idempotency.retentionSeconds > 0);
      assert.equal(typeof definition.idempotency.begin, "function");
      assert.equal(typeof definition.idempotency.complete, "function");
    }

    assert.equal(typeof definition.state.initial, "function");
    assert.equal(typeof definition.state.schema.parse, "function");
    assert.equal(typeof definition.money.parseServiceAmount, "function");
    assert.equal(typeof definition.money.formatServiceAmount, "function");
    assert.equal(typeof definition.money.formatDisplay, "function");
    assert.equal(typeof definition.money.assertValid, "function");
    assert.ok(["docs", "assumed"].includes(definition.retry.source));
  },
};

const lifecycle: ConformanceCheck = {
  id: "lifecycle",
  run: async (definition) => {
    const harness = await startFor(definition);
    try {
      assert.ok(harness.running.port > 0);
      assert.equal(harness.running.hostname, "127.0.0.1");
      assert.equal(harness.running.address, "127.0.0.1");
    } finally {
      await harness.running.stop();
    }
    await harness.running.stop();
    await assert.rejects(fetch(`http://127.0.0.1:${harness.running.port}/`));
  },
};

const hostAndHttpSafety: ConformanceCheck = {
  id: "host-and-http-safety",
  run: async (definition) => {
    const harness = await startFor(definition);
    try {
      const action = nonCheckoutAction(definition);
      const path = concretePath(action);

      const local = await rawRequest({
        port: harness.running.port,
        path,
        method: action.method,
        headers: { host: `127.0.0.1:${harness.running.port}` },
      });
      assert.notEqual(local.status, 403);

      const localhost = await rawRequest({
        port: harness.running.port,
        path,
        method: action.method,
        headers: { host: `LOCALHOST:${harness.running.port}` },
      });
      assert.notEqual(localhost.status, 403);

      const forbidden = await rawRequest({
        port: harness.running.port,
        path,
        method: action.method,
        headers: { host: `evil.example:${harness.running.port}` },
      });
      assert.equal(forbidden.status, 403);
      assert.equal(JSON.parse(forbidden.body).error.code, "FORBIDDEN_HOST");
      assert.equal(forbidden.headers["access-control-allow-origin"], undefined);

      const checkout = checkoutAction(definition, "GET");
      const page = await rawRequest({
        port: harness.running.port,
        path: concretePath(checkout),
        method: "GET",
        headers: { host: `127.0.0.1:${harness.running.port}` },
      });
      assert.equal(page.status, 200);
      assert.equal(
        page.headers["content-security-policy"],
        "default-src 'self'; frame-ancestors 'none'",
      );
      assert.equal(page.headers["referrer-policy"], "same-origin");
      assert.equal(page.headers["access-control-allow-origin"], undefined);

      const post = definition.actions.find(
        (item) => item.kind !== "checkout" && item.method === "POST",
      );
      assert.ok(post);
      const tooLarge = await rawRequest({
        port: harness.running.port,
        path: concretePath(post),
        method: "POST",
        headers: { host: `127.0.0.1:${harness.running.port}` },
        body: "a".repeat(1_048_577),
      });
      assert.equal(tooLarge.status, 413);
      assert.equal(JSON.parse(tooLarge.body).error.code, "BODY_TOO_LARGE");
    } finally {
      await harness.running.stop();
    }
  },
};

const credentialsCheck: ConformanceCheck = {
  id: "credentials",
  run: async (definition) => {
    for (const spec of definition.credentials) {
      const first = spec.generate(deterministicRandom(11));
      const second = spec.generate(deterministicRandom(11));
      assert.equal(first, second);
      assert.ok(first.includes("ibeji"));
      assert.equal(spec.isTestFormat(first), true);
      assert.ok(spec.label.trim().length > 0);
      assert.equal(typeof spec.secret, "boolean");
    }
  },
};

const authentication: ConformanceCheck = {
  id: "authentication",
  run: async (definition) => {
    const harness = await startFor(definition);
    try {
      const action = nonCheckoutAction(definition);
      const path = concretePath(action);

      const missing = await fetch(`http://127.0.0.1:${harness.running.port}${path}`, {
        method: action.method,
      });
      assert.equal(missing.status, 401);
      const missingBody: unknown = await missing.json();
      const expected = definition.auth.unauthorized({ kind: "missing" });
      assert.equal(typeof expected.body, "string");
      const expectedBody: unknown = JSON.parse(expected.body as string);
      assert.deepEqual(compareContractBody(expectedBody as JsonValue, missingBody), []);

      const wrong = await fetch(`http://127.0.0.1:${harness.running.port}${path}`, {
        method: action.method,
        headers: { authorization: "Bearer ibeji_wrong_key" },
      });
      assert.equal(wrong.status, 401);

      const liveKey = liveKeyFor(definition, harness.credentials);
      const live = await fetch(`http://127.0.0.1:${harness.running.port}${path}`, {
        method: action.method,
        headers: { authorization: `Bearer ${liveKey}` },
      });
      assert.equal(live.status, 401);

      const warning = harness.events.after(0).find((event) => event.type === "warning");
      assert.ok(warning);
      assert.equal(warning.details.fingerprint, fingerprint(liveKey));
      assert.ok(!warning.summary.includes(liveKey));

      const valid = await fetch(`http://127.0.0.1:${harness.running.port}${path}`, {
        method: action.method,
        headers: actionHeaders(definition, harness.credentials),
      });
      assert.notEqual(valid.status, 401);
    } finally {
      await harness.running.stop();
    }
  },
};

const actionRouteParity: ConformanceCheck = {
  id: "action-route-parity",
  run: async (definition) => {
    const harness = await startFor(definition);
    try {
      for (const action of definition.actions) {
        if (action.kind === "checkout") {
          continue;
        }
        const response = await fetch(
          `http://127.0.0.1:${harness.running.port}${concretePath(action)}`,
          {
            method: action.method,
            headers: actionHeaders(definition, harness.credentials),
          },
        );
        assert.notEqual(response.status, 404, `${action.id} should be reachable`);
      }

      const unknown = await fetch(`http://127.0.0.1:${harness.running.port}/no-such-route`, {
        headers: actionHeaders(definition, harness.credentials),
      });
      assert.equal(unknown.status, 404);
      const unknownBody = await unknown.json();
      assert.equal(typeof unknownBody, "object");

      const wrongMethod = await fetch(
        `http://127.0.0.1:${harness.running.port}${concretePath(nonCheckoutAction(definition))}`,
        { method: "DELETE", headers: actionHeaders(definition, harness.credentials) },
      );
      assert.equal(wrongMethod.status, 404);
    } finally {
      await harness.running.stop();
    }
  },
};

const eventsCheck: ConformanceCheck = {
  id: "events",
  run: async (definition) => {
    const harness = await startFor(definition);
    try {
      const action = nonCheckoutAction(definition);
      await fetch(`http://127.0.0.1:${harness.running.port}${concretePath(action)}`, {
        method: action.method,
        headers: actionHeaders(definition, harness.credentials),
      });

      const all = harness.events.after(0);
      const request = all.find(
        (event) => event.type === "request" && event.details.actionId === action.id,
      );
      const response = all.find(
        (event) => event.type === "response" && event.details.actionId === action.id,
      );
      assert.ok(request);
      assert.ok(response);
      assert.equal(request.scope, definition.id);
      assert.equal(response.scope, definition.id);
      assert.ok(request.summary.includes(definition.displayName));
      assert.ok(request.summary.trim().length > 0);
      assert.equal(typeof response.details.status, "number");
      assert.ok(!JSON.stringify(all).includes(secretOf(definition, harness.credentials)));
    } finally {
      await harness.running.stop();
    }
  },
};

function effectsForFailure(failureId: string): ActiveFailureEffects {
  const effects: Readonly<Record<string, ActiveFailureEffects>> = {
    "payment-declined": { declined: true },
    "bank-resolve-fails": { bankResolveFails: { mode: "error" } },
  };
  return effects[failureId] ?? {};
}

const WEBHOOK_FAILURES = new Set([
  "webhook-delayed",
  "webhook-duplicated",
  "webhook-out-of-order",
  "webhook-never-sent",
  "webhook-verification-fails",
]);

const failureSupport: ConformanceCheck = {
  id: "failure-support",
  run: async (definition) => {
    const harness = await startFor(definition);
    try {
      const action = nonCheckoutAction(definition);
      for (const support of definition.failures.support) {
        const supportAction = support.actions[0];
        assert.ok(supportAction, "every supported failure must name an action");
        const forceSettings = support.id === "flaky-network" ? { percent: 100 } : undefined;
        const rule = harness.rules.add({
          failureId: support.id,
          twins: [definition.id],
          actions: supportAction,
          ...(forceSettings === undefined ? {} : { settings: forceSettings }),
        });
        assert.equal(rule.failureId, support.id);
        const plan = WEBHOOK_FAILURES.has(support.id)
          ? decideWebhook({
              twinId: definition.id,
              actionId: supportAction,
              rules: harness.rules.activeRules(),
              random: new SeededRandom(5),
              now: harness.clock.now(),
            })
          : decide({
              twinId: definition.id,
              actionId: supportAction,
              rules: harness.rules.activeRules(),
              random: new SeededRandom(5),
              now: harness.clock.now(),
            });
        assert.ok(
          plan.firedRules.some((fired) => fired.failureId === support.id),
          `${support.id} did not fire for the ${definition.id} twin`,
        );
        const effects = definition.failures.shapeResult({
          failureId: support.id,
          actionId: supportAction,
          effects: effectsForFailure(support.id),
        });
        assert.equal(typeof effects, "object");
        if (support.id === "server-error" || support.id === "rate-limited") {
          const error = definition.failures.httpError({
            failureId: support.id,
            actionId: action.id,
            status: support.id === "rate-limited" ? 429 : 500,
          });
          assert.equal(error.status, support.id === "rate-limited" ? 429 : 500);
        }
        harness.rules.remove(rule.id);
      }

      const unsupported = FAILURE_IDS.find(
        (failureId) => !definition.failures.support.some((support) => support.id === failureId),
      );
      assert.ok(unsupported);
      assert.throws(
        () =>
          harness.rules.add({
            failureId: unsupported,
            twins: [definition.id],
          }),
        (error: unknown) => isIbejiError(error) && error.code === "FAILURE_NOT_SUPPORTED_BY_TWIN",
      );
    } finally {
      await harness.running.stop();
    }
  },
};

const failureOrder: ConformanceCheck = {
  id: "failure-order",
  run: async (definition) => {
    const harness = await startFor(definition);
    try {
      const action = nonCheckoutAction(definition);
      const slow = harness.rules.add({
        failureId: "slow-response",
        twins: [definition.id],
        actions: action.id,
        settings: { seconds: 2 },
      });
      const rate = harness.rules.add({
        failureId: "rate-limited",
        twins: [definition.id],
        actions: action.id,
      });
      const plan = decide({
        twinId: definition.id,
        actionId: action.id,
        rules: harness.rules.activeRules(),
        random: new SeededRandom(1),
        now: harness.clock.now(),
      });
      assert.equal(plan.step, "rate-limited");
      assert.equal(plan.status, 429);
      assert.equal(plan.delayMs, 2_000);
      assert.deepEqual(plan.firedSteps, ["rate-limited", "slow-response"]);
      harness.rules.remove(slow.id);
      harness.rules.remove(rate.id);
    } finally {
      await harness.running.stop();
    }
  },
};

const checkout: ConformanceCheck = {
  id: "checkout",
  run: async (definition) => {
    const drafts: TwinWebhookDraft[] = [];
    const clock = new FakeClock(1_000);
    const events = new EventLog(clock);
    const rules = new RuleStore({
      twins: [
        {
          id: definition.id,
          actions: definition.actions.map((item) => item.id),
          failures: definition.failures.support,
        },
      ],
      events,
    });
    const credentials = credentialsFor(definition);
    const running = await startTwin(definition, {
      credentials,
      events,
      rules,
      clock,
      onWebhookDraft: (draft) => {
        drafts.push(draft);
      },
    });
    try {
      const open = checkoutAction(definition, "GET");
      const submit = checkoutAction(definition, "POST");
      const openPath = concretePath(open);
      const submitPath = concretePath(submit);
      const page = await fetch(`http://127.0.0.1:${running.port}${openPath}`);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.ok(html.includes("Ibeji test checkout"));
      assert.ok(html.includes(definition.displayName));
      assert.ok(html.includes("No real money moves"));
      for (const outcome of definition.checkout.outcomes) {
        assert.ok(html.includes(outcome.id));
      }
      const firstOutcome = definition.checkout.outcomes[0];
      assert.ok(firstOutcome, "a checkout must declare an outcome");

      const wrongOrigin = await fetch(`http://127.0.0.1:${running.port}${submitPath}`, {
        method: "POST",
        headers: {
          origin: "http://evil.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `outcome=${encodeURIComponent(firstOutcome.id)}`,
      });
      assert.equal(wrongOrigin.status, 403);
      assert.equal(JSON.parse(await wrongOrigin.text()).error.code, "FORBIDDEN_ORIGIN");

      const missingOrigin = await fetch(`http://127.0.0.1:${running.port}${submitPath}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `outcome=${encodeURIComponent(firstOutcome.id)}`,
      });
      assert.equal(missingOrigin.status, 403);

      const success = await fetch(`http://127.0.0.1:${running.port}${submitPath}`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${running.port}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `outcome=${encodeURIComponent(firstOutcome.id)}`,
      });
      assert.equal(success.status, 200);
      assert.ok((await success.text()).includes("Ibeji test checkout result"));
      assert.ok(drafts.length >= 1);

      const badOutcome = await fetch(`http://127.0.0.1:${running.port}${submitPath}`, {
        method: "POST",
        headers: {
          origin: `http://localhost:${running.port}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "outcome=not-a-real-outcome",
      });
      assert.equal(badOutcome.status, 400);

      const rule = rules.add({
        failureId: "payment-declined",
        twins: [definition.id],
        actions: "checkout.submit",
        settings: { percent: 100 },
      });
      const overridden = await fetch(`http://127.0.0.1:${running.port}${openPath}`);
      const overriddenHtml = await overridden.text();
      assert.ok(overriddenHtml.includes("An Ibeji failure rule changed this result"));
      assert.ok(overriddenHtml.includes("Declined payment"));
      const declined = await fetch(`http://127.0.0.1:${running.port}${submitPath}`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${running.port}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `outcome=${encodeURIComponent(firstOutcome.id)}`,
      });
      assert.equal(declined.status, 200);
      assert.ok((await declined.text()).includes("Ibeji test checkout result"));
      rules.remove(rule.id);
    } finally {
      await running.stop();
    }
  },
};

const webhookBuildSign: ConformanceCheck = {
  id: "webhook-build-sign",
  run: async (definition) => {
    const credentials = credentialsFor(definition);
    const draft = webhookDraft(definition);
    const raw = definition.webhooks.build(draft, definition.state.initial());
    const headers = definition.webhooks.sign(raw, credentials, { attempt: 1 });
    assert.equal(typeof raw.body, "string");
    assert.equal(raw.contentType, "application/json");
    assert.equal(definition.webhooks.verify(raw, headers, credentials, new Date(1_000)), true);

    const tampered: RawWebhook = { ...raw, body: `${raw.body} ` };
    assert.equal(
      definition.webhooks.verify(tampered, headers, credentials, new Date(1_000)),
      false,
    );

    const summary = definition.webhooks.summarize(draft, raw);
    assert.ok(summary.includes(definition.displayName));
    assert.ok(!summary.includes(secretOf(definition, credentials)));
  },
};

function tamperedHeaders(
  definition: TwinDefinition,
  raw: RawWebhook,
  credentials: TwinCredentials,
): readonly WebhookHeaders[] {
  return definition.webhooks.verificationFailures.map((method) =>
    definition.webhooks.sign(raw, credentials, { attempt: 1, failureMethod: method }),
  );
}

const webhookVerificationFailures: ConformanceCheck = {
  id: "webhook-verification-failures",
  run: async (definition) => {
    const credentials = credentialsFor(definition);
    const draft = webhookDraft(definition);
    const raw = definition.webhooks.build(draft, definition.state.initial());
    for (const headers of tamperedHeaders(definition, raw, credentials)) {
      assert.equal(definition.webhooks.verify(raw, headers, credentials, new Date(1_000)), false);
    }
    const good = definition.webhooks.sign(raw, credentials, { attempt: 1 });
    assert.equal(definition.webhooks.verify(raw, good, credentials, new Date(1_000)), true);
  },
};

async function withWebhookReceiver(
  handler: (body: string) => void,
): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      handler(Buffer.concat(chunks).toString("utf8"));
      response.statusCode = 200;
      response.end("ok");
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

const webhookDeliveryBehaviours: ConformanceCheck = {
  id: "webhook-delivery-behaviours",
  run: async (definition) => {
    const received: string[] = [];
    const receiver = await withWebhookReceiver((body) => {
      received.push(body);
    });
    const clock = new FakeClock(1_000);
    const credentials = credentialsFor(definition);
    const dispatcher = new WebhookDispatcher({
      clock,
      random: new SeededRandom(1),
      twins: {
        [definition.id]: {
          signer: definition.webhooks,
          retry: definition.retry,
          webhookUrl: () => `http://127.0.0.1:${receiver.port}/hook`,
          credentials: () => credentials,
        },
      },
    });

    try {
      const draft = webhookDraft(definition);
      const raw = definition.webhooks.build(draft, definition.state.initial());
      dispatcher.enqueue({
        eventId: "event-1",
        twinId: definition.id,
        actionId: draft.actionId,
        raw,
        plan: emptyWebhookPlan(),
      });
      const delivered = await dispatcher.dispatchDue();
      assert.equal(delivered[0]?.status, "delivered");
      assert.equal(received.length, 1);

      const notSent = dispatcher.enqueue({
        eventId: "event-2",
        twinId: definition.id,
        actionId: draft.actionId,
        raw,
        plan: { ...emptyWebhookPlan(), send: false, notSentReason: "webhook-never-sent" },
      });
      assert.equal(notSent[0]?.status, "not-sent");

      const duplicated = dispatcher.enqueue({
        eventId: "event-3",
        twinId: definition.id,
        actionId: draft.actionId,
        raw,
        plan: {
          ...emptyWebhookPlan(),
          deliveries: [
            {
              index: 0,
              dueAt: clock.now(),
              delayMs: 0,
              verificationFailure: undefined,
              holdUntil: undefined,
            },
            {
              index: 1,
              dueAt: clock.now(),
              delayMs: 0,
              verificationFailure: undefined,
              holdUntil: undefined,
            },
          ],
        },
      });
      assert.equal(duplicated.length, 2);

      const scheduled = dispatcher.enqueue({
        eventId: "event-4",
        twinId: definition.id,
        actionId: draft.actionId,
        raw,
        plan: {
          ...emptyWebhookPlan(),
          deliveries: [
            {
              index: 0,
              dueAt: clock.now() + 5_000,
              delayMs: 5_000,
              verificationFailure: undefined,
              holdUntil: undefined,
            },
          ],
        },
      });
      assert.equal(scheduled[0]?.status, "scheduled");
    } finally {
      dispatcher.stop();
      await receiver.close();
    }
  },
};

const moneyCheck: ConformanceCheck = {
  id: "money",
  run: async (definition) => {
    const serviceText = definition.money.formatServiceAmount(1_234, "USD");
    assert.equal(definition.money.parseServiceAmount(serviceText, "USD"), 1_234);
    assert.ok(definition.money.formatDisplay(1_234, "USD").length > 0);
    assert.equal(definition.money.fractionDigits("USD"), 2);
    assert.ok(Array.isArray(definition.money.zeroDecimal));
    definition.money.assertValid(1_234, "USD");
    assert.throws(() => {
      definition.money.assertValid(-1, "USD");
    });
  },
};

const idempotencyCheck: ConformanceCheck = {
  id: "idempotency",
  run: async (definition) => {
    const action = nonCheckoutAction(definition);
    const credentials = credentialsFor(definition);
    const request: TwinRequest = {
      method: action.method,
      path: concretePath(action),
      headers: {},
      query: {},
      params: {},
      rawBody: new Uint8Array(),
    };

    if (definition.idempotency.mode === "none") {
      assert.deepEqual(definition.idempotency, { mode: "none" });
      return;
    }

    const adapter: IdempotencyAdapter = definition.idempotency;
    assert.ok(adapter.headerName.length > 0);
    const store = new MemoryIdempotencyStore();
    const clock = new FakeClock(1_000);
    const missing = adapter.begin({ request, action, credentials, store, clock });
    assert.deepEqual(missing, { kind: "proceed", key: null });

    const keyedRequest: TwinRequest = {
      ...request,
      headers: { [adapter.headerName.toLowerCase()]: "key-1" },
    };
    const first = adapter.begin({ request: keyedRequest, action, credentials, store, clock });
    assert.deepEqual(first, { kind: "proceed", key: "key-1" });
    const firstKey = (first as { readonly key: string }).key;
    adapter.complete(
      { key: firstKey, request: keyedRequest, action, store, clock },
      { status: 200, headers: {}, body: "{}", contentType: "application/json" },
    );
    const replay = adapter.begin({ request: keyedRequest, action, credentials, store, clock });
    assert.equal(replay.kind, "replay");
  },
};

const eventSummaries: ConformanceCheck = {
  id: "event-summaries",
  run: async (definition) => {
    const credentials = credentialsFor(definition);
    for (const event of definition.webhooks.events) {
      const eventActionId = event.actions[0];
      assert.ok(eventActionId, "a webhook event must name an action");
      const draft: TwinWebhookDraft = {
        key: event.key,
        actionId: eventActionId,
        resourceId: "pay_1",
        occurredAt: 1_000,
        data: { id: "pay_1" },
      };
      const raw = definition.webhooks.build(draft, definition.state.initial());
      const summary = definition.webhooks.summarize(draft, raw);
      assert.ok(summary.trim().length > 0);
      assert.ok(summary.includes(definition.displayName));
      assert.ok(!summary.includes(secretOf(definition, credentials)));
    }
  },
};

const registryExtensibility: ConformanceCheck = {
  id: "registry-extensibility",
  run: async (definition) => {
    const registry = createTwinRegistry([definition]);
    assert.equal(registry.list().length, 1);
    assert.equal(registry.require(definition.id), definition);
    assert.equal(registry.has(definition.id), true);
    assert.equal(registry.has("not-a-twin"), false);
    assert.throws(
      () => registry.require("not-a-twin"),
      (error: unknown) => isIbejiError(error) && error.code === "UNKNOWN_TWIN",
    );
    assert.throws(
      () => createTwinRegistry([definition, definition]),
      (error: unknown) => isIbejiError(error) && error.code === "BAD_REQUEST",
    );
  },
};

export const CONFORMANCE_CHECKS: readonly ConformanceCheck[] = [
  definitionContract,
  lifecycle,
  hostAndHttpSafety,
  credentialsCheck,
  authentication,
  actionRouteParity,
  eventsCheck,
  failureSupport,
  failureOrder,
  checkout,
  webhookBuildSign,
  webhookVerificationFailures,
  webhookDeliveryBehaviours,
  moneyCheck,
  idempotencyCheck,
  eventSummaries,
  registryExtensibility,
];

/**
 * Run the shared T14 suite. Each check is registered by id and runs against the
 * definition it is given; no check contains a service name or a twin id.
 */
export async function runConformance(
  definition: TwinDefinition,
  options: ConformanceOptions = {},
): Promise<ConformanceResult> {
  const selected =
    options.only === undefined
      ? CONFORMANCE_CHECKS
      : CONFORMANCE_CHECKS.filter((check) => options.only?.includes(check.id) === true);

  const checks: ConformanceCheckResult[] = [];
  for (const check of selected) {
    try {
      await check.run(definition);
      checks.push({ id: check.id, ok: true, error: undefined });
    } catch (error) {
      checks.push({
        id: check.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failures = checks.filter((check) => !check.ok);
  return { passed: failures.length === 0, checks, failures };
}

export function assertConformance(result: ConformanceResult): void {
  if (!result.passed) {
    throw new IbejiError("INTERNAL", {
      what: "A twin failed the shared conformance suite.",
      why: result.failures
        .map((failure) => `${failure.id}: ${failure.error ?? "failed"}`)
        .join("; "),
      fix: "Fix the twin definition, then run the conformance suite again.",
    });
  }
}
