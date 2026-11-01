import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { IbejiError, isIbejiError, zodProblemsToError } from "../core/errors.js";
import { EVENT_TYPES, IBEJI_SCOPE } from "../core/events.js";
import { actionSelectorSchema, FAILURE_CATALOG } from "../core/failures/catalog.js";
import { resolveAllowedWebhookUrl } from "../core/webhooks/address.js";
import { WEBHOOK_DELIVERY_STATUSES } from "../core/webhooks/dispatcher.js";
import {
  applyHtmlSecurityHeaders,
  errorResponseFrom,
  ibejiErrorResponse,
  isAllowedHost,
  isAllowedOrigin,
  MAX_BODY_BYTES,
} from "../twins/framework/http-security.js";
import type { TwinDefinition } from "../twins/framework/types.js";
import { buildSessionExport } from "./export.js";
import { SecretRedactor } from "./redact.js";
import { eventStreamResponse } from "./sse.js";
import type { ControlDependencies } from "./types.js";

export const API_PREFIX = "/_ibeji/api/v1";
const HEALTH_PATH = `${API_PREFIX}/health`;
const EXCHANGE_PATH = `${API_PREFIX}/auth/exchange`;
const UI_COOKIE = "ibeji_ui";

const exchangeBodySchema = z
  .strictObject({
    code: z.string().min(1).optional(),
    launchCode: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const present = Number(value.code !== undefined) + Number(value.launchCode !== undefined);
    if (present !== 1) {
      context.addIssue({
        code: "custom",
        path: ["code"],
        message: "Expected exactly one of code or launchCode.",
        input: value,
      });
    }
  });

const optionalTwinsSchema = z.strictObject({
  twins: z.array(z.string().min(1)).min(1).optional(),
});

const rotateBodySchema = z.strictObject({
  twin: z.string().min(1).optional(),
});

const ruleBodySchema = z.strictObject({
  failureId: z.string().min(1),
  twins: z.array(z.string().min(1)).min(1).optional(),
  actions: actionSelectorSchema.optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
});

const webhookUrlBodySchema = z.strictObject({
  url: z.string(),
});

const webhooksQuerySchema = z.strictObject({
  twin: z.string().min(1).optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
});

const eventsQuerySchema = z.strictObject({
  scope: z.string().min(1).optional(),
  type: z.enum(EVENT_TYPES).optional(),
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

const scopeQuerySchema = z.strictObject({
  scope: z.string().min(1).optional(),
});

const rulesQuerySchema = z.strictObject({
  twin: z.string().min(1).optional(),
});

const stateRecordSchema = z.record(z.string(), z.unknown());

function jsonResponse(
  value: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function bodyProblems(error: z.ZodError): IbejiError {
  return zodProblemsToError("BAD_REQUEST", error.issues);
}

async function parseBody<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  const text = await context.req.text();
  if (text.trim() === "") {
    throw new IbejiError("BAD_REQUEST", {
      what: "The request body is empty.",
      why: "This route needs a JSON object.",
      fix: "Send a JSON object with content-type application/json.",
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The request body is not valid JSON.",
      why: "The body could not be parsed as JSON.",
      fix: "Send a JSON object with content-type application/json.",
      cause: error,
    });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw bodyProblems(parsed.error);
  }
  return parsed.data;
}

async function parseOptionalBody<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  const text = await context.req.text();
  if (text.trim() === "") {
    const parsed = schema.safeParse({});
    if (!parsed.success) {
      throw bodyProblems(parsed.error);
    }
    return parsed.data;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The request body is not valid JSON.",
      why: "The body could not be parsed as JSON.",
      fix: "Send a JSON object with content-type application/json.",
      cause: error,
    });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw bodyProblems(parsed.error);
  }
  return parsed.data;
}

function parseQuery<T>(context: Context, schema: z.ZodType<T>): T {
  const raw = Object.fromEntries(new URL(context.req.url).searchParams);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw bodyProblems(parsed.error);
  }
  return parsed.data;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals !== -1 && trimmed.slice(0, equals) === name) {
      return trimmed.slice(equals + 1);
    }
  }
  return undefined;
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  return match?.[1];
}

function isChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "DELETE";
}

function renderPlaceholder(notice?: string): string {
  const message = notice === undefined ? "" : `<p role="alert">${notice}</p>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ibeji</title></head>
<body><main><h1>Ibeji</h1><p>Ibeji dashboard is coming in Phase 6</p>${message}</main></body>
</html>`;
}

function htmlResponse(html: string, status = 200): Response {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  applyHtmlSecurityHeaders(headers);
  return new Response(html, { status, headers });
}

function labelColourToken(index: number): string {
  return `twin-label-${index + 1}`;
}

function twinAddress(definition: TwinDefinition, deps: ControlDependencies): string | null {
  const running = deps.runningTwins.get(definition.id);
  return running === undefined ? null : `http://127.0.0.1:${running.port}`;
}

function twinSummary(
  definition: TwinDefinition,
  index: number,
  deps: ControlDependencies,
): unknown {
  const running = deps.runningTwins.get(definition.id);
  const fractions: Record<string, number> = {};
  for (const currency of [...new Set([...definition.money.zeroDecimal, "USD"])]) {
    fractions[currency] = definition.money.fractionDigits(currency);
  }

  return {
    id: definition.id,
    displayName: definition.displayName,
    running: running !== undefined,
    address: twinAddress(definition, deps),
    port: running?.port ?? null,
    actions: definition.actions.map((action) => ({
      id: action.id,
      method: action.method,
      path: action.path,
      summary: action.summary,
      kind: action.kind,
    })),
    failures: definition.failures.support.map((failure) => ({
      id: failure.id,
      actions: [...failure.actions],
      source: failure.source,
    })),
    currencyRules: {
      zeroDecimal: [...definition.money.zeroDecimal],
      defaultFractionDigits: definition.money.fractionDigits("USD"),
      fractionDigits: fractions,
    },
    labelColourToken: labelColourToken(index),
  };
}

function findDefinition(twinId: string, deps: ControlDependencies): TwinDefinition {
  const definition = deps.definitions.find((item) => item.id === twinId);
  if (definition === undefined) {
    throw new IbejiError("UNKNOWN_TWIN", {
      why: "That twin id is not in the registry.",
    });
  }
  return definition;
}

function requireRunning(
  twinId: string,
  deps: ControlDependencies,
): { readonly definition: TwinDefinition; readonly port: number } {
  const definition = findDefinition(twinId, deps);
  const running = deps.runningTwins.get(twinId);
  if (running === undefined) {
    throw new IbejiError("TWIN_NOT_RUNNING", {
      what: `The ${definition.displayName} twin is not running.`,
      why: "The action needs a twin that is part of the current session.",
      fix: "Start the twin with ibeji start --twins and try again.",
    });
  }
  return { definition, port: running.port };
}

function requireState(twinId: string, deps: ControlDependencies) {
  const store = deps.states.get(twinId);
  if (store === undefined) {
    throw new IbejiError("INTERNAL", {
      what: "The twin state is not available.",
      why: "The running twin has no state store in this session.",
      fix: "Start a new Ibeji session. If the problem continues, report it.",
    });
  }
  return store;
}

type CollectionView = {
  readonly id: string;
  readonly label: string;
  readonly columns: TwinDefinition["state"]["collections"][number]["columns"];
  readonly records: readonly Readonly<Record<string, unknown>>[];
};

function stateCollections(
  definition: TwinDefinition,
  deps: ControlDependencies,
): readonly CollectionView[] {
  const store = deps.states.get(definition.id);
  return definition.state.collections.map((collection) => ({
    id: collection.id,
    label: collection.label,
    columns: collection.columns,
    records: store === undefined ? [] : store.list(collection.id, stateRecordSchema),
  }));
}

function stateSnapshot(
  deps: ControlDependencies,
): Record<string, Record<string, readonly Readonly<Record<string, unknown>>[]>> {
  const result: Record<string, Record<string, readonly Readonly<Record<string, unknown>>[]>> = {};
  for (const definition of deps.definitions) {
    const collections: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
    for (const collection of stateCollections(definition, deps)) {
      collections[collection.id] = collection.records;
    }
    result[definition.id] = collections;
  }
  return result;
}

function currentRedactor(deps: ControlDependencies): SecretRedactor {
  return SecretRedactor.forSecrets(
    deps.secrets.secretValues(),
    deps.credentials.secretValues(),
    deps.definitions,
  );
}

function sanitizeError(error: IbejiError, deps: ControlDependencies): IbejiError {
  const redactor = currentRedactor(deps);
  return new IbejiError(error.code, {
    what: redactor.redactText(error.what),
    why: redactor.redactText(error.why),
    fix: redactor.redactText(error.fix),
  });
}

function validateScope(scope: string | undefined, deps: ControlDependencies): string | undefined {
  if (scope === undefined || scope === IBEJI_SCOPE) {
    return scope;
  }
  requireRunning(scope, deps);
  return scope;
}

function lastEventIdOf(context: Context): number | undefined {
  const header = context.req.header("last-event-id");
  if (header === undefined) {
    return undefined;
  }
  const parsed = z.coerce.number().int().min(0).safeParse(header);
  if (!parsed.success) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The Last-Event-ID header is not valid.",
      why: "Last-Event-ID must be a whole event number from 0 upwards.",
      fix: "Send the id from the last event message, or omit the header.",
    });
  }
  return parsed.data;
}

function failureCatalog(deps: ControlDependencies): readonly unknown[] {
  return FAILURE_CATALOG.flatMap((failure) => {
    const support = deps.definitions.flatMap((definition) =>
      definition.failures.support
        .filter((item) => item.id === failure.id)
        .map((item) => ({
          twin: definition.id,
          source: item.source,
          actions: [...item.actions],
        })),
    );

    if (support.length === 0) {
      return [];
    }

    return [
      {
        id: failure.id,
        name: failure.name,
        realLife: failure.description.realLife,
        whatToCheck: failure.description.whatToCheck,
        settingsSchema: failure.settingsJsonSchema,
        support,
      },
    ];
  });
}

export function createControlApp(deps: ControlDependencies): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    if (!isAllowedHost(context.req.header("host"), deps.controlPort.value)) {
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

  app.use(`${API_PREFIX}/*`, async (context, next) => {
    const path = new URL(context.req.url).pathname;
    if (path === HEALTH_PATH || path === EXCHANGE_PATH) {
      await next();
      return;
    }

    const bearer = bearerToken(context.req.header("authorization"));
    if (bearer !== undefined && deps.secrets.matchesBearerToken(bearer)) {
      await next();
      return;
    }

    const cookie = cookieValue(context.req.header("cookie"), UI_COOKIE);
    if (cookie === undefined || !deps.secrets.matchesUiToken(cookie)) {
      throw new IbejiError("UNAUTHORIZED");
    }

    if (isChangingMethod(context.req.method)) {
      if (context.req.header("x-ibeji-request") !== "1") {
        throw new IbejiError("FORBIDDEN_ORIGIN");
      }
      if (!isAllowedOrigin(context.req.header("origin"), deps.controlPort.value)) {
        throw new IbejiError("FORBIDDEN_ORIGIN");
      }
    }

    await next();
  });

  app.get("/", (context) => {
    const launch = new URL(context.req.url).searchParams.get("launch");
    if (launch === null) {
      return htmlResponse(renderPlaceholder());
    }

    let uiToken: string;
    try {
      uiToken = deps.secrets.exchangeLaunchCode(launch);
    } catch (error) {
      if (isIbejiError(error) && error.code === "LAUNCH_CODE_INVALID") {
        return htmlResponse(
          renderPlaceholder(
            "That launch link is not valid. Run ibeji open to get a new dashboard link.",
          ),
          401,
        );
      }
      throw error;
    }

    const headers = new Headers({ location: "/", "cache-control": "no-store" });
    headers.set("set-cookie", `${UI_COOKIE}=${uiToken}; HttpOnly; SameSite=Strict; Path=/`);
    return new Response(null, { status: 303, headers });
  });

  app.get(HEALTH_PATH, () => jsonResponse({ ok: true, instance: deps.instanceId }));

  app.post(EXCHANGE_PATH, async (context) => {
    const body = await parseBody(context, exchangeBodySchema);
    const code = body.code ?? body.launchCode;
    if (code === undefined) {
      throw new IbejiError("BAD_REQUEST");
    }

    const uiToken = deps.secrets.exchangeLaunchCode(code);
    return jsonResponse({ ok: true }, 200, {
      "set-cookie": `${UI_COOKIE}=${uiToken}; HttpOnly; SameSite=Strict; Path=/`,
    });
  });

  app.get(`${API_PREFIX}/status`, () => {
    return jsonResponse({
      version: deps.version,
      instance: deps.instanceId,
      seed: deps.seed,
      startTime: deps.startTime,
      twins: deps.definitions.map((definition, index) => ({
        id: definition.id,
        displayName: definition.displayName,
        running: deps.runningTwins.has(definition.id),
        address: twinAddress(definition, deps),
        labelColourToken: labelColourToken(index),
      })),
      rules: deps.rules.list(),
      scenario: deps.scenarios.activeScenarioId ?? null,
    });
  });

  app.get(`${API_PREFIX}/twins`, () => {
    return jsonResponse({
      twins: deps.definitions.map((definition, index) => twinSummary(definition, index, deps)),
    });
  });

  app.get(`${API_PREFIX}/twins/:twin/credentials`, (context) => {
    const definition = findDefinition(context.req.param("twin"), deps);
    return jsonResponse({
      twin: { id: definition.id, displayName: definition.displayName },
      credentials: deps.credentials.views(definition.id),
    });
  });

  app.post(`${API_PREFIX}/credentials/rotate`, async (context) => {
    const body = await parseOptionalBody(context, rotateBodySchema);
    if (body.twin !== undefined) {
      findDefinition(body.twin, deps);
    }
    const rotated = await deps.credentials.rotate(body.twin);
    const credentials: Record<string, unknown> = {};
    for (const twinId of rotated) {
      credentials[twinId] = deps.credentials.views(twinId);
    }
    return jsonResponse({ rotated, credentials });
  });

  app.get(`${API_PREFIX}/twins/:twin/state`, (context) => {
    const twinId = context.req.param("twin");
    const { definition } = requireRunning(twinId, deps);
    return jsonResponse({
      twin: definition.id,
      collections: stateCollections(definition, deps),
    });
  });

  app.delete(`${API_PREFIX}/twins/:twin/state`, (context) => {
    const twinId = context.req.param("twin");
    const { definition } = requireRunning(twinId, deps);
    requireState(twinId, deps).reset();
    const abandonedWebhooks = deps.dispatcher.resetTwin(twinId);
    deps.events.publish({
      type: "state-reset",
      scope: twinId,
      summary: `Reset the ${definition.displayName} twin's records.`,
      details: { twinId, abandonedWebhooks },
    });
    return jsonResponse({ ok: true, twin: twinId, abandonedWebhooks });
  });

  app.delete(`${API_PREFIX}/state`, () => {
    const twins: string[] = [];
    let abandonedWebhooks = 0;
    for (const [twinId, running] of deps.runningTwins) {
      deps.states.get(twinId)?.reset();
      abandonedWebhooks += deps.dispatcher.resetTwin(twinId);
      twins.push(twinId);
      deps.events.publish({
        type: "state-reset",
        scope: twinId,
        summary: `Reset the ${running.definition.displayName} twin's records.`,
        details: { twinId, abandonedWebhooks },
      });
    }
    return jsonResponse({ ok: true, twins, abandonedWebhooks });
  });

  app.get(`${API_PREFIX}/failures`, () => {
    return jsonResponse({ failures: failureCatalog(deps) });
  });

  app.get(`${API_PREFIX}/rules`, () => {
    return jsonResponse({ rules: deps.rules.list() });
  });

  app.post(`${API_PREFIX}/rules`, async (context) => {
    const body = await parseBody(context, ruleBodySchema);
    if (body.twins !== undefined) {
      for (const twinId of body.twins) {
        requireRunning(twinId, deps);
      }
    }

    const rule = deps.rules.add({
      failureId: body.failureId,
      settings: body.settings,
      ...(body.twins === undefined ? {} : { twins: body.twins }),
      ...(body.actions === undefined ? {} : { actions: body.actions }),
    });
    return jsonResponse({ rule });
  });

  app.delete(`${API_PREFIX}/rules/:id`, (context) => {
    const id = context.req.param("id");
    if (deps.rules.get(id) === undefined) {
      throw new IbejiError("NOT_FOUND", {
        what: "The rule was not found.",
        why: "No rule has that id in this session.",
        fix: "Read GET /rules and use an id from the list.",
      });
    }
    return jsonResponse({ ok: true, rule: deps.rules.remove(id) });
  });

  app.delete(`${API_PREFIX}/rules`, (context) => {
    const query = parseQuery(context, rulesQuerySchema);
    if (query.twin !== undefined) {
      requireRunning(query.twin, deps);
    }

    const before = deps.rules.list().reduce((total, rule) => total + rule.twins.length, 0);
    if (query.twin === undefined) {
      deps.rules.clear();
    } else {
      deps.rules.removeAll({ twinId: query.twin });
    }
    const after = deps.rules.list().reduce((total, rule) => total + rule.twins.length, 0);
    return jsonResponse({ ok: true, removed: before - after });
  });

  app.get(`${API_PREFIX}/scenarios`, () => {
    const active = deps.scenarios.activeScenarioId ?? null;
    return jsonResponse({
      scenarios: deps.scenarioDefinitions.map((scenario) => ({
        ...scenario,
        running: scenario.id === active,
      })),
      active,
    });
  });

  app.post(`${API_PREFIX}/scenarios/:id/run`, async (context) => {
    const scenarioId = context.req.param("id");
    if (!deps.scenarioDefinitions.some((scenario) => scenario.id === scenarioId)) {
      throw new IbejiError("UNKNOWN_SCENARIO", {
        why: "That scenario id is not one of the loaded scenarios.",
      });
    }

    const body = await parseOptionalBody(context, optionalTwinsSchema);
    if (body.twins !== undefined) {
      for (const twinId of body.twins) {
        requireRunning(twinId, deps);
      }
    }

    if (body.twins === undefined) {
      deps.scenarios.start(scenarioId);
    } else {
      deps.scenarios.start(scenarioId, { twins: body.twins });
    }

    return jsonResponse({
      ok: true,
      scenario: scenarioId,
      twins: deps.scenarios.activeTwins,
    });
  });

  app.post(`${API_PREFIX}/scenarios/stop`, () => {
    const stopped = deps.scenarios.activeScenarioId ?? null;
    deps.scenarios.stop();
    return jsonResponse({ ok: true, stopped });
  });

  app.get(`${API_PREFIX}/twins/:twin/webhook-url`, (context) => {
    const definition = findDefinition(context.req.param("twin"), deps);
    return jsonResponse({
      twin: definition.id,
      url: deps.webhookUrls.get(definition.id) ?? null,
    });
  });

  app.put(`${API_PREFIX}/twins/:twin/webhook-url`, async (context) => {
    const definition = findDefinition(context.req.param("twin"), deps);
    const body = await parseBody(context, webhookUrlBodySchema);
    const url = body.url.trim();

    if (url === "") {
      deps.webhookUrls.delete(definition.id);
      return jsonResponse({ twin: definition.id, url: null });
    }

    await resolveAllowedWebhookUrl(url, deps.addressPolicy);
    deps.webhookUrls.set(definition.id, url);
    return jsonResponse({ twin: definition.id, url });
  });

  app.get(`${API_PREFIX}/webhooks`, (context) => {
    const query = parseQuery(context, webhooksQuerySchema);
    if (query.twin !== undefined) {
      requireRunning(query.twin, deps);
    }

    const deliveries = deps.dispatcher
      .list()
      .filter(
        (delivery) =>
          (query.twin === undefined || delivery.twinId === query.twin) &&
          (query.status === undefined || delivery.status === query.status),
      );
    return jsonResponse({ deliveries });
  });

  app.post(`${API_PREFIX}/webhooks/:id/resend`, (context) => {
    const id = context.req.param("id");
    if (deps.dispatcher.get(id) === undefined) {
      throw new IbejiError("NOT_FOUND", {
        what: "The webhook delivery was not found.",
        why: "No delivery has that id in this session.",
        fix: "Read GET /webhooks and use an id from the list.",
      });
    }
    return jsonResponse({ delivery: deps.dispatcher.resend(id) });
  });

  app.get(`${API_PREFIX}/events`, (context) => {
    const query = parseQuery(context, eventsQuerySchema);
    validateScope(query.scope, deps);

    const events = deps.events
      .after(query.after)
      .filter(
        (event) =>
          (query.scope === undefined || event.scope === query.scope) &&
          (query.type === undefined || event.type === query.type),
      )
      .slice(-query.limit);
    return jsonResponse({ events });
  });

  app.get(`${API_PREFIX}/events/stream`, (context) => {
    const query = parseQuery(context, scopeQuerySchema);
    const scope = validateScope(query.scope, deps);
    const lastEventId = lastEventIdOf(context);

    return eventStreamResponse({
      events: deps.events,
      clock: deps.clock,
      scope,
      lastEventId,
      signal: context.req.raw.signal,
    });
  });

  app.get(`${API_PREFIX}/export`, () => {
    const targets = deps.definitions.map((definition) => ({
      id: definition.id,
      displayName: definition.displayName,
      running: deps.runningTwins.has(definition.id),
      port: deps.runningTwins.get(definition.id)?.port ?? null,
    }));
    const ports: Record<string, number> = {};
    for (const [twinId, running] of deps.runningTwins) {
      ports[twinId] = running.port;
    }

    return jsonResponse(
      buildSessionExport({
        version: deps.version,
        seed: deps.seed,
        startTime: deps.startTime,
        twins: targets,
        ports: { control: deps.controlPort.value, twins: ports },
        rules: deps.rules.list(),
        scenario: deps.scenarios.activeScenarioId ?? null,
        webhookUrls: Object.fromEntries(deps.webhookUrls),
        state: stateSnapshot(deps),
        deliveries: deps.dispatcher.list(),
        events: deps.events.after(0),
        credentials: deps.credentials.fingerprints(),
        redactor: currentRedactor(deps),
      }),
    );
  });

  app.notFound(() => ibejiErrorResponse("NOT_FOUND"));

  app.onError((error) => {
    if (isIbejiError(error)) {
      return errorResponseFrom(sanitizeError(error, deps));
    }
    deps.logger.error("The control API hit an internal error.");
    return ibejiErrorResponse("INTERNAL");
  });

  return app;
}
