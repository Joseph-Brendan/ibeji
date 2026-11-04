import { z } from "zod";

export const FAILURE_IDS = [
  "slow-response",
  "timeout-after-commit",
  "timeout-before-commit",
  "server-error",
  "rate-limited",
  "flaky-network",
  "webhook-delayed",
  "webhook-duplicated",
  "webhook-out-of-order",
  "webhook-never-sent",
  "webhook-verification-fails",
  "payment-declined",
  "authentication-required",
  "transfer-stuck-pending",
  "transfer-reversed",
  "bank-resolve-fails",
] as const;

export type FailureId = (typeof FAILURE_IDS)[number];

export type FailureDescription = {
  readonly realLife: string;
  readonly whatToCheck: string;
};

export type FailureDefinition = {
  readonly id: FailureId;
  readonly name: string;
  readonly description: FailureDescription;
  /**
   * The full settings schema, including the shared twins and actions settings.
   * The UI and MCP server use this schema and settingsJsonSchema.
   */
  readonly settingsSchema: z.ZodType<Record<string, unknown>>;
  /** The failure-specific part, without twins and actions. Rules use this. */
  readonly failureSettingsSchema: z.ZodType<Record<string, unknown>>;
  /** The same full schema in JSON Schema form, for the UI and MCP server. */
  readonly settingsJsonSchema: z.core.JSONSchema.BaseSchema;
};

export const actionSelectorSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const sharedRuleSettingsSchema = z.strictObject({
  twins: z.array(z.string().min(1)).min(1).optional(),
  actions: actionSelectorSchema.optional(),
});

const timesSchema = z.number().int().min(1).max(10_000).nullable().default(3);

function defineFailure(
  id: FailureId,
  name: string,
  description: FailureDescription,
  specific: z.ZodRawShape,
): FailureDefinition {
  const failureSettingsSchema = z.strictObject(specific);
  const settingsSchema = z.strictObject({
    ...specific,
    twins: z.array(z.string().min(1)).min(1).optional(),
    actions: actionSelectorSchema.optional(),
  });

  return {
    id,
    name,
    description,
    settingsSchema: settingsSchema as z.ZodType<Record<string, unknown>>,
    failureSettingsSchema: failureSettingsSchema as z.ZodType<Record<string, unknown>>,
    settingsJsonSchema: z.toJSONSchema(settingsSchema),
  };
}

const slowResponse = defineFailure(
  "slow-response",
  "Slow response",
  {
    realLife:
      "A customer taps Pay at a Lagos shop and the page keeps spinning. The payment service is working, but its answer is late. The customer taps again and wonders if the first payment went through. In another country, a shopper can leave when a page feels stuck.",
    whatToCheck:
      "Show a clear waiting state and stop double taps. Set a time limit for the answer and decide what your app does when that limit passes. Check the payment status before you try again.",
  },
  {
    seconds: z.number().int().min(1).max(120).default(5),
  },
);

const timeoutAfterCommit = defineFailure(
  "timeout-after-commit",
  "Success, but the reply is lost",
  {
    realLife:
      "Kola asks for a refund at his Lagos shop. The payment service records the refund, but the connection drops before the reply arrives. Kola's app sees an error even though the money is already on its way back. In an international shop, a lost reply can make a customer pay twice when the app retries.",
    whatToCheck:
      "Check the real status before you retry a request that may have succeeded. Use the service reference, or a key that marks a retry as the same request, where the service provides one. Make the retry safe so one refund or payment cannot happen twice.",
  },
  {
    mode: z.enum(["hang", "reset"]).default("hang"),
  },
);

const timeoutBeforeCommit = defineFailure(
  "timeout-before-commit",
  "Failure, and the reply is lost",
  {
    realLife:
      "Amina tries to pay for cloth in Abuja. The connection drops before the payment service receives the request. Her app shows an error, and no money has moved. In an international shop, the shopper may try again at once.",
    whatToCheck:
      "Treat a lost connection as unknown at first, then check the payment status. If no record exists, let the customer try again with the same reference. Do not show success until the service confirms it.",
  },
  {
    mode: z.enum(["hang", "reset"]).default("hang"),
  },
);

const serverError = defineFailure(
  "server-error",
  "Server error",
  {
    realLife:
      "Chidi runs a small delivery business in Port Harcourt. He tries to send a driver's payout and the payment service returns a server error. The payout did not start, but Chidi cannot tell that from the message alone. In an international shop, a server error can appear during a busy sale.",
    whatToCheck:
      "Retry only errors that are safe to retry, and wait longer between each try. Check the payout or payment status before sending again. Show a plain message and keep the order unpaid until the service confirms it.",
  },
  {
    times: timesSchema,
    status: z.number().int().min(500).max(599).default(500),
  },
);

const rateLimited = defineFailure(
  "rate-limited",
  "Too many requests",
  {
    realLife:
      "Ngozi's food shop in Enugu checks many orders during a lunch rush. The payment service says the shop is sending too many requests. New orders start to fail even though the customers' cards are fine. In an international shop, a busy sale can hit the same limit.",
    whatToCheck:
      "Slow down and wait before trying again. Read the reset time when the service sends one. Queue work so a burst of users does not become a burst of requests.",
  },
  {
    times: timesSchema,
  },
);

const flakyNetwork = defineFailure(
  "flaky-network",
  "Unreliable network",
  {
    realLife:
      "A rider in Lagos uses a phone with a weak signal. Some requests reach the payment service and some do not. A request may even reach the service after the phone gives up. In an international shop, a train tunnel or a weak hotel connection can do the same.",
    whatToCheck:
      "Use a safe retry with the same reference each time. Check the status before you retry a request that may have arrived. Make each action safe to repeat.",
  },
  {
    percent: z.number().int().min(1).max(100).default(20),
    when: z.enum(["before", "after"]).default("before"),
  },
);

const webhookDelayed = defineFailure(
  "webhook-delayed",
  "Late webhook",
  {
    realLife:
      "Tunde's textile shop in Kano gets an order webhook three minutes late. A webhook is an automatic message from the payment service to the shop's app. The customer has paid, but the order list still shows unpaid. Tunde's staff may ask the customer to pay again. In an international shop, a late webhook can delay a download or a booking.",
    whatToCheck:
      "Do not treat a missing webhook as a failed payment. Check the payment status when the customer returns or after a short wait. Make webhook handling safe when the same event arrives later.",
  },
  {
    seconds: z.number().int().min(1).max(3_600).default(60),
    jitterSeconds: z.number().int().min(0).max(3_600).default(0),
  },
);

const webhookDuplicated = defineFailure(
  "webhook-duplicated",
  "Duplicate webhook",
  {
    realLife:
      "Bisi's beauty shop in Ibadan receives the same order webhook twice. The shop's app creates two orders for one payment. The customer gets two confirmation emails. In an international shop, a duplicate webhook can send a download link twice or add a second booking.",
    whatToCheck:
      "Store the event id and ignore an event you have already handled. Make each webhook handler safe to run more than once. Use the payment reference to link records to one payment.",
  },
  {
    copies: z.number().int().min(2).max(5).default(2),
    gapSeconds: z.number().int().min(0).max(300).default(5),
  },
);

const webhookOutOfOrder = defineFailure(
  "webhook-out-of-order",
  "Webhooks in the wrong order",
  {
    realLife:
      "Amina's fashion shop in Abuja gets a delivery webhook before the payment webhook. The app marks the order paid and then sees an older status that says unpaid. The order can end in the wrong state. In an international shop, a refund event can arrive before the payment event.",
    whatToCheck:
      "Do not let an older event overwrite a newer state. Keep the event time or a sequence and apply events in order. Check the current payment status when the order looks inconsistent.",
  },
  {
    windowSeconds: z.number().int().min(1).max(300).default(15),
  },
);

const webhookNeverSent = defineFailure(
  "webhook-never-sent",
  "Missing webhook",
  {
    realLife:
      "Chidi's delivery business in Port Harcourt waits for a payout webhook that never comes. The transfer succeeded, but the app never updates the driver's record. Staff spend the afternoon checking the dashboard by hand. In an international shop, a missing webhook can leave an order stuck as unpaid.",
    whatToCheck:
      "Do not depend on a webhook as the only source of truth. Check payment and payout status on a schedule or when the user returns. Show a state that says the app is still checking.",
  },
  {
    percent: z.number().int().min(1).max(100).default(100),
  },
);

const webhookVerificationFails = defineFailure(
  "webhook-verification-fails",
  "Forged webhook",
  {
    realLife:
      "A forged webhook reaches Ngozi's food shop in Enugu. It looks like a payment success, but the signature does not match. A signature is a code that proves a message came from the service. If the app trusts the message, an attacker can mark an unpaid order as paid. In an international shop, the same trick can unlock a download for free.",
    whatToCheck:
      "Verify every webhook with the service's documented method before you trust it. Reject a missing or wrong signature and record the rejection. Never use the webhook body as proof of payment without that check.",
  },
  {
    method: z.string().min(1).default("wrong-secret"),
  },
);

const paymentDeclined = defineFailure(
  "payment-declined",
  "Declined payment",
  {
    realLife:
      "A customer tries to pay Bisi's beauty shop in Ibadan with a card that the bank declines. The payment fails, but the customer wants to try another card. Bisi's app must not mark the order paid. In an international shop, a declined card can be a bank block or a wrong card detail.",
    whatToCheck:
      "Show a plain message that the payment failed, without saying the customer has no money. Keep the order unpaid and allow a safe retry. Do not create a second order for the same basket.",
  },
  {
    percent: z.number().int().min(1).max(100).default(100),
  },
);

const authenticationRequired = defineFailure(
  "authentication-required",
  "Extra check needed",
  {
    realLife:
      "A shopper in London pays with a card that needs an extra bank check. The bank asks the shopper to approve the payment in a banking app. The payment stays pending until that check finishes. If the shopper closes the page, the order may stay unpaid.",
    whatToCheck:
      "Send the customer to the extra check and bring them back to a clear result page. Do not mark the order paid while the check is pending. Check the final status before you fulfil the order.",
  },
  {
    // biome-ignore lint/suspicious/noThenProperty: C5 names this setting "then".
    then: z.enum(["succeed", "fail"]).default("fail"),
  },
);

const transferStuckPending = defineFailure(
  "transfer-stuck-pending",
  "Stuck transfer",
  {
    realLife:
      "Tunde's textile shop in Kano pays a supplier by bank transfer. The transfer stays pending for ten minutes because the bank is slow. Pending means the payout has not finished yet. The supplier calls to ask where the money is. In another case, a transfer can stay pending for hours.",
    whatToCheck:
      "Show pending as its own state, not as success or failure. Check the transfer status before you send it again. Tell the supplier that the bank is still processing the payout.",
  },
  {
    seconds: z.number().int().min(1).max(86_400).nullable().default(null),
    thenFailPercent: z.number().int().min(0).max(100).default(0),
  },
);

const transferReversed = defineFailure(
  "transfer-reversed",
  "Reversed transfer",
  {
    realLife:
      "Chidi's delivery business in Port Harcourt pays a driver. The bank later returns the money because the account could not take the transfer. The transfer first looked successful, then became reversed. The app must update the driver's record and tell staff.",
    whatToCheck:
      "Listen for the reversal webhook as well as the first success. Keep the transfer id so you can match the reversal to the right payout. Do not pay the driver again by hand until you check the final status.",
  },
  {
    afterSeconds: z.number().int().min(1).max(86_400).default(60),
    percent: z.number().int().min(1).max(100).default(100),
  },
);

const bankResolveFails = defineFailure(
  "bank-resolve-fails",
  "Account lookup fails",
  {
    realLife:
      "Amina's fashion shop in Abuja checks a customer's account name before a refund. The bank lookup fails or takes too long. The shop cannot confirm the account, so the refund must wait. In another case, a wrong account number gives the same kind of error.",
    whatToCheck:
      "Show the lookup failure as a separate step, not as a failed refund. Let the customer check the account number and try again. Do not send money to an account you could not confirm.",
  },
  {
    mode: z.enum(["error", "timeout"]).default("error"),
  },
);

export const FAILURE_BY_ID: Readonly<Record<FailureId, FailureDefinition>> = {
  "slow-response": slowResponse,
  "timeout-after-commit": timeoutAfterCommit,
  "timeout-before-commit": timeoutBeforeCommit,
  "server-error": serverError,
  "rate-limited": rateLimited,
  "flaky-network": flakyNetwork,
  "webhook-delayed": webhookDelayed,
  "webhook-duplicated": webhookDuplicated,
  "webhook-out-of-order": webhookOutOfOrder,
  "webhook-never-sent": webhookNeverSent,
  "webhook-verification-fails": webhookVerificationFails,
  "payment-declined": paymentDeclined,
  "authentication-required": authenticationRequired,
  "transfer-stuck-pending": transferStuckPending,
  "transfer-reversed": transferReversed,
  "bank-resolve-fails": bankResolveFails,
};

export const FAILURE_CATALOG: readonly FailureDefinition[] = FAILURE_IDS.map(
  (id) => FAILURE_BY_ID[id],
);

export const FAILURE_SETTINGS_JSON_SCHEMAS: Readonly<
  Record<FailureId, z.core.JSONSchema.BaseSchema>
> = Object.fromEntries(
  FAILURE_IDS.map((id) => [id, FAILURE_BY_ID[id].settingsJsonSchema]),
) as Record<FailureId, z.core.JSONSchema.BaseSchema>;

export function getFailure(id: string): FailureDefinition | undefined {
  if (Object.hasOwn(FAILURE_BY_ID, id)) {
    return FAILURE_BY_ID[id as FailureId];
  }
  return undefined;
}
