import type { ActionContext, ActionDefinition, TwinRequest } from "../framework/types.js";
import { paystackMoney } from "./money.js";
import {
  duplicateReferenceResponse,
  invalidAmountResponse,
  invalidBodyResponse,
  invalidCallbackUrlResponse,
  invalidReferenceResponse,
  invalidTransactionIdResponse,
  missingAmountResponse,
  missingEmailResponse,
  paystackResponses,
  transactionNotFoundResponse,
  validationErrorResponse,
} from "./responses.js";
import type { PaystackLog, PaystackTransaction } from "./state.js";
import { paystackTransactionSchema } from "./state.js";

const TRANSACTIONS = "transactions";
const IP_ADDRESS = "203.0.113.1";

let nextTransactionId = 6_705_000_000;

function nextId(): number {
  const id = nextTransactionId;
  nextTransactionId += 1;
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

function readAmountText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return undefined;
}

function readCurrency(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toUpperCase() : "NGN";
}

function parseMetadata(value: unknown): PaystackTransaction["metadata"] {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed as PaystackTransaction["metadata"];
    } catch {
      return value;
    }
  }
  return value as PaystackTransaction["metadata"];
}

function validCallbackUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isoTimestamp(clock: { readonly now: () => number }): string {
  return new Date(clock.now()).toISOString();
}

function twinOrigin(request: TwinRequest): string {
  const host = (request.headers.host ?? "127.0.0.1")
    .toLowerCase()
    .replace(/\.(?=:|$)/gu, "")
    .replace(/^localhost:/u, "127.0.0.1:");
  return `http://${host}`;
}

function accessCode(context: ActionContext): string {
  return `ibeji${context.random.int(100_000_000, 999_999_999)}`;
}

function buildLog(success: boolean): PaystackLog {
  const last = success
    ? {
        type: "success",
        message: "Successfully paid with card",
        time: 6,
      }
    : {
        type: "error",
        message: "Error: Declined",
        time: 6,
      };

  return {
    start_time: 1,
    time_spent: 6,
    attempts: 1,
    errors: success ? 0 : 1,
    success,
    mobile: false,
    input: [],
    history: [
      { type: "input", message: "Filled this field: card number", time: 1 },
      { type: "action", message: "User switched transaction currency to NGN", time: 2 },
      { type: "input", message: "Filled this field: card expiry", time: 3 },
      { type: "input", message: "Filled this field: card cvv", time: 4 },
      { type: "action", message: "Attempted to pay with card", time: 5 },
      last,
    ],
  };
}

export function buildTransactionLog(status: "success" | "failed"): PaystackLog {
  return buildLog(status === "success");
}

function gatewayFor(status: PaystackTransaction["status"]): {
  gateway: string;
  gatewayCode: string | null;
  responseCode: string | null;
} {
  switch (status) {
    case "success":
      return { gateway: "Successful", gatewayCode: "approved", responseCode: "00" };
    case "failed":
      return { gateway: "Declined", gatewayCode: "do_not_honor", responseCode: "05" };
    case "abandoned":
      return {
        gateway: "The transaction was not completed",
        gatewayCode: null,
        responseCode: null,
      };
    case "pending":
      return { gateway: "Pending", gatewayCode: null, responseCode: null };
  }
}

type Authorization = {
  authorization_code: string;
  bin: string;
  last4: string;
  exp_month: string;
  exp_year: string;
  channel: string;
  card_type: string;
  bank: string;
  country_code: string;
  brand: string;
  reusable: boolean;
  signature: string;
  account_name: null;
  receiver_bank_account_number: null;
  receiver_bank: null;
};

function authorizationFull(record: PaystackTransaction): Authorization {
  return {
    authorization_code: record.authorizationCode,
    bin: "408408",
    last4: "0000",
    exp_month: "12",
    exp_year: "2099",
    channel: "card",
    card_type: "visa ",
    bank: "TEST BANK",
    country_code: "NG",
    brand: "visa",
    reusable: true,
    signature: record.signature,
    account_name: null,
    receiver_bank_account_number: null,
    receiver_bank: null,
  };
}

type ListAuthorization = {
  authorization_code: string | null;
  bin: string | null;
  last4: string | null;
  exp_month: string | null;
  exp_year: string | null;
  channel: string | null;
  card_type: string | null;
  bank: string | null;
  country_code: string | null;
  brand: string | null;
  reusable: boolean;
  signature: string | null;
  account_name: null;
};

function authorizationList(record: PaystackTransaction): ListAuthorization {
  if (record.status === "abandoned") {
    return {
      authorization_code: null,
      bin: null,
      last4: null,
      exp_month: null,
      exp_year: null,
      channel: null,
      card_type: null,
      bank: null,
      country_code: null,
      brand: null,
      reusable: false,
      signature: null,
      account_name: null,
    };
  }

  const full = authorizationFull(record);
  return {
    authorization_code: full.authorization_code,
    bin: full.bin,
    last4: full.last4,
    exp_month: full.exp_month,
    exp_year: full.exp_year,
    channel: full.channel,
    card_type: full.card_type,
    bank: full.bank,
    country_code: full.country_code,
    brand: full.brand,
    reusable: full.reusable,
    signature: full.signature,
    account_name: full.account_name,
  };
}

type Customer = {
  id: number;
  first_name: null;
  last_name: null;
  email: string;
  customer_code: string;
  phone: null;
  metadata: null;
  risk_action: string;
  international_format_phone: null;
};

function customer(
  record: PaystackTransaction,
  withInternationalPhone: boolean,
): Customer | Omit<Customer, "international_format_phone"> {
  const base = {
    id: record.customerId,
    first_name: null,
    last_name: null,
    email: record.email,
    customer_code: record.customerCode,
    phone: null,
    metadata: null,
    risk_action: "default",
  } as const;
  return withInternationalPhone ? { ...base, international_format_phone: null } : base;
}

function logFor(
  record: PaystackTransaction,
  status: PaystackTransaction["status"],
): PaystackLog | null {
  if (record.log !== null) {
    return record.log;
  }
  if (status === "success") {
    return buildTransactionLog("success");
  }
  if (status === "failed") {
    return buildTransactionLog("failed");
  }
  return null;
}

function feesFor(
  record: PaystackTransaction,
  status: PaystackTransaction["status"],
): number | null {
  return status === "success" ? (record.fees ?? 0) : null;
}

export function buildVerifyTransaction(record: PaystackTransaction): Record<string, unknown> {
  const gateway = gatewayFor(record.status);
  return {
    id: record.transactionId,
    domain: record.domain,
    status: record.status,
    reference: record.reference,
    receipt_number: null,
    amount: record.amount,
    message: null,
    gateway_response: gateway.gateway,
    gateway_response_code: gateway.gatewayCode,
    response_code: gateway.responseCode,
    paid_at: record.paidAt,
    created_at: record.createdAt,
    channel: "card",
    currency: record.currency,
    ip_address: IP_ADDRESS,
    metadata: record.metadata,
    log: logFor(record, record.status),
    fees: feesFor(record, record.status),
    fees_split: null,
    authorization: record.status === "abandoned" ? {} : authorizationFull(record),
    customer: customer(record, true),
    plan: null,
    split: {},
    order_id: null,
    paidAt: record.paidAt,
    createdAt: record.createdAt,
    requested_amount: record.amount,
    pos_transaction_data: null,
    source: null,
    fees_breakdown: null,
    connect: null,
    transaction_date: record.createdAt,
    plan_object: {},
    subaccount: {},
  };
}

export function buildFetchTransaction(record: PaystackTransaction): Record<string, unknown> {
  const gateway = gatewayFor(record.status);
  return {
    id: record.transactionId,
    domain: record.domain,
    status: record.status,
    reference: record.reference,
    receipt_number: null,
    amount: record.amount,
    message: null,
    gateway_response: gateway.gateway,
    gateway_response_code: gateway.gatewayCode,
    response_code: gateway.responseCode,
    helpdesk_link: null,
    paid_at: record.paidAt,
    created_at: record.createdAt,
    channel: "card",
    currency: record.currency,
    ip_address: IP_ADDRESS,
    metadata: record.metadata,
    log: logFor(record, record.status),
    fees: feesFor(record, record.status),
    fees_split: null,
    authorization: authorizationFull(record),
    customer: customer(record, true),
    plan: {},
    subaccount: {},
    split: {},
    order_id: null,
    paidAt: record.paidAt,
    createdAt: record.createdAt,
    requested_amount: record.amount,
    pos_transaction_data: null,
    source: {
      type: "api",
      source: "merchant_api",
      identifier: null,
    },
    fees_breakdown: null,
    connect: null,
  };
}

export function buildListTransaction(record: PaystackTransaction): Record<string, unknown> {
  const gateway = gatewayFor(record.status);
  return {
    id: record.transactionId,
    domain: record.domain,
    status: record.status,
    reference: record.reference,
    amount: record.amount,
    message: null,
    gateway_response: gateway.gateway,
    gateway_response_code: gateway.gatewayCode,
    response_code: gateway.responseCode,
    paid_at: record.paidAt,
    created_at: record.createdAt,
    channel: "card",
    currency: record.currency,
    ip_address: IP_ADDRESS,
    metadata: record.metadata,
    log: logFor(record, record.status),
    fees: feesFor(record, record.status),
    fees_split: null,
    customer: customer(record, false),
    authorization: authorizationList(record),
    plan: {},
    split: {},
    subaccount: {},
    order_id: null,
    paidAt: record.paidAt,
    createdAt: record.createdAt,
    requested_amount: record.amount,
    source: {
      source: "merchant_api",
      type: "api",
      identifier: null,
      entry_point: "transaction_initialize",
    },
    connect: null,
    pos_transaction_data: null,
  };
}

export function buildChargeSuccessData(record: PaystackTransaction): Record<string, unknown> {
  return buildVerifyTransaction(record);
}

function makeRecord(
  context: ActionContext,
  reference: string,
  amount: number,
  currency: string,
  email: string,
  metadata: PaystackTransaction["metadata"],
  callbackUrl: string | null,
): PaystackTransaction {
  const now = isoTimestamp(context.clock);
  const transactionId = nextId();
  const randomSuffix = context.random.int(100_000_000, 999_999_999);
  return {
    id: reference,
    transactionId,
    domain: "test",
    status: "pending",
    reference,
    amount,
    currency,
    email,
    metadata,
    createdAt: now,
    paidAt: null,
    callbackUrl,
    accessCode: accessCode(context),
    customerId: 400_000_000 + (transactionId % 1_000_000),
    customerCode: `CUS_ibeji${randomSuffix}`,
    authorizationCode: `AUTH_ibeji${randomSuffix}`,
    signature: `SIG_ibeji${randomSuffix}`,
    fees: null,
    log: null,
  };
}

export function placeholderTransaction(
  reference: string,
  clock: { readonly now: () => number },
): PaystackTransaction {
  const now = isoTimestamp(clock);
  const transactionId = nextId();
  return {
    id: reference,
    transactionId,
    domain: "test",
    status: "pending",
    reference,
    amount: 0,
    currency: "NGN",
    email: "",
    metadata: null,
    createdAt: now,
    paidAt: null,
    callbackUrl: null,
    accessCode: `ibeji${transactionId}`,
    customerId: 400_000_000 + (transactionId % 1_000_000),
    customerCode: `CUS_ibeji${transactionId}`,
    authorizationCode: `AUTH_ibeji${transactionId}`,
    signature: `SIG_ibeji${transactionId}`,
    fees: null,
    log: null,
  };
}

export function readTransaction(
  state: ActionContext["state"],
  reference: string,
): PaystackTransaction | undefined {
  return state.read(TRANSACTIONS, reference, paystackTransactionSchema);
}

export function listStoredTransactions(
  state: ActionContext["state"],
): readonly PaystackTransaction[] {
  return state.list(TRANSACTIONS, paystackTransactionSchema);
}

export function applyCheckoutOutcome(
  record: PaystackTransaction,
  outcome: "success" | "declined" | "abandoned",
  clock: { readonly now: () => number },
): PaystackTransaction {
  switch (outcome) {
    case "success":
      return {
        ...record,
        status: "success",
        paidAt: isoTimestamp(clock),
        fees: 0,
        log: buildTransactionLog("success"),
      };
    case "declined":
      return {
        ...record,
        status: "failed",
        paidAt: null,
        fees: null,
        log: buildTransactionLog("failed"),
      };
    case "abandoned":
      return {
        ...record,
        status: "abandoned",
        paidAt: null,
        fees: null,
        log: null,
      };
  }
}

function generatedReference(context: ActionContext): string {
  return `ibeji-${context.clock.now()}-${context.random.int(100_000, 999_999)}`;
}

function eventSummaryForInitialize(request: TwinRequest): string {
  const body = parseJsonObject(request.rawBody);
  if (body === undefined) {
    return "Your app tried to start a Paystack payment.";
  }
  const amountText = readAmountText(body.amount);
  const email = typeof body.email === "string" ? body.email : undefined;
  if (amountText === undefined || email === undefined) {
    return "Your app tried to start a Paystack payment.";
  }
  try {
    const currency = readCurrency(body.currency);
    const amount = paystackMoney.parseServiceAmount(amountText, currency);
    const formatted = paystackMoney.formatDisplay(amount, currency);
    return `Your app started a Paystack payment of ${formatted} for ${email}`;
  } catch {
    return "Your app tried to start a Paystack payment.";
  }
}

function initialize(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return invalidBodyResponse();
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length === 0) {
    return missingEmailResponse();
  }

  const amountText = readAmountText(body.amount);
  if (amountText === undefined) {
    return missingAmountResponse();
  }

  const currency = readCurrency(body.currency);
  let amount: number;
  try {
    amount = paystackMoney.parseServiceAmount(amountText, currency);
    paystackMoney.assertValid(amount, currency);
  } catch {
    return invalidAmountResponse();
  }

  const rawReference = typeof body.reference === "string" ? body.reference.trim() : "";
  const reference = rawReference.length > 0 ? rawReference : generatedReference(context);
  if (!/^[A-Za-z0-9.=-]+$/u.test(reference)) {
    return validationErrorResponse(
      "Transaction reference contains invalid characters",
      "invalid_params",
    );
  }

  const callbackUrl = validCallbackUrl(body.callback_url);
  if (callbackUrl === undefined) {
    return invalidCallbackUrlResponse();
  }

  if (readTransaction(context.state, reference) !== undefined) {
    return duplicateReferenceResponse();
  }

  const record = makeRecord(
    context,
    reference,
    amount,
    currency,
    email,
    parseMetadata(body.metadata),
    callbackUrl,
  );
  context.state.insert(TRANSACTIONS, record);

  return paystackResponses.success(context.action, {
    authorization_url: `${twinOrigin(context.request)}/checkout/${encodeURIComponent(reference)}`,
    access_code: record.accessCode,
    reference,
  });
}

function verify(context: ActionContext) {
  const reference = context.request.params.reference;
  if (reference === undefined) {
    return invalidReferenceResponse();
  }
  const record = readTransaction(context.state, reference);
  if (record === undefined) {
    return invalidReferenceResponse();
  }
  return paystackResponses.success(context.action, buildVerifyTransaction(record));
}

function fetchTransaction(context: ActionContext) {
  const rawId = context.request.params.id ?? "";
  if (!/^\d+$/u.test(rawId)) {
    return invalidTransactionIdResponse();
  }
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) {
    return invalidTransactionIdResponse();
  }
  const record = listStoredTransactions(context.state).find(
    (transaction) => transaction.transactionId === id,
  );
  if (record === undefined) {
    return transactionNotFoundResponse();
  }
  return paystackResponses.success(context.action, buildFetchTransaction(record));
}

function queryString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function listTransactions(context: ActionContext) {
  const perPage = Math.min(positiveInteger(queryString(context.request.query.perPage), 50), 100);
  const page = positiveInteger(queryString(context.request.query.page), 1);
  const status = queryString(context.request.query.status);
  const amount = positiveInteger(queryString(context.request.query.amount), 0);

  const filtered = listStoredTransactions(context.state)
    .filter((record) => status === undefined || record.status === status)
    .filter((record) => amount === 0 || record.amount === amount)
    .sort((left, right) => right.transactionId - left.transactionId);

  const start = (page - 1) * perPage;
  const data = filtered.slice(start, start + perPage).map(buildListTransaction);
  const total = filtered.length;
  const totalVolume = filtered.reduce((sum, record) => sum + record.amount, 0);

  return paystackResponses.success(context.action, data, {
    total,
    total_volume: totalVolume,
    skipped: start,
    perPage,
    page,
    pageCount: Math.ceil(total / perPage),
  });
}

const checkoutHandler = () => paystackResponses.notFound();

export const transactionActions: readonly ActionDefinition[] = [
  {
    id: "transaction.initialize",
    method: "POST",
    path: "/transaction/initialize",
    summary: "Initialize a transaction",
    kind: "write",
    eventSummary: eventSummaryForInitialize,
    handler: initialize,
  },
  {
    id: "transaction.verify",
    method: "GET",
    path: "/transaction/verify/:reference",
    summary: "Verify a transaction",
    kind: "read",
    handler: verify,
  },
  {
    id: "transaction.fetch",
    method: "GET",
    path: "/transaction/:id",
    summary: "Fetch a transaction",
    kind: "read",
    handler: fetchTransaction,
  },
  {
    id: "transaction.list",
    method: "GET",
    path: "/transaction",
    summary: "List transactions",
    kind: "read",
    handler: listTransactions,
  },
  {
    id: "checkout.open",
    method: "GET",
    path: "/checkout/:reference",
    summary: "Open the Paystack test checkout page",
    kind: "checkout",
    handler: checkoutHandler,
  },
  {
    id: "checkout.submit",
    method: "POST",
    path: "/checkout/:reference",
    summary: "Submit the Paystack test checkout page",
    kind: "checkout",
    handler: checkoutHandler,
  },
];
