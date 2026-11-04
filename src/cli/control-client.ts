import type { SessionFile } from "../control/session-file.js";
import { ERROR_DEFINITIONS, type ErrorCode, IbejiError } from "../core/errors.js";

export type TwinSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly running: boolean;
  readonly address: string | null;
  readonly port: number | null;
  readonly actions: readonly {
    readonly id: string;
    readonly method: string;
    readonly path: string;
    readonly summary: string;
    readonly kind: string;
  }[];
  readonly failures: readonly FailureSupport[];
  readonly currencyRules: {
    readonly zeroDecimal: readonly string[];
    readonly defaultFractionDigits: number;
    readonly fractionDigits: Readonly<Record<string, number>>;
  };
  readonly labelColourToken: string;
};

export type FailureSupport = {
  readonly id: string;
  readonly actions: readonly string[];
  readonly source: "docs" | "real-story" | "assumed";
  readonly sourceReference?: string;
};

export type TwinList = {
  readonly twins: readonly TwinSummary[];
};

export type Rule = {
  readonly id: string;
  readonly failureId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly twins: readonly string[];
  readonly actions: string | undefined;
  readonly resolvedActions: Readonly<Record<string, readonly string[]>>;
  readonly scenarioId: string | undefined;
  readonly counters: Readonly<Record<string, number>>;
  readonly order: number;
};

export type RuleList = {
  readonly rules: readonly Rule[];
};

export type StatusResponse = {
  readonly version: string;
  readonly instance: string;
  readonly seed: number;
  readonly startTime: string;
  readonly twins: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly running: boolean;
    readonly address: string | null;
    readonly labelColourToken: string;
  }[];
  readonly rules: readonly Rule[];
  readonly scenario: string | null;
};

export type FailureInfo = {
  readonly id: string;
  readonly name: string;
  readonly realLife: string;
  readonly whatToCheck: string;
  readonly settingsSchema: unknown;
  readonly support: readonly {
    readonly twin: string;
    readonly source: "docs" | "real-story" | "assumed";
    readonly actions: readonly string[];
    readonly sourceReference?: string;
  }[];
};

export type FailureList = {
  readonly failures: readonly FailureInfo[];
};

export type ScenarioInfo = {
  readonly id: string;
  readonly name: string;
  readonly story: string;
  readonly twins: readonly string[];
  readonly rules: readonly {
    readonly id: string;
    readonly failureId: string;
    readonly settings: Readonly<Record<string, unknown>>;
    readonly actions?: string | readonly string[];
  }[];
  readonly steps: readonly { readonly afterSeconds: number; readonly removeRule: string }[];
  readonly running: boolean;
};

export type ScenarioList = {
  readonly scenarios: readonly ScenarioInfo[];
  readonly active: string | null;
};

export type WebhookUrlResponse = {
  readonly twin: string;
  readonly url: string | null;
};

export type EventItem = {
  readonly id: number;
  readonly time: number;
  readonly type: string;
  readonly scope: string;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
};

export type EventList = {
  readonly events: readonly EventItem[];
};

export type ResetResponse = {
  readonly ok: boolean;
  readonly twin?: string;
  readonly twins?: readonly string[];
  readonly abandonedWebhooks: number;
};

export type OkResponse = {
  readonly ok: boolean;
};

function errorCode(value: string): ErrorCode | undefined {
  return Object.hasOwn(ERROR_DEFINITIONS, value) ? (value as ErrorCode) : undefined;
}

function errorFromBody(body: unknown): IbejiError | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return undefined;
  }
  const raw = body.error;
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  if (!("code" in raw) || typeof raw.code !== "string") {
    return undefined;
  }
  const code = errorCode(raw.code);
  if (code === undefined) {
    return undefined;
  }
  return new IbejiError(code, {
    ...("what" in raw && typeof raw.what === "string" ? { what: raw.what } : {}),
    ...("why" in raw && typeof raw.why === "string" ? { why: raw.why } : {}),
    ...("fix" in raw && typeof raw.fix === "string" ? { fix: raw.fix } : {}),
  });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class ControlClient {
  readonly session: SessionFile;
  readonly baseUrl: string;
  private readonly token: string;

  constructor(session: SessionFile) {
    this.session = session;
    this.baseUrl = `http://127.0.0.1:${session.ports.control}/_ibeji/api/v1`;
    this.token = session.token;
  }

  get origin(): string {
    return `http://127.0.0.1:${this.session.ports.control}`;
  }

  async request<T>(
    path: string,
    options: {
      readonly method?: "GET" | "POST" | "PUT" | "DELETE";
      readonly body?: unknown;
    } = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      throw new IbejiError("SESSION_STALE", {
        cause: error,
      });
    }

    const body = await readBody(response);
    if (!response.ok) {
      const parsed = errorFromBody(body);
      if (parsed !== undefined) {
        throw parsed;
      }
      throw new IbejiError("INTERNAL", {
        what: "The Ibeji control API returned an error.",
        why: `The server answered with HTTP ${response.status}.`,
        fix: "Try again. If the problem continues, restart Ibeji.",
      });
    }

    return body as T;
  }

  get twins(): Promise<TwinList> {
    return this.request<TwinList>("/twins");
  }

  get status(): Promise<StatusResponse> {
    return this.request<StatusResponse>("/status");
  }

  get failures(): Promise<FailureList> {
    return this.request<FailureList>("/failures");
  }

  get rules(): Promise<RuleList> {
    return this.request<RuleList>("/rules");
  }

  get scenarios(): Promise<ScenarioList> {
    return this.request<ScenarioList>("/scenarios");
  }

  async webhookUrl(twinId: string): Promise<WebhookUrlResponse> {
    return this.request<WebhookUrlResponse>(`/twins/${encodeURIComponent(twinId)}/webhook-url`);
  }

  async setWebhookUrl(twinId: string, url: string): Promise<WebhookUrlResponse> {
    return this.request<WebhookUrlResponse>(`/twins/${encodeURIComponent(twinId)}/webhook-url`, {
      method: "PUT",
      body: { url },
    });
  }

  async addRule(input: {
    readonly failureId: string;
    readonly settings: Readonly<Record<string, unknown>>;
    readonly twins?: readonly string[];
    readonly actions?: string | readonly string[];
  }): Promise<{ readonly rule: Rule }> {
    return this.request<{ readonly rule: Rule }>("/rules", {
      method: "POST",
      body: input,
    });
  }

  async removeRule(id: string): Promise<{ readonly ok: boolean; readonly rule: Rule }> {
    return this.request<{ readonly ok: boolean; readonly rule: Rule }>(
      `/rules/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  async clearRules(twinId?: string): Promise<{ readonly ok: boolean; readonly removed: number }> {
    const query = twinId === undefined ? "" : `?twin=${encodeURIComponent(twinId)}`;
    return this.request<{ readonly ok: boolean; readonly removed: number }>(`/rules${query}`, {
      method: "DELETE",
    });
  }

  async runScenario(
    id: string,
    twins?: readonly string[],
  ): Promise<{
    readonly ok: boolean;
    readonly scenario: string;
    readonly twins: readonly string[];
  }> {
    return this.request(`/scenarios/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: twins === undefined ? {} : { twins },
    });
  }

  async stopScenario(): Promise<{ readonly ok: boolean; readonly stopped: string | null }> {
    return this.request("/scenarios/stop", { method: "POST", body: {} });
  }

  async events(
    options: { readonly scope?: string; readonly limit?: number } = {},
  ): Promise<EventList> {
    const query = new URLSearchParams();
    if (options.scope !== undefined) {
      query.set("scope", options.scope);
    }
    query.set("limit", String(options.limit ?? 500));
    return this.request<EventList>(`/events?${query.toString()}`);
  }

  async resend(id: string): Promise<unknown> {
    return this.request(`/webhooks/${encodeURIComponent(id)}/resend`, {
      method: "POST",
      body: {},
    });
  }

  async reset(twinId?: string): Promise<ResetResponse> {
    const path = twinId === undefined ? "/state" : `/twins/${encodeURIComponent(twinId)}/state`;
    return this.request<ResetResponse>(path, { method: "DELETE" });
  }

  async exportSession(): Promise<unknown> {
    return this.request<unknown>("/export");
  }

  async launchLink(): Promise<{ readonly url: string }> {
    return this.request<{ readonly url: string }>("/auth/launch", {
      method: "POST",
      body: {},
    });
  }

  async placeholder(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.origin}/`, {
        headers: { accept: "text/html" },
      });
    } catch (error) {
      throw new IbejiError("SESSION_STALE", { cause: error });
    }
    return response.text();
  }

  eventStreamUrl(scope?: string): string {
    const query = new URLSearchParams();
    if (scope !== undefined) {
      query.set("scope", scope);
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return `${this.baseUrl}/events/stream${suffix}`;
  }

  get authorizationHeader(): string {
    return `Bearer ${this.token}`;
  }
}
