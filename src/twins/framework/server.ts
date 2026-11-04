import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { type HttpBindings, serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { type Clock, realClock } from "../../core/clock.js";
import { IbejiError, isIbejiError } from "../../core/errors.js";
import { EventLog } from "../../core/events.js";
import {
  type ActiveRule,
  decide,
  decideWebhook,
  type FailureEffect,
  type RequestPlan,
} from "../../core/failures/engine.js";
import type { RuleStore } from "../../core/failures/rules.js";
import { SeededRandom } from "../../core/random.js";
import { fingerprint } from "../../core/redact.js";
import type { WebhookDispatcher, WebhookTwin } from "../../core/webhooks/dispatcher.js";
import { CHECKOUT_STYLES, renderCheckoutPage, renderCheckoutResult } from "./html.js";
import {
  applyHtmlSecurityHeaders,
  errorResponseFrom,
  ibejiErrorResponse,
  isAllowedHost,
  isAllowedOrigin,
  MAX_BODY_BYTES,
} from "./http-security.js";
import { FrameworkStateStore, MemoryIdempotencyStore } from "./state.js";
import type {
  ActionContext,
  ActionDefinition,
  ActiveFailureEffects,
  AuthFailure,
  CheckoutPageContext,
  CheckoutPageModel,
  CheckoutSubmitContext,
  HttpMethod,
  IdempotencyAdapter,
  IdempotencyDecision,
  IdempotencyStore,
  ResultFailurePlan,
  TwinCredentials,
  TwinDefinition,
  TwinRequest,
  TwinResponse,
  TwinStateStore,
  TwinWebhookDraft,
} from "./types.js";

export { MAX_BODY_BYTES } from "./http-security.js";

export type WebhookTwinRegistry = Record<string, WebhookTwin>;

export type StartTwinOptions = {
  readonly port?: number;
  readonly credentials: TwinCredentials | (() => TwinCredentials);
  readonly events?: EventLog;
  readonly rules?: RuleStore;
  readonly clock?: Clock;
  readonly random?: SeededRandom;
  readonly state?: TwinStateStore;
  readonly idempotencyStore?: IdempotencyStore;
  readonly webhookTwins?: WebhookTwinRegistry;
  readonly webhookUrl?: () => string | undefined;
  readonly dispatcher?: WebhookDispatcher;
  readonly onWebhookDraft?: (draft: TwinWebhookDraft) => void;
  readonly fontsDir?: string;
};

const CHECKOUT_FONT_FILES = new Set([
  "ibm-plex-sans-latin-400-normal.woff2",
  "ibm-plex-sans-latin-600-normal.woff2",
  "ibm-plex-sans-latin-ext-400-normal.woff2",
  "ibm-plex-sans-latin-ext-600-normal.woff2",
  "ibm-plex-mono-latin-400-normal.woff2",
  "ibm-plex-mono-latin-ext-400-normal.woff2",
]);

export type RunningTwin = {
  readonly definition: TwinDefinition;
  readonly port: number;
  readonly hostname: "127.0.0.1";
  readonly address: string;
  readonly events: EventLog;
  readonly app: Hono<{ Bindings: HttpBindings; Variables: TwinVariables }>;
  readonly server: Server;
  readonly stop: () => Promise<void>;
};

type TwinVariables = {
  actionId: string | undefined;
  actionSummary: string | undefined;
  request: TwinRequest | undefined;
};

type TwinContext = Context<{ Bindings: HttpBindings; Variables: TwinVariables }>;

function invalidDefinition(what: string, why: string, fix: string): IbejiError {
  return new IbejiError("BAD_REQUEST", { what, why, fix });
}

function collectRoutes(definition: TwinDefinition): readonly ActionDefinition[] {
  const registered: ActionDefinition[] = [];
  definition.routes({
    add(action) {
      registered.push(action);
    },
  });

  if (registered.length !== definition.actions.length) {
    throw invalidDefinition(
      "The twin definition's routes do not match its actions.",
      `The ${definition.id} twin declares ${definition.actions.length} actions but registered ${registered.length} routes.`,
      "Register exactly one route for every declared action.",
    );
  }

  const declared = new Map(definition.actions.map((action) => [action.id, action]));
  const seenIds = new Set<string>();
  const seenRoutes = new Set<string>();

  for (const action of registered) {
    const declaredAction = declared.get(action.id);
    if (declaredAction === undefined) {
      throw invalidDefinition(
        `The ${definition.id} twin registered an action it did not declare.`,
        `The route "${action.method} ${action.path}" uses the unknown action "${action.id}".`,
        "Add the action to the definition's action list, or remove the route.",
      );
    }
    if (declaredAction !== action) {
      throw invalidDefinition(
        `The ${definition.id} twin's route does not match its action.`,
        `The action "${action.id}" is registered with a different object than the one in the action list.`,
        "Register the same action object from the definition.",
      );
    }
    if (seenIds.has(action.id)) {
      throw invalidDefinition(
        `The ${definition.id} twin registered the action "${action.id}" twice.`,
        "Every action id must be unique.",
        "Remove the duplicate route registration.",
      );
    }
    seenIds.add(action.id);

    const routeKey = `${action.method} ${action.path}`;
    if (seenRoutes.has(routeKey)) {
      throw invalidDefinition(
        `The ${definition.id} twin declared the route "${routeKey}" twice.`,
        "Every method and path pair must map to exactly one action.",
        "Give each action a different method or path.",
      );
    }
    seenRoutes.add(routeKey);
  }

  return registered;
}

function matchAction(
  actions: readonly ActionDefinition[],
  method: string,
  path: string,
): ActionDefinition | undefined {
  return actions.find((action) => action.method === method && pathMatches(action.path, path));
}

function pathMatches(pattern: string, path: string): boolean {
  const patternParts = pattern.split("/").filter((part) => part.length > 0);
  const pathParts = path.split("/").filter((part) => part.length > 0);
  if (patternParts.length !== pathParts.length) {
    return false;
  }
  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

function twinResponseOf(response: TwinResponse): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (!name.toLowerCase().startsWith("access-control-")) {
      headers.set(name, value);
    }
  }
  headers.set("content-type", response.contentType);

  if (response.body instanceof Uint8Array) {
    return new Response(new Uint8Array(response.body), { status: response.status, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

function requestOf(context: TwinContext): Promise<TwinRequest> {
  const url = new URL(context.req.url);
  const headers: Record<string, string> = {};
  context.req.raw.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  const query: Record<string, string | readonly string[]> = {};
  for (const [name, values] of Object.entries(context.req.queries())) {
    query[name] = values.length === 1 ? (values[0] as string) : values;
  }

  return context.req.arrayBuffer().then((buffer) => ({
    method: context.req.method as HttpMethod,
    path: url.pathname,
    headers,
    query,
    params: context.req.param(),
    rawBody: new Uint8Array(buffer),
  }));
}

function effectsFromPlan(
  definition: TwinDefinition,
  actionId: string,
  effect: FailureEffect | undefined,
): ActiveFailureEffects {
  if (effect === undefined) {
    return {};
  }

  let plan: ResultFailurePlan;
  switch (effect.kind) {
    case "payment-declined":
      plan = { failureId: effect.kind, actionId, effects: { declined: true } };
      break;
    case "authentication-required":
      plan = {
        failureId: effect.kind,
        actionId,
        effects: {
          // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
          authenticationRequired: { then: effect.then },
        },
      };
      break;
    case "transfer-stuck-pending":
      plan = {
        failureId: effect.kind,
        actionId,
        effects: {
          transferStuckPending: {
            thenFailPercent: effect.thenFailPercent,
            seconds: effect.seconds,
            thenFailed: effect.thenFailed,
            endsAt: effect.endsAt,
          },
        },
      };
      break;
    case "transfer-reversed":
      plan = {
        failureId: effect.kind,
        actionId,
        effects: {
          transferReversed: true,
          transferReversal: {
            afterSeconds: effect.afterSeconds,
            reverseAt: effect.reverseAt,
            reversed: effect.reversed,
          },
        },
      };
      break;
    case "bank-resolve-fails":
      plan = {
        failureId: effect.kind,
        actionId,
        effects: { bankResolveFails: { mode: effect.mode } },
      };
      break;
  }

  return definition.failures.shapeResult(plan);
}

function checkoutEffects(
  definition: TwinDefinition,
  actionIds: readonly string[],
  primaryActionId: string,
  rules: readonly ActiveRule[],
): { effects: ActiveFailureEffects; notice: string | undefined } {
  const selected = rules
    .filter(
      (rule) =>
        rule.twinId === definition.id &&
        actionIds.some((actionId) => rule.actionIds.includes(actionId)) &&
        (rule.failureId === "payment-declined" || rule.failureId === "authentication-required"),
    )
    .at(-1);

  if (selected === undefined) {
    return { effects: {}, notice: undefined };
  }

  if (selected.failureId === "payment-declined") {
    return {
      effects: definition.failures.shapeResult({
        failureId: selected.failureId,
        actionId: primaryActionId,
        effects: { declined: true },
      }),
      notice: "An Ibeji failure rule changed this result: Declined payment is on for this twin.",
    };
  }

  const then = selected.settings.then === "succeed" ? "succeed" : "fail";
  const effects: ActiveFailureEffects = {
    authenticationRequired: { then },
  };
  return {
    effects: definition.failures.shapeResult({
      failureId: selected.failureId,
      actionId: primaryActionId,
      effects,
    }),
    notice: "An Ibeji failure rule changed this result: Extra check needed is on for this twin.",
  };
}

function checkoutRecordId(request: TwinRequest): string {
  const firstParam = Object.values(request.params)[0];
  if (firstParam !== undefined) {
    return firstParam;
  }
  const reference = request.query.reference;
  if (typeof reference === "string") {
    return reference;
  }
  const id = request.query.id;
  return typeof id === "string" ? id : "";
}

function authenticationChoiceOf(value: string): {
  outcomeId: string;
  authentication: "approve" | "fail" | undefined;
} {
  const marker = value.lastIndexOf("|");
  if (marker === -1) {
    return { outcomeId: value, authentication: undefined };
  }
  const choice = value.slice(marker + 1);
  return {
    outcomeId: value.slice(0, marker),
    authentication: choice === "approve" || choice === "fail" ? choice : undefined,
  };
}

function delay(clock: Clock, milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    clock.setTimeout(resolve, milliseconds);
  });
}

async function applyConnectionEnd(
  context: { readonly env: HttpBindings },
  plan: RequestPlan,
  clock: Clock,
): Promise<void> {
  if (plan.connection === "hang") {
    await delay(clock, plan.connectionHangMs as number);
  }
  context.env.outgoing.destroy();
}

function webhookDraftEventId(definition: TwinDefinition, draft: TwinWebhookDraft): string {
  return `${definition.id}-${draft.key}-${draft.resourceId}-${draft.occurredAt}`;
}

function credentialsProvider(
  value: TwinCredentials | (() => TwinCredentials),
): () => TwinCredentials {
  if (typeof value === "function") {
    return value;
  }
  const fixed: TwinCredentials = value;
  return () => fixed;
}

export async function startTwin(
  definition: TwinDefinition,
  options: StartTwinOptions,
): Promise<RunningTwin> {
  const actions = collectRoutes(definition);
  const clock = options.clock ?? realClock;
  const random = options.random ?? new SeededRandom(1);
  const events = options.events ?? new EventLog(clock);
  const credentials = credentialsProvider(options.credentials);
  const state =
    options.state ?? new FrameworkStateStore(definition.id, definition.state.collections);
  const idempotencyStore = options.idempotencyStore ?? new MemoryIdempotencyStore();
  const portRef = { value: 0 };
  const webhookTwins = options.webhookTwins;

  const app = new Hono<{ Bindings: HttpBindings; Variables: TwinVariables }>();

  app.use("*", async (context, next) => {
    const method = context.req.method;
    const path = new URL(context.req.url).pathname;
    if (path === "/_ibeji/checkout.css" || path.startsWith("/_ibeji/fonts/")) {
      await next();
      return;
    }

    const action = matchAction(actions, method, path);
    context.set("actionId", action?.id);
    context.set("actionSummary", action?.summary);
    context.set("request", undefined);

    await next();

    const request = context.get("request");
    const requestSummary =
      action?.eventSummary !== undefined && request !== undefined
        ? action.eventSummary(request, state)
        : action === undefined
          ? `${definition.displayName} twin received a request.`
          : `${definition.displayName} twin: ${action.summary}.`;

    events.publish({
      type: "request",
      scope: definition.id,
      summary: requestSummary,
      details: {
        method,
        path,
        actionId: action?.id ?? null,
      },
    });

    if (context.res.headers.get("content-type")?.toLowerCase().includes("text/html") === true) {
      applyHtmlSecurityHeaders(context.res.headers);
    }

    const actionId = context.get("actionId");
    const actionSummary = context.get("actionSummary");
    events.publish({
      type: "response",
      scope: definition.id,
      summary:
        actionSummary === undefined
          ? `${definition.displayName} twin responded with HTTP ${context.res.status}.`
          : `${definition.displayName} twin: ${actionSummary} responded with HTTP ${context.res.status}.`,
      details: {
        method,
        path,
        actionId: actionId ?? null,
        status: context.res.status,
      },
    });
  });

  app.use("*", async (context, next) => {
    if (!isAllowedHost(context.req.header("host"), portRef.value)) {
      return ibejiErrorResponse("FORBIDDEN_HOST");
    }
    await next();
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => ibejiErrorResponse("BODY_TOO_LARGE"),
    }),
  );

  app.get("/_ibeji/checkout.css", () => {
    return new Response(CHECKOUT_STYLES, {
      status: 200,
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  });

  if (options.fontsDir !== undefined) {
    const fontsDir = options.fontsDir;
    app.get("/_ibeji/fonts/:file", async (context) => {
      const file = context.req.param("file");
      if (!CHECKOUT_FONT_FILES.has(file)) {
        return new Response(null, { status: 404 });
      }
      try {
        const body = await readFile(join(fontsDir, file));
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "font/woff2",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
  }

  const runIdempotency = (
    adapter: IdempotencyAdapter,
    request: TwinRequest,
    action: ActionDefinition,
  ): IdempotencyDecision => {
    if (adapter.mode === "none") {
      return { kind: "proceed", key: null };
    }
    return adapter.begin({
      request,
      action,
      credentials: credentials(),
      store: idempotencyStore,
      clock,
    });
  };

  const emitDrafts = (drafts: readonly TwinWebhookDraft[]): void => {
    for (const draft of drafts) {
      const raw = definition.webhooks.build(draft, definition.state.initial());
      options.onWebhookDraft?.(draft);
      if (options.dispatcher !== undefined) {
        const plan = decideWebhook({
          twinId: definition.id,
          actionId: draft.actionId,
          rules: options.rules?.activeRules() ?? [],
          random,
          now: clock.now(),
        });
        options.rules?.recordFired(plan);
        for (const fired of plan.firedRules) {
          events.publish({
            type: "failure-fired",
            scope: definition.id,
            summary: `${fired.failureId} fired while handling the ${draft.actionId} webhook.`,
            details: {
              failureId: fired.failureId,
              ruleId: fired.ruleId,
              actionId: draft.actionId,
              step: fired.step,
            },
          });
        }
        options.dispatcher.enqueue({
          eventId: webhookDraftEventId(definition, draft),
          twinId: definition.id,
          actionId: draft.actionId,
          raw,
          plan,
        });
      }
    }
  };

  const handleCheckout = async (context: TwinContext, request: TwinRequest): Promise<Response> => {
    const activeRules = options.rules?.activeRules() ?? [];
    const checkoutActions = definition.actions.filter((item) => item.kind === "checkout");
    const checkoutActionIds = checkoutActions.map((item) => item.id);
    const primaryCheckoutActionId = (checkoutActions[0] as ActionDefinition).id;
    const computed = checkoutEffects(
      definition,
      checkoutActionIds,
      primaryCheckoutActionId,
      activeRules,
    );
    const pageContext: CheckoutPageContext = {
      state,
      recordId: checkoutRecordId(request),
      failures: computed.effects,
      money: definition.money,
      clock,
    };

    if (request.method === "GET") {
      const model = definition.checkout.page(pageContext);
      const withNotice: CheckoutPageModel =
        computed.notice === undefined ? model : { ...model, failureNotice: computed.notice };
      return new Response(renderCheckoutPage(withNotice, definition.money), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (!isAllowedOrigin(request.headers.origin, portRef.value)) {
      return ibejiErrorResponse("FORBIDDEN_ORIGIN");
    }

    const form = await context.req.parseBody();
    const rawOutcome = form.outcome;
    if (typeof rawOutcome !== "string") {
      return ibejiErrorResponse("BAD_REQUEST");
    }
    const parsed = authenticationChoiceOf(rawOutcome);
    const outcome = definition.checkout.outcomes.find((item) => item.id === parsed.outcomeId);
    if (outcome === undefined) {
      return ibejiErrorResponse("BAD_REQUEST");
    }

    const submitContext: CheckoutSubmitContext = {
      ...pageContext,
      ...(parsed.authentication === undefined
        ? {}
        : { authenticationChoice: parsed.authentication }),
    };
    const result = await definition.checkout.submit(
      submitContext,
      parsed.outcomeId,
      parsed.authentication,
    );
    emitDrafts(result.webhooks);
    if (result.redirectUrl !== undefined) {
      return new Response(null, {
        status: 303,
        headers: { location: result.redirectUrl },
      });
    }
    return new Response(renderCheckoutResult(result, definition.displayName), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  const handleAction = async (
    context: TwinContext,
    action: ActionDefinition,
    request: TwinRequest,
  ): Promise<Response> => {
    context.set("request", request);
    if (action.kind === "checkout") {
      return handleCheckout(context, request);
    }

    const key = definition.auth.readKey(request);
    if (key !== null && definition.auth.isLiveKey(key)) {
      events.publish({
        type: "warning",
        scope: definition.id,
        summary: `A live key was sent to the ${definition.displayName} twin. Live keys must never be used with Ibeji. Remove it from your app's test settings.`,
        details: {
          fingerprint: fingerprint(key),
          actionId: action.id,
        },
      });
      const failure: AuthFailure = { kind: "live" };
      return twinResponseOf(definition.auth.unauthorized(failure));
    }

    const auth = definition.auth.classify(key, credentials());
    if (auth.kind !== "valid") {
      return twinResponseOf(definition.auth.unauthorized(auth));
    }

    const idempotency = runIdempotency(definition.idempotency, request, action);
    if (idempotency.kind === "replay" || idempotency.kind === "error") {
      return twinResponseOf(idempotency.response);
    }

    const plan = decide({
      twinId: definition.id,
      actionId: action.id,
      rules: options.rules?.activeRules() ?? [],
      random,
      now: clock.now(),
    });
    options.rules?.recordFired(plan);

    for (const fired of plan.firedRules) {
      events.publish({
        type: "failure-fired",
        scope: definition.id,
        summary: `${fired.failureId} fired while handling ${action.summary}.`,
        details: {
          failureId: fired.failureId,
          ruleId: fired.ruleId,
          actionId: action.id,
          step: fired.step,
        },
      });
    }

    if (!plan.actionPerformed) {
      if (plan.connection !== "normal") {
        await applyConnectionEnd(context, plan, clock);
        return new Response(null, { status: 502 });
      }
      await delay(clock, plan.delayMs);
      const failureId = (plan.firedRules[0] as { readonly failureId: string }).failureId;
      return twinResponseOf(
        definition.failures.httpError({
          failureId,
          actionId: action.id,
          status: plan.status as number,
        }),
      );
    }

    const effects = effectsFromPlan(definition, action.id, plan.effect);
    const actionContext: ActionContext = {
      action,
      request,
      state,
      failures: effects,
      credentials: credentials(),
      clock,
      random,
      webhooks: {
        emit: (draft) => {
          emitDrafts([draft]);
        },
      },
    };

    const response = await action.handler(actionContext);

    if (idempotency.kind === "proceed" && idempotency.key !== null) {
      const adapter = definition.idempotency as Extract<
        IdempotencyAdapter,
        { readonly mode: "header" }
      >;
      adapter.complete(
        {
          key: idempotency.key,
          request,
          action,
          store: idempotencyStore,
          clock,
        },
        response,
      );
    }

    if (plan.connection !== "normal") {
      await applyConnectionEnd(context, plan, clock);
      return new Response(null, { status: 502 });
    }

    await delay(clock, plan.delayMs);
    return twinResponseOf(response);
  };

  for (const action of actions) {
    app.on(action.method, action.path, async (context) => {
      const request = await requestOf(context);
      return handleAction(context, action, request);
    });
  }

  app.notFound(() => twinResponseOf(definition.responses.notFound()));

  app.onError((error, _context) => {
    if (isIbejiError(error)) {
      return errorResponseFrom(error);
    }
    return ibejiErrorResponse("INTERNAL");
  });

  let bound: AddressInfo | undefined;
  const server = (await new Promise<Server>((resolve, reject) => {
    const instance = serve(
      {
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: options.port ?? 0,
      },
      (info) => {
        bound = info;
        portRef.value = info.port;
        resolve(instance as Server);
      },
    );
    instance.once("error", reject);
  })) as Server;
  const address = bound as AddressInfo;

  const webhookTwin: WebhookTwin = {
    signer: definition.webhooks,
    retry: definition.retry,
    webhookUrl: options.webhookUrl ?? (() => undefined),
    credentials,
  };
  options.dispatcher?.registerTwin(definition.id, webhookTwin);
  if (webhookTwins !== undefined) {
    webhookTwins[definition.id] = webhookTwin;
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    options.dispatcher?.unregisterTwin(definition.id);
    if (webhookTwins !== undefined) {
      delete webhookTwins[definition.id];
    }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  };

  return {
    definition,
    port: address.port,
    hostname: "127.0.0.1",
    address: address.address,
    events,
    app,
    server,
    stop,
  };
}

export function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
