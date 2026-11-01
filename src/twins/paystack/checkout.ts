import type {
  CheckoutAdapter,
  CheckoutPageContext,
  CheckoutPageModel,
  CheckoutSubmitContext,
  JsonValue,
  TwinWebhookDraft,
} from "../framework/types.js";
import type { PaystackTransaction } from "./state.js";
import {
  applyCheckoutOutcome,
  buildChargeSuccessData,
  placeholderTransaction,
  readTransaction,
} from "./transactions.js";

const OUTCOMES = [
  {
    id: "success",
    label: "Pay successfully",
    description: "The Paystack transaction becomes successful.",
  },
  {
    id: "declined",
    label: "Decline payment",
    description: "The Paystack transaction becomes failed, like a declined card.",
  },
  {
    id: "abandoned",
    label: "Abandon",
    description: "The Paystack transaction becomes abandoned.",
  },
] as const;

function recordFor(context: CheckoutPageContext): PaystackTransaction {
  return (
    readTransaction(context.state, context.recordId) ??
    placeholderTransaction(context.recordId, context.clock)
  );
}

function page(context: CheckoutPageContext): CheckoutPageModel {
  const record = recordFor(context);
  return {
    twinDisplayName: "Paystack",
    amountMinor: record.amount,
    currency: record.currency,
    ...(record.email.length === 0 ? {} : { customerEmail: record.email }),
    reference: record.reference,
    outcomes: OUTCOMES,
  };
}

function redirectUrl(callbackUrl: string | null, reference: string): string | undefined {
  if (callbackUrl === null) {
    return undefined;
  }
  const url = new URL(callbackUrl);
  url.searchParams.set("reference", reference);
  return url.toString();
}

function successDraft(record: PaystackTransaction, occurredAt: number): TwinWebhookDraft {
  return {
    key: "charge.success",
    actionId: "checkout.submit",
    resourceId: record.reference,
    occurredAt,
    data: buildChargeSuccessData(record) as unknown as JsonValue,
  };
}

async function submit(
  context: CheckoutSubmitContext,
  outcomeId: string,
  _authenticationChoice?: "approve" | "fail",
) {
  const existing = readTransaction(context.state, context.recordId);
  const record = existing ?? placeholderTransaction(context.recordId, context.clock);
  const chosen =
    context.failures.declined === true
      ? "declined"
      : outcomeId === "declined" || outcomeId === "abandoned"
        ? outcomeId
        : "success";
  const updated = applyCheckoutOutcome(record, chosen, context.clock);

  if (existing === undefined) {
    context.state.insert("transactions", updated);
  } else {
    context.state.update("transactions", updated.reference, updated);
  }

  const webhooks = chosen === "success" ? [successDraft(updated, context.clock.now())] : [];
  const notice =
    chosen === "success"
      ? "Paystack payment succeeded. No real money moved."
      : chosen === "declined"
        ? "Paystack payment declined. No real money moved."
        : "Paystack payment abandoned. No real money moved.";

  const redirect = redirectUrl(updated.callbackUrl, updated.reference);
  return {
    notice,
    webhooks,
    ...(redirect === undefined ? {} : { redirectUrl: redirect }),
  };
}

export const paystackCheckout: CheckoutAdapter = {
  outcomes: OUTCOMES,
  page,
  submit,
};
