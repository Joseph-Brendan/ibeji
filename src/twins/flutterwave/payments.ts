import type {
  ActionContext,
  ActionDefinition,
  TwinRequest,
  TwinStateStore,
} from "../framework/types.js";
import { flutterwaveMoney } from "./money.js";
import {
  duplicatePaymentReferenceResponse,
  flutterwaveResponses,
  invalidBodyResponse,
  invalidPaymentAmountResponse,
  paymentNotFoundResponse,
  paymentValidationError,
} from "./responses.js";
import type { FlutterwavePayment } from "./state.js";
import { flutterwavePaymentSchema } from "./state.js";

const PAYMENTS = "payments";
const ACCOUNT_ID = 1_967_796;
const DEVICE_FINGERPRINT = "7a63c4da5c10656da8c526933c01f095019fe7a271d7c838403dba041102f0b6";
const IP_ADDRESS = "203.0.113.1";
const FAILED_PROCESSOR_RESPONSE =
  "Do Not Honour: We're sorry, we cannot charge your card due to bank restrictions. Please contact your bank or financial institution.";

let nextTransactionId = 10_579_745;
let nextCustomerId = 3_655_183;

function nextPaymentId(): number {
  const id = nextTransactionId;
  nextTransactionId += 1;
  return id;
}

function nextCustomerNumber(): number {
  const id = nextCustomerId;
  nextCustomerId += 1;
  return id;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonObject(rawBody: Uint8Array): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(rawBody));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the amount as it was written in the request JSON. JSON.parse turns a
 * decimal number into a binary floating-point value; the money rule must read
 * the decimal text instead. A string amount is also accepted.
 */
export function readRawAmountText(rawBody: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(rawBody);
  const match = /"amount"\s*:\s*(?:"([^"]*)"|(-?\d+(?:\.\d+)?))/u.exec(text);
  return match?.[1] ?? match?.[2];
}

function amountTextOf(body: Record<string, unknown>, rawBody: Uint8Array): string | undefined {
  const raw = readRawAmountText(rawBody);
  if (raw !== undefined) {
    return raw;
  }
  if (typeof body.amount === "string" && body.amount.trim().length > 0) {
    return body.amount;
  }
  if (typeof body.amount === "number" && Number.isSafeInteger(body.amount)) {
    return String(body.amount);
  }
  return undefined;
}

function readCurrency(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toUpperCase() : "NGN";
}

export function isoTimestamp(clock: { readonly now: () => number }): string {
  return new Date(clock.now()).toISOString();
}

export function twinOrigin(request: TwinRequest): string {
  const host = (request.headers.host ?? "127.0.0.1")
    .toLowerCase()
    .replace(/\.(?=:|$)/gu, "")
    .replace(/^localhost:/u, "127.0.0.1:");
  return `http://${host}`;
}

/** Convert stored smallest units to the main-unit number Flutterwave returns. */
export function majorFromMinor(amount: number): number {
  const whole = Math.trunc(amount / 100);
  const fraction = amount % 100;
  return whole + fraction / 100;
}

function validRedirectUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function paymentRecord(
  state: TwinStateStore,
  txRef: string,
): FlutterwavePayment | undefined {
  return state.read(PAYMENTS, txRef, flutterwavePaymentSchema);
}

export function listStoredPayments(state: TwinStateStore): readonly FlutterwavePayment[] {
  return state.list(PAYMENTS, flutterwavePaymentSchema);
}

function cardFor(payment: FlutterwavePayment): Record<string, unknown> {
  const card: Record<string, unknown> = {
    first_6digits: payment.cardFirst6,
    last_4digits: payment.cardLast4,
    issuer: payment.cardIssuer,
    country: payment.cardCountry,
    type: payment.cardType,
    expiry: payment.cardExpiry,
  };
  if (payment.status === "successful" && payment.cardToken !== null) {
    card.token = payment.cardToken;
  }
  return card;
}

export function transactionData(payment: FlutterwavePayment): Record<string, unknown> {
  const successful = payment.status === "successful";
  return {
    id: payment.transactionId,
    tx_ref: payment.txRef,
    flw_ref: payment.flwRef ?? "N/A",
    device_fingerprint: payment.deviceFingerprint,
    amount: majorFromMinor(payment.amount),
    currency: payment.currency,
    charged_amount: majorFromMinor(payment.amount),
    app_fee: majorFromMinor(payment.appFee),
    merchant_fee: 0,
    processor_response: successful ? "successful" : FAILED_PROCESSOR_RESPONSE,
    auth_model: successful ? "PIN" : "AVS_VBVSECURECODE",
    ip: IP_ADDRESS,
    narration: "CARD Transaction ",
    status: payment.status,
    payment_type: "card",
    created_at: payment.paidAt ?? payment.createdAt,
    account_id: ACCOUNT_ID,
    card: cardFor(payment),
    meta: {
      __CheckoutInitAddress: payment.checkoutInitAddress,
      __FingerprintConfidenceScore: payment.fingerprintScore,
    },
    amount_settled: successful ? majorFromMinor(payment.amountSettled) : 0,
    customer: {
      id: payment.customerId,
      name: payment.customerName,
      phone_number: payment.customerPhone,
      email: payment.customerEmail,
      created_at: payment.createdAt,
    },
  };
}

/**
 * The documented charge.completed webhook object is not the same shape as the
 * verify object: it has no meta, amount_settled, or card token.
 */
export function chargeWebhookData(payment: FlutterwavePayment): Record<string, unknown> {
  const successful = payment.status === "successful";
  return {
    id: payment.transactionId,
    tx_ref: payment.txRef,
    flw_ref: payment.flwRef ?? "N/A",
    device_fingerprint: payment.deviceFingerprint,
    amount: majorFromMinor(payment.amount),
    currency: payment.currency,
    charged_amount: majorFromMinor(payment.amount),
    app_fee: majorFromMinor(payment.appFee),
    merchant_fee: 0,
    processor_response: successful ? "successful" : FAILED_PROCESSOR_RESPONSE,
    auth_model: successful ? "PIN" : "AVS_VBVSECURECODE",
    ip: IP_ADDRESS,
    narration: "CARD Transaction ",
    status: payment.status,
    payment_type: "card",
    created_at: payment.paidAt ?? payment.createdAt,
    account_id: ACCOUNT_ID,
    customer: {
      id: payment.customerId,
      name: payment.customerName,
      phone_number: payment.customerPhone,
      email: payment.customerEmail,
      created_at: payment.createdAt,
    },
    card: {
      first_6digits: payment.cardFirst6,
      last_4digits: payment.cardLast4,
      issuer: payment.cardIssuer,
      country: payment.cardCountry,
      type: payment.cardType,
      expiry: payment.cardExpiry,
    },
  };
}

function listItem(payment: FlutterwavePayment): Record<string, unknown> {
  const successful = payment.status === "successful";
  return {
    id: String(payment.transactionId),
    tx_ref: payment.txRef,
    flw_ref: payment.flwRef ?? "N/A",
    device_fingerprint: payment.deviceFingerprint,
    amount: majorFromMinor(payment.amount),
    currency: payment.currency,
    charged_amount: majorFromMinor(payment.amount),
    app_fee: majorFromMinor(payment.appFee),
    merchant_fee: 0,
    processor_response: successful ? "successful" : FAILED_PROCESSOR_RESPONSE,
    auth_model: successful ? "PIN" : "AVS_VBVSECURECODE",
    ip: IP_ADDRESS,
    narration: "CARD Transaction ",
    status: payment.status,
    payment_type: "card",
    created_at: payment.paidAt ?? payment.createdAt,
    amount_settled: successful ? majorFromMinor(payment.amountSettled) : null,
    account: {
      nuban: "N/A",
      bank: "N/A",
    },
    customer_name: payment.customerName,
    customer_email: payment.customerEmail,
    account_id: String(ACCOUNT_ID),
  };
}

type CardProfile = {
  readonly first6: string;
  readonly last4: string;
  readonly issuer: string;
  readonly country: string;
  readonly type: string;
  readonly expiry: string;
};

const SUCCESS_CARD: CardProfile = {
  first6: "553188",
  last4: "2950",
  issuer: " CREDIT",
  country: "NIGERIA NG",
  type: "MASTERCARD",
  expiry: "12/2099",
};

const FAILED_CARD: CardProfile = {
  first6: "514301",
  last4: "9965",
  issuer: "JACK HENRY AND ASSOCIATES DEBITSTANDARD",
  country: "UNITED STATES US",
  type: "MASTERCARD",
  expiry: "12/2099",
};

/**
 * D52: fees are illustrative. These two recorded examples are the only
 * fixtures that show a fee for the same amount and card as the twin's checkout.
 */
const RECORDED_APP_FEES = [
  {
    amount: 750_000,
    first6: SUCCESS_CARD.first6,
    last4: SUCCESS_CARD.last4,
    status: "successful",
    appFee: 10_500,
  },
  {
    amount: 750_000,
    first6: FAILED_CARD.first6,
    last4: FAILED_CARD.last4,
    status: "failed",
    appFee: 28_500,
  },
] as const;

function formulaAppFee(amount: number): number {
  return Math.floor((amount * 14) / 1_000);
}

function appFeeFor(amount: number, card: CardProfile, status: "successful" | "failed"): number {
  const recorded = RECORDED_APP_FEES.find(
    (entry) =>
      entry.amount === amount &&
      entry.first6 === card.first6 &&
      entry.last4 === card.last4 &&
      entry.status === status,
  );
  return recorded?.appFee ?? formulaAppFee(amount);
}

function makePayment(
  context: ActionContext,
  txRef: string,
  amount: number,
  currency: string,
  customerEmail: string,
  customerName: string,
  customerPhone: string,
  redirectUrl: string,
): FlutterwavePayment {
  const now = isoTimestamp(context.clock);
  const transactionId = nextPaymentId();
  const appFee = formulaAppFee(amount);
  return {
    id: txRef,
    transactionId,
    txRef,
    amount,
    currency,
    status: "unpaid",
    customerEmail,
    customerName,
    customerPhone,
    customerId: nextCustomerNumber(),
    redirectUrl,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    flwRef: null,
    appFee,
    amountSettled: 0,
    processorResponse: "pending",
    authModel: "PIN",
    deviceFingerprint: DEVICE_FINGERPRINT,
    checkoutInitAddress: customerPhone.length === 0 ? "N/A" : customerPhone,
    fingerprintScore: "0.5",
    cardFirst6: SUCCESS_CARD.first6,
    cardLast4: SUCCESS_CARD.last4,
    cardIssuer: SUCCESS_CARD.issuer,
    cardCountry: SUCCESS_CARD.country,
    cardType: SUCCESS_CARD.type,
    cardExpiry: SUCCESS_CARD.expiry,
    cardToken: null,
  };
}

export function placeholderPayment(
  txRef: string,
  clock: { readonly now: () => number },
): FlutterwavePayment {
  const now = isoTimestamp(clock);
  const transactionId = nextPaymentId();
  return {
    id: txRef,
    transactionId,
    txRef,
    amount: 0,
    currency: "NGN",
    status: "unpaid",
    customerEmail: "",
    customerName: "Ibeji Test Customer",
    customerPhone: "N/A",
    customerId: nextCustomerNumber(),
    redirectUrl: "",
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    flwRef: null,
    appFee: 0,
    amountSettled: 0,
    processorResponse: "pending",
    authModel: "PIN",
    deviceFingerprint: DEVICE_FINGERPRINT,
    checkoutInitAddress: "N/A",
    fingerprintScore: "0.5",
    cardFirst6: SUCCESS_CARD.first6,
    cardLast4: SUCCESS_CARD.last4,
    cardIssuer: SUCCESS_CARD.issuer,
    cardCountry: SUCCESS_CARD.country,
    cardType: SUCCESS_CARD.type,
    cardExpiry: SUCCESS_CARD.expiry,
    cardToken: null,
  };
}

export function applyCheckoutOutcome(
  payment: FlutterwavePayment,
  outcome: "success" | "failed",
  clock: { readonly now: () => number },
): FlutterwavePayment {
  const now = isoTimestamp(clock);
  const flwRef = `FLW-MOCK-ibeji-${payment.transactionId}`;
  if (outcome === "success") {
    const appFee = appFeeFor(payment.amount, SUCCESS_CARD, "successful");
    return {
      ...payment,
      status: "successful",
      paidAt: now,
      updatedAt: now,
      flwRef,
      appFee,
      amountSettled: Math.max(0, payment.amount - appFee),
      processorResponse: "successful",
      authModel: "PIN",
      cardFirst6: SUCCESS_CARD.first6,
      cardLast4: SUCCESS_CARD.last4,
      cardIssuer: SUCCESS_CARD.issuer,
      cardCountry: SUCCESS_CARD.country,
      cardType: SUCCESS_CARD.type,
      cardExpiry: SUCCESS_CARD.expiry,
      cardToken: `flw-t1nf-ibeji-${payment.transactionId}`,
    };
  }
  return {
    ...payment,
    status: "failed",
    paidAt: now,
    updatedAt: now,
    flwRef,
    appFee: appFeeFor(payment.amount, FAILED_CARD, "failed"),
    amountSettled: 0,
    processorResponse: FAILED_PROCESSOR_RESPONSE,
    authModel: "AVS_VBVSECURECODE",
    cardFirst6: FAILED_CARD.first6,
    cardLast4: FAILED_CARD.last4,
    cardIssuer: FAILED_CARD.issuer,
    cardCountry: FAILED_CARD.country,
    cardType: FAILED_CARD.type,
    cardExpiry: FAILED_CARD.expiry,
    cardToken: null,
  };
}

function paymentEventSummary(request: TwinRequest): string {
  const body = parseJsonObject(request.rawBody);
  if (body === undefined) {
    return "Your app tried to start a Flutterwave payment.";
  }
  const amountText = amountTextOf(body, request.rawBody);
  const customer = isRecord(body.customer) ? body.customer : undefined;
  const email = customer !== undefined && typeof customer.email === "string" ? customer.email : "";
  if (amountText === undefined || email.length === 0) {
    return "Your app tried to start a Flutterwave payment.";
  }
  try {
    const currency = readCurrency(body.currency);
    const amount = flutterwaveMoney.parseServiceAmount(amountText, currency);
    const formatted = flutterwaveMoney.formatDisplay(amount, currency);
    return `Your app started a Flutterwave payment of ${formatted} for ${email}`;
  } catch {
    return "Your app tried to start a Flutterwave payment.";
  }
}

function createPayment(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return invalidBodyResponse();
  }

  const redirectUrl = validRedirectUrl(body.redirect_url);
  if (redirectUrl === undefined) {
    return paymentValidationError("redirect_url", "Redirect URL is required");
  }

  const amountText = amountTextOf(body, context.request.rawBody);
  if (amountText === undefined) {
    return paymentValidationError("amount", "Amount is required");
  }

  const currency = readCurrency(body.currency);
  let amount: number;
  try {
    amount = flutterwaveMoney.parseServiceAmount(amountText, currency);
    flutterwaveMoney.assertValid(amount, currency);
  } catch {
    return invalidPaymentAmountResponse();
  }

  const txRef = typeof body.tx_ref === "string" ? body.tx_ref.trim() : "";
  if (txRef.length === 0) {
    return paymentValidationError("tx_ref", "Transaction reference is required");
  }

  const customer = isRecord(body.customer) ? body.customer : undefined;
  const customerEmail =
    customer !== undefined && typeof customer.email === "string" ? customer.email.trim() : "";
  if (customer === undefined || customerEmail.length === 0) {
    return paymentValidationError("customer", "Customer email is required");
  }

  if (paymentRecord(context.state, txRef) !== undefined) {
    return duplicatePaymentReferenceResponse();
  }

  const customerName =
    typeof customer.name === "string" && customer.name.trim().length > 0
      ? customer.name.trim()
      : "Ibeji Test Customer";
  const phoneValue = customer.phone_number ?? customer.phonenumber;
  const customerPhone =
    typeof phoneValue === "string" && phoneValue.trim().length > 0 ? phoneValue.trim() : "N/A";

  const payment = makePayment(
    context,
    txRef,
    amount,
    currency,
    customerEmail,
    customerName,
    customerPhone,
    redirectUrl,
  );
  context.state.insert(PAYMENTS, payment);

  return flutterwaveResponses.success(context.action, {
    link: `${twinOrigin(context.request)}/checkout/${encodeURIComponent(txRef)}`,
  });
}

function verifyPayment(context: ActionContext) {
  const rawId = context.request.params.id ?? "";
  if (!/^\d+$/u.test(rawId)) {
    return paymentNotFoundResponse();
  }
  const payment = listStoredPayments(context.state).find(
    (item) => String(item.transactionId) === rawId,
  );
  if (payment === undefined || payment.status === "unpaid") {
    return paymentNotFoundResponse();
  }
  return flutterwaveResponses.success(context.action, transactionData(payment));
}

function verifyByReference(context: ActionContext) {
  const rawReference = context.request.query.tx_ref;
  const txRef = typeof rawReference === "string" ? rawReference : "";
  const payment = paymentRecord(context.state, txRef);
  if (payment === undefined || payment.status === "unpaid") {
    return paymentNotFoundResponse();
  }
  return flutterwaveResponses.success(context.action, transactionData(payment));
}

function queryString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pageNumber(value: string | undefined): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return 1;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function validDatePrefix(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
}

function listPayments(context: ActionContext) {
  const page = pageNumber(queryString(context.request.query.page));
  const from = validDatePrefix(queryString(context.request.query.from));
  const to = validDatePrefix(queryString(context.request.query.to));
  const status = queryString(context.request.query.status);
  const txRef = queryString(context.request.query.tx_ref);
  const email = queryString(context.request.query.customer_email);
  const currency = queryString(context.request.query.currency)?.toUpperCase();
  const perPage = 20;

  const filtered = listStoredPayments(context.state)
    .filter((payment) => payment.status !== "unpaid")
    .filter((payment) => status === undefined || payment.status === status)
    .filter((payment) => txRef === undefined || payment.txRef === txRef)
    .filter((payment) => email === undefined || payment.customerEmail === email)
    .filter((payment) => currency === undefined || payment.currency === currency)
    .filter(
      (payment) => from === undefined || (payment.paidAt ?? payment.createdAt).slice(0, 10) >= from,
    )
    .filter(
      (payment) => to === undefined || (payment.paidAt ?? payment.createdAt).slice(0, 10) <= to,
    )
    .sort((left, right) => right.transactionId - left.transactionId);

  const start = (page - 1) * perPage;
  const data = filtered.slice(start, start + perPage).map(listItem);
  const total = filtered.length;
  const currentPage = total === 0 ? 0 : page;
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);

  return flutterwaveResponses.success(context.action, data, {
    page_info: {
      total,
      current_page: currentPage,
      total_pages: totalPages,
    },
  });
}

export const paymentActions: readonly ActionDefinition[] = [
  {
    id: "payment.create",
    method: "POST",
    path: "/v3/payments",
    summary: "Create a hosted payment",
    kind: "write",
    eventSummary: paymentEventSummary,
    handler: createPayment,
  },
  {
    id: "payment.verify",
    method: "GET",
    path: "/v3/transactions/:id/verify",
    summary: "Verify a payment by ID",
    kind: "read",
    handler: verifyPayment,
  },
  {
    id: "payment.verify_by_reference",
    method: "GET",
    path: "/v3/transactions/verify_by_reference",
    summary: "Verify a payment by reference",
    kind: "read",
    handler: verifyByReference,
  },
  {
    id: "payment.list",
    method: "GET",
    path: "/v3/transactions",
    summary: "List payments",
    kind: "read",
    handler: listPayments,
  },
];
