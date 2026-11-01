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

function recipientNameFrom(data: JsonValue): string | undefined {
  if (!isRecord(data) || !isRecord(data.recipient)) {
    return undefined;
  }
  return typeof data.recipient.name === "string" ? data.recipient.name : undefined;
}

function statusLabel(status: string): string {
  switch (status) {
    case "success":
      return "succeeded";
    case "reversed":
      return "was reversed";
    case "needs-attention":
      return "needs attention";
    default:
      return status.replaceAll("-", " ");
  }
}

function summarize(draft: TwinWebhookDraft): string {
  const amount = amountFrom(draft.data);
  const formatted =
    amount === undefined
      ? undefined
      : paystackMoney.formatDisplay(amount, currencyFrom(draft.data));

  if (draft.key.startsWith("refund.")) {
    const status = statusLabel(draft.key.slice("refund.".length));
    return formatted === undefined
      ? `Paystack refund ${status} for ${draft.resourceId}`
      : `Paystack refund ${status} for ${formatted}`;
  }

  if (draft.key.startsWith("transfer.")) {
    const status = statusLabel(draft.key.slice("transfer.".length));
    const recipientName = recipientNameFrom(draft.data);
    if (formatted === undefined) {
      return `Paystack transfer ${status} for ${draft.resourceId}`;
    }
    return recipientName === undefined
      ? `Paystack transfer ${status} for ${formatted}`
      : `Paystack transfer ${status} for ${formatted} to ${recipientName}`;
  }

  return formatted === undefined
    ? `Paystack charge succeeded for ${draft.resourceId}`
    : `Paystack charge succeeded for ${formatted}`;
}

const EVENT_NAMES: Readonly<Record<string, string>> = {
  "charge.success": "charge.success",
  "refund.pending": "refund.pending",
  "refund.processing": "refund.processing",
  "refund.needs-attention": "refund.needs-attention",
  "refund.failed": "refund.failed",
  "refund.processed": "refund.processed",
  "transfer.success": "transfer.success",
  "transfer.failed": "transfer.failed",
  "transfer.reversed": "transfer.reversed",
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
    {
      key: "transfer.success",
      wireName: "transfer.success",
      objectType: "transfer",
      actions: ["transfer.create"],
    },
    {
      key: "transfer.failed",
      wireName: "transfer.failed",
      objectType: "transfer",
      actions: ["transfer.create"],
    },
    {
      key: "transfer.reversed",
      wireName: "transfer.reversed",
      objectType: "transfer",
      actions: ["transfer.create"],
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
