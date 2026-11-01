import { timingSafeEqual } from "node:crypto";
import type { RawWebhook, WebhookHeaders, WebhookSignOptions } from "../../core/webhooks/types.js";
import type {
  JsonValue,
  TwinCredentials,
  TwinWebhookDraft,
  WebhookAdapter,
} from "../framework/types.js";
import { flutterwaveMoney } from "./money.js";
import { isRecord } from "./payments.js";

export const FLUTTERWAVE_VERIFICATION_HEADER = "verif-hash";

function secretOf(credentials: TwinCredentials): string {
  return credentials.webhook ?? "";
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sign(
  _raw: RawWebhook,
  credentials: TwinCredentials,
  options: WebhookSignOptions,
): WebhookHeaders {
  switch (options.failureMethod) {
    case "wrong-secret":
      return { [FLUTTERWAVE_VERIFICATION_HEADER]: "ibeji-wrong-secret" };
    case "corrupted":
      return { [FLUTTERWAVE_VERIFICATION_HEADER]: "ibeji-corrupted-secret" };
    case "missing":
      return {};
    default:
      return { [FLUTTERWAVE_VERIFICATION_HEADER]: secretOf(credentials) };
  }
}

/**
 * v3 verification is a shared-secret comparison, not an HMAC over the body.
 * The canonical-body check is an Ibeji guard required by the shared
 * conformance suite's tampered-body check; it is not a Flutterwave signature.
 */
function verify(raw: RawWebhook, headers: WebhookHeaders, credentials: TwinCredentials): boolean {
  const actual = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === FLUTTERWAVE_VERIFICATION_HEADER,
  )?.[1];
  const expected = secretOf(credentials);
  if (actual === undefined || expected.length === 0 || !sameSecret(actual, expected)) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(raw.body);
    return JSON.stringify(parsed) === raw.body;
  } catch {
    return false;
  }
}

function amountFrom(data: JsonValue): number | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const amount = data.AmountRefunded ?? data.amount;
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return amount;
  }
  if (typeof amount === "string" && /^\d+(?:\.\d+)?$/u.test(amount)) {
    return Number(amount);
  }
  return undefined;
}

function currencyFrom(data: JsonValue): string {
  return isRecord(data) && typeof data.currency === "string" ? data.currency : "NGN";
}

function summaryAmount(data: JsonValue): string | undefined {
  const amount = amountFrom(data);
  if (amount === undefined) {
    return undefined;
  }
  try {
    const currency = currencyFrom(data);
    const minor = flutterwaveMoney.parseServiceAmount(String(amount), currency);
    return flutterwaveMoney.formatDisplay(minor, currency);
  } catch {
    return undefined;
  }
}

function summarize(draft: TwinWebhookDraft): string {
  const data = draft.data;
  const status = isRecord(data) && typeof data.status === "string" ? data.status : "event";
  const formatted = summaryAmount(data);

  if (draft.key === "refund") {
    return formatted === undefined
      ? `Flutterwave refund ${status} for ${draft.resourceId}`
      : `Flutterwave refund ${status} for ${formatted}`;
  }

  return formatted === undefined
    ? `Flutterwave payment ${status} for ${draft.resourceId}`
    : `Flutterwave payment ${status} for ${formatted}`;
}

function build(draft: TwinWebhookDraft): RawWebhook {
  if (draft.key === "refund") {
    return {
      body: JSON.stringify(draft.data),
      contentType: "application/json",
    };
  }

  const failed = isRecord(draft.data) && draft.data.status === "failed";
  return {
    body: JSON.stringify({
      event: draft.key,
      ...(failed ? { "event.type": "CARD_TRANSACTION" } : {}),
      data: draft.data,
    }),
    contentType: "application/json",
  };
}

export const flutterwaveWebhooks: WebhookAdapter = {
  events: [
    {
      key: "charge.completed",
      wireName: "charge.completed",
      objectType: "transaction",
      actions: ["checkout.submit"],
    },
    {
      key: "refund",
      wireName: null,
      objectType: "refund",
      actions: ["refund.create"],
    },
  ],
  build,
  sign,
  verify,
  verificationFailures: ["wrong-secret", "corrupted", "missing"],
  summarize,
};
