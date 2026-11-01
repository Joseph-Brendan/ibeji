import type {
  ActionDefinition,
  CheckoutAdapter,
  CheckoutPageContext,
  CheckoutPageModel,
  CheckoutSubmitContext,
  JsonValue,
  TwinWebhookDraft,
} from "../framework/types.js";
import {
  applyCheckoutOutcome,
  chargeWebhookData,
  paymentRecord,
  placeholderPayment,
} from "./payments.js";
import { flutterwaveResponses } from "./responses.js";
import type { FlutterwavePayment } from "./state.js";

const OUTCOMES = [
  {
    id: "success",
    label: "Pay successfully",
    description: "The Flutterwave transaction becomes successful.",
  },
  {
    id: "failed",
    label: "Fail payment",
    description: "The Flutterwave transaction becomes failed.",
  },
  {
    id: "cancelled",
    label: "Cancel payment",
    description: "Cancelled is recorded as Flutterwave's failed result.",
  },
] as const;

function recordFor(context: CheckoutPageContext): FlutterwavePayment {
  return (
    paymentRecord(context.state, context.recordId) ??
    placeholderPayment(context.recordId, context.clock)
  );
}

function page(context: CheckoutPageContext): CheckoutPageModel {
  const record = recordFor(context);
  return {
    twinDisplayName: "Flutterwave",
    amountMinor: record.amount,
    currency: record.currency,
    ...(record.customerEmail.length === 0 ? {} : { customerEmail: record.customerEmail }),
    reference: record.txRef,
    outcomes: OUTCOMES,
  };
}

function redirectFor(record: FlutterwavePayment, successful: boolean): string | undefined {
  if (record.redirectUrl.length === 0) {
    return undefined;
  }
  try {
    const url = new URL(record.redirectUrl);
    url.searchParams.set("status", successful ? "successful" : "failed");
    url.searchParams.set("tx_ref", record.txRef);
    url.searchParams.set("transaction_id", String(record.transactionId));
    return url.toString();
  } catch {
    return undefined;
  }
}

function chargeDraft(record: FlutterwavePayment, occurredAt: number): TwinWebhookDraft {
  return {
    key: "charge.completed",
    actionId: "checkout.submit",
    resourceId: record.txRef,
    occurredAt,
    data: chargeWebhookData(record) as unknown as JsonValue,
  };
}

async function submit(
  context: CheckoutSubmitContext,
  outcomeId: string,
  _authenticationChoice?: "approve" | "fail",
) {
  const existing = paymentRecord(context.state, context.recordId);
  const record = existing ?? placeholderPayment(context.recordId, context.clock);
  const chosen =
    context.failures.declined === true || outcomeId === "failed" || outcomeId === "cancelled"
      ? "failed"
      : "success";
  const updated = applyCheckoutOutcome(record, chosen, context.clock);

  if (existing === undefined) {
    context.state.insert("payments", updated);
  } else {
    context.state.update("payments", updated.id, updated);
  }

  const notice =
    chosen === "success"
      ? "Flutterwave payment succeeded. No real money moved."
      : outcomeId === "cancelled"
        ? "Flutterwave payment cancelled and recorded as failed. No real money moved."
        : "Flutterwave payment failed. No real money moved.";
  const redirect = redirectFor(updated, chosen === "success");

  return {
    notice,
    webhooks: [chargeDraft(updated, context.clock.now())],
    ...(redirect === undefined ? {} : { redirectUrl: redirect }),
  };
}

export const flutterwaveCheckout: CheckoutAdapter = {
  outcomes: OUTCOMES,
  page,
  submit,
};

const checkoutHandler = () => flutterwaveResponses.notFound();

export const checkoutActions: readonly ActionDefinition[] = [
  {
    id: "checkout.open",
    method: "GET",
    path: "/checkout/:tx_ref",
    summary: "Open the Flutterwave test checkout page",
    kind: "checkout",
    handler: checkoutHandler,
  },
  {
    id: "checkout.submit",
    method: "POST",
    path: "/checkout/:tx_ref",
    summary: "Submit the Flutterwave test checkout page",
    kind: "checkout",
    handler: checkoutHandler,
  },
];
