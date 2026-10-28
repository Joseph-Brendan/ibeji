# Twin framework design

Status: approved in SPEC.md v1.3, C21 decisions D31 to D41. This is a design, not an implementation. No code has been written.

Scope: SPEC.md C2, C3, C4, C5, C6, C7, C10, C12, C13, C17 T14, and B3 goal 7. The three research files are the only source of service facts: `research/paystack.md` (P), `research/flutterwave.md` (F), and `research/stripe.md` (S).

## 1. Comparison of the three services

Every cell cites the research section it comes from. `P` = `research/paystack.md`; `F` = `research/flutterwave.md`; `S` = `research/stripe.md`.

| Row | Paystack | Flutterwave | Stripe |
|---|---|---|---|
| Base URL style | `https://api.paystack.co`, no version segment in the API base; routes such as `/transaction/initialize` (P §0, §1.1). | `https://api.flutterwave.com/v3`; the `/v3` is part of the base URL and routes continue under it (F §0.1, §2.1). | `https://api.stripe.com`; v1 routes begin `/v1/...` (S §0.1, §1.1). |
| Request format | JSON body, `Content-Type: application/json`; query parameters on GETs (P §0, §1.1). | JSON body on POSTs; query parameters on GETs; `Content-Type: application/json` (F §2.1, §2.5, §4.1). | `application/x-www-form-urlencoded`; nested objects as `name[key]`, arrays as `name[]`, object arrays as `name[0][field]` (S §0.2). |
| Authentication | `Authorization: Bearer SECRET_KEY`; secret key required for server calls (P §7). | `Authorization: Bearer <secret key>`; secret key required (F §7). | HTTP Basic Auth with the key as username and empty password; bearer is also documented (S §16, §0.1). |
| Test and live key formats | Test public `pk_test_...`, test secret `sk_test_...`, live public `pk_live_...`, live secret `sk_live_...`; no restricted-key format documented (P §7). | Test public `FLWPUBK_TEST-...`, test secret `FLWSECK_TEST-...`; live public `FLWPUBK-...`, live secret `FLWSECK-...`; exact full live format **UNCONFIRMED**; no restricted-key format documented (F §7). | Test publishable `pk_test_`, test secret `sk_test_`, test restricted `rk_test_`; live publishable `pk_live_`, live secret `sk_live_`, live restricted `rk_live_`; webhook signing secret `whsec_` (S §16). |
| Error shape | `{status: false, message, meta: {nextStep, ...}, type, code, data?}`; statuses 200/201/400/401/404/429/5xx; exact per-action bodies often **UNCONFIRMED** (P §0.11). | Most errors `{status: "error", message, data}`; 500 has `{error_id, message, code: "app_error"}`; 429 body undocumented; statuses include 400/401/429/500/503 (F §1.2, §7). | `{error: {type, code, message, param, decline_code, ...}}`; types `api_error`, `card_error`, `idempotency_error`, `invalid_request_error`; statuses 200/400/401/402/403/404/409/424/429/500/502/503/504 (S §0.3, §0.4). |
| Money units | Whole number in the currency subunit; docs say multiply base amount by 100; XOF has no subunit in display but still must be multiplied by 100 (P §12). | Whole currency amount, not minor units, in documented examples; v3 does not use subunit language (F §12). | Integer in the smallest currency unit; zero-decimal currencies use whole units; zero-decimal list includes BIF, CLP, DJF, GNF, JPY, KMF, KRW, MGA, PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF; ISK/UGX special representation (S §23). |
| Webhook signing or verification | `x-paystack-signature`, HMAC-SHA512 over the raw body, keyed by the secret key, hexadecimal (P §8). | `verif-hash` header containing a shared secret hash; string comparison, not HMAC (F §8). | `Stripe-Signature: t=...,v1=...`, HMAC-SHA256 over `timestamp.rawBody`, `whsec_` endpoint secret, 5-minute default tolerance (S §19). |
| Webhook retries | Live: every 3 minutes for 4 tries, then hourly for 72 hours; test: hourly for 10 hours; 30-second timeout; exactly 200 stops retries (P §9). | If enabled: 3 retries at 30-minute intervals; 60-second timeout; any non-200 fails (F §9). | Live: up to 3 days with exponential backoff; sandbox: 3 retries over a few hours; exact delays not documented; 2xx success (S §20). |
| Idempotency | No general `Idempotency-Key`; transfer references are unique and retries use the same reference; duplicate recipient returns existing record; no documented refund idempotency (P §10). | No general v3 idempotency header; `tx_ref` and transfer reference are unique; duplicate behaviour **UNCONFIRMED**; refund has no documented idempotency (F §10). | `Idempotency-Key` for v1 POST; up to 255 characters; retained at least 24 hours; same key/parameters replays status and body, including 500; different parameters produce `idempotency_error`; concurrent use `409 idempotency_key_in_use` (S §18). |
| Pagination | Mixed offset and cursor `meta` shapes. Offset: `total`, `skipped`, `perPage`, `page`, `pageCount`. Cursor: `next`, `previous`, `perPage`. List endpoints use page/perPage or cursor-style fields (P §0.10, §1.4, §3.3). | `meta.page_info` with `total`, `current_page`, `total_pages`; `page` and sometimes `page_size` (F §2.5, §5.3). | Cursor: `limit` 1–100 default 10, `starting_after`/`ending_before`, list envelope `object: "list"`, `data`, `has_more`, `url` (S §21). |
| Checkout flow | `POST /transaction/initialize` returns `data.authorization_url`; redirect, then verify by reference. Local page outcomes: success, declined, abandoned. Only `charge.success` is documented for success; no failed/abandoned webhook (P §2, §6.2). | `POST /v3/payments` returns `data.link`; redirect, then verify server-side. Local outcomes: success, failed, cancelled; cancelled maps to a documented failed result, not a separate status; `charge.completed` for success/failure (F §3, §6.2). | `POST /v1/checkout/sessions` returns `url`; local outcomes: success, card declined, requires 3DS then approve/fail. Success can produce `checkout.session.completed` and `payment_intent.succeeded`; decline `payment_intent.payment_failed`; 3DS `requires_action` (S §6, §9, §15). |
| Which C5 failures apply | Yes: `server-error`, `rate-limited`, `webhook-verification-fails`, `payment-declined`, `transfer-stuck-pending`, `transfer-reversed` (docs); `slow-response`, `timeout-after-commit`, `timeout-before-commit`, `flaky-network`, `webhook-delayed`, `webhook-duplicated`, `webhook-out-of-order`, `webhook-never-sent`, `bank-resolve-fails` (assumed). No: `authentication-required` (P §14.2). | Yes: `slow-response`, `timeout-after-commit`, `timeout-before-commit`, `server-error`, `rate-limited`, `webhook-duplicated`, `webhook-verification-fails`, `payment-declined`, `transfer-stuck-pending` (docs); `flaky-network`, `webhook-delayed`, `webhook-out-of-order`, `webhook-never-sent`, `bank-resolve-fails` (assumed). No: `authentication-required`; `transfer-reversed` is not supported because v3 has no reversal status/event (C21 D33; F §14.2, §15). | Yes: `timeout-after-commit`, `server-error`, `rate-limited`, `flaky-network`, `webhook-duplicated`, `webhook-out-of-order`, `webhook-verification-fails`, `payment-declined`, `authentication-required` (docs); `slow-response`, `timeout-before-commit`, `webhook-delayed`, `webhook-never-sent` (assumed). No: `transfer-stuck-pending`, `transfer-reversed`, `bank-resolve-fails` (S §26). |

The comparison shows why the framework cannot assume one request parser, one error envelope, one pagination style, one money rule, one idempotency rule, one signer, or one checkout result. Those are per-twin.

## 2. The one shape every twin provides

The core receives a `TwinDefinition`. `TwinId` and `ActionId` are strings; they are not unions or enums that list the three services (C3 rule 8). The registry validates that ids are unique and that all action ids are local `<resource>.<verb>` ids.

```ts
export type TwinDefinition = {
  readonly id: TwinId;                 // "paystack", "flutterwave", "stripe", ...
  readonly displayName: string;
  readonly defaultPort: number;
  readonly actions: readonly ActionDefinition[];
  readonly state: TwinStateDefinition;
  readonly auth: AuthAdapter;
  readonly idempotency: IdempotencyAdapter;
  readonly routes: RouteRegistrar;
  readonly responses: ResponseBuilder;
  readonly failures: FailureAdapter;
  readonly webhooks: WebhookAdapter;
  readonly checkout: CheckoutAdapter;
  readonly credentials: readonly CredentialSpec[];
  readonly money: MoneyRules;
  readonly retry: RetrySchedule;
};
```

- `id` is a runtime string checked by the registry, not a compile-time union.
- `displayName` is what the UI shows.
- `defaultPort` is 4401, 4402, or 4403 in the definition, never in the core.
- `actions` is both the action catalog and the source for action selectors. The core adds the `twin.` prefix for a full id.
- `state` declares the twin's record schema and UI collections; the core stores the JSON state.
- `auth` owns key extraction, live-key detection, and the service's 401 shape.
- `idempotency` is either `none` or the service's replay adapter. The core calls it before the failure step and stores results only after the action is performed (D39).
- `routes` registers the twin's HTTP methods and paths; the twin owns its parser.
- `responses` builds success and service-specific error bodies.
- `failures` declares and shapes the shared failure engine's results.
- `webhooks` builds bodies, signs or marks them, verifies them for conformance, and writes summaries.
- `checkout` declares the local checkout outcomes and applies the tester's choice.
- `credentials` declares the service's credential roles and generation formats.
- `money` owns the service's unit and currency rules.
- `retry` owns the service's webhook retry schedule.

### 2.0 Action catalogs

The concrete definitions have these ids, display names, and default ports:

| Twin id | Display name | Default port |
|---|---|---|
| `paystack` | Paystack | 4401 |
| `flutterwave` | Flutterwave | 4402 |
| `stripe` | Stripe | 4403 |

Action ids are local. The core forms the full id by prefixing the twin id, for example `paystack.refund.create` and `stripe.payment_intent.confirm`. The resource part of a local id also works as an action selector: `refund` means every refund action on that twin.

The two checkout ids are the request/page and the tester's choice. Both have the resource `checkout`, so the selector `checkout` covers the C4 checkout action.

| Twin | Area | Local action ids |
|---|---|---|
| Paystack | Transactions | `transaction.initialize`, `transaction.verify`, `transaction.fetch`, `transaction.list` |
| Paystack | Checkout | `checkout.open`, `checkout.submit` |
| Paystack | Refunds | `refund.create`, `refund.fetch`, `refund.list` |
| Paystack | Transfers | `transfer_recipient.create`, `transfer.create`, `transfer.fetch`, `transfer.verify` |
| Paystack | Banks | `bank.list`, `bank.resolve` |
| Flutterwave | Payments | `payment.create`, `payment.verify`, `payment.verify_by_reference`, `payment.list` |
| Flutterwave | Checkout | `checkout.open`, `checkout.submit` |
| Flutterwave | Refunds | `refund.create`, `refund.fetch`, `refund.list` |
| Flutterwave | Transfers | `transfer.create`, `transfer.fetch`, `transfer.list` |
| Flutterwave | Banks | `bank.list`, `bank.resolve` |
| Stripe | PaymentIntents | `payment_intent.create`, `payment_intent.retrieve`, `payment_intent.confirm`, `payment_intent.cancel`, `payment_intent.list` |
| Stripe | Checkout Sessions | `checkout_session.create`, `checkout_session.retrieve`, `checkout_session.list` |
| Stripe | Checkout | `checkout.open`, `checkout.submit` |
| Stripe | Refunds | `refund.create`, `refund.retrieve`, `refund.list` |
| Stripe | Events | `event.retrieve`, `event.list` |

Flutterwave has no separate `payment.fetch` action because v3 documents no distinct fetch endpoint; `payment.verify` by id is the fetch. Verify by id and verify by reference are separate actions, `payment.verify` and `payment.verify_by_reference`, because each route maps to exactly one action and T14 checks that (C21 D32). Webhooks are not actions: the twin declares them through `WebhookEventDefinition` and emits them from the actions that cause them.

### 2.1 Actions and routes

```ts
export type ActionDefinition = {
  readonly id: ActionId;               // local id: "refund.create"
  readonly method: HttpMethod;
  readonly path: string;               // service-relative, e.g. "/v2/refunds"
  readonly summary: string;            // plain English, for the UI
  readonly kind: "read" | "write" | "checkout";
  readonly handler: ActionHandler;
};

export type ActionHandler = (
  context: ActionContext
) => Promise<TwinResponse> | TwinResponse;

export type RouteRegistrar = (router: TwinRouter) => void;

export type TwinRouter = {
  add(action: ActionDefinition): void;
};

export type ActionContext = {
  readonly action: ActionDefinition;
  readonly request: TwinRequest;       // raw body, headers, query, path params
  readonly state: TwinStateStore;
  readonly failures: ActiveFailureEffects;
  readonly credentials: TwinCredentials;
  readonly clock: Clock;
  readonly random: SeededRandom;
  readonly webhooks: TwinWebhookSink;
};
```

- The twin calls `router.add` for every action. The core checks that the registered route set and `actions` are identical.
- The twin receives the raw request. Paystack and Flutterwave parse JSON; Stripe parses form encoding. No shared parser assumes one format.
- The path includes the service's prefix: Paystack `/transaction/...`, Flutterwave `/v3/...`, Stripe `/v1/...`.
- `state` is a generic JSON-backed store. The twin parses typed records with its own Zod schema; the core does not know record shapes.
- The action handler builds its own success body through `responses`.

### 2.2 State and UI collections

```ts
export type TwinStateDefinition = {
  readonly schema: ZodType<TwinState>;
  readonly initial: () => TwinState;
  readonly collections: readonly CollectionDefinition[];
};

export type CollectionDefinition = {
  readonly id: string;
  readonly label: string;
  readonly columns: readonly CollectionColumn[];
};

export type TwinStateStore = {
  read<T>(collection: string, id: string, schema: ZodType<T>): T | undefined;
  list<T>(collection: string, schema: ZodType<T>): readonly T[];
  insert<T>(collection: string, record: T): void;
  update<T>(collection: string, id: string, record: T): void;
  remove(collection: string, id: string): void;
  reset(): void;
};
```

The core owns storage, reset scope, and export. The twin owns what a record means, which collections appear on the Data page, and how amounts and references are rendered. This is needed because Paystack uses integer ids and mixed timestamp field names, Flutterwave has numeric ids in one place and strings in another, and Stripe has `pi_`, `cs_`, `re_`, and `evt_` objects.

### 2.3 Authentication and live-key detection

```ts
export type AuthAdapter = {
  readonly readKey: (request: TwinRequest) => string | null;
  readonly isLiveKey: (key: string) => boolean;
  readonly classify: (
    key: string | null,
    credentials: TwinCredentials
  ) => AuthResult;
  readonly unauthorized: (result: AuthFailure) => TwinResponse;
};

export type AuthResult =
  | { readonly kind: "valid" }
  | { readonly kind: "missing" }
  | { readonly kind: "wrong" }
  | { readonly kind: "live" };

export type AuthFailure = Exclude<AuthResult, { readonly kind: "valid" }>;
```

- Paystack reads `Authorization: Bearer ...` and rejects `pk_live_`/`sk_live_`.
- Flutterwave reads `Authorization: Bearer ...` and rejects live `FLWPUBK-`/`FLWSECK-` prefixes; its live exact full format is **UNCONFIRMED**, so the prefix is the detector.
- Stripe parses Basic Auth (key as username, empty password) and also accepts the documented bearer form; it rejects `pk_live_`, `sk_live_`, and `rk_live_`.
- The core calls `isLiveKey` before `classify`, records a warning event with only the key fingerprint (C12), and asks the twin for its service-shaped 401. The core never branches on a service id.

### 2.4 Responses and errors

```ts
export type TwinResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
  readonly contentType: string;
};

export type ResponseBuilder = {
  readonly success: (
    action: ActionDefinition,
    data: unknown,
    meta?: unknown
  ) => TwinResponse;
  readonly created: (action: ActionDefinition, data: unknown) => TwinResponse;
  readonly error: (failure: TwinFailure) => TwinResponse;
  readonly notFound: (action?: ActionDefinition) => TwinResponse;
};
```

`TwinFailure` is service-neutral: a failure id, an HTTP status hint, a message, and structured details. The twin maps it to Paystack's `status/message/meta`, Flutterwave's `status/message/data`, or Stripe's `error` object. The core may set the status for a failure, but it never builds the body.

The twin also owns validation errors, unknown-resource errors, and unsupported-resource shapes. For Stripe, the version gate accepts a missing header or a well-formed version and answers as `2026-09-30.endive`; it records a warning once per well-formed version and uses the Stripe response builder only to reject a malformed value (D37).

### 2.5 The shared failure step

The failure engine is pure and lives in the core. It returns a plan. The core applies the plan in the C5 order; the twin turns the plan into its own service result or error.

```ts
export type FailureSupport = {
  readonly id: FailureId;
  readonly source: "docs" | "real-story" | "assumed";
  readonly actions: readonly ActionId[];
};

export type FailureAdapter = {
  readonly support: readonly FailureSupport[];
  readonly httpError: (plan: HttpFailurePlan) => TwinResponse;
  readonly shapeResult: (plan: ResultFailurePlan) => ActiveFailureEffects;
};

export type ActiveFailureEffects = {
  readonly declined?: boolean;
  readonly authenticationRequired?: { readonly then: "succeed" | "fail" };
  readonly transferStuckPending?: {
    readonly thenFailPercent: number;
  };
  readonly transferReversed?: boolean;
  readonly bankResolveFails?: { readonly mode: "error" | "timeout" };
};
```

- The core resolves the action and asks the failure engine for a plan.
- The core applies `flaky-network` before, `rate-limited`, `server-error`, `timeout-before-commit`, then calls the action handler only if the plan allows it.
- The twin's `shapeResult` turns `payment-declined`, `authentication-required`, `transfer-stuck-pending`, `transfer-reversed`, and `bank-resolve-fails` into the service's statuses, bodies, and webhook events. For `transfer-stuck-pending`, the core holds the transfer pending, then the twin resolves it as successful or failed according to `thenFailPercent`, using the service's own statuses and webhooks (D31).
- The twin's `httpError` turns `server-error`, `rate-limited`, and other plan HTTP errors into its own error body. Timeouts produce no body.
- The core applies `timeout-after-commit`, `flaky-network` after, and `slow-response` after the action.
- The core calls the twin's idempotency adapter before the failure step. A replay returns the stored result and skips the failure step; a request that did not perform its action stores nothing (D39).
- The core refuses any failure not in `support` with the Ibeji control error `FAILURE_NOT_SUPPORTED_BY_TWIN`. The twin does not decide support at request time.

### 2.6 Webhook building, signing, and summaries

```ts
export type WebhookAdapter = {
  readonly events: readonly WebhookEventDefinition[];
  readonly build: (
    draft: TwinWebhookDraft,
    state: TwinStateView
  ) => RawWebhook;
  readonly sign: (
    raw: RawWebhook,
    credentials: TwinCredentials,
    options: WebhookSignOptions
  ) => WebhookHeaders;
  readonly verify: (
    raw: RawWebhook,
    headers: WebhookHeaders,
    credentials: TwinCredentials,
    now: Date
  ) => boolean;
  readonly verificationFailures: readonly VerificationFailureMethod[];
  readonly summarize: (
    draft: TwinWebhookDraft,
    raw: RawWebhook
  ) => string;
};

export type WebhookEventDefinition = {
  readonly key: string;               // internal stable key
  readonly wireName: string | null;   // exact service event name; null for FW refund
  readonly objectType: string;
  readonly actions: readonly ActionId[];
};

export type RawWebhook = {
  readonly body: string;
  readonly contentType: "application/json";
};

export type WebhookSignOptions = {
  readonly attempt: number;
  readonly failureMethod?: VerificationFailureMethod;
};

export type VerificationFailureMethod =
  | "wrong-secret"
  | "corrupted"
  | "missing"
  | "stale-timestamp";

export type WebhookHeaders = Readonly<Record<string, string>>;
```

- Paystack builds `{ "event": "...", "data": ... }`; it signs the raw body with HMAC-SHA512 in `x-paystack-signature`.
- Flutterwave builds the normal `{ "event": "...", "data": ... }` for charges and transfers. Its refund webhook is a bare refund object with no event field, so `wireName` is `null` for that event. It marks the request with `verif-hash`.
- Stripe builds a complete Event object with `id`, `object: "event"`, `api_version`, `created`, `data`, `livemode`, `pending_webhooks`, `request`, and `type`. It signs `t=...,v1=...` with HMAC-SHA256 and the `whsec_` credential.
- For Stripe `charge.refunded`, `data.object` is a documented Charge built from the PaymentIntent's own data; its id matches `latest_charge`. There is no Charge API (D34).
- `build` runs when the event is created, so the stored body is exact and a resend can reuse it. `sign` runs for every delivery attempt; Stripe's timestamp is new for each attempt.
- `verify` is used by T14 to prove the twin accepts its own good webhook and rejects each declared tamper method. The runtime dispatcher does not need to verify its own outbound webhooks.
- `verificationFailures` is per twin. All three can do `wrong-secret`, `corrupted`, and `missing`; Stripe can also do `stale-timestamp`. The C5 method setting is validated against this list.
- `summarize` writes plain English using the twin's money formatter, for example "Paystack charge succeeded for NGN 5,000.00", "Flutterwave refund pending for NGN 6,900.00", or "Stripe payment intent succeeded for $20.00". It never includes a full key or a signature.

### 2.7 Checkout outcomes

```ts
export type CheckoutAdapter = {
  readonly outcomes: readonly CheckoutOutcome[];
  readonly page: (context: CheckoutPageContext) => CheckoutPageModel;
  readonly submit: (
    context: CheckoutSubmitContext,
    outcomeId: string,
    authenticationChoice?: "approve" | "fail"
  ) => Promise<CheckoutResult>;
};

export type CheckoutOutcome = {
  readonly id: string;                // stable local outcome id
  readonly label: string;
  readonly description: string;
  readonly authentication?: {
    readonly approveLabel: string;
    readonly failLabel: string;
  };
};

export type CheckoutResult = {
  readonly notice: string;
  readonly webhooks: readonly TwinWebhookDraft[];
};
```

The shared framework renders the page (C10): Ibeji design tokens, no service branding, amount/currency/email/reference from the twin record, outcome buttons, the failure-override notice, and the authentication approve/fail choice. The twin decides what each outcome does to its records and which webhook drafts it emits. The core only renders and dispatches.

Outcome tables:

| Twin | Outcome | What it does |
|---|---|---|
| Paystack | `success` | Transaction becomes `success`; emits `charge.success`. (P §2) |
| Paystack | `declined` | Transaction becomes `failed`; no failed-payment webhook is documented. (P §2) |
| Paystack | `abandoned` | Transaction becomes `abandoned`; no abandoned-payment webhook is documented. (P §2) |
| Flutterwave | `success` | Transaction becomes `successful`; emits `charge.completed` with successful data. (F §3) |
| Flutterwave | `failed` | Transaction becomes `failed`; emits `charge.completed` with failed data. (F §3) |
| Flutterwave | `cancelled` | A local label that produces the documented failed result; v3 has no separate cancelled status. (F §3, §15) |
| Stripe | `success` | PaymentIntent succeeds; Checkout Session completes/paid; emits `checkout.session.completed` and `payment_intent.succeeded`. (S §9, §15) |
| Stripe | `card_declined` | Card error/declined PaymentIntent; emits `payment_intent.payment_failed`; no `checkout.session.completed`. (S §9, §15) |
| Stripe | `requires_authentication` | PaymentIntent `requires_action` with `next_action`; approve succeeds, fail declines; emits the matching PaymentIntent events. (S §9, §15) |

When `payment-declined` or `authentication-required` is on, the failure overrides the tester's button and the page says so (C5). The twin's `submit` implements that override; the shared page only displays the notice.

### 2.8 Credentials

```ts
export type CredentialSpec = {
  readonly id: string;
  readonly label: string;
  readonly role: "public" | "secret" | "webhook";
  readonly secret: boolean;
  readonly generate: (random: CryptoRandom) => string;
  readonly isTestFormat: (value: string) => boolean;
};

export type TwinCredentials = Readonly<Record<string, string>>;
```

Credential roles and formats:

| Twin | Credentials | Generation and use |
|---|---|---|
| Paystack | Public `pk_test_ibeji_...`; secret `sk_test_ibeji_...` | The core generates with a crypto-random source; the secret value authenticates API calls and signs `x-paystack-signature`. No separate webhook secret is invented; Paystack uses the secret key (P §7, §8; C7). |
| Flutterwave | Public `FLWPUBK_TEST-ibeji-...`; secret `FLWSECK_TEST-ibeji-...`; webhook hash `ibeji_...` | The secret authenticates API calls. The separate webhook hash is the value compared to `verif-hash`; v3 requires it (F §7, §8). The encryption key is not issued because C4b's hosted flow does not use direct card-charge encryption. |
| Stripe | Publishable `pk_test_ibeji_...`; secret `sk_test_ibeji_...`; webhook secret `whsec_ibeji_...` | The secret authenticates API calls; the webhook secret signs `Stripe-Signature`. Stripe's restricted-key formats are detected as live/test formats but Ibeji does not issue a restricted key in v1; an app must use the issued secret key. (S §16, §19.) |

The core owns the credentials file, stable issuance, rotation, permission bits, and fingerprinting (C7, C12). The twin owns the format, test/live detection, and which values its auth and signer consume. Every value contains `ibeji` and is in the service's test format. No live value is ever generated or logged.

### 2.9 Money

Inside Ibeji every amount is stored as a whole number in the currency's smallest unit (D38). There is no floating-point amount anywhere in the core or in twin state. Each twin converts at its edge, using its own service rules. Decimal amounts are parsed from the request text digit by digit and converted to smallest-unit integers; they are never parsed with `parseFloat`, `Number`, or floating-point arithmetic.

```ts
export type MoneyRules = {
  readonly zeroDecimal: readonly string[];
  readonly fractionDigits: (currency: string) => number;
  readonly parseServiceAmount: (
    text: string,
    currency: string
  ) => MinorUnits;
  readonly formatServiceAmount: (
    amount: MinorUnits,
    currency: string
  ) => string;
  readonly formatDisplay: (
    amount: MinorUnits,
    currency: string
  ) => string;
  readonly assertValid: (amount: MinorUnits, currency: string) => void;
};

export type MinorUnits = number;
```

- Paystack: the API already sends whole numbers in the currency subunit. `parseServiceAmount` accepts the documented integer shape and returns it unchanged. The documented XOF exception remains: XOF has no display subunit, but Paystack requires the API amount multiplied by 100, so the twin's edge rules preserve that (P §12).
- Flutterwave: v3 sends amounts in the main currency unit, not minor units. `parseServiceAmount` parses the text amount into Ibeji's smallest-unit integer and `formatServiceAmount` writes the main-unit text back to Flutterwave. The documented examples use whole currency amounts. **UNCONFIRMED:** `research/flutterwave.md` §12 does not document how many decimal places v3 allows for each currency, how it rounds excess decimals, or how decimal amounts behave in responses; the twin must not invent those rules. It rejects more decimal places than the currency has only once fixtures or a C21 decision confirm the currency rules.
- Stripe: the API sends whole numbers in the smallest currency unit. `parseServiceAmount` accepts the integer and returns it unchanged. `fractionDigits` is 0 for the zero-decimal list and 2 otherwise, with ISK/UGX special handling; `formatServiceAmount` and `formatDisplay` use the smallest-unit rules (S §23).

The core uses `formatDisplay` for the Data page and event summaries. It uses `assertValid` before action handlers run. The core never converts a service amount; the twin does that at its boundary. This means a Flutterwave decimal amount and a Stripe or Paystack integer amount can both live in Ibeji state as the same kind of minor-unit integer.

`CheckoutPageModel.amountMinor` is a smallest-unit integer. The shared page calls the twin's `formatDisplay`; it never formats with a shared divisor.

### 2.10 Retry schedule

```ts
export type RetrySchedule = {
  readonly source: "docs" | "assumed";
  readonly delaysSeconds: readonly number[];
};
```

`delaysSeconds` are the delays after the first attempt. The core owns the scheduler, attempt recording, jitter only where the twin's schedule says so, and the 10-second no-answer rule in C7. The twin owns the service's schedule.

| Twin | Test-mode schedule | Source |
|---|---|---|
| Paystack | 10 retries, 3600 seconds apart (the documented hourly retry for 10 hours) | P §9, `docs` |
| Flutterwave | 3 retries, 1800 seconds apart (documented when retries are enabled; the twin treats them as enabled) | F §9, `docs` |
| Stripe | 3 retries at 3600, 7200, and 14400 seconds (the docs say 3 times over a few hours; exact delays are not published) | S §20, `assumed` |

C7's fallback schedule (5 retries at 1, 5, 15, 30, 60 minutes) applies where a service has no documented schedule. Stripe has a count and a rough window but not exact delays; the schedule above is approved by D35 and recorded as assumed, not as a Stripe fact.

### 2.11 Supported C5 failures

Each twin's `failures.support` is the authority. The approved matrix is (D31, as changed by D33):

| Failure | Paystack | Flutterwave | Stripe |
|---|---|---|---|
| `slow-response` | yes, assumed | yes, docs | yes, assumed |
| `timeout-after-commit` | yes, assumed | yes, docs | yes, docs |
| `timeout-before-commit` | yes, assumed | yes, docs | yes, assumed |
| `server-error` | yes, docs | yes, docs | yes, docs |
| `rate-limited` | yes, docs | yes, docs | yes, docs |
| `flaky-network` | yes, assumed | yes, assumed | yes, docs |
| `webhook-delayed` | yes, assumed | yes, assumed | yes, assumed |
| `webhook-duplicated` | yes, assumed | yes, docs | yes, docs |
| `webhook-out-of-order` | yes, assumed | yes, assumed | yes, docs |
| `webhook-never-sent` | yes, assumed | yes, assumed | yes, assumed |
| `webhook-verification-fails` | yes, docs | yes, docs | yes, docs |
| `payment-declined` | yes, docs | yes, docs | yes, docs |
| `authentication-required` | no | no | yes, docs |
| `transfer-stuck-pending` | yes, docs | yes, docs | no |
| `transfer-reversed` | yes, docs | no (D33) | no |
| `bank-resolve-fails` | yes, assumed | yes, assumed | no |

`source: docs` means the research cites service documentation. `source: assumed` means the twin offers the failure because C5 requires a synthetic version, but the service documentation does not confirm the exact real-world behavior. The UI/CLI label assumed failures as required by C5. The `actions` list in each `FailureSupport` maps each failure to the actions it can shape. `transfer-stuck-pending` carries the approved `thenFailPercent` setting: after the configured pending time, that percentage of transfers end failed and the rest end successful, using each service's statuses and webhooks (D31). C6's `stuck-payouts` uses 600 seconds and `thenFailPercent` 50.

### 2.12 Supporting types

These are the shared design types behind the signatures above. They are interfaces only; no implementation is proposed here.

```ts
export type TwinId = string;
export type ActionId = string;
export type FailureId = string;
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type TwinState = Readonly<Record<string, JsonValue>>;
export type TwinStateView = Readonly<TwinState>;

export type CollectionColumn = {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "money" | "date";
};

export type TwinRequest = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly params: Readonly<Record<string, string>>;
  readonly rawBody: Uint8Array;
};

export type TwinWebhookDraft = {
  readonly key: string;                // internal stable event key
  readonly actionId: ActionId;
  readonly resourceId: string;
  readonly occurredAt: number;
  readonly data: JsonValue;            // twin-owned snapshot for the body
};

export type TwinWebhookSink = {
  readonly emit: (draft: TwinWebhookDraft) => void;
};

export type CheckoutPageContext = {
  readonly state: TwinStateStore;
  readonly recordId: string;
  readonly failures: ActiveFailureEffects;
  readonly money: MoneyRules;
};

export type CheckoutSubmitContext = CheckoutPageContext & {
  readonly authenticationChoice?: "approve" | "fail";
};

export type CheckoutPageModel = {
  readonly twinDisplayName: string;
  readonly amountMinor: MinorUnits;
  readonly currency: string;
  readonly customerEmail?: string;
  readonly reference: string;
  readonly outcomes: readonly CheckoutOutcome[];
  readonly failureNotice?: string;
};

export type TwinFailure = {
  readonly failureId?: FailureId;
  readonly kind:
    | "invalid-request"
    | "not-found"
    | "unauthorized"
    | "server"
    | "rate-limited"
    | "version-unsupported";
  readonly status?: number;
  readonly message?: string;
  readonly details?: JsonValue;
};

export type HttpFailurePlan = {
  readonly failureId: FailureId;
  readonly actionId: ActionId;
  readonly status: number;
  readonly details?: JsonValue;
};

export type ResultFailurePlan = {
  readonly failureId: FailureId;
  readonly actionId: ActionId;
  readonly effects: ActiveFailureEffects;
};

export type Clock = {
  readonly now: () => number;
};

export type SeededRandom = {
  readonly next: () => number;
};

export type CryptoRandom = {
  readonly bytes: (length: number) => Uint8Array;
};
```

The core owns `Clock`, `SeededRandom`, `CryptoRandom`, and the storage types. The twin receives them but does not create a second clock or random source.

### 2.13 Idempotency

```ts
export type IdempotencyAdapter =
  | { readonly mode: "none" }
  | {
      readonly mode: "header";
      readonly headerName: string;
      readonly maxKeyLength: number;
      readonly retentionSeconds: number;
      readonly begin: (context: IdempotencyBeginContext) => IdempotencyDecision;
      readonly complete: (
        context: IdempotencyCompleteContext,
        response: TwinResponse
      ) => void;
    };

export type IdempotencyBeginContext = {
  readonly request: TwinRequest;
  readonly action: ActionDefinition;
  readonly credentials: TwinCredentials;
  readonly store: IdempotencyStore;
  readonly clock: Clock;
};

export type IdempotencyCompleteContext = {
  readonly key: string;
  readonly request: TwinRequest;
  readonly action: ActionDefinition;
  readonly store: IdempotencyStore;
  readonly clock: Clock;
};

export type IdempotencyDecision =
  | { readonly kind: "proceed"; readonly key: string | null }
  | { readonly kind: "replay"; readonly response: TwinResponse }
  | { readonly kind: "error"; readonly response: TwinResponse };

export type IdempotencyStore = {
  readonly lookup: (
    twinId: TwinId,
    key: string
  ) => StoredIdempotency | undefined;
  readonly save: (twinId: TwinId, record: StoredIdempotency) => void;
};

export type StoredIdempotency = {
  readonly key: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly fingerprint: string;
  readonly response: TwinResponse;
  readonly storedAt: number;
};
```

The core calls `begin` after the action is resolved and authenticated, but **before** the failure step. Its order is:

1. If `mode` is `none`, skip all idempotency handling.
2. Otherwise, `begin` reads the header, checks length, fingerprints the method/path/parameters, looks up the key, and returns `proceed`, `replay`, or `error`.
3. A `replay` returns the stored response immediately; no failure fires and the action is not performed.
4. A new key returns `proceed` with that key and goes to the normal failure step and the action; no header returns `proceed` with `null`.
5. `complete` is called only when the action was performed, produced a response, and `proceed` carried a key. It stores the status, body, and replay headers. If steps 1 to 4 of C5 fired, the action never began, `complete` is not called, and a retry with the same key runs normally.
6. `timeout-after-commit` and `flaky-network` after are applied only after `complete` has stored the result, so a retry with the same key returns the original success.
7. A parameter mismatch or a concurrent same-key request returns the service-shaped error from `begin`.

The adapters are:

| Twin | Idempotency part |
|---|---|
| Paystack | `{ mode: "none" }`. Paystack documents no general idempotency header (P §10). The twin may model the documented transfer-reference and recipient behaviours inside those actions, but there is no general replay adapter. |
| Flutterwave | `{ mode: "none" }`. Flutterwave v3 documents no general idempotency header; v4's `X-Idempotency-Key` is not a v3 fact (F §10). |
| Stripe | Header adapter for `Idempotency-Key`: 255-character maximum, 24-hour retention, method/path/parameter fingerprint, saved status/body replay with `Idempotent-Replayed: true`, a service-shaped `idempotency_error` for a parameter mismatch, and `409 idempotency_key_in_use` for a concurrent same-key request. It applies only to POST; GET and DELETE carry no idempotency effect (S §18; D39). |

Stripe's adapter owns the Stripe error bodies, including the exact ambiguous mismatch status the research leaves **UNCONFIRMED**. Paystack and Flutterwave cannot accidentally inherit it because their adapters are `none`.

## 3. How each service fits

### 3.1 Paystack

Paystack fits directly:

- JSON body parser, helper for query filters, and its own success/error envelopes.
- Bearer secret auth and prefix-based live detection.
- HMAC-SHA512 signer over the raw body with the secret key.
- Transaction, checkout, refund, transfer-recipient, transfer, transfer-verify, bank-list, and bank-resolve actions.
- Two pagination styles are handled by its response builder and list actions; the core never assumes one.
- No general idempotency header; the twin declares `idempotency: { mode: "none" }` (D39) and only the documented transfer/reference behaviours are modeled inside those actions.
- Local checkout has no Paystack HTML API; the twin declares success/declined/abandoned outcomes and the shared renderer shows them. Only `charge.success` is emitted on success.
- Transfer reversal and stuck-pending are documented, so those C5 failures are supported.
- Bank resolve failure has no documented exact failure mode; the twin supports it as assumed.

No Paystack-specific code is needed in the core.

### 3.2 Flutterwave

Flutterwave v3 fits with these approved decisions:

- JSON parser, bearer secret auth, `status/message/data` envelope, and the separate bare-refund webhook shape.
- `verif-hash` is a marker, not an HMAC signature. The `WebhookAdapter.sign` method is named generically "sign" but returns the `verif-hash` header for Flutterwave.
- Checkout uses `POST /v3/payments` → `data.link`; local outcomes use the documented successful/failed states. The `cancelled` button is local and maps to the documented failed result, not an invented status.
- C4b includes a separate "fetch one transaction", but the research found no distinct v3 endpoint. Verify-by-id is the fetch. Verify by id and verify by reference are separate actions, `payment.verify` and `payment.verify_by_reference`, because each route maps to exactly one action and T14 checks that (D32). No `payment.fetch` action exists.
- C5 includes `transfer-reversed` for Flutterwave, but v3 has no reversal status or reversal event. D33 removes Flutterwave from that C5 row rather than inventing a v3 reversal. `transfer-stuck-pending` remains, because v3 documents `PENDING` and test transfers stay pending.
- The v3 refund webhook is a bare object with no event name. `WebhookEventDefinition.wireName` is nullable; the internal event key is `refund`, and the summary says "Flutterwave refund".
- v3 has no general idempotency header. The twin declares `idempotency: { mode: "none" }` (D39).

No Flutterwave-specific branch is needed in the core.

### 3.3 Stripe

Stripe is the hardest fit and must be handled by the adapter, not by a JSON assumption:

- The request parser is form-encoded: `metadata[key]`, `line_items[0][price]`, `name[]`, and `expand[]`. It lives in the Stripe twin.
- Authentication accepts Basic Auth and the documented bearer form. The core does not assume `Authorization: Bearer` for every twin.
- The error builder produces the `{error: {...}}` wrapper and Stripe's status/type/code shape.
- The API-version policy is D37 in the Stripe version gate: a missing header answers as `2026-09-30.endive`; any well-formed version is accepted, answered in the `2026-09-30.endive` shape, and records a warning once per version; only a malformed value is rejected with the Stripe error builder.
- `Idempotency-Key` is the Stripe adapter in §2.13: 255-character maximum, 24-hour retention, method/path/parameter fingerprint, saved status/body replay, mismatch error, and `409 idempotency_key_in_use` for concurrent use. The Stripe twin owns the adapter and its error bodies; the core calls it before the failure step and stores only after the action was performed (D39). Paystack and Flutterwave declare `none`, so the core never applies a replay rule to them.
- Checkout Sessions, Events, and PaymentIntents are all normal actions. The local checkout has the extra approve/fail 3DS choice declared by the Stripe checkout adapter.
- Stripe's `charge.refunded` event carries the documented Charge shape, built from the PaymentIntent's own data. The Charge id matches the PaymentIntent's `latest_charge`. There is no Charge API in v1 (D34).
- Pagination is cursor-only and list envelopes are Stripe-specific, so the list actions and response builder are in the twin.
- Stripe's test webhook retry schedule has no exact delays. The twin declares an assumed schedule.

The Stripe form parser, Basic Auth, version gate, idempotency, and Event objects are all twin-owned. No service is deferred to later.

## 4. What stays in each twin folder and what is shared

### 4.1 Shared core and framework

The following may live in `src/core/`, `src/twins/framework/`, `src/control/`, `src/cli/`, `src/mcp/`, or `src/shared/`:

- HTTP server construction, `127.0.0.1` binding, Host checks, body limit, security headers, no CORS, route dispatch.
- Session lifecycle, ports, state storage, reset scope, export, event log, clock, seeded randomness, scenarios.
- The pure failure engine and its C5 order.
- The optional idempotency store and the `begin`/`complete` orchestration. The adapter is twin-owned; `none` twins never store a result.
- Webhook delivery records, attempts, statuses, address safety, retry scheduling, duplicate/delay/order/never-sent orchestration, resend handling.
- The shared checkout page shell and renderer. It consumes a `CheckoutPageModel` and never knows service names or outcomes.
- Credential storage, stable issuance, rotation, permission bits, and fingerprinting. It calls each `CredentialSpec.generate`.
- Control API, SSE, UI, CLI, MCP. They read `GET /twins`, action metadata, failure support, money rules, and event summaries; they never contain a twin id branch.
- `src/twins/framework/` holds the `TwinDefinition` and adapter types, the shared route pipeline, the shared checkout renderer, and the conformance suite.
- `src/twins/registry.ts` is the only list of twin definitions. Adding a fourth twin is one import/entry plus the new folder (B3 goal 7).

Shared code must not contain service paths, field names, key prefixes, event names, error envelopes, signatures, money rules, pagination rules, or checkout outcome semantics. The comparison table in §1 is the proof that those are not common.

### 4.2 Inside each twin folder

`src/twins/<twin>/` contains:

- `definition.ts` — the `TwinDefinition` object and action catalog.
- `actions/` — request parsers, action handlers, route registration, status transitions.
- `auth.ts` — key extraction, live detection, issued-key comparison, and 401 shaping.
- `idempotency.ts` — `{ mode: "none" }` or the service's header adapter, key/parameter comparison, replay, and error bodies.
- `responses.ts` and `errors.ts` — success and error builders in the service's exact envelope, including 500/429/401 and all C5-shaped errors.
- `state.ts` — the twin's Zod schema, initial state, record types, and UI collection metadata.
- `money.ts` — unit conversion, currency list/special cases, formatting, validation.
- `webhooks/` — event definitions, body builder, signer/marker, verifier, tamper methods, summaries.
- `checkout.ts` — outcomes, page model, submit/apply logic, failure override.
- `credentials.ts` — credential specs and generation formats.
- `failures.ts` — the C5 support list with sources and action mapping.
- `retry.ts` — the retry schedule.
- `data/` — any built-in static data the twin needs, for example bank lists copied from fixtures.
- Tests that are specific to that twin. Cross-twin tests belong in `test/conformance/`.

The twin may have a private HTTP base path helper (for example Flutterwave `/v3`), but the core must not hard-code it.

## 5. T14 conformance suite

`test/conformance/` runs the same suite against every `TwinDefinition` in the registry. It reads the definition; it does not contain a list of service names. Each check runs against every twin.

| Check | What T14 asserts for every twin |
|---|---|
| Definition contract | `id` is unique and non-empty; `displayName` is non-empty; `defaultPort` is a valid unused test port; every action id matches `<resource>.<verb>`; no duplicate ids; every action has a route; every route maps to a declared action; `idempotency` is either `none` or a complete header adapter. |
| Lifecycle | The twin starts with port 0 and `hostname: '127.0.0.1'`, reports its bound port, stops cleanly, and leaves no server or timer. |
| Host and HTTP safety | `127.0.0.1:<port>` and `localhost:<port>` are accepted; other Hosts get the correct forbidden-host result. No CORS headers. HTML has the CSP/referrer rules. Bodies over 1 MB are refused. No outbound request except the test's allowed local webhook receiver. |
| Credentials | Every `CredentialSpec` generates a value containing `ibeji`, matching its test format; values are stable across a restart until rotation; rotation changes all of that twin's credentials; public values are displayable; secret values are never emitted in events, logs, exports, or summaries. |
| Authentication | A missing key, wrong key, another twin's key, publishable key where a secret is required, and every known live prefix each get the service's own 401 shape. A live key also records the warning event and red-banner signal with only a fingerprint. A valid issued key works. |
| Action/route parity | Every declared action is reachable at its declared method/path; unknown paths/methods return the service's not-found shape; query/path parsing matches that twin's service; action ids resolve through resource and full-id selectors. |
| Events | Every request emits a request event and a response event with the twin scope, action id, status, and no secrets. Checkout and webhook actions likewise emit scoped events. |
| Failure support | For every `FailureSupport`, the control API accepts the rule on a listed action; the shared failure step fires; the response/result is in the twin's shape; counters and action selectors work; the failure's source label is exposed. For every unsupported failure pair, the control API returns `FAILURE_NOT_SUPPORTED_BY_TWIN` and the twin is never called. |
| Failure order | The shared C5 order is observed for each declared request/webhook failure: pre-network, rate, server, timeout-before, action, timeout-after, network-after, slow-response; webhook never-sent, verification, out-of-order, delay, duplicate. The twin only shapes outcomes; it does not reorder. A stuck transfer resolves after its configured time using the seeded random and `thenFailPercent`; the result uses the twin's statuses and webhooks. |
| Checkout | The page is served on the twin port; it shows the Ibeji label, amount, currency, email/reference from the twin record, declared outcomes, and no service branding. The POST choice is checked for the twin's own Origin. Each outcome produces the declared state and webhook drafts. Payment-declined and authentication-required override the button and show the notice. |
| Webhook build/sign | A declared event produces the exact documented body shape; `sign` returns the service's headers or marker; the twin's own `verify` accepts the untampered body and rejects tampering. |
| Webhook verification failures | Every method the twin declares (`wrong-secret`, `corrupted`, `missing`, and Stripe's `stale-timestamp`) fails that twin's own `verify`; a good delivery still passes. Methods the twin does not declare are rejected by the control API. |
| Webhook delivery behaviours | `webhook-never-sent` records `not-sent`; `webhook-delayed` delays the first attempt; duplicated copies have the same event id and body; out-of-order holds and releases newest first; retries follow the twin's schedule; resend uses the same body and current credentials. |
| Money | Every stored amount is a smallest-unit integer; `parseServiceAmount` converts service text at the edge without floating point; `formatServiceAmount`/`formatDisplay` produce the documented service and UI forms; `assertValid`, `fractionDigits`, and zero-decimal handling match the twin's research, with Flutterwave decimal limits remaining UNCONFIRMED. |
| Idempotency | With a header adapter, the core calls `begin` before the failure step: the same key/parameters replay the stored response without rerunning either the failure step or the action; a different parameter set is rejected in the service's shape; concurrent same-key returns the declared conflict. `complete` stores only after the action was performed; a server-error or timeout-before retry with the same key runs normally, while timeout-after replays the original success. A `none` twin applies no replay dedupe. |
| Event summaries | Every declared webhook event has a non-empty plain-English summary containing the service name, event meaning, and formatted amount/reference where applicable; no key, signature, or raw JSON is included. |
| Registry extensibility | The conformance suite discovers all twins from `registry.ts` and runs without edits; a synthetic fourth definition with the same interface passes the contract/lifecycle checks without core changes. This protects B3 goal 7. |

T14 does not replace T3 (fixture shapes), T4 (failure behaviour), T5 (webhooks), or T6 (security); it proves that every twin is a conforming definition and that the shared framework can drive it.

## 6. How the dispatcher calls a signer without knowing the service

The core webhook dispatcher works only through the `TwinDefinition` interface. In order:

1. Read the delivery record's `twinId` and ask the registry for that definition. The dispatcher never compares the id to a known service.
2. Use the `rawBody` stored when the event was created; that body came from `twin.webhooks.build`.
3. Call `twin.webhooks.sign(rawBody, credentials, { attempt: delivery.attemptNumber, failureMethod: delivery.failureMethod })`.
4. Send the stored body and returned headers to the checked address.

- `registry.require(delivery.twinId)` returns the interface. The dispatcher never compares the id to a known service.
- `delivery.rawBody` was produced by that twin's `webhooks.build` when the event was recorded. The body is stored, so resends use the same bytes.
- `sign` is called for every attempt. Paystack and Flutterwave produce the same header each time; Stripe produces a new timestamp/signature for each attempt.
- For `webhook-verification-fails`, the core passes `failureMethod`; the twin's signer decides how to make the delivery fail its own verifier. The core does not know whether that means HMAC, a shared hash, or a timestamp.
- `webhook-never-sent` never calls the dispatcher. `webhook-delayed`, `webhook-duplicated`, and `webhook-out-of-order` operate on delivery records in the core before/around this call.
- Retry scheduling uses `twin.retry`; the core records the schedule and the twin does not run its own loop.
- The core's UI calls `twin.webhooks.summarize` for plain English and never parses a service body.
- `twin.webhooks.verify` is used by the conformance suite, not by the outbound dispatcher. It proves the signer and verifier agree and that declared tamper methods fail.

This is the C3 rule: the core orchestrates, the twin owns the service-specific body and signature.

## 7. Approved C21 decisions

These decisions are approved in SPEC.md v1.3, C21 D31 to D41. The design matches them; there are no pending proposed decisions in this file.

### 7.1 Approved service versions

- **D40 — Flutterwave API v3.0.0 is approved.** The twin uses `/v3` routes, bearer auth, `verif-hash`, whole-currency amounts at the service edge, and no v3 idempotency. Flutterwave v4 is not imitated in v1.
- **D41 — Stripe API version `2026-09-30.endive` is approved.** The Stripe twin answers in that shape. D37 governs how the `Stripe-Version` header is handled.

### 7.2 Approved framework decisions

**D31 — The C5 support matrix in §2.11 is approved, as changed by D33.**

- Paystack supports every C5 failure except `authentication-required`.
- Flutterwave supports every C5 failure except `authentication-required` and `transfer-reversed`.
- Stripe supports every C5 failure except `transfer-stuck-pending`, `transfer-reversed`, and `bank-resolve-fails`.
- Failures marked `assumed` are offered with the "Assumed" label.
- `transfer-stuck-pending` includes `thenFailPercent`: after the configured pending time, that share of transfers ends failed and the rest ends successful, using the service's own statuses and webhooks.

**D32 — Flutterwave has no separate fetch action.**

Verify by id is the fetch. Verify by id and verify by reference are separate actions, `payment.verify` and `payment.verify_by_reference`, because each route maps to exactly one action and T14 checks that. No `payment.fetch` action or invented path exists.

**D33 — `transfer-reversed` applies to Paystack only.**

Flutterwave v3 documents no reversal status or event. The Flutterwave twin does not advertise `transfer-reversed`; the C5 row is Paystack-only. Flutterwave v4's `transfer.reversal` is not a v3 fact.

**D34 — Stripe's `charge.refunded` event carries a documented Charge object.**

The Stripe twin builds the Charge from the PaymentIntent's own data, following the documented Charge shape in `research/stripe.md`, and the Charge id matches the PaymentIntent's `latest_charge`. This is event payload data only; there is no Charge API in v1.

**D35 — Retry schedules are approved.**

Paystack test mode uses 10 retries hourly (documented); Flutterwave v3 uses 3 retries at 30 minutes (documented, treated as enabled); Stripe sandbox uses 3 retries at 1, 2, and 4 hours (assumed, because Stripe documents three retries over a few hours but not exact delays). C7's fallback remains for a future twin with no schedule.

**D36 — Flutterwave's local "cancelled" outcome produces the documented failed result.**

The local page labels the choice "Cancelled", but Flutterwave v3 has no separate cancelled status. The record and webhook use the documented failed result.

**D37 — Stripe version-header handling is approved.**

- No `Stripe-Version` header: the twin answers as `2026-09-30.endive`.
- A well-formed version, meaning a date optionally followed by a dot and a name such as `2025-09-30.clover`: the twin accepts it, answers in the `2026-09-30.endive` shape, and records a warning event once per version: "Your app asked for Stripe API version X. The Stripe twin answers as 2026-09-30.endive, so some fields may differ."
- A malformed value: the twin rejects it with Stripe's error envelope and `invalid_request_error`. `research/stripe.md` §17 records that Stripe's exact behavior for an arbitrary invalid version is **UNCONFIRMED**; the twin must not invent a new error code.
- The warning contains no key material and is scoped to the Stripe twin.

**D38 — Money is stored inside Ibeji in smallest-unit whole numbers.**

The core and every twin state store amounts as `MinorUnits` integers. Each twin converts at its edge:

- Paystack and Stripe already send whole numbers in the smallest unit; their edge parsers accept the integer.
- Flutterwave v3 sends main-unit amounts. Its edge parser converts the request text to `MinorUnits` without floating-point arithmetic, and its formatter writes main-unit text back.
- Decimal amounts are parsed from text digit by digit. `parseFloat`, `Number`, and floating-point arithmetic are never used for money.
- The twin rejects more decimal places than the currency has, in the service's own error shape.
- **UNCONFIRMED:** `research/flutterwave.md` §12 does not document the allowed decimal places, rounding, or decimal response behavior for Flutterwave v3 currencies. The Flutterwave twin must not invent those rules; it uses fixtures or a future C21 decision.

**D39 — `TwinDefinition` includes idempotency.**

The `idempotency` part is an adapter or `{ mode: "none" }`. The core calls `begin` after authentication/action resolution and **before** the failure step. A replay returns the stored response and skips both the failure step and the action. The core calls `complete` only when the action was performed and produced a response; results are stored only then. If `server-error`, `rate-limited`, or `timeout-before-commit` fires, nothing is stored and a retry with the same key runs normally. `timeout-after-commit` stores the result before the reply is lost, so a retry returns the original success.

- Paystack: `{ mode: "none" }` (P §10).
- Flutterwave: `{ mode: "none" }` (F §10).
- Stripe: a header adapter for `Idempotency-Key` with 255-character maximum, 24-hour retention, method/path/parameter fingerprint, saved status/body replay, `Idempotent-Replayed: true`, a service-shaped mismatch error, and `409 idempotency_key_in_use` for concurrent same-key use (S §18).

## 8. Decision summary

The approved design satisfies SPEC.md v1.3 and C21 D31 to D41:

1. The comparison table and research citations are correct.
2. `TwinDefinition` is the only contract the core uses.
3. The three services fit through their own parsers, auth adapters, idempotency adapters, error builders, signers, checkout adapters, money rules, and failure maps.
4. Shared code contains only the orchestration and UI pieces that all three use.
5. T14 can run against every registry entry without a service switch.
