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

export type HealthResponse = {
  readonly ok: boolean;
  readonly instance: string;
};

export type LaunchLinkResponse = {
  readonly url: string;
};
