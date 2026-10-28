import type { RequestOptions as HttpRequestOptions, IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import type { Clock } from "../clock.js";
import { IbejiError, isIbejiError } from "../errors.js";
import type { RandomSource, WebhookPlan } from "../failures/engine.js";
import {
  type AddressPolicy,
  DEFAULT_ADDRESS_POLICY,
  type DnsAddress,
  type DnsResolver,
  defaultDnsResolver,
  dnsHostname,
  parseWebhookUrl,
  resolveAllowedWebhookUrl,
} from "./address.js";
import type {
  RawWebhook,
  RetrySchedule,
  TwinCredentials,
  VerificationFailureMethod,
  WebhookHeaders,
  WebhookSigner,
} from "./types.js";

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 4_096;

export const C7_FALLBACK_RETRY_DELAYS_SECONDS = [60, 300, 900, 1_800, 3_600] as const;

export const C7_FALLBACK_RETRY_SCHEDULE: RetrySchedule = {
  source: "assumed",
  delaysSeconds: C7_FALLBACK_RETRY_DELAYS_SECONDS,
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

export const WEBHOOK_DELIVERY_STATUSES: readonly WebhookDeliveryStatus[] = [
  "queued",
  "scheduled",
  "sending",
  "delivered",
  "failed",
  "unreachable",
  "not-sent",
  "abandoned",
];

export type WebhookAttemptOutcome = "delivered" | "failed" | "unreachable";

export type WebhookAttempt = {
  readonly attempt: number;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: WebhookAttemptOutcome;
  readonly requestUrl: string;
  readonly remoteAddress: string | undefined;
  readonly responseStatus: number | undefined;
  readonly responseHeaders: WebhookHeaders;
  readonly responseBody: string;
  readonly error: string | undefined;
  readonly errorCode: string | undefined;
};

export type WebhookDelivery = {
  readonly id: string;
  readonly eventId: string;
  readonly twinId: string;
  readonly actionId: string;
  readonly raw: RawWebhook;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: readonly WebhookAttempt[];
  readonly createdAt: number;
  readonly scheduledAt: number | undefined;
  readonly holdUntil: number | undefined;
  readonly failureMethod: VerificationFailureMethod | undefined;
  readonly resendOf: string | undefined;
  readonly reason: string | undefined;
  readonly url: string | undefined;
  readonly sequence: number;
};

export type WebhookTwin = {
  readonly signer: WebhookSigner;
  readonly retry: RetrySchedule;
  readonly webhookUrl: () => string | undefined;
  readonly credentials: () => TwinCredentials;
};

export type WebhookTwinSource = Readonly<Record<string, WebhookTwin>>;

export type WebhookDispatcherOptions = {
  readonly clock: Clock;
  readonly twins: WebhookTwinSource;
  readonly random: RandomSource;
  readonly addressPolicy?: AddressPolicy;
  readonly dnsResolver?: DnsResolver;
};

export type EnqueueWebhookInput = {
  readonly eventId: string;
  readonly twinId: string;
  readonly actionId: string;
  readonly raw: RawWebhook;
  readonly plan: WebhookPlan;
};

type HttpResult = {
  readonly outcome: WebhookAttemptOutcome;
  readonly status: number | undefined;
  readonly headers: WebhookHeaders;
  readonly body: string;
  readonly error: string | undefined;
  readonly errorCode: string | undefined;
  readonly remoteAddress: string | undefined;
};

/**
 * The generic webhook dispatcher. It knows delivery mechanics, address safety,
 * retries and response recording; the twin's signer owns the service format.
 */
export class WebhookDispatcher {
  private readonly clock: Clock;
  private readonly twins: WebhookTwinSource;
  private readonly random: RandomSource;
  private readonly addressPolicy: AddressPolicy;
  private readonly dnsResolver: DnsResolver;
  private readonly deliveries = new Map<string, WebhookDelivery>();
  private readonly activeControllers = new Map<string, AbortController>();
  private nextDeliveryNumber = 1;
  private nextSequence = 1;
  private stopped = false;
  private dispatchPromise: Promise<readonly WebhookDelivery[]> | undefined;

  constructor(options: WebhookDispatcherOptions) {
    this.clock = options.clock;
    this.twins = options.twins;
    this.random = options.random;
    this.addressPolicy = options.addressPolicy ?? DEFAULT_ADDRESS_POLICY;
    this.dnsResolver = options.dnsResolver ?? defaultDnsResolver;
  }

  enqueue(input: EnqueueWebhookInput): readonly WebhookDelivery[] {
    this.assertRunning();
    const twin = this.requireTwin(input.twinId);
    const now = this.clock.now();
    const url = this.currentUrl(twin);

    if (url !== undefined) {
      parseWebhookUrl(url);
    }

    if (url === undefined) {
      return [
        this.createDelivery({
          eventId: input.eventId,
          twinId: input.twinId,
          actionId: input.actionId,
          raw: input.raw,
          status: "not-sent",
          reason: "no webhook URL set",
          now,
          url: undefined,
          scheduledAt: undefined,
          holdUntil: undefined,
          failureMethod: undefined,
          resendOf: undefined,
        }),
      ];
    }

    if (!input.plan.send) {
      return [
        this.createDelivery({
          eventId: input.eventId,
          twinId: input.twinId,
          actionId: input.actionId,
          raw: input.raw,
          status: "not-sent",
          reason: input.plan.notSentReason ?? "webhook not sent",
          now,
          url,
          scheduledAt: undefined,
          holdUntil: undefined,
          failureMethod: undefined,
          resendOf: undefined,
        }),
      ];
    }

    const planned =
      input.plan.deliveries.length === 0
        ? [
            {
              index: 0,
              dueAt: now,
              delayMs: 0,
              verificationFailure: undefined,
              holdUntil: undefined,
            },
          ]
        : input.plan.deliveries;

    return planned.map((delivery) => {
      const scheduledAt = Math.max(delivery.dueAt, delivery.holdUntil ?? delivery.dueAt);
      return this.createDelivery({
        eventId: input.eventId,
        twinId: input.twinId,
        actionId: input.actionId,
        raw: input.raw,
        status: scheduledAt <= now ? "queued" : "scheduled",
        reason: undefined,
        now,
        url,
        scheduledAt,
        holdUntil: delivery.holdUntil,
        failureMethod: delivery.verificationFailure as VerificationFailureMethod | undefined,
        resendOf: undefined,
      });
    });
  }

  list(): readonly WebhookDelivery[] {
    return [...this.deliveries.values()].map((delivery) => this.cloneDelivery(delivery));
  }

  get(id: string): WebhookDelivery | undefined {
    const delivery = this.deliveries.get(id);
    return delivery === undefined ? undefined : this.cloneDelivery(delivery);
  }

  /**
   * Send every queued delivery whose scheduled time has arrived. Retries are
   * scheduled by setting scheduledAt; call this again after the clock advances.
   */
  async dispatchDue(): Promise<readonly WebhookDelivery[]> {
    if (this.stopped) {
      return [];
    }
    if (this.dispatchPromise !== undefined) {
      return this.dispatchPromise;
    }

    const promise = this.runDue();
    this.dispatchPromise = promise;
    try {
      return await promise;
    } finally {
      this.dispatchPromise = undefined;
    }
  }

  resend(deliveryId: string): WebhookDelivery {
    this.assertRunning();
    const original = this.deliveries.get(deliveryId);
    if (original === undefined) {
      throw new IbejiError("NOT_FOUND", {
        why: `No webhook delivery has the id "${deliveryId}".`,
      });
    }

    const twin = this.requireTwin(original.twinId);
    const now = this.clock.now();
    const url = this.currentUrl(twin);
    if (url !== undefined) {
      parseWebhookUrl(url);
    }

    return this.createDelivery({
      eventId: original.eventId,
      twinId: original.twinId,
      actionId: original.actionId,
      raw: original.raw,
      status: url === undefined ? "not-sent" : "queued",
      reason: url === undefined ? "no webhook URL set" : undefined,
      now,
      url,
      scheduledAt: url === undefined ? undefined : now,
      holdUntil: undefined,
      failureMethod: undefined,
      resendOf: original.id,
    });
  }

  resetTwin(twinId: string): number {
    let changed = 0;
    for (const delivery of this.deliveries.values()) {
      if (
        delivery.twinId === twinId &&
        (delivery.status === "queued" || delivery.status === "scheduled")
      ) {
        this.replaceDelivery(delivery.id, {
          status: "abandoned",
          scheduledAt: undefined,
          reason: "the twin was reset",
        });
        changed += 1;
      }
    }
    return changed;
  }

  stop(): number {
    if (this.stopped) {
      return 0;
    }
    this.stopped = true;
    let changed = 0;

    for (const delivery of this.deliveries.values()) {
      if (
        delivery.status === "queued" ||
        delivery.status === "scheduled" ||
        delivery.status === "sending"
      ) {
        this.replaceDelivery(delivery.id, {
          status: "abandoned",
          scheduledAt: undefined,
          reason: "the session stopped",
        });
        this.activeControllers.get(delivery.id)?.abort();
        changed += 1;
      }
    }

    return changed;
  }

  private async runDue(): Promise<readonly WebhookDelivery[]> {
    const now = this.clock.now();
    const due = [...this.deliveries.values()]
      .filter(
        (delivery) =>
          (delivery.status === "queued" || delivery.status === "scheduled") &&
          (delivery.scheduledAt as number) <= now,
      )
      .sort(compareDue);
    const processed: WebhookDelivery[] = [];

    for (const delivery of due) {
      if (this.stopped) {
        break;
      }
      const current = this.deliveries.get(delivery.id) as WebhookDelivery;
      if (current.status !== "queued" && current.status !== "scheduled") {
        continue;
      }
      await this.attemptDelivery(delivery.id);
      const after = this.deliveries.get(delivery.id) as WebhookDelivery;
      processed.push(this.cloneDelivery(after));
    }

    return processed;
  }

  private async attemptDelivery(deliveryId: string): Promise<void> {
    const delivery = this.deliveries.get(deliveryId) as WebhookDelivery;

    const twin = this.requireTwin(delivery.twinId);
    const url = this.currentUrl(twin);
    if (url === undefined) {
      this.replaceDelivery(deliveryId, {
        status: "not-sent",
        scheduledAt: undefined,
        reason: "no webhook URL set",
      });
      return;
    }

    const attemptNumber = delivery.attempts.length + 1;
    const startedAt = this.clock.now();
    this.replaceDelivery(deliveryId, { status: "sending" });
    this.activeControllers.set(deliveryId, new AbortController());

    let result: HttpResult;
    try {
      result = await this.sendAttempt(
        twin,
        delivery,
        url,
        attemptNumber,
        this.activeControllers.get(deliveryId)?.signal,
      );
    } catch (error) {
      result = {
        outcome: "unreachable",
        status: undefined,
        headers: {},
        body: "",
        error: errorMessage(error),
        errorCode: errorCodeOf(error),
        remoteAddress: undefined,
      };
    } finally {
      this.activeControllers.delete(deliveryId);
    }

    const attempt: WebhookAttempt = Object.freeze({
      attempt: attemptNumber,
      startedAt,
      finishedAt: this.clock.now(),
      outcome: result.outcome,
      requestUrl: url,
      remoteAddress: result.remoteAddress,
      responseStatus: result.status,
      responseHeaders: Object.freeze({ ...result.headers }),
      responseBody: result.body,
      error: result.error,
      errorCode: result.errorCode,
    });
    const current = this.deliveries.get(deliveryId) as WebhookDelivery;
    const attempts = Object.freeze([...current.attempts, attempt]);
    if (current.status === "abandoned") {
      this.replaceDelivery(deliveryId, { attempts });
      return;
    }

    if (result.outcome === "delivered") {
      this.replaceDelivery(deliveryId, {
        status: "delivered",
        attempts,
        scheduledAt: undefined,
      });
      return;
    }

    const retryDelay = this.retryDelay(twin.retry, attemptNumber);
    if (retryDelay !== undefined) {
      this.replaceDelivery(deliveryId, {
        status: "scheduled",
        attempts,
        scheduledAt: attempt.finishedAt + retryDelay,
      });
      return;
    }

    this.replaceDelivery(deliveryId, {
      status: result.outcome,
      attempts,
      scheduledAt: undefined,
    });
  }

  private async sendAttempt(
    twin: WebhookTwin,
    delivery: WebhookDelivery,
    rawUrl: string,
    attemptNumber: number,
    signal: AbortSignal | undefined,
  ): Promise<HttpResult> {
    const resolved = await resolveAllowedWebhookUrl(rawUrl, this.addressPolicy, this.dnsResolver);
    const address = resolved.addresses[0] as DnsAddress;

    const signOptions =
      delivery.failureMethod === undefined
        ? { attempt: attemptNumber }
        : { attempt: attemptNumber, failureMethod: delivery.failureMethod };
    const signedHeaders = twin.signer.sign(delivery.raw, twin.credentials(), signOptions);

    return sendHttpRequest({
      clock: this.clock,
      url: resolved.url,
      address,
      raw: delivery.raw,
      headers: signedHeaders,
      signal,
    });
  }

  private retryDelay(schedule: RetrySchedule, attemptNumber: number): number | undefined {
    const delays =
      schedule.source === "assumed"
        ? C7_FALLBACK_RETRY_SCHEDULE.delaysSeconds
        : schedule.delaysSeconds;
    const seconds = delays[attemptNumber - 1];
    if (seconds === undefined) {
      return undefined;
    }

    const base = seconds * 1_000;
    return schedule.source === "assumed" ? Math.round(base * (1 + this.random.next() * 0.1)) : base;
  }

  private currentUrl(twin: WebhookTwin): string | undefined {
    const url = twin.webhookUrl();
    return url === undefined || url.trim() === "" ? undefined : url;
  }

  private requireTwin(twinId: string): WebhookTwin {
    if (Object.hasOwn(this.twins, twinId)) {
      return this.twins[twinId] as WebhookTwin;
    }
    throw new IbejiError("UNKNOWN_TWIN", {
      why: `"${twinId}" is not a twin the webhook dispatcher knows about.`,
    });
  }

  private assertRunning(): void {
    if (this.stopped) {
      throw new IbejiError("SESSION_NOT_RUNNING", {
        what: "The webhook dispatcher has already stopped.",
        why: "A stopped session cannot create or resend webhook deliveries.",
        fix: "Start a new Ibeji session before sending webhooks.",
      });
    }
  }

  private createDelivery(input: {
    readonly eventId: string;
    readonly twinId: string;
    readonly actionId: string;
    readonly raw: RawWebhook;
    readonly status: WebhookDeliveryStatus;
    readonly reason: string | undefined;
    readonly now: number;
    readonly url: string | undefined;
    readonly scheduledAt: number | undefined;
    readonly holdUntil: number | undefined;
    readonly failureMethod: VerificationFailureMethod | undefined;
    readonly resendOf: string | undefined;
  }): WebhookDelivery {
    const delivery: WebhookDelivery = Object.freeze({
      id: `delivery-${this.nextDeliveryNumber}`,
      eventId: input.eventId,
      twinId: input.twinId,
      actionId: input.actionId,
      raw: Object.freeze({ ...input.raw }),
      status: input.status,
      attempts: Object.freeze([]),
      createdAt: input.now,
      scheduledAt: input.scheduledAt,
      holdUntil: input.holdUntil,
      failureMethod: input.failureMethod,
      resendOf: input.resendOf,
      reason: input.reason,
      url: input.url,
      sequence: this.nextSequence,
    });
    this.nextDeliveryNumber += 1;
    this.nextSequence += 1;
    this.deliveries.set(delivery.id, delivery);
    return this.cloneDelivery(delivery);
  }

  private replaceDelivery(
    deliveryId: string,
    patch: Partial<Pick<WebhookDelivery, "status" | "attempts" | "scheduledAt" | "reason">>,
  ): void {
    const current = this.deliveries.get(deliveryId) as WebhookDelivery;
    this.deliveries.set(
      deliveryId,
      Object.freeze({
        ...current,
        ...patch,
      }),
    );
  }

  private cloneDelivery(delivery: WebhookDelivery): WebhookDelivery {
    return Object.freeze({
      ...delivery,
      raw: Object.freeze({ ...delivery.raw }),
      attempts: Object.freeze([...delivery.attempts]),
    });
  }
}

function compareDue(left: WebhookDelivery, right: WebhookDelivery): number {
  const leftAt = left.scheduledAt as number;
  const rightAt = right.scheduledAt as number;
  if (leftAt !== rightAt) {
    return leftAt - rightAt;
  }
  if (
    left.holdUntil !== undefined &&
    right.holdUntil !== undefined &&
    left.holdUntil === right.holdUntil
  ) {
    return right.sequence - left.sequence;
  }
  return left.sequence - right.sequence;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCodeOf(error: unknown): string | undefined {
  return isIbejiError(error) ? error.code : undefined;
}

function isSensitiveResponseHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("authorization") ||
    lower.includes("signature") ||
    lower === "verif-hash" ||
    lower === "proxy-authorization"
  );
}

export function sanitiseResponseHeaders(headers: IncomingHttpHeaders): WebhookHeaders {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || isSensitiveResponseHeader(name)) {
      continue;
    }
    result[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return Object.freeze(result);
}

export function webhookPort(url: URL): number {
  if (url.port !== "") {
    return Number(url.port);
  }
  return url.protocol === "https:" ? 443 : 80;
}

type SendHttpOptions = {
  readonly clock: Clock;
  readonly url: URL;
  readonly address: DnsAddress;
  readonly raw: RawWebhook;
  readonly headers: WebhookHeaders;
  readonly signal: AbortSignal | undefined;
};

function sendHttpRequest(options: SendHttpOptions): Promise<HttpResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    let request: ReturnType<typeof httpRequest> | undefined;
    const isHttps = options.url.protocol === "https:";
    const hostname = dnsHostname(options.url);

    const finish = (result: HttpResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.clock.clearTimeout(timer);
      resolve(result);
    };

    timer = options.clock.setTimeout(() => {
      request?.destroy();
      finish({
        outcome: "unreachable",
        status: undefined,
        headers: {},
        body: "",
        error: "The webhook receiver did not answer within 10 seconds.",
        errorCode: undefined,
        remoteAddress: options.address.address,
      });
    }, WEBHOOK_TIMEOUT_MS);

    const headers = {
      ...options.headers,
      Host: options.url.host,
      "Content-Type": options.raw.contentType,
      "Content-Length": String(Buffer.byteLength(options.raw.body)),
    };
    const httpOptions: HttpsRequestOptions = {
      method: "POST",
      hostname: options.address.address,
      family: options.address.family,
      port: webhookPort(options.url),
      path: `${options.url.pathname}${options.url.search}`,
      headers,
      agent: false,
      signal: options.signal,
    };
    if (isHttps && isIP(hostname) === 0) {
      httpOptions.servername = hostname;
    }

    const requestFunction = isHttps ? httpsRequest : httpRequest;
    try {
      request = requestFunction(httpOptions as HttpRequestOptions, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;

        response.on("data", (chunk: Buffer) => {
          if (bytes >= MAX_RESPONSE_BYTES) {
            return;
          }
          const remaining = MAX_RESPONSE_BYTES - bytes;
          const part = chunk.subarray(0, remaining);
          chunks.push(part);
          bytes += part.length;
        });

        response.on("end", () => {
          const status = response.statusCode as number;
          finish({
            outcome: status >= 200 && status < 300 ? "delivered" : "failed",
            status,
            headers: sanitiseResponseHeaders(response.headers),
            body: Buffer.concat(chunks).toString("utf8"),
            error: undefined,
            errorCode: undefined,
            remoteAddress: options.address.address,
          });
        });
      });
    } catch (error) {
      finish({
        outcome: "unreachable",
        status: undefined,
        headers: {},
        body: "",
        error: errorMessage(error),
        errorCode: errorCodeOf(error),
        remoteAddress: options.address.address,
      });
      return;
    }

    request.on("error", (error: Error) => {
      finish({
        outcome: "unreachable",
        status: undefined,
        headers: {},
        body: "",
        error: error.message,
        errorCode: undefined,
        remoteAddress: options.address.address,
      });
    });

    request.end(options.raw.body);
  });
}
