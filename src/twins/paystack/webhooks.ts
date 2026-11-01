import { createHmac, timingSafeEqual } from "node:crypto";
import type { RawWebhook, WebhookHeaders, WebhookSignOptions } from "../../core/webhooks/types.js";
import type {
  JsonValue,
  TwinCredentials,
  TwinWebhookDraft,
  WebhookAdapter,
} from "../framework/types.js";
import { paystackMoney } from "./money.js";
import { isRecord } from "./transactions.js";

export const PAYSTACK_SIGNATURE_HEADER = "x-paystack-signature";

function secretOf(credentials: TwinCredentials): string {
  return credentials.secret ?? "";
}

function signatureOf(body: string, secret: string): string {
  return createHmac("sha512", secret).update(body, "utf8").digest("hex");
}

function corrupted(signature: string): string {
  const first = signature[0] === "0" ? "1" : "0";
  return `${first}${signature.slice(1)}`;
}

function sign(
  raw: RawWebhook,
  credentials: TwinCredentials,
  options: WebhookSignOptions,
): WebhookHeaders {
  const signature = signatureOf(raw.body, secretOf(credentials));
  switch (options.failureMethod) {
    case "wrong-secret":
      return { [PAYSTACK_SIGNATURE_HEADER]: signatureOf(raw.body, "ibeji-wrong-secret") };
    case "corrupted":
      return { [PAYSTACK_SIGNATURE_HEADER]: corrupted(signature) };
    case "missing":
      return {};
    case "stale-timestamp":
      return { [PAYSTACK_SIGNATURE_HEADER]: signature };
    default:
      return { [PAYSTACK_SIGNATURE_HEADER]: signature };
  }
}

function verify(raw: RawWebhook, headers: WebhookHeaders, credentials: TwinCredentials): boolean {
  const actual = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === PAYSTACK_SIGNATURE_HEADER,
  )?.[1];
  if (actual === undefined || !/^[0-9a-f]+$/iu.test(actual)) {
    return false;
  }
  const expected = signatureOf(raw.body, secretOf(credentials));
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function amountFrom(data: JsonValue): number | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const amount = data.amount;
  if (typeof amount === "number" && Number.isSafeInteger(amount)) {
    return amount;
  }
  if (typeof amount === "string" && /^\d+$/u.test(amount)) {
    const parsed = Number(amount);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function currencyFrom(data: JsonValue): string {
  return isRecord(data) && typeof data.currency === "string" ? data.currency : "NGN";
}

function summarize(draft: TwinWebhookDraft): string {
  const amount = amountFrom(draft.data);
  if (draft.key.startsWith("refund.")) {
    const status = draft.key.slice("refund.".length);
    if (amount === undefined) {
      return `Paystack refund ${status} for ${draft.resourceId}`;
    }
    return `Paystack refund ${status} for ${paystackMoney.formatDisplay(amount, currencyFrom(draft.data))}`;
  }
  if (amount === undefined) {
    return `Paystack charge succeeded for ${draft.resourceId}`;
  }
  return `Paystack charge succeeded for ${paystackMoney.formatDisplay(amount, currencyFrom(draft.data))}`;
}

const EVENT_NAMES: Readonly<Record<string, string>> = {
  "charge.success": "charge.success",
  "refund.pending": "refund.pending",
  "refund.processing": "refund.processing",
  "refund.needs-attention": "refund.needs-attention",
  "refund.failed": "refund.failed",
  "refund.processed": "refund.processed",
};

export const paystackWebhooks: WebhookAdapter = {
  events: [
    {
      key: "charge.success",
      wireName: "charge.success",
      objectType: "transaction",
      actions: ["transaction.initialize", "checkout.submit"],
    },
    {
      key: "refund.pending",
      wireName: "refund.pending",
      objectType: "refund",
      actions: ["refund.create"],
    },
    {
      key: "refund.processing",
      wireName: "refund.processing",
      objectType: "refund",
      actions: ["refund.create"],
    },
    {
      key: "refund.needs-attention",
      wireName: "refund.needs-attention",
      objectType: "refund",
      actions: ["refund.create"],
    },
    {
      key: "refund.failed",
      wireName: "refund.failed",
      objectType: "refund",
      actions: ["refund.create"],
    },
    {
      key: "refund.processed",
      wireName: "refund.processed",
      objectType: "refund",
      actions: ["refund.create"],
    },
  ],
  build: (draft) => ({
    body: JSON.stringify({
      event: EVENT_NAMES[draft.key] ?? draft.key,
      data: draft.data,
    }),
    contentType: "application/json",
  }),
  sign,
  verify,
  verificationFailures: ["wrong-secret", "corrupted", "missing"],
  summarize,
};
