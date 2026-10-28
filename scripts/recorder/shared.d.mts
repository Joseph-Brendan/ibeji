export type RecorderService = "paystack" | "flutterwave" | "stripe";

export type ServiceMeta = {
  readonly id: RecorderService;
  readonly displayName: string;
  readonly envName: string;
  readonly baseUrl: string;
  readonly requestFormat: "json" | "form";
  readonly auth: "bearer" | "basic";
  readonly testKey: RegExp;
  readonly liveKeys: readonly RegExp[];
  readonly keyPatterns: readonly RegExp[];
  readonly preflight: {
    readonly method: string;
    readonly path: string;
    readonly query?: Record<string, string | number | boolean | readonly (string | number)[]>;
  };
  readonly isKeyError: (status: number, body: unknown) => boolean;
  readonly isSuccess: (status: number, body: unknown) => boolean;
};

export type KeyValidation =
  | { readonly ok: true; readonly code: "valid"; readonly key: string }
  | {
      readonly ok: false;
      readonly code: "missing" | "wrong-format" | "live";
      readonly message: string;
    };

export type RecorderResult = {
  readonly action: string;
  readonly outcome: string;
  readonly status: number | null;
  readonly reason?: string;
  readonly file: string | null;
  readonly serviceMessage?: string;
  readonly serviceCode?: string;
  readonly note?: string;
  readonly paymentStatus?: string;
};

export type RecorderPrompt = {
  readonly ask: (question: string) => Promise<string>;
  readonly close: () => void;
};

export type RecorderRequestResult = {
  readonly ok: boolean;
  readonly method: string;
  readonly path: string;
  readonly query: unknown;
  readonly requestBody: string | null;
  readonly requestContentType: string | null;
  readonly status: number;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: unknown;
  readonly file: string;
};

export type ResponseClassifierInput = {
  readonly ok: boolean;
  readonly status: number;
  readonly responseBody: unknown;
};

export type OutcomeDecision =
  | string
  | {
      readonly outcome: string;
      readonly allowDuplicate?: boolean;
    };

export type OutcomeResolver = (
  result: ResponseClassifierInput,
) => OutcomeDecision | Promise<OutcomeDecision>;

export type RecorderContext = {
  readonly meta: ServiceMeta;
  readonly keyFingerprint: string;
  readonly state: Map<string, unknown>;
  readonly results: RecorderResult[];
  readonly preflight: () => Promise<unknown>;
  readonly record: (request: {
    action: string;
    method: string;
    path: string;
    query?: Record<string, string | number | boolean | readonly (string | number)[]>;
    body?: string | null;
    contentType?: string;
    outcome?: string | OutcomeResolver;
    failureOutcome?: string;
    failureMatches?: (result: ResponseClassifierInput) => boolean;
    failureFileName?: string;
    invalidKey?: boolean;
    headers?: Record<string, string>;
    stepLabel?: string;
    paymentStatusPath?: string;
  }) => Promise<RecorderRequestResult>;
  readonly skip: (action: string, reason: string) => Promise<void>;
  readonly recordInvalid: (
    action: string,
    request: Omit<Parameters<RecorderContext["record"]>[0], "action" | "outcome">,
  ) => Promise<RecorderRequestResult>;
  readonly recordInvalidKey: (
    action: string,
    request: Omit<Parameters<RecorderContext["record"]>[0], "action" | "outcome">,
  ) => Promise<RecorderRequestResult>;
  readonly promptCheckout: (details: {
    title: string;
    url: string;
    card: string;
    extra?: string;
  }) => Promise<void>;
  readonly ask: (question: string) => Promise<string>;
  readonly close: () => void;
};

export type FixtureProblem = {
  readonly file: string;
  readonly kind: "key" | "email" | "phone" | "account" | "name" | "invalid-json";
  readonly fingerprint: string | null;
};

export type FixtureScanResult = {
  readonly files: string[];
  readonly services: string[];
  readonly problems: FixtureProblem[];
};

export const VALID_SERVICES: readonly RecorderService[];
export const FAKE_EMAILS: readonly string[];
export const RECORDER_EMAIL: string;
export function isFakeEmail(value: string): boolean;
export class RecorderStopError extends Error {}
export class KeyRejectedError extends RecorderStopError {}
export function fingerprintKey(key: string): string;
export function validateKey(meta: ServiceMeta, key: string | undefined): KeyValidation;
export function encodeJson(value: unknown): string;
export function encodeForm(value: unknown): string;
export function makeReference(prefix: string, separator?: string): string;
export function readResponseField(result: RecorderRequestResult, fieldPath: string): unknown;
export function responseData(result: RecorderRequestResult): unknown;
export function requireResponseField(
  result: RecorderRequestResult,
  action: string,
  fieldPath: string,
  expectedType?: "string" | "number" | "boolean" | "array" | "object",
): unknown;
export function createPrompt(): RecorderPrompt;
export function createRecorderContext(options: {
  meta: ServiceMeta;
  key: string;
  baseUrl?: string;
  cwd?: string;
  fetchImpl?: typeof fetch;
  prompt?: RecorderPrompt;
  redactor?: Redactor;
  now?: () => Date;
}): RecorderContext;
export class Redactor {
  constructor(options?: { keyPatterns?: readonly RegExp[] });
  redact(value: unknown, fieldName?: string, path?: readonly string[]): unknown;
  redactText(value: string): string;
}
export function scanFixtures(
  root?: string,
  keyPatterns?: readonly RegExp[],
): Promise<FixtureScanResult>;
