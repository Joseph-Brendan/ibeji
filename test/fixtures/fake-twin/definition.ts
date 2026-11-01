import { createHmac } from "node:crypto";
import { z } from "zod";

import { IbejiError } from "../../../src/core/errors.js";
import type {
  ActionDefinition,
  CheckoutPageContext,
  CheckoutSubmitContext,
  CredentialSpec,
  CryptoRandom,
  FailureSupport,
  IdempotencyAdapter,
  JsonValue,
  MoneyRules,
  StoredIdempotency,
  TwinDefinition,
  TwinRequest,
  TwinResponse,
  TwinState,
} from "../../../src/twins/framework/types.js";

export const FAKE_SECRET = "sk_test_ibeji_fixture0001";
export const FAKE_PUBLIC = "pk_test_ibeji_fixture0001";
export const FAKE_WEBHOOK_SECRET = "whsec_ibeji_fixture0001";

export const fakeCredentials = {
  secret: FAKE_SECRET,
  public: FAKE_PUBLIC,
  webhookSecret: FAKE_WEBHOOK_SECRET,
} as const;

const paymentRecordSchema = z.object({
  id: z.string(),
  status: z.string(),
});

const stateSchema = z.record(
  z.string(),
  z.unknown(),
) as unknown as TwinDefinition["state"]["schema"];

function jsonResponse(status: number, body: unknown): TwinResponse {
  return {
    status,
    headers: {},
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
  };
}

function serviceError(status: number, message: string): TwinResponse {
  return jsonResponse(status, { status: "error", message, data: null });
}

function hex(random: CryptoRandom, bytes: number): string {
  return [...random.bytes(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function signatureOf(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function mutateSignature(signature: string): string {
  const first = signature[0] === "0" ? "1" : "0";
  return `${first}${signature.slice(1)}`;
}

function webhookSecret(credentials: Readonly<Record<string, string>>): string {
  return credentials.webhookSecret ?? credentials.secret ?? FAKE_WEBHOOK_SECRET;
}

const signatureHeader = "x-fake-signature";

function keyOf(request: TwinRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim();
}

function unauthorized(): TwinResponse {
  return serviceError(401, "Invalid key. Use the Ibeji-issued fake secret key.");
}

const failureSupport: readonly FailureSupport[] = [
  {
    id: "server-error",
    source: "docs",
    actions: ["payment.create", "refund.create"],
  },
  {
    id: "rate-limited",
    source: "docs",
    actions: ["payment.create", "refund.create"],
  },
  {
    id: "payment-declined",
    source: "docs",
    actions: ["payment.create", "checkout.submit"],
  },
  {
    id: "bank-resolve-fails",
    source: "assumed",
    actions: ["bank.resolve"],
  },
  {
    id: "authentication-required",
    source: "docs",
    actions: ["payment.create", "checkout.submit"],
  },
  {
    id: "transfer-stuck-pending",
    source: "docs",
    actions: ["payment.create"],
  },
  {
    id: "transfer-reversed",
    source: "docs",
    actions: ["payment.create"],
  },
  {
    id: "slow-response",
    source: "docs",
    actions: ["payment.fetch", "payment.create"],
  },
  {
    id: "timeout-before-commit",
    source: "docs",
    actions: ["payment.create"],
  },
  {
    id: "timeout-after-commit",
    source: "docs",
    actions: ["payment.create"],
  },
  {
    id: "webhook-delayed",
    source: "assumed",
    actions: ["webhook.emit", "checkout.submit"],
  },
  {
    id: "webhook-duplicated",
    source: "assumed",
    actions: ["webhook.emit", "checkout.submit"],
  },
  {
    id: "webhook-out-of-order",
    source: "assumed",
    actions: ["webhook.emit", "checkout.submit"],
  },
  {
    id: "webhook-never-sent",
    source: "assumed",
    actions: ["webhook.emit", "checkout.submit"],
  },
  {
    id: "webhook-verification-fails",
    source: "docs",
    actions: ["webhook.emit", "checkout.submit"],
  },
];

const credentialsSpecs: readonly CredentialSpec[] = [
  {
    id: "secret",
    label: "Secret key",
    role: "secret",
    secret: true,
    generate: (random) => `sk_test_ibeji_${hex(random, 8)}`,
    isTestFormat: (value) => /^sk_test_ibeji_[0-9a-f]{16}$/u.test(value),
  },
  {
    id: "public",
    label: "Public key",
    role: "public",
    secret: false,
    generate: (random) => `pk_test_ibeji_${hex(random, 8)}`,
    isTestFormat: (value) => /^pk_test_ibeji_[0-9a-f]{16}$/u.test(value),
  },
  {
    id: "webhookSecret",
    label: "Webhook secret",
    role: "webhook",
    secret: true,
    generate: (random) => `whsec_ibeji_${hex(random, 8)}`,
    isTestFormat: (value) => /^whsec_ibeji_[0-9a-f]{16}$/u.test(value),
  },
];

function amountToMinor(text: string, currency: string): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(text);
  if (match === null) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The fake twin received an invalid amount.",
      why: `"${text}" is not a whole or decimal amount.`,
      fix: "Send an amount such as 10.00.",
    });
  }

  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] as string;
  const fraction = match[3] ?? "";
  const digits = fractionDigits(currency);
  if (fraction.length > digits) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The fake twin received too many decimal places.",
      why: `${currency} allows ${digits} decimal places.`,
      fix: `Send at most ${digits} decimal places.`,
    });
  }

  const scale = 10n ** BigInt(digits);
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(digits, "0"));
  return sign * Number(minor);
}

function formatMinor(amount: number, currency: string, withSymbol: boolean): string {
  const digits = fractionDigits(currency);
  const scale = 10n ** BigInt(digits);
  const value = BigInt(amount);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / scale;
  const fraction = absolute % scale;
  const fractionText = digits === 0 ? "" : `.${fraction.toString().padStart(digits, "0")}`;
  const number = `${sign}${whole.toString()}${fractionText}`;
  if (!withSymbol) {
    return number;
  }
  if (currency === "USD") {
    return `$${number}`;
  }
  if (currency === "JPY") {
    return `¥${number}`;
  }
  return `${currency} ${number}`;
}

function fractionDigits(currency: string): number {
  return currency === "JPY" ? 0 : 2;
}

function assertValidAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The fake twin received an invalid stored amount.",
      why: "Stored amounts must be whole numbers in the smallest currency unit.",
      fix: "Pass a non-negative safe integer.",
    });
  }
}

const money: MoneyRules = {
  zeroDecimal: ["JPY"],
  fractionDigits,
  parseServiceAmount: amountToMinor,
  formatServiceAmount: (amount, currency) => formatMinor(amount, currency, false),
  formatDisplay: (amount, currency) => formatMinor(amount, currency, true),
  assertValid: (amount, currency) => {
    assertValidAmount(amount);
    const digits = fractionDigits(currency);
    if (!Number.isInteger(amount) || (digits === 0 && amount % 1 !== 0)) {
      throw new IbejiError("BAD_REQUEST", {
        what: "The fake twin received an invalid amount for the currency.",
        why: `${currency} cannot store a fractional smallest-unit amount.`,
        fix: "Send a whole number in the smallest currency unit.",
      });
    }
  },
};

type JsonObject = {
  readonly [key: string]: JsonValue;
};

function paymentResponse(reference: string): JsonObject {
  return {
    id: `pay_${reference}`,
    object: "payment",
    amount: 1000,
    currency: "USD",
    reference,
    status: "succeeded",
  };
}

const checkoutOutcomes = [
  {
    id: "success",
    label: "Pay successfully",
    description: "The fake payment succeeds.",
  },
  {
    id: "declined",
    label: "Decline the payment",
    description: "The fake payment is declined.",
  },
  {
    id: "authenticated",
    label: "Check with authentication",
    description: "The fake payment asks for authentication.",
    authentication: {
      approveLabel: "Approve the check",
      failLabel: "Fail the check",
    },
  },
] as const;

function checkoutPage(context: CheckoutPageContext) {
  return {
    twinDisplayName: "Fake Twin",
    amountMinor: 1000,
    currency: "USD",
    customerEmail: "customer.one@example.com",
    reference: context.recordId,
    outcomes: checkoutOutcomes,
  };
}

async function checkoutSubmit(context: CheckoutSubmitContext) {
  const declined = context.failures.declined === true;
  const status = declined ? "declined" : "succeeded";
  const existing = context.state.read("payments", context.recordId, paymentRecordSchema);
  if (existing === undefined) {
    context.state.insert("payments", { id: context.recordId, status });
  } else {
    context.state.update("payments", context.recordId, { id: context.recordId, status });
  }

  return {
    notice: declined
      ? "Fake Twin declined the payment. No real money moved."
      : "Fake Twin payment succeeded. No real money moved.",
    webhooks: declined
      ? []
      : [
          {
            key: "payment.succeeded",
            actionId: "checkout.submit",
            resourceId: context.recordId,
            occurredAt: 0,
            data: paymentResponse(context.recordId),
          },
        ],
  };
}

function routeActions(): readonly ActionDefinition[] {
  return [
    {
      id: "payment.create",
      method: "POST",
      path: "/payments",
      summary: "Create a payment",
      kind: "write",
      handler: (context) =>
        context.failures.declined === true
          ? serviceError(402, "Payment declined")
          : jsonResponse(200, {
              status: "success",
              data: paymentResponse("ref-1"),
              meta: { note: "created" },
            }),
    },
    {
      id: "payment.fetch",
      method: "GET",
      path: "/payments/:reference",
      summary: "Fetch a payment",
      kind: "read",
      handler: (context) => {
        const reference = context.request.params.reference ?? "ref-1";
        return jsonResponse(200, { status: "success", data: paymentResponse(reference) });
      },
    },
    {
      id: "refund.create",
      method: "POST",
      path: "/refunds",
      summary: "Create a refund",
      kind: "write",
      handler: () =>
        jsonResponse(201, {
          status: "success",
          data: { id: "refund_1", status: "processed", amount: 500, currency: "USD" },
        }),
    },
    {
      id: "bank.resolve",
      method: "GET",
      path: "/banks/resolve",
      summary: "Resolve an account",
      kind: "read",
      handler: (context) => {
        if (context.failures.bankResolveFails?.mode === "timeout") {
          return serviceError(504, "Account lookup timed out");
        }
        if (context.failures.bankResolveFails !== undefined) {
          return serviceError(502, "Account lookup failed");
        }
        return jsonResponse(200, {
          status: "success",
          data: { account_number: "0000000001", account_name: "Test Name 1" },
        });
      },
    },
    {
      id: "query.echo",
      method: "GET",
      path: "/query",
      summary: "Echo query values",
      kind: "read",
      handler: (context) => jsonResponse(200, { status: "success", data: context.request.query }),
    },
    {
      id: "plain.text",
      method: "GET",
      path: "/plain",
      summary: "Return plain text",
      kind: "read",
      handler: () => ({
        status: 200,
        headers: {},
        body: "not json",
        contentType: "text/plain; charset=utf-8",
      }),
    },
    {
      id: "empty.response",
      method: "GET",
      path: "/empty",
      summary: "Return an empty response",
      kind: "read",
      handler: () => ({
        status: 200,
        headers: {},
        body: "",
        contentType: "application/json",
      }),
    },
    {
      id: "custom.headers",
      method: "GET",
      path: "/headers",
      summary: "Return custom headers",
      kind: "read",
      handler: () => ({
        status: 200,
        headers: { "access-control-allow-origin": "*", "x-fake-header": "yes" },
        body: "{}",
        contentType: "application/json",
      }),
    },
    {
      id: "binary.body",
      method: "GET",
      path: "/binary",
      summary: "Return a binary body",
      kind: "read",
      handler: () => ({
        status: 200,
        headers: {},
        body: new TextEncoder().encode("binary"),
        contentType: "application/octet-stream",
      }),
    },
    {
      id: "webhook.emit",
      method: "GET",
      path: "/webhook/emit",
      summary: "Emit a webhook",
      kind: "write",
      handler: (context) => {
        context.webhooks.emit({
          key: "payment.succeeded",
          actionId: "webhook.emit",
          resourceId: "pay_1",
          occurredAt: 0,
          data: paymentResponse("ref-1"),
        });
        return jsonResponse(200, { status: "success", data: { emitted: true } });
      },
    },
    {
      id: "checkout.open",
      method: "GET",
      path: "/checkout/:reference",
      summary: "Open the test checkout page",
      kind: "checkout",
      handler: () => serviceError(500, "The framework renders checkout.open"),
    },
    {
      id: "checkout.submit",
      method: "POST",
      path: "/checkout/:reference",
      summary: "Submit the test checkout page",
      kind: "checkout",
      handler: () => serviceError(500, "The framework handles checkout.submit"),
    },
  ];
}

const actions = routeActions();

const webhookEvents = [
  {
    key: "payment.succeeded",
    wireName: "payment.succeeded",
    objectType: "payment",
    actions: ["payment.create", "checkout.submit"],
  },
  {
    key: "refund.created",
    wireName: "refund.created",
    objectType: "refund",
    actions: ["refund.create"],
  },
] as const;

const fakeTwin: TwinDefinition = {
  id: "fake",
  displayName: "Fake Twin",
  defaultPort: 4499,
  actions,
  state: {
    schema: stateSchema,
    initial: () => ({}),
    collections: [
      {
        id: "payments",
        label: "Payments",
        columns: [
          { key: "id", label: "Id", kind: "text" },
          { key: "status", label: "Status", kind: "text" },
        ],
      },
    ],
  },
  auth: {
    readKey: keyOf,
    isLiveKey: (key) => /^(?:sk|pk|rk)_live_/u.test(key),
    classify: (key, credentials): { kind: "valid" | "missing" | "wrong" } => {
      if (key === null) {
        return { kind: "missing" };
      }
      return key === credentials.secret ? { kind: "valid" } : { kind: "wrong" };
    },
    unauthorized: (result) => {
      if (result.kind === "live") {
        return serviceError(401, "A live key was sent to the Fake Twin.");
      }
      if (result.kind === "missing") {
        return serviceError(401, "No key was sent.");
      }
      return unauthorized();
    },
  },
  idempotency: { mode: "none" },
  routes: (router) => {
    for (const action of actions) {
      router.add(action);
    }
  },
  responses: {
    success: (_action, data, meta) =>
      jsonResponse(
        200,
        meta === undefined ? { status: "success", data } : { status: "success", data, meta },
      ),
    created: (_action, data) => jsonResponse(201, { status: "success", data }),
    error: (failure) => serviceError(failure.status ?? 500, failure.message ?? "Fake Twin error"),
    notFound: () => serviceError(404, "The Fake Twin has no route for that request."),
  },
  failures: {
    support: failureSupport,
    httpError: (plan) =>
      serviceError(
        plan.status,
        plan.status === 429
          ? "Too many requests"
          : `The Fake Twin had a server error (${plan.failureId}).`,
      ),
    shapeResult: (plan) => plan.effects,
  },
  webhooks: {
    events: webhookEvents,
    build: (draft) => {
      const event = webhookEvents.find((item) => item.key === draft.key);
      const wireName = event?.wireName ?? draft.key;
      return {
        body: JSON.stringify({ event: wireName, data: draft.data }),
        contentType: "application/json",
      };
    },
    sign: (raw, credentials, options) => {
      const signature = signatureOf(raw.body, webhookSecret(credentials));
      switch (options.failureMethod) {
        case "wrong-secret":
          return { [signatureHeader]: signatureOf(raw.body, "wrong-secret") };
        case "corrupted":
          return { [signatureHeader]: mutateSignature(signature) };
        case "missing":
          return {};
        case "stale-timestamp":
          return { [signatureHeader]: signature, "x-fake-timestamp": "0" };
        default:
          return { [signatureHeader]: signature };
      }
    },
    verify: (raw, headers, credentials) => {
      const actual = headers[signatureHeader];
      if (actual === undefined) {
        return false;
      }
      return actual === signatureOf(raw.body, webhookSecret(credentials));
    },
    verificationFailures: ["wrong-secret", "corrupted", "missing"],
    summarize: (draft) => `Fake Twin event "${draft.key}" for ${draft.resourceId}`,
  },
  checkout: {
    outcomes: checkoutOutcomes,
    page: checkoutPage,
    submit: checkoutSubmit,
  },
  credentials: credentialsSpecs,
  money,
  retry: { source: "docs", delaysSeconds: [1] },
};

export const fakeTwinDefinition: TwinDefinition = fakeTwin;

export function brokenLiveKeyTwin(): TwinDefinition {
  return {
    ...fakeTwin,
    auth: {
      ...fakeTwin.auth,
      isLiveKey: () => false,
    },
  };
}

export function brokenActionTwin(): TwinDefinition {
  const extra: ActionDefinition = {
    id: "extra.action",
    method: "GET",
    path: "/extra",
    summary: "An action with no route",
    kind: "read",
    handler: () => serviceError(500, "never called"),
  };
  return {
    ...fakeTwin,
    actions: [...fakeTwin.actions, extra],
  };
}

export function headerIdempotencyTwin(): TwinDefinition {
  const adapter: IdempotencyAdapter = {
    mode: "header",
    headerName: "Idempotency-Key",
    maxKeyLength: 64,
    retentionSeconds: 86_400,
    begin: (context) => {
      const key = context.request.headers["idempotency-key"];
      if (key === undefined) {
        return { kind: "proceed", key: null };
      }
      const stored: StoredIdempotency | undefined = context.store.lookup("fake", key);
      if (stored !== undefined) {
        return { kind: "replay", response: stored.response };
      }
      return { kind: "proceed", key };
    },
    complete: (context, response) => {
      context.store.save("fake", {
        key: context.key,
        method: context.request.method,
        path: context.request.path,
        fingerprint: `${context.request.method} ${context.request.path}`,
        response,
        storedAt: context.clock.now(),
      });
    },
  };

  return { ...fakeTwin, idempotency: adapter };
}

export function deterministicRandom(seed: number): CryptoRandom {
  let value = seed;
  return {
    bytes: (length) => {
      const result = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        value = (value * 33 + 17) % 256;
        result[index] = value;
      }
      return result;
    },
  };
}

export const fakeStateSchema = stateSchema as TwinDefinition["state"]["schema"];
export type FakeState = TwinState;
