import type { ErrorCode } from "../core/errors.js";

export type ControlErrorBody = {
  readonly error: {
    readonly code: ErrorCode;
    readonly what: string;
    readonly why: string;
    readonly fix: string;
  };
};

export type FailureSource = "docs" | "real-story" | "assumed";

export type FailureSupport = {
  readonly id: string;
  readonly actions: readonly string[];
  readonly source: FailureSource;
  readonly sourceReference?: string;
};

export type TwinAction = {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly kind: string;
};

export type CurrencyRules = {
  readonly zeroDecimal: readonly string[];
  readonly defaultFractionDigits: number;
  readonly fractionDigits: Readonly<Record<string, number>>;
};

export type ConnectionGuideStep = {
  readonly title: string;
  readonly body: string;
  readonly code?: string;
};

export type ConnectionGuideInfo = {
  readonly summary: string;
  readonly baseUrlNote: string;
  readonly keysNote: string;
  readonly steps: readonly ConnectionGuideStep[];
  readonly webhookNote: string;
  readonly agentInstruction: string;
};

export type TwinSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly running: boolean;
  readonly address: string | null;
  readonly port: number | null;
  readonly actions: readonly TwinAction[];
  readonly failures: readonly FailureSupport[];
  readonly currencyRules: CurrencyRules;
  readonly labelColourToken: string;
  readonly connectionGuide?: ConnectionGuideInfo;
};

export type TwinList = {
  readonly twins: readonly TwinSummary[];
};

export type CredentialView = {
  readonly id: string;
  readonly label: string;
  readonly role: "public" | "secret" | "webhook";
  readonly secret: boolean;
  readonly value: string;
};

export type CredentialsResponse = {
  readonly twin: { readonly id: string; readonly displayName: string };
  readonly credentials: readonly CredentialView[];
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

export type StatusTwin = {
  readonly id: string;
  readonly displayName: string;
  readonly running: boolean;
  readonly address: string | null;
  readonly labelColourToken: string;
};

export type StatusResponse = {
  readonly version: string;
  readonly instance: string;
  readonly seed: number;
  readonly startTime: string;
  readonly twins: readonly StatusTwin[];
  readonly rules: readonly Rule[];
  readonly scenario: string | null;
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

export type WebhookUrlResponse = {
  readonly twin: string;
  readonly url: string | null;
};

export type StateColumnKind = "text" | "money" | "date";

export type StateColumn = {
  readonly key: string;
  readonly label: string;
  readonly kind: StateColumnKind;
};

export type StateRecord = Readonly<Record<string, unknown>>;

export type StateCollection = {
  readonly id: string;
  readonly label: string;
  readonly columns: readonly StateColumn[];
  readonly records: readonly StateRecord[];
};

export type StateResponse = {
  readonly twin: string;
  readonly collections: readonly StateCollection[];
};

export type ResetStateResponse = {
  readonly ok: boolean;
  readonly twin?: string;
  readonly twins?: readonly string[];
  readonly abandonedWebhooks: number;
};

export type HealthResponse = {
  readonly ok: boolean;
  readonly instance: string;
};

export type LaunchLinkResponse = {
  readonly url: string;
};

export type FailureSourceInfo = {
  readonly twin: string;
  readonly source: FailureSource;
  readonly actions: readonly string[];
  readonly sourceReference?: string;
};

export type FailureInfo = {
  readonly id: string;
  readonly name: string;
  readonly realLife: string;
  readonly whatToCheck: string;
  readonly settingsSchema: unknown;
  readonly support: readonly FailureSourceInfo[];
};

export type FailureList = {
  readonly failures: readonly FailureInfo[];
};

export type ScenarioRule = {
  readonly id: string;
  readonly failureId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly actions?: string | readonly string[];
};

export type ScenarioStep = {
  readonly afterSeconds: number;
  readonly removeRule: string;
};

export type ScenarioInfo = {
  readonly id: string;
  readonly name: string;
  readonly story: string;
  readonly twins: readonly string[];
  readonly rules: readonly ScenarioRule[];
  readonly steps: readonly ScenarioStep[];
  readonly running: boolean;
};

export type ScenarioList = {
  readonly scenarios: readonly ScenarioInfo[];
  readonly active: string | null;
};

export type RuleResponse = {
  readonly rule: Rule;
};

export type RuleDeleteResponse = {
  readonly ok: boolean;
  readonly rule: Rule;
};

export type ClearRulesResponse = {
  readonly ok: boolean;
  readonly removed: number;
};

export type RunScenarioResponse = {
  readonly ok: boolean;
  readonly scenario: string;
  readonly twins: readonly string[];
};

export type StopScenarioResponse = {
  readonly ok: boolean;
  readonly stopped: string | null;
};

export type WebhookDeliveryStatus =
  | "queued"
  | "scheduled"
  | "sending"
  | "delivered"
  | "failed"
  | "unreachable"
  | "not-sent"
  | "abandoned";

export type WebhookAttemptOutcome = "delivered" | "failed" | "unreachable";

export type WebhookAttempt = {
  readonly attempt: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: WebhookAttemptOutcome;
  readonly requestUrl: string;
  readonly remoteAddress: string | undefined;
  readonly responseStatus: number | undefined;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseBody: string;
  readonly error: string | undefined;
  readonly errorCode: string | undefined;
};

export type WebhookDelivery = {
  readonly id: string;
  readonly eventId: string;
  readonly twinId: string;
  readonly actionId: string;
  readonly raw: { readonly body: string; readonly contentType: "application/json" };
  readonly status: WebhookDeliveryStatus;
  readonly attempts: readonly WebhookAttempt[];
  readonly createdAt: number;
  readonly scheduledAt: number | undefined;
  readonly holdUntil: number | undefined;
  readonly failureMethod: string | undefined;
  readonly resendOf: string | undefined;
  readonly reason: string | undefined;
  readonly url: string | undefined;
  readonly sequence: number;
};

export type WebhookListResponse = {
  readonly deliveries: readonly WebhookDelivery[];
};

export type WebhookDeliveryResponse = {
  readonly delivery: WebhookDelivery;
};
