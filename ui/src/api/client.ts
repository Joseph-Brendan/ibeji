import type {
  ClearRulesResponse,
  ControlErrorBody,
  CredentialsResponse,
  EventList,
  FailureList,
  HealthResponse,
  ResetStateResponse,
  RuleDeleteResponse,
  RuleList,
  RuleResponse,
  RunScenarioResponse,
  ScenarioList,
  StateResponse,
  StatusResponse,
  StopScenarioResponse,
  TwinList,
  WebhookUrlResponse,
} from "../../../src/shared/control.js";

export const API_PREFIX = "/_ibeji/api/v1";
export const REQUEST_HEADER = "X-Ibeji-Request";
export const REQUEST_TIMEOUT_MS = 5_000;

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "CONFIG_INVALID"
  | "CONFIG_HAS_SECRET"
  | "PORT_IN_USE"
  | "SESSION_NOT_RUNNING"
  | "SESSION_STALE"
  | "SESSION_ALREADY_RUNNING"
  | "UNAUTHORIZED"
  | "LAUNCH_CODE_INVALID"
  | "FORBIDDEN_HOST"
  | "FORBIDDEN_ORIGIN"
  | "NOT_FOUND"
  | "UNKNOWN_TWIN"
  | "UNKNOWN_ACTION"
  | "UNKNOWN_FAILURE"
  | "UNKNOWN_SCENARIO"
  | "TWIN_NOT_RUNNING"
  | "FAILURE_NOT_SUPPORTED_BY_TWIN"
  | "INVALID_RULE"
  | "SCENARIO_INVALID"
  | "WEBHOOK_URL_NOT_ALLOWED"
  | "BODY_TOO_LARGE"
  | "INTERNAL";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly what: string;
  readonly why: string;
  readonly fix: string;
  readonly status: number;
  readonly staleSession: boolean;

  constructor(
    status: number,
    body: {
      readonly code: ApiErrorCode;
      readonly what: string;
      readonly why: string;
      readonly fix: string;
    },
    staleSession = false,
  ) {
    super(body.what);
    this.name = "ApiError";
    this.code = body.code;
    this.what = body.what;
    this.why = body.why;
    this.fix = body.fix;
    this.status = status;
    this.staleSession = staleSession;
  }
}

export class ConnectionError extends Error {
  constructor(cause: unknown) {
    super("Ibeji is not answering.");
    this.name = "ConnectionError";
    this.cause = cause;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.code === "UNAUTHORIZED";
}

export function isConnectionError(error: unknown): boolean {
  return error instanceof ConnectionError;
}

function isApiErrorCode(value: string): value is ApiErrorCode {
  return [
    "BAD_REQUEST",
    "CONFIG_INVALID",
    "CONFIG_HAS_SECRET",
    "PORT_IN_USE",
    "SESSION_NOT_RUNNING",
    "SESSION_STALE",
    "SESSION_ALREADY_RUNNING",
    "UNAUTHORIZED",
    "LAUNCH_CODE_INVALID",
    "FORBIDDEN_HOST",
    "FORBIDDEN_ORIGIN",
    "NOT_FOUND",
    "UNKNOWN_TWIN",
    "UNKNOWN_ACTION",
    "UNKNOWN_FAILURE",
    "UNKNOWN_SCENARIO",
    "TWIN_NOT_RUNNING",
    "FAILURE_NOT_SUPPORTED_BY_TWIN",
    "INVALID_RULE",
    "SCENARIO_INVALID",
    "WEBHOOK_URL_NOT_ALLOWED",
    "BODY_TOO_LARGE",
    "INTERNAL",
  ].includes(value);
}

function fallbackError(status: number): ApiError {
  return new ApiError(status, {
    code: "INTERNAL",
    what: "Ibeji could not finish that action.",
    why: `Ibeji sent an unexpected answer (HTTP ${status}).`,
    fix: "Try again. If it keeps happening, restart Ibeji with ibeji start.",
  });
}

function apiErrorFromBody(status: number, body: unknown, staleSession: boolean): ApiError {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return fallbackError(status);
  }
  const error = body.error;
  if (typeof error !== "object" || error === null) {
    return fallbackError(status);
  }
  if (!("code" in error) || typeof error.code !== "string" || !isApiErrorCode(error.code)) {
    return fallbackError(status);
  }
  return new ApiError(
    status,
    {
      code: error.code,
      what:
        "what" in error && typeof error.what === "string"
          ? error.what
          : "Ibeji could not finish that action.",
      why:
        "why" in error && typeof error.why === "string"
          ? error.why
          : `Ibeji sent an unexpected answer (HTTP ${status}).`,
      fix:
        "fix" in error && typeof error.fix === "string"
          ? error.fix
          : "Try again. If it keeps happening, restart Ibeji with ibeji start.",
    },
    staleSession,
  );
}

export type RequestOptions = {
  readonly method?: "GET" | "POST" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
};

export class ControlApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { readonly baseUrl?: string; readonly fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = options.baseUrl ?? API_PREFIX;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const headers = new Headers({ accept: "application/json" });
    if (method !== "GET") {
      headers.set(REQUEST_HEADER, "1");
    }
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: "same-origin",
        signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      throw new ConnectionError(error);
    }

    const text = await response.text();
    let body: unknown;
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      throw apiErrorFromBody(
        response.status,
        body,
        response.headers.get("x-ibeji-stale-session") === "1",
      );
    }

    return body as T;
  }

  exchangeLaunchCode(code: string): Promise<{ readonly ok: boolean }> {
    return this.request<{ readonly ok: boolean }>("/auth/exchange", {
      method: "POST",
      body: { code },
    });
  }

  getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/status");
  }

  getTwins(): Promise<TwinList> {
    return this.request<TwinList>("/twins");
  }

  getCredentials(twinId: string): Promise<CredentialsResponse> {
    return this.request<CredentialsResponse>(`/twins/${encodeURIComponent(twinId)}/credentials`);
  }

  getWebhookUrl(twinId: string): Promise<WebhookUrlResponse> {
    return this.request<WebhookUrlResponse>(`/twins/${encodeURIComponent(twinId)}/webhook-url`);
  }

  getState(twinId: string): Promise<StateResponse> {
    return this.request<StateResponse>(`/twins/${encodeURIComponent(twinId)}/state`);
  }

  getFailures(): Promise<FailureList> {
    return this.request<FailureList>("/failures");
  }

  getRules(): Promise<RuleList> {
    return this.request<RuleList>("/rules");
  }

  addRule(input: {
    readonly failureId: string;
    readonly twins?: readonly string[];
    readonly actions?: string;
    readonly settings: Readonly<Record<string, unknown>>;
  }): Promise<RuleResponse> {
    return this.request<RuleResponse>("/rules", { method: "POST", body: input });
  }

  deleteRule(id: string): Promise<RuleDeleteResponse> {
    return this.request<RuleDeleteResponse>(`/rules/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  clearRules(twinId?: string): Promise<ClearRulesResponse> {
    const query = twinId === undefined ? "" : `?twin=${encodeURIComponent(twinId)}`;
    return this.request<ClearRulesResponse>(`/rules${query}`, { method: "DELETE" });
  }

  getScenarios(): Promise<ScenarioList> {
    return this.request<ScenarioList>("/scenarios");
  }

  runScenario(scenarioId: string, twins?: readonly string[]): Promise<RunScenarioResponse> {
    return this.request<RunScenarioResponse>(`/scenarios/${encodeURIComponent(scenarioId)}/run`, {
      method: "POST",
      ...(twins === undefined ? {} : { body: { twins } }),
    });
  }

  stopScenario(): Promise<StopScenarioResponse> {
    return this.request<StopScenarioResponse>("/scenarios/stop", { method: "POST" });
  }

  resetState(twinId?: string): Promise<ResetStateResponse> {
    return this.request<ResetStateResponse>(
      twinId === undefined ? "/state" : `/twins/${encodeURIComponent(twinId)}/state`,
      { method: "DELETE" },
    );
  }

  getEvents(
    options: {
      readonly scope?: string;
      readonly type?: string;
      readonly after?: number;
      readonly limit?: number;
    } = {},
  ): Promise<EventList> {
    const query = new URLSearchParams();
    if (options.scope !== undefined) {
      query.set("scope", options.scope);
    }
    if (options.type !== undefined) {
      query.set("type", options.type);
    }
    if (options.after !== undefined) {
      query.set("after", String(options.after));
    }
    query.set("limit", String(options.limit ?? 500));
    return this.request<EventList>(`/events?${query.toString()}`);
  }

  rotateCredentials(twinId: string): Promise<unknown> {
    return this.request("/credentials/rotate", {
      method: "POST",
      body: { twin: twinId },
    });
  }
}

export type { ControlErrorBody };
