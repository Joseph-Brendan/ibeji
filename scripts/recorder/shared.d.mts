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
  readonly isSuccess: (status: number, body: unknown) => boolean;
};

export type KeyValidation =
  | { readonly ok: true; readonly code: "valid" }
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
};

export type RecorderPrompt = {
  readonly ask: (question: string) => Promise<string>;
  readonly close: () => void;
};

export type RecorderContext = {
  readonly meta: ServiceMeta;
  readonly keyFingerprint: string;
  readonly state: Map<string, unknown>;
  readonly results: RecorderResult[];
  readonly record: (request: {
    action: string;
    method: string;
    path: string;
    query?: Record<string, string | number | boolean | readonly (string | number)[]>;
    body?: string | null;
    contentType?: string;
    outcome?: string;
    invalidKey?: boolean;
    headers?: Record<string, string>;
  }) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly body: unknown;
    readonly file: string;
  }>;
  readonly skip: (action: string, reason: string) => Promise<void>;
  readonly recordInvalid: (
    action: string,
    request: Omit<Parameters<RecorderContext["record"]>[0], "action" | "outcome">,
  ) => Promise<unknown>;
  readonly recordInvalidKey: (
    action: string,
    request: Omit<Parameters<RecorderContext["record"]>[0], "action" | "outcome">,
  ) => Promise<unknown>;
  readonly promptCheckout: (details: {
    title: string;
    url: string;
    card: string;
    extra?: string;
  }) => Promise<void>;
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
export function fingerprintKey(key: string): string;
export function validateKey(meta: ServiceMeta, key: string | undefined): KeyValidation;
export function encodeJson(value: unknown): string;
export function encodeForm(value: unknown): string;
export function makeReference(prefix: string): string;
export function createPrompt(): RecorderPrompt;
export class Redactor {
  constructor(options?: { keyPatterns?: readonly RegExp[] });
  redact(value: unknown, fieldName?: string, path?: readonly string[]): unknown;
  redactText(value: string): string;
}
export function scanFixtures(
  root?: string,
  keyPatterns?: readonly RegExp[],
): Promise<FixtureScanResult>;
