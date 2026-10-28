export type RawWebhook = {
  readonly body: string;
  readonly contentType: "application/json";
};

export type TwinCredentials = Readonly<Record<string, string>>;

export type WebhookHeaders = Readonly<Record<string, string>>;

export type VerificationFailureMethod =
  | "wrong-secret"
  | "corrupted"
  | "missing"
  | "stale-timestamp";

export type WebhookSignOptions = {
  readonly attempt: number;
  readonly failureMethod?: VerificationFailureMethod;
};

/**
 * The dispatcher only sees this interface. It never knows whether the twin
 * signs with an HMAC, a shared marker, or a timestamp.
 */
export interface WebhookSigner {
  sign(raw: RawWebhook, credentials: TwinCredentials, options: WebhookSignOptions): WebhookHeaders;
}

/**
 * The twin owns the service's schedule. `delaysSeconds` are the delays after
 * the first attempt. An assumed schedule uses C7's fallback schedule in the
 * dispatcher, including its seeded jitter.
 */
export type RetrySchedule = {
  readonly source: "docs" | "assumed";
  readonly delaysSeconds: readonly number[];
};
