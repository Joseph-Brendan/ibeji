Stripe is a trademark of its owner. Ibeji is not affiliated with Stripe.

# Stripe research for Ibeji

Research date: **28 October 2026**. The API version studied and proposed for the twin is **`2026-09-30.endive`**, which Stripe's versioning page names as the current version and which the official `stripe` Node package 23.0.1 pins in `cjs/apiVersion.js`.

Source rule: every Stripe fact below comes from Stripe's official documentation at `docs.stripe.com` and its API reference, except where this file explicitly labels a source exception. The source exceptions are the official `stripe` Node package itself (for the library's base-URL options and pinned API version) and the official Stripe `stripe-mock` repository (because `docs.stripe.com` has no stripe-mock page). No Paystack or Flutterwave research file was read or used.

## 0. Common request and response rules

### 0.1 Base URL and authentication

- Base URL: `https://api.stripe.com`.
- API version studied: `2026-09-30.endive`.
- All paths below are under that base URL. The v1 paths begin `/v1/`.
- Stripe v1 requests are authenticated with HTTP Basic Auth. The API key is the username; the password is empty. The documentation's curl form is `-u sk_test_...:`. The colon prevents curl from asking for a password.
- Stripe also documents bearer auth for cross-origin requests: `Authorization: Bearer <key>`. The ordinary server-side form is Basic Auth.
- The key decides live mode versus test mode. Test secret keys start with `sk_test_`; test restricted keys start with `rk_test_`; live secret keys start with `sk_live_`; live restricted keys start with `rk_live_`.
- Publishable keys cannot authenticate these server-side calls. The documented error code for a publishable key where a secret key is required is `secret_key_required`.

### 0.2 Request encoding

Stripe v1 request bodies are **form-encoded**, `application/x-www-form-urlencoded`. The API reference says: "accepts form-encoded request bodies, returns JSON-encoded responses". JSON request bodies are not the documented format for these v1 endpoints.

The documentation's curl examples use `-d` and, for values that need URL encoding, `--data-urlencode`. The twin must parse the same bracket notation that Stripe's libraries emit.

| Shape | Encoding | Exact documentation example |
|---|---|---|
| Nested object | `name[subfield]=value` | `automatic_payment_methods[enabled]=true` |
| Metadata | `metadata[key]=value` | `metadata[order_id]=6735` |
| Array of objects | `name[index][field]=value` | `line_items[0][price]=...`, `line_items[0][quantity]=2` |
| Deeply nested object | `name[index][field][subfield]=value` | `line_items[0][price_data][product_data][name]=...` |
| Scalar array | `name[]=value`, repeated | `expand[]=customer`, `types[]=payment_intent.succeeded` |
| Date filter | `created[gte]=...` or `created[lte]=...` | Stripe list filters use a nested `created` object |
| Empty metadata value | `metadata[key]=` unsets that key; `metadata=` unsets all keys | Stripe metadata documentation |

- Repeated fields use the same bracket name for each value, for example `types[]=payment_intent.succeeded` and `types[]=payment_intent.payment_failed`.
- Scalar arrays may also be sent as comma-separated values in some Stripe SDK/CLI contexts, but the documented raw HTTP examples use `[]=`. The twin must accept the bracket form.
- `GET` list filters use the same bracket notation in the query string, for example `?limit=3&starting_after=pi_...` and `?created[gte]=...`.
- `expand[]` is the documented expansion syntax. Expansions can be nested with dots, for example `expand[]=payment_intent.customer`.
- Request headers relevant to this research: `Stripe-Version` and `Idempotency-Key`. They are headers, not form fields.

### 0.3 Common error response

Stripe's error response is an object with a required `error` member. The documented card-error example in Stripe's declines guide uses that wrapper, and the API error reference defines these attributes on the error member:

| Field | Type | Meaning |
|---|---|---|
| `advice_code` | string, nullable | Advice for an issuer decline. |
| `charge` | string, nullable | ID of the failed charge for card errors. |
| `code` | string, nullable | Programmatic error code, when present. |
| `decline_code` | string, nullable | Card issuer's decline reason. |
| `doc_url` | string, nullable | Documentation URL for the error code. |
| `message` | string, nullable | Human-readable message. |
| `network_advice_code` | string, nullable | Two-digit network advice code. |
| `network_decline_code` | string, nullable | Network decline reason. |
| `param` | string, nullable | Parameter related to the error. |
| `payment_intent` | object, nullable | PaymentIntent associated with the error. |
| `payment_method` | object, nullable | PaymentMethod associated with the error. |
| `payment_method_type` | string, nullable | Payment-method type for invoice-related errors. |
| `request_log_url` | string, nullable | Dashboard request-log link. |
| `setup_intent` | object, nullable | SetupIntent associated with the error. |
| `source` | object, nullable | Source associated with the error. |
| `type` | enum | One of `api_error`, `card_error`, `idempotency_error`, `invalid_request_error`. |

A documented card-error example, quoted from the Stripe declines guide:

```json
{
  "error": {
    "code": "incorrect_cvc",
    "doc_url": "https://docs.stripe.com/error-codes#incorrect-cvc",
    "message": "Your card's security code is incorrect.",
    "param": "cvc",
    "type": "card_error"
  }
}
```

A broader shape, using only documented fields, is:

```json
{
  "error": {
    "type": "card_error",
    "code": "card_declined",
    "decline_code": "generic_decline",
    "message": "Your card was declined.",
    "param": null,
    "doc_url": "https://docs.stripe.com/error-codes#card-declined",
    "charge": "ch_...",
    "payment_intent": { "id": "pi_...", "object": "payment_intent" },
    "payment_method": { "id": "pm_...", "object": "payment_method" }
  }
}
```

The fields other than `type` are nullable. Do not assume that every error includes `charge`, `payment_intent`, or `payment_method`.

### 0.4 Documented HTTP statuses and error types

The API error reference documents these statuses:

| Status | Stripe's meaning |
|---|---|
| `200` | Everything worked as expected. |
| `400` | Bad Request: unacceptable request, often a missing required parameter. |
| `401` | Unauthorized: no valid API key provided. |
| `402` | Request Failed: parameters were valid but the request failed. |
| `403` | Forbidden: the API key lacks permission. |
| `404` | Not Found: the requested resource does not exist. |
| `409` | Conflict: conflicts with another request, perhaps the same idempotency key. |
| `424` | External Dependency Failed. |
| `429` | Too Many Requests; Stripe recommends exponential backoff. |
| `500`, `502`, `503`, `504` | Server Errors on Stripe's side. |

The four documented error `type` values are:

- `api_error` — temporary or other server-side problem.
- `card_error` — a card or payment method could not be charged.
- `idempotency_error` — an idempotency key reused on a request that does not match the first request's endpoint and parameters.
- `invalid_request_error` — invalid parameters or invalid request state.

Relevant documented `code` values for C4c include:

- Card/payment: `card_declined`, `expired_card`, `incorrect_cvc`, `incorrect_number`, `processing_error`, `authentication_required`, `authentication_failure`, `payment_intent_payment_attempt_failed`, `payment_method_provider_decline`, `payment_method_provider_timeout`, `payment_method_restricted`.
- Request: `parameter_missing`, `parameter_unknown`, `parameter_invalid_empty`, `resource_missing`, `amount_too_small`, `amount_too_large`, `charge_already_refunded`, `charge_disputed`, `intent_invalid_state`, `payment_intent_unexpected_state`.
- Authentication/permission: `api_key_expired`, `secret_key_required`.
- Idempotency: `idempotency_key_in_use`.
- Rate limiting: `rate_limit`.

The error reference also documents these idempotency-specific facts:

- `409` can indicate another request with the same idempotency key is still executing.
- `idempotency_key_in_use` means the key is currently being used in another request.
- The `Idempotent-Replayed: true` response header identifies a replayed saved response.
- The `Stripe-Should-Retry` response header can be `true`, `false`, or absent.

Action sections below refer back to this shape and list action-specific errors. Stripe docs do not publish a separate error subtype or separate wrapper for each endpoint.

### 0.5 List envelope

Every v1 list endpoint returns:

```json
{
  "object": "list",
  "url": "/v1/payment_intents",
  "has_more": false,
  "data": []
}
```

| Field | Type | Meaning |
|---|---|---|
| `object` | string, value `"list"` | The list envelope. |
| `data` | array | Objects in this page. |
| `has_more` | boolean | Whether more results exist. |
| `url` | string | The list URL. |

`limit` is documented as 1 to 100, default 10. `starting_after` and `ending_before` are mutually exclusive cursors. Lists are returned in reverse chronological order. See §21 for pagination details.

### 0.6 Event envelope and snapshot events

C4c's Events action and webhooks use Stripe's **snapshot Event** object, not the newer thin-event notification object. The Event object's `data.object` is the affected resource, and updated events may include `data.previous_attributes`.

```json
{
  "id": "evt_...",
  "object": "event",
  "api_version": "2026-09-30.endive",
  "created": 1686089970,
  "data": {
    "object": {
      "id": "pi_...",
      "object": "payment_intent"
    }
  },
  "livemode": false,
  "pending_webhooks": 0,
  "request": {
    "id": "req_...",
    "idempotency_key": null
  },
  "type": "payment_intent.created"
}
```

The exact Event object fields are in §13.1.

Stripe now recommends thin events for new integrations, but thin events are not the C4c model: C4c requires retrieving and listing Stripe's Event objects, and the documented v1 Events API returns snapshot Event objects. The twin should implement snapshot events and the v1 Events API, and should not silently implement thin events instead.

### 0.7 Scope boundary

C4c covers PaymentIntents, Checkout Sessions, the local checkout page, Refunds, Events, and webhooks. It explicitly excludes Stripe payouts and Stripe Connect transfers. Therefore:

- This research does not document payout or Connect-transfer endpoints.
- Connect-only fields such as `application_fee_amount`, `on_behalf_of`, `transfer_data`, `transfer_group`, `refund_application_fee`, and `reverse_transfer` are recorded as out of scope.
- Stripe's `charge` object is not a C4c action. A `charge.refunded` event payload is a `charge`, however, so the twin needs a decision about that one event; see §15 and §27.
- C4c has no Charge API, Customer API, Price API, PaymentMethod API, or webhook-endpoint management API. The twin may need local internal records for IDs it must return, but it does not need to expose those APIs.

## 1. PaymentIntents — Create

**Documentation:** `https://docs.stripe.com/api/payment_intents/create`
**Date:** 28 October 2026.

### 1.1 Method, path, base URL

```text
POST https://api.stripe.com/v1/payment_intents
```

### 1.2 Request format

Form-encoded body. Nested objects use bracket notation. Arrays use `[]`; arrays of objects use `[index][field]`; metadata uses `metadata[key]`. See §0.2.

### 1.3 Request fields needed for C4c

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | integer | yes | Positive integer in the smallest currency unit. Minimum 0.50 USD or currency equivalent. Supports up to eight digits. |
| `currency` | enum/string | yes | Lowercase three-letter ISO currency. |
| `automatic_payment_methods[enabled]` | boolean | no | Enables Stripe's dynamic payment methods. The documented create example uses `true`. |
| `payment_method_types[]` | array of enums | no | Explicit payment-method list. The example response commonly contains `card` and `link`; this is Stripe's dynamic result, not a guarantee. |
| `payment_method` | string | no | PaymentMethod ID to attach. |
| `confirm` | boolean | no | `true` creates and confirms in one call; confirm-only fields may then be supplied. |
| `customer` | string | no | Customer ID. Not implemented by C4c itself; the twin can accept an ID only if it chooses to model customers locally. |
| `description` | string | no | Arbitrary description. |
| `metadata` | map | no | `metadata[key]=value`; values are strings; keys can be unset with an empty value. |
| `receipt_email` | string | no | Email for a receipt. |
| `setup_future_usage` | enum | no | `off_session` or `on_session`. |
| `capture_method` | enum | no | `automatic`, `automatic_async`, or `manual`. |
| `confirmation_method` | enum | no | `automatic` or `manual`. |
| `statement_descriptor` | string | no | Non-card statement descriptor; setting it for a card charge is documented to return an error. |
| `statement_descriptor_suffix` | string | no | Card statement descriptor suffix. |
| `return_url` | string | no | Only used with `confirm=true`; where to send the customer after authentication or cancellation. |
| `off_session` | boolean or string | no | Only with `confirm=true`; indicates the customer is not in the checkout flow. |
| `error_on_requires_action` | boolean | no | Only with `confirm=true`; fail rather than transition to `requires_action`. |
| `payment_method_options[card][request_three_d_secure]` | enum | no | Requests 3DS behavior for card payments. The twin uses test outcomes, not a real card network. |
| `payment_method_data` | object | no | Creates a PaymentMethod inline. The documented object is large; C4c can accept a test PaymentMethod ID instead. |
| `expand[]` | array of strings | no | Expands expandable fields in the response. |

Out of scope for C4c: Connect and application-fee fields, and unrelated industry-specific fields.

### 1.4 Response object

`object` value: **`"payment_intent"`**.

This is the complete top-level PaymentIntent field set from the current API reference. "Scope" means the field matters to C4c or to a documented event the twin must produce.

| Field | Type | Scope | Notes |
|---|---|---|---|
| `id` | string | yes | `pi_...`. |
| `object` | string | yes | Always `payment_intent`. |
| `allowed_payment_method_types` | array of enums, nullable | no | Dynamic payment-method filtering. |
| `amount` | integer | yes | Smallest currency unit. |
| `amount_capturable` | integer | yes | For manual capture. |
| `amount_details` | object, nullable | no | Industry-specific details. |
| `amount_received` | integer | yes | Amount collected. |
| `application` | string, nullable | no | Connect application. |
| `application_fee_amount` | integer, nullable | no | Connect. |
| `automatic_payment_methods` | object, nullable | yes | Dynamic payment-method settings. |
| `canceled_at` | timestamp, nullable | yes | Seconds since Unix epoch. |
| `cancellation_reason` | enum, nullable | yes | `abandoned`, `automatic`, `duplicate`, `expired`, `failed_invoice`, `fraudulent`, `requested_by_customer`, `void_invoice`. |
| `capture_method` | enum | yes | `automatic`, `automatic_async`, `manual`. |
| `client_secret` | string, nullable | yes | Client-side secret. Never log it. |
| `confirmation_method` | enum | yes | `automatic`, `manual`. |
| `created` | timestamp | yes | Seconds since Unix epoch. |
| `currency` | enum | yes | Lowercase ISO code. |
| `customer` | string, nullable, expandable | partial | Only if the twin models a customer ID. |
| `customer_account` | string, nullable | no | Accounts v2 customer representation. |
| `description` | string, nullable | yes | Arbitrary description. |
| `excluded_payment_method_types` | array of enums, nullable | no | Dynamic filtering. |
| `hooks` | object, nullable | no | Automations. |
| `last_payment_error` | object, nullable | yes | Last confirmation error; same error attributes as §0.3. Cleared when the PaymentIntent is updated. |
| `latest_charge` | string, nullable, expandable | yes | Charge ID created by confirmation. C4c does not implement the Charge API. |
| `livemode` | boolean | yes | `false` in test mode. |
| `managed_payments` | object, nullable | no | Managed Payments settings. |
| `metadata` | map | yes | String key-value pairs. |
| `next_action` | object, nullable | yes | For `requires_action`; see §1.5 and §9. |
| `on_behalf_of` | string, nullable | no | Connect. |
| `payment_details` | object, nullable | no | Industry-specific. |
| `payment_method` | string, nullable, expandable | yes | PaymentMethod ID. |
| `payment_method_configuration_details` | object, nullable | no | Dynamic configuration details. |
| `payment_method_options` | object, nullable | yes | Payment-method-specific options. |
| `payment_method_types` | array of strings | yes | Allowed payment-method types. |
| `payment_record` | string, nullable | no | Payment Record. |
| `presentment_details` | object, nullable | no | Currency conversion display. |
| `processing` | object, nullable | yes | Present while processing. |
| `receipt_email` | string, nullable | yes | Receipt email. |
| `review` | string, nullable | no | Radar review. |
| `setup_future_usage` | enum, nullable | yes | `off_session`, `on_session`. |
| `shipping` | object, nullable | no | Shipping information. |
| `source` | string, nullable | no | Present in the API example; legacy source object field. Not in the current attribute list. |
| `statement_descriptor` | string, nullable | no | Non-card descriptor. |
| `statement_descriptor_suffix` | string, nullable | no | Card descriptor suffix. |
| `status` | enum | yes | `requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`, `requires_capture`, `canceled`, `succeeded`. |
| `transfer_data` | object, nullable | no | Connect. |
| `transfer_group` | string, nullable | no | Connect. |

### 1.5 Documented example

This is Stripe's documented create response. Field availability can vary with account settings and payment-method configuration.

```json
{
  "id": "pi_3MtwBwLkdIwHu7ix28a3tqPa",
  "object": "payment_intent",
  "amount": 2000,
  "amount_capturable": 0,
  "amount_details": { "tip": {} },
  "amount_received": 0,
  "application": null,
  "application_fee_amount": null,
  "automatic_payment_methods": { "enabled": true },
  "canceled_at": null,
  "cancellation_reason": null,
  "capture_method": "automatic",
  "client_secret": "pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH",
  "confirmation_method": "automatic",
  "created": 1680800504,
  "currency": "usd",
  "customer": null,
  "description": null,
  "last_payment_error": null,
  "latest_charge": null,
  "livemode": false,
  "metadata": {},
  "next_action": null,
  "on_behalf_of": null,
  "payment_method": null,
  "payment_method_options": {
    "card": {
      "installments": null,
      "mandate_options": null,
      "network": null,
      "request_three_d_secure": "automatic"
    },
    "link": { "persistent_token": null }
  },
  "payment_method_types": ["card", "link"],
  "processing": null,
  "receipt_email": null,
  "review": null,
  "setup_future_usage": null,
  "shipping": null,
  "source": null,
  "statement_descriptor": null,
  "statement_descriptor_suffix": null,
  "status": "requires_payment_method",
  "transfer_data": null,
  "transfer_group": null
}
```

### 1.6 Errors

Common shape and status table: §0.3–§0.4.

- Missing or invalid auth: `401`; exact body/message for a missing key is **UNCONFIRMED** beyond the error envelope.
- Missing `amount` or `currency`: `400` `invalid_request_error`, commonly `parameter_missing`.
- Invalid amount: `400`, commonly `amount_too_small`, `amount_too_large`, or `invalid_charge_amount`.
- Unknown parameter: `400`, commonly `parameter_unknown`.
- Declined card when creating with `confirm=true`: `402` `card_error`, commonly `card_declined` and a `decline_code`.
- Permission problem: `403`.
- Idempotency conflict: `409` or `idempotency_error`; see §18.
- Rate limit: `429` with code `rate_limit`.
- Server failure: `500`, `502`, `503`, `504` with `api_error`.

### 1.7 Webhooks triggered

- **`payment_intent.created`** — `data.object` is a `payment_intent`.
- If the create includes `confirm=true`, the confirm events in §3.7 can also occur.
- Creating a PaymentIntent may also cause Stripe-generated `charge.*` events, but Charge is outside C4c; the twin should not invent a Charge API. See §27.

## 2. PaymentIntents — Retrieve

**Documentation:** `https://docs.stripe.com/api/payment_intents/retrieve`
**Date:** 28 October 2026.

### 2.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/payment_intents/{PAYMENT_INTENT_ID}
```

### 2.2 Request format

No form body. Query parameters use the same bracket notation if nested:

| Field | Type | Required | Notes |
|---|---|---|---|
| `client_secret` | string | conditional | Required only when retrieving with a publishable key. |
| `expand[]` | array of strings | no | Expands expandable fields. |

### 2.3 Response object

`object` value: **`"payment_intent"`**. Same complete field table as §1.4. The documented example returns the same shape with the stored status.

### 2.4 Documented example

```json
{
  "id": "pi_3MtwBwLkdIwHu7ix28a3tqPa",
  "object": "payment_intent",
  "amount": 2000,
  "currency": "usd",
  "status": "requires_payment_method",
  "client_secret": "pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH",
  "metadata": {},
  "payment_method": null,
  "latest_charge": null,
  "last_payment_error": null,
  "next_action": null,
  "livemode": false
}
```

The ellipsis-free full shape is the field table in §1.4; this example omits only fields whose values are unchanged from that table.

### 2.5 Errors

- Valid ID: `200`.
- Unknown ID: `404` `invalid_request_error`, commonly `resource_missing`.
- Missing/invalid key: `401`.
- No permission: `403`.
- Rate limit: `429`.
- Server failure: `500`, `502`, `503`, `504`.

### 2.6 Webhooks triggered

None. Retrieval is a read-only action and does not create an event.

## 3. PaymentIntents — Confirm

**Documentation:** `https://docs.stripe.com/api/payment_intents/confirm`
**Date:** 28 October 2026.

### 3.1 Method, path, base URL

```text
POST https://api.stripe.com/v1/payment_intents/{PAYMENT_INTENT_ID}/confirm
```

### 3.2 Request format

Form-encoded body. See §0.2.

### 3.3 Request fields needed for C4c

| Field | Type | Required | Notes |
|---|---|---|---|
| `payment_method` | string | no | PaymentMethod ID. If absent, Stripe can use an attached/default method under its documented rules. |
| `return_url` | string | no | Where to send the customer after authentication or cancellation. Used by cards and redirect methods. |
| `capture_method` | enum | no | `automatic`, `automatic_async`, `manual`. |
| `confirmation_token` | string | no | ConfirmationToken ID. |
| `error_on_requires_action` | boolean | no | Fail instead of returning `requires_action`. |
| `off_session` | boolean or string | no | Customer is not in the checkout flow. |
| `payment_method_options[card][request_three_d_secure]` | enum | no | Forces/requests 3DS behavior. |
| `payment_method_data` | object | no | Creates a PaymentMethod inline. |
| `receipt_email` | string | no | Receipt email. |
| `setup_future_usage` | enum | no | `off_session` or `on_session`. |
| `shipping` | object | no | Shipping information. |
| `use_stripe_sdk` | boolean | no | For Stripe.js/mobile confirmation flows. |
| `mandate` | string | no | Mandate ID. |
| `mandate_data` | object | no | Mandate creation data. |
| `amount_to_confirm` | integer | no | Confirms a different amount; defaults to `amount`. |

Out of scope: Connect, application fees, and industry-specific fields.

### 3.4 Response object

`object` value: **`"payment_intent"`**. Same complete field table as §1.4.

Documented status transitions:

- Success without manual capture: `succeeded`.
- Success with `capture_method=manual`: `requires_capture`.
- Extra customer action: `requires_action` with `next_action`; for 3DS this is `redirect_to_url` with `url` and `return_url`.
- Failure: `requires_payment_method`, or `canceled` if the confirmation limit is reached.
- Async processing: `processing`.

### 3.5 Documented 3DS `next_action` shape

```json
{
  "next_action": {
    "type": "redirect_to_url",
    "redirect_to_url": {
      "url": "https://hooks.stripe.com/...",
      "return_url": "https://mysite.com"
    }
  }
}
```

`next_action.redirect_to_url.url` and `.return_url` are documented as nullable strings. Other `next_action` variants exist for non-card methods but are outside C4c.

### 3.6 Errors

- Missing PaymentIntent: `404` `resource_missing`.
- Already canceled or not confirmable: `400` `invalid_request_error`, commonly `intent_invalid_state` or `payment_intent_unexpected_state`.
- Card declined: `402` `card_error`, commonly `card_declined` with `decline_code`; the PaymentIntent can also transition to `requires_payment_method`.
- Authentication required but forbidden by `error_on_requires_action`: `400`/`402` with `authentication_required` or `payment_intent_action_required`; exact status for the specific combination is **UNCONFIRMED** in the cited pages.
- Authentication failed: `402` `card_error` with `authentication_failure` or `payment_intent_authentication_failure`.
- Rate limit, server errors, idempotency errors as §0.4.

### 3.7 Webhooks triggered

Exact documented PaymentIntent events that can follow confirmation:

- `payment_intent.requires_action` — `data.object` is `payment_intent`; transitions to `requires_action`.
- `payment_intent.processing` — `data.object` is `payment_intent`.
- `payment_intent.succeeded` — `data.object` is `payment_intent`.
- `payment_intent.payment_failed` — `data.object` is `payment_intent`; inspect `last_payment_error`.
- `payment_intent.amount_capturable_updated` — `data.object` is `payment_intent`; relevant to manual capture.
- `payment_intent.canceled` — `data.object` is `payment_intent`; possible when the confirmation limit is reached.
- `payment_intent.partially_funded` — documented for customer_balance PaymentIntents; outside C4c.

Stripe may also emit `charge.succeeded` or `charge.failed`; Charge is outside C4c. See §27.

## 4. PaymentIntents — Cancel

**Documentation:** `https://docs.stripe.com/api/payment_intents/cancel`
**Date:** 28 October 2026.

### 4.1 Method, path, base URL

```text
POST https://api.stripe.com/v1/payment_intents/{PAYMENT_INTENT_ID}/cancel
```

### 4.2 Request format

Form-encoded body.

### 4.3 Request field

| Field | Type | Required | Notes |
|---|---|---|---|
| `cancellation_reason` | string | no | Documented values: `duplicate`, `fraudulent`, `requested_by_customer`, `abandoned`. |

### 4.4 Response object

`object` value: **`"payment_intent"`**. Same complete field table as §1.4. On success the documented response has `status: "canceled"`, a populated `canceled_at`, and no further charges.

Cancellation is documented only for `requires_payment_method`, `requires_capture`, `requires_confirmation`, `requires_action`, or, in rare cases, `processing`. For a Checkout Session's PaymentIntent, direct cancellation is documented only for `requires_capture`; otherwise expire the Checkout Session. C4c does not include the expire-session action.

### 4.5 Errors

- Already canceled or not cancelable: `400` `invalid_request_error`; exact code is **UNCONFIRMED** on the cancel page.
- Unknown ID: `404` `resource_missing`.
- Auth/permission/rate/server errors as §0.4.

### 4.6 Webhooks triggered

- **`payment_intent.canceled`** — `data.object` is a `payment_intent`.

## 5. PaymentIntents — List

**Documentation:** `https://docs.stripe.com/api/payment_intents/list`
**Date:** 28 October 2026.

### 5.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/payment_intents
```

### 5.2 Request format

Query string. No body.

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | no | 1–100; default 10. |
| `starting_after` | string | no | Cursor; mutually exclusive with `ending_before`. |
| `ending_before` | string | no | Cursor; mutually exclusive with `starting_after`. |
| `customer` | string | no | Filter by Customer ID. |
| `customer_account` | string | no | Accounts v2 filter. |
| `created` | object or integer | no | Unix timestamp or nested filter. |
| `expand[]` | array of strings | no | Expands fields on returned objects. |

### 5.3 Response

`object` value: **`"list"`**. `data` entries are `payment_intent` objects. See §0.5 and §1.4.

```json
{
  "object": "list",
  "url": "/v1/payment_intents",
  "has_more": false,
  "data": [
    {
      "id": "pi_3MtwBwLkdIwHu7ix28a3tqPa",
      "object": "payment_intent",
      "amount": 2000,
      "currency": "usd",
      "status": "requires_payment_method",
      "livemode": false,
      "metadata": {}
    }
  ]
}
```

The full item shape is §1.4.

### 5.4 Errors

- Invalid `limit`: `400` invalid request.
- Invalid cursor: `400`; exact code **UNCONFIRMED**.
- Auth/permission/rate/server errors as §0.4.

### 5.5 Webhooks triggered

None.

## 6. Checkout Sessions — Create

**Documentation:** `https://docs.stripe.com/api/checkout/sessions/create`
**Date:** 28 October 2026.

### 6.1 Method, path, base URL

```text
POST https://api.stripe.com/v1/checkout/sessions
```

### 6.2 Request format

Form-encoded body. Arrays of line items use `line_items[0][...]`; metadata uses `metadata[key]`; scalar arrays use `[]`. See §0.2.

### 6.3 Request fields needed for C4c

| Field | Type | Required | Notes |
|---|---|---|---|
| `mode` | enum | yes | `payment`, `setup`, or `subscription`. C4c uses `payment` for the normal checkout. |
| `line_items` | array of objects | conditionally required | Required for `payment` and `subscription`; up to 100 one-time items for `payment`. |
| `line_items[0][price]` | string | one of `price`/`price_data` | Existing Price/Plan ID. |
| `line_items[0][price_data]` | object | one of `price`/`price_data` | Inline Price. |
| `line_items[0][price_data][currency]` | enum | yes for `price_data` | Lowercase ISO currency. |
| `line_items[0][price_data][product]` | string | one of `product`/`product_data` | Existing Product ID. |
| `line_items[0][price_data][product_data]` | object | one of `product`/`product_data` | Inline Product. |
| `line_items[0][price_data][product_data][name]` | string | yes for inline Product | Product name. |
| `line_items[0][price_data][product_data][description]` | string | no | Product description. |
| `line_items[0][price_data][product_data][images]` | array of strings | no | Image URLs. |
| `line_items[0][price_data][product_data][metadata]` | map | no | Product metadata. |
| `line_items[0][price_data][unit_amount]` | integer | one of `unit_amount`/`unit_amount_decimal` | Smallest currency unit. |
| `line_items[0][price_data][unit_amount_decimal]` | string | one of the two | Decimal string in the smallest unit, at most 12 decimal places. |
| `line_items[0][quantity]` | integer | conditionally required | Quantity; documented as required conditionally. |
| `line_items[0][metadata]` | map | no | Line-item metadata. |
| `line_items[0][adjustable_quantity]` | object | no | `enabled` required if used; `minimum`/`maximum` optional. |
| `success_url` | string | conditionally required | Required for hosted-page payment when a success redirect is needed. |
| `cancel_url` | string | no | Back/cancel URL for hosted Checkout. |
| `client_reference_id` | string | no | Up to 200 characters. |
| `customer` | string | no | Existing Customer ID. |
| `customer_email` | string | no | Prefill email; up to 800 characters. |
| `customer_creation` | enum | no | `always` or `if_required`. |
| `metadata` | map | no | Session metadata. |
| `payment_method_types[]` | array of enums | no | Static list. |
| `payment_method_options[card][request_three_d_secure]` | enum | no | 3DS behavior. |
| `payment_intent_data` | object | no | Subset of PaymentIntent parameters for `payment` mode. |
| `expires_at` | timestamp | no | 30 minutes to 24 hours after creation; default 24 hours. |
| `locale` | enum | no | Checkout display locale. |
| `submit_type` | enum | no | `auto`, `book`, `donate`, `pay`, `subscribe`. |
| `billing_address_collection` | enum | no | `auto` or `required`. |
| `phone_number_collection` | object | no | Controls phone collection. |
| `automatic_tax` | object | no | Tax calculation settings. |
| `allow_promotion_codes` | boolean | no | Enables promotion codes. |
| `discounts` | array of objects | no | Coupon/promotion code; up to one. |
| `shipping_options` | array of objects | no | Up to five shipping rates. |
| `ui_mode` | enum | no | `hosted_page` (default), `embedded_page`, `elements`, or `form`. C4c uses hosted page. |
| `return_url` | string | conditionally required | Required for embedded/elements with redirect methods. |
| `payment_method_collection` | enum | no | `always` or `if_required`. |
| `expand[]` | array of strings | no | Expands fields. |

C4c does not implement Products, Prices, Customers, Coupons, Tax, ShippingRates, or PaymentMethods. Therefore the twin must model enough local IDs/records to accept the documented inline `price_data` route and/or accept synthetic IDs. That is an implementation decision, not a new Stripe endpoint.

### 6.4 Response object

`object` value: **`"checkout.session"`**.

| Field | Type | Scope | Notes |
|---|---|---|---|
| `id` | string | yes | `cs_...`. |
| `object` | string | yes | Always `checkout.session`. |
| `adaptive_pricing` | object, nullable | no | Adaptive Pricing. |
| `after_expiration` | object, nullable | no | Recovery/expiry actions. |
| `allow_promotion_codes` | boolean, nullable | no | Promo-code setting. |
| `allowed_payment_method_types` | array of strings, nullable | no | Dynamic filter. |
| `amount_subtotal` | integer, nullable | yes | Before discounts/tax. |
| `amount_total` | integer, nullable | yes | After discounts/tax. |
| `automatic_tax` | object | no | Tax state. |
| `billing_address_collection` | enum, nullable | no | Address collection. |
| `branding_settings` | object, nullable | no | Branding. |
| `cancel_url` | string, nullable | yes | Cancel return URL. |
| `client_reference_id` | string, nullable | yes | Caller reference. |
| `client_secret` | string, nullable | no | Embedded/elements only; not hosted page. |
| `collected_information` | object, nullable | no | Collected customer information. |
| `consent` | object, nullable | no | Consent results. |
| `consent_collection` | object, nullable | no | Consent settings. |
| `created` | timestamp | yes | Seconds since Unix epoch. |
| `currency` | enum, nullable | yes | Lowercase ISO code. |
| `currency_conversion` | object, nullable | no | Adaptive Pricing legacy. |
| `custom_fields` | array of objects | no | Up to three. |
| `custom_text` | object | no | Text customizations. |
| `customer` | string, nullable, expandable | partial | Customer ID. |
| `customer_account` | string, nullable | no | Accounts v2. |
| `customer_creation` | enum, nullable | no | `always` or `if_required`. |
| `customer_details` | object, nullable | yes | Collected email/name/address/tax IDs. |
| `customer_email` | string, nullable | yes | Prefilled email. |
| `discounts` | array of objects, nullable | no | Applied discounts. |
| `excluded_payment_method_types` | array of strings, nullable | no | Dynamic filter. |
| `expires_at` | timestamp | yes | Session expiry. |
| `integration_identifier` | string, nullable | no | Caller identifier. |
| `invoice` | string, nullable, expandable | no | Invoice ID. |
| `invoice_creation` | object, nullable | no | Invoice settings. |
| `line_items` | object, nullable, includable | partial | Not returned by default; request with `expand`. |
| `livemode` | boolean | yes | `false` in test mode. |
| `locale` | enum, nullable | no | Display locale. |
| `managed_payments` | object, nullable | no | Managed Payments. |
| `metadata` | map, nullable | yes | Session metadata. |
| `mode` | enum | yes | `payment`, `setup`, `subscription`. |
| `name_collection` | object, nullable | no | Name collection. |
| `optional_items` | array of objects, nullable, includable | no | Optional add-ons. |
| `origin_context` | enum, nullable | no | `mobile_app` or `web`. |
| `payment_intent` | string, nullable, expandable | yes | PaymentIntent ID in `payment` mode. |
| `payment_link` | string, nullable, expandable | no | Payment Link ID. |
| `payment_method_collection` | enum, nullable | no | `always` or `if_required`. |
| `payment_method_configuration_details` | object, nullable | no | Dynamic configuration. |
| `payment_method_options` | object, nullable | partial | Payment-method settings. |
| `payment_method_types` | array of strings | yes | Allowed types. |
| `payment_status` | enum | yes | `paid`, `unpaid`, `no_payment_required`. |
| `permissions` | object, nullable | no | Embedded/elements permissions. |
| `phone_number_collection` | object, nullable | no | Phone collection. |
| `presentment_details` | object, nullable | no | Currency display. |
| `recovered_from` | string, nullable | no | Original expired session. |
| `redirect_on_completion` | enum, nullable | no | Embedded-page redirect setting. |
| `return_url` | string, nullable | no | Embedded/elements return URL. |
| `saved_payment_method_options` | object, nullable | no | Saved-method settings. |
| `setup_intent` | string, nullable, expandable | no | SetupIntent ID in `setup` mode. |
| `shipping_address_collection` | object, nullable | no | Shipping address collection. |
| `shipping_cost` | object, nullable | no | Chosen shipping cost. |
| `shipping_details` | object, nullable | no | Present in the API example; not in the current attribute list. |
| `shipping_options` | array of objects | no | Shipping rate options. |
| `status` | enum, nullable | yes | `open`, `complete`, `expired`. |
| `submit_type` | enum, nullable | no | `auto`, `book`, `donate`, `pay`, `subscribe`. |
| `subscription` | string, nullable, expandable | no | Subscription ID. |
| `success_url` | string, nullable | yes | Success return URL. |
| `tax_id_collection` | object, nullable | no | Tax ID collection. |
| `total_details` | object, nullable | yes | Discount/shipping/tax totals. |
| `ui_mode` | enum, nullable | yes | `hosted_page` for C4c. |
| `url` | string, nullable | yes | Hosted Checkout URL; present only while active. |
| `wallet_options` | object, nullable | no | Wallet configuration. |

### 6.5 Documented example

```json
{
  "id": "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u",
  "object": "checkout.session",
  "after_expiration": null,
  "allow_promotion_codes": null,
  "amount_subtotal": 2198,
  "amount_total": 2198,
  "automatic_tax": { "enabled": false, "liability": null, "status": null },
  "billing_address_collection": null,
  "cancel_url": null,
  "client_reference_id": null,
  "consent": null,
  "consent_collection": null,
  "created": 1679600215,
  "currency": "usd",
  "custom_fields": [],
  "custom_text": { "shipping_address": null, "submit": null },
  "customer": null,
  "customer_creation": "if_required",
  "customer_details": null,
  "customer_email": null,
  "expires_at": 1679686615,
  "invoice": null,
  "invoice_creation": {
    "enabled": false,
    "invoice_data": {
      "account_tax_ids": null,
      "custom_fields": null,
      "description": null,
      "footer": null,
      "issuer": null,
      "metadata": {},
      "rendering_options": null
    }
  },
  "livemode": false,
  "locale": null,
  "metadata": {},
  "mode": "payment",
  "payment_intent": null,
  "payment_link": null,
  "payment_method_collection": "always",
  "payment_method_options": {},
  "payment_method_types": ["card"],
  "payment_status": "unpaid",
  "phone_number_collection": { "enabled": false },
  "recovered_from": null,
  "setup_intent": null,
  "shipping_address_collection": null,
  "shipping_cost": null,
  "shipping_details": null,
  "shipping_options": [],
  "status": "open",
  "submit_type": null,
  "subscription": null,
  "success_url": "https://example.com/success",
  "total_details": { "amount_discount": 0, "amount_shipping": 0, "amount_tax": 0 },
  "return_url": null,
  "ui_mode": "hosted_page",
  "url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

The `url` value in the documentation is a long signed URL; it is shortened here only for readability. The field table in §6.4 is the complete shape.

### 6.6 Errors

- Missing `mode`: `400` `parameter_missing`.
- Missing `line_items` in `payment` mode: `400`; exact code **UNCONFIRMED** but it is an invalid-request error.
- Both `price` and `price_data`, or neither: `400` invalid request.
- Invalid `success_url`/`cancel_url`: `400` `url_invalid` or invalid request.
- Unknown/invalid Price/Customer/Product ID: `400` `resource_missing` or invalid request.
- Auth/permission/rate/server errors as §0.4.

### 6.7 Webhooks triggered

Stripe's event catalog does **not** document a `checkout.session.created` event. Creating a session itself is not a documented webhook trigger. The created session can later emit:

- `checkout.session.completed` — `data.object` is `checkout.session`.
- `checkout.session.async_payment_succeeded` — `data.object` is `checkout.session`.
- `checkout.session.async_payment_failed` — `data.object` is `checkout.session`.
- `checkout.session.expired` — `data.object` is `checkout.session`.

The corresponding PaymentIntent events can also occur. See §15.

## 7. Checkout Sessions — Retrieve

**Documentation:** `https://docs.stripe.com/api/checkout/sessions/retrieve`
**Date:** 28 October 2026.

### 7.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/checkout/sessions/{SESSION_ID}
```

### 7.2 Request format

No body. Query parameter:

| Field | Type | Required | Notes |
|---|---|---|---|
| `expand[]` | array of strings | no | Expands expandable/includable fields, including `line_items`. |

### 7.3 Response object

`object` value: **`"checkout.session"`**. Same complete field table as §6.4.

### 7.4 Documented example

The retrieve response is the same documented object, for example with `status: "open"`, `payment_status: "unpaid"`, and a `url` while active.

### 7.5 Errors

- Unknown session: `404` `resource_missing`.
- Invalid/missing auth: `401`.
- No permission: `403`.
- Rate/server errors: `429`, `500`, `502`, `503`, `504`.

### 7.6 Webhooks triggered

None.

## 8. Checkout Sessions — List

**Documentation:** `https://docs.stripe.com/api/checkout/sessions/list`
**Date:** 28 October 2026.

### 8.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/checkout/sessions
```

### 8.2 Request fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | no | 1–100; default 10. |
| `starting_after` | string | no | Cursor; mutually exclusive with `ending_before`. |
| `ending_before` | string | no | Cursor; mutually exclusive with `starting_after`. |
| `created` | object or integer | no | Date filter. |
| `customer` | string | no | Customer ID. |
| `customer_account` | string | no | Accounts v2 customer. |
| `customer_details` | object | no | Email filter. |
| `payment_intent` | string | no | PaymentIntent ID. |
| `payment_link` | string | no | Payment Link ID. |
| `status` | enum | no | `complete`, `expired`, `open`. |
| `subscription` | string | no | Subscription ID. |
| `expand[]` | array of strings | no | Expansion. |

### 8.3 Response

`object` value: **`"list"`**; `data` entries are `checkout.session` objects. See §0.5 and §6.4.

### 8.4 Errors

- Invalid filter/cursor: `400` invalid request.
- Auth/permission/rate/server errors as §0.4.

### 8.5 Webhooks triggered

None.

## 9. Checkout — local test checkout page

**Documentation:** `https://docs.stripe.com/testing`, `https://docs.stripe.com/payments/3d-secure/authentication-flow`, and `https://docs.stripe.com/api/payment_intents/object#payment_intent_object-next_action`
**Date:** 28 October 2026.

### 9.1 Method, path, base URL

This is **not a Stripe HTTP endpoint**. It is Ibeji's local test page. Stripe's hosted Checkout is the `url` returned by `POST /v1/checkout/sessions`; Stripe does not document a test-outcome API for that page.

The twin's page must be local, must say it is a test checkout, and must not use Stripe branding (SPEC C20). The page is reached from the created session's `url` field or an equivalent local URL; the exact local path is a C4 design decision.

### 9.2 Request format

HTML form/navigation, not Stripe form encoding. The page needs the local Checkout Session and its amount/currency. The tester picks one of C4c's outcomes:

1. Success.
2. Card declined.
3. Requires extra authentication, then approve or fail.

### 9.3 Fields and outcomes

| Field/choice | Type | Notes |
|---|---|---|
| Session ID | string | Local Checkout Session identifier. |
| Amount/currency | integer/string | From the session. |
| Outcome | enum | `success`, `card_declined`, `requires_authentication`. |
| Authentication result | enum | `approve` or `fail`, when authentication was selected. |
| Test card | string | Optional display/choice using Stripe's documented test cards. |

Stripe's documented outcomes that guide the page:

- A successful card produces a PaymentIntent that can reach `succeeded`, and the Checkout Session can reach `status: "complete"` with `payment_status: "paid"`.
- A declined card produces a `card_error` such as `card_declined` with a `decline_code`; a PaymentIntent payment failure is documented as `payment_intent.payment_failed`, and the PaymentIntent can return to `requires_payment_method`.
- A 3DS-required payment produces `status: "requires_action"` and `next_action.type: "redirect_to_url"` with `next_action.redirect_to_url.url` and `.return_url`.
- After authentication, the PaymentIntent is documented to become `succeeded` or `requires_payment_method` depending on success; a failed authentication can also use `authentication_failure`/`payment_intent_authentication_failure`.
- Checkout Session `status` is `open`, `complete`, or `expired`; `payment_status` is `paid`, `unpaid`, or `no_payment_required`.
- `checkout.session.completed` is documented when a Checkout Session is successfully completed. For delayed payment methods, `payment_status` can still be `unpaid` at that moment; `checkout.session.async_payment_succeeded` follows later.

### 9.4 Response and resulting state

The local page returns HTML and then updates local records. The documented Stripe state names the twin should use are:

- Success: Checkout Session `status: "complete"`, `payment_status: "paid"`; PaymentIntent `status: "succeeded"`.
- Decline: PaymentIntent `status: "requires_payment_method"` and `last_payment_error` with a `card_error`; Checkout Session remains open unless the twin chooses to model expiry. The exact Stripe Checkout UI after a decline is **UNCONFIRMED** in the API docs; the local page can allow retry.
- Authentication required: PaymentIntent `status: "requires_action"` with `next_action.redirect_to_url`; after approve, `succeeded`; after fail, `requires_payment_method` or a failed authentication error.
- Session expiry: `status: "expired"`; `checkout.session.expired`.

The local page's precise sequence is Ibeji's design, using Stripe's documented statuses and events; it is not a Stripe endpoint and must not be presented as one.

### 9.5 Errors

- Unknown local session: local Ibeji error/page; no Stripe shape required because this is not a Stripe endpoint.
- Invalid outcome choice: local validation error.
- If the twin exposes a Stripe-shaped API response after the local action, use the common Stripe error shape only for the API part.

### 9.6 Webhooks triggered by C4c outcomes

- Success: `checkout.session.completed` (`data.object` = `checkout.session`) and `payment_intent.succeeded` (`data.object` = `payment_intent`).
- Declined: `payment_intent.payment_failed` (`data.object` = `payment_intent`); `checkout.session.completed` is not documented for a failed payment.
- Authentication required: `payment_intent.requires_action` (`data.object` = `payment_intent`); after approve, `payment_intent.succeeded`; after fail, `payment_intent.payment_failed`.
- Session expiry: `checkout.session.expired` (`data.object` = `checkout.session`).

`checkout.session.async_payment_*` is documented for delayed payment methods, not for the simple card outcomes in this local page. Exact local emission order is **UNCONFIRMED** as a Stripe fact; it is an Ibeji design choice.

## 10. Refunds — Create

**Documentation:** `https://docs.stripe.com/api/refunds/create`
**Date:** 28 October 2026.

### 10.1 Method, path, base URL

```text
POST https://api.stripe.com/v1/refunds
```

### 10.2 Request format

Form-encoded body. Metadata uses `metadata[key]`; see §0.2.

### 10.3 Request fields for C4c

| Field | Type | Required | Notes |
|---|---|---|---|
| `charge` | string | one of `charge`/`payment_intent` | Charge ID to refund. |
| `payment_intent` | string | one of `charge`/`payment_intent` | PaymentIntent ID to refund. |
| `amount` | integer | no | Partial refund in smallest currency unit; defaults to the remaining refundable amount. Cannot exceed it. |
| `metadata` | map | no | Refund metadata. |
| `reason` | string | no | `duplicate`, `fraudulent`, `requested_by_customer`. |
| `instructions_email` | string | no | For payment methods without native refund support. |
| `origin` | enum | no | Documented value `customer_balance`; outside C4c's card flow. |
| `refund_application_fee` | boolean | no | Connect only; out of scope. |
| `reverse_transfer` | boolean | no | Connect only; out of scope. |
| `expand[]` | array of strings | no | Expansion. |

C4c has no Charges API, so `charge` IDs are not created by a C4c action. The documented C4c-compatible path is to refund by `payment_intent`. The twin can keep an internal charge-like ID for `latest_charge`, but it must not claim a Charge API.

### 10.4 Response object

`object` value: **`"refund"`**.

| Field | Type | Scope | Notes |
|---|---|---|---|
| `id` | string | yes | `re_...`. |
| `object` | string | yes | Always `refund`. |
| `amount` | integer | yes | Smallest currency unit. |
| `balance_transaction` | string, nullable, expandable | no | Balance transaction. |
| `charge` | string, nullable, expandable | partial | Charge ID. |
| `created` | timestamp | yes | Seconds since Unix epoch. |
| `currency` | enum | yes | Lowercase ISO code. |
| `customer` | string, nullable, expandable | no | Customer ID. |
| `customer_account` | string, nullable | no | Accounts v2. |
| `description` | string, nullable | no | Non-card refund description. |
| `destination_details` | object, nullable | no | Card/network details. |
| `failure_balance_transaction` | string, nullable, expandable | no | Adjustment after failure. |
| `failure_reason` | string, nullable | yes | `lost_or_stolen_card`, `expired_or_canceled_card`, `charge_for_pending_refund_disputed`, `insufficient_funds`, `declined`, `merchant_request`, `unknown`. |
| `instructions_email` | string, nullable | no | Refund instructions. |
| `metadata` | map, nullable | yes | Refund metadata. |
| `next_action` | object, nullable | no | For `requires_action`. |
| `payment_intent` | string, nullable, expandable | yes | PaymentIntent ID. |
| `payment_method` | string, nullable, expandable | no | PaymentMethod ID. |
| `pending_reason` | enum, nullable | no | `processing`, `insufficient_funds`, `charge_pending`. |
| `presentment_details` | object, nullable | no | Currency display. |
| `reason` | enum, nullable | yes | `duplicate`, `fraudulent`, `requested_by_customer`, `expired_uncaptured_charge`. |
| `receipt_number` | string, nullable | no | Email receipt number. |
| `source_transfer_reversal` | string, nullable, expandable | no | Connect. |
| `status` | string, nullable | yes | `pending`, `requires_action`, `succeeded`, `failed`, `canceled`. |
| `transfer_reversal` | string, nullable, expandable | no | Connect. |

### 10.5 Documented example

```json
{
  "id": "re_1Nispe2eZvKYlo2Cd31jOCgZ",
  "object": "refund",
  "amount": 1000,
  "balance_transaction": "txn_1Nispe2eZvKYlo2CYezqFhEx",
  "charge": "ch_1NirD82eZvKYlo2CIvbtLWuY",
  "created": 1692942318,
  "currency": "usd",
  "destination_details": {
    "card": {
      "reference": "123456789012",
      "reference_status": "available",
      "reference_type": "acquirer_reference_number",
      "type": "refund"
    },
    "type": "card"
  },
  "metadata": {},
  "payment_intent": "pi_1GszsK2eZvKYlo2CfhZyoZLp",
  "reason": null,
  "receipt_number": null,
  "source_transfer_reversal": null,
  "status": "succeeded",
  "transfer_reversal": null
}
```

### 10.6 Errors

- Neither `charge` nor `payment_intent`: `400` invalid request.
- Unknown charge/PaymentIntent: `404` `resource_missing`.
- Refund exceeds remaining amount: `400`; commonly `amount_too_large` or `invalid_charge_amount`.
- Already fully refunded: `400` `charge_already_refunded`.
- Disputed charge: `400` `charge_disputed`.
- Refund on a pending/unavailable charge: `400`; exact code **UNCONFIRMED**.
- Auth/permission/rate/server errors as §0.4.

### 10.7 Webhooks triggered

- `refund.created` — `data.object` is `refund`.
- `charge.refunded` — `data.object` is `charge` (not `refund`). This is a C4c gap because Charge is not a C4c action.
- `refund.updated` — `data.object` is `refund`; later updates on all refunds.
- `refund.failed` — `data.object` is `refund`.
- `charge.refund.updated` — `data.object` is `refund`; documented for selected payment methods.

## 11. Refunds — Retrieve

**Documentation:** `https://docs.stripe.com/api/refunds/retrieve`
**Date:** 28 October 2026.

### 11.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/refunds/{REFUND_ID}
```

### 11.2 Request format

No body; `expand[]` optional.

### 11.3 Response object

`object` value: **`"refund"`**. Same complete table as §10.4.

### 11.4 Documented example

Same documented example as §10.5; the returned status can be `pending`, `requires_action`, `succeeded`, `failed`, or `canceled`.

### 11.5 Errors

- Unknown refund: `404` `resource_missing`.
- Auth/permission/rate/server errors as §0.4.

### 11.6 Webhooks triggered

None.

## 12. Refunds — List

**Documentation:** `https://docs.stripe.com/api/refunds/list`
**Date:** 28 October 2026.

### 12.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/refunds
```

### 12.2 Request fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | no | 1–100; default 10. |
| `starting_after` | string | no | Cursor. |
| `ending_before` | string | no | Cursor; mutually exclusive with `starting_after`. |
| `charge` | string | no | Filter by charge. |
| `payment_intent` | string | no | Filter by PaymentIntent. |
| `created` | object or integer | no | Date filter. |
| `expand[]` | array of strings | no | Expansion. |

### 12.3 Response

`object` value: **`"list"`**; `data` entries are `refund` objects. See §0.5 and §10.4.

### 12.4 Errors

- Invalid filter/cursor: `400`.
- Unknown charge filter ID: documented as an error; exact code **UNCONFIRMED**.
- Auth/permission/rate/server errors as §0.4.

### 12.5 Webhooks triggered

None.

## 13. Events — Retrieve

**Documentation:** `https://docs.stripe.com/api/events/retrieve`
**Date:** 28 October 2026.

### 13.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/events/{EVENT_ID}
```

Documented retention: events can be retrieved if created in the last 30 days. List events also goes back up to 30 days.

### 13.2 Request format

No body. `expand[]` optional if an expandable field is present.

### 13.3 Response object

`object` value: **`"event"`**.

| Field | Type | Scope | Notes |
|---|---|---|---|
| `id` | string | yes | `evt_...`. |
| `object` | string | yes | Always `event`. |
| `account` | string, nullable | no | Connected account. |
| `api_version` | string, nullable | yes | Version used to render `data` at creation; immutable. |
| `context` | string, nullable | no | Authentication context. |
| `created` | timestamp | yes | Seconds since Unix epoch. |
| `data` | object | yes | Contains `object` and, when applicable, `previous_attributes`. |
| `livemode` | boolean | yes | `false` in test mode. |
| `pending_webhooks` | integer | yes | Number of not-yet-successfully-delivered webhooks. |
| `request` | object, nullable | yes | Contains `id` and `idempotency_key`. |
| `type` | string | yes | Exact event name. |

`data.object` is the same shape as retrieving the affected object directly. `data.previous_attributes` is documented for changed attributes; it is not present on every event.

### 13.4 Documented example

```json
{
  "id": "evt_1NG8Du2eZvKYlo2CUI79vXWy",
  "object": "event",
  "api_version": "2019-02-19",
  "created": 1686089970,
  "data": {
    "object": {
      "id": "seti_1NG8Du2eZvKYlo2C9XMqbR0x",
      "object": "setup_intent"
    }
  },
  "livemode": false,
  "pending_webhooks": 0,
  "request": { "id": null, "idempotency_key": null },
  "type": "setup_intent.created"
}
```

The `data.object` example is a SetupIntent because that is the documented example; for C4c the same envelope carries `payment_intent`, `checkout.session`, or `refund` objects.

### 13.5 Errors

- Unknown/expired event: `404` `resource_missing`; exact distinction for older-than-30-days is **UNCONFIRMED**.
- Auth/permission/rate/server errors as §0.4.

### 13.6 Webhooks triggered

None.

## 14. Events — List

**Documentation:** `https://docs.stripe.com/api/events/list`
**Date:** 28 October 2026.

### 14.1 Method, path, base URL

```text
GET https://api.stripe.com/v1/events
```

### 14.2 Request fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | no | 1–100; default 10. |
| `starting_after` | string | no | Cursor. |
| `ending_before` | string | no | Cursor; mutually exclusive. |
| `created` | object or integer | no | Date filter. |
| `delivery_success` | boolean | no | Filter by whether all webhooks were delivered. `false` includes still-pending/failed events. |
| `type` | string | no | Exact event name or wildcard group. |
| `types[]` | array of strings | no | Up to 20 event names; mutually exclusive with `type`. |
| `expand[]` | array of strings | no | Expansion. |

### 14.3 Response

`object` value: **`"list"`**; `data` entries are `event` objects. Each event's `data` is rendered according to the API version at its creation, not the current request version. See §0.5 and §13.3.

### 14.4 Errors

- Both `type` and `types`: `400` invalid request.
- More than 20 `types`: `400`; exact code **UNCONFIRMED**.
- Invalid filter/cursor: `400`.
- Auth/permission/rate/server errors as §0.4.

### 14.5 Webhooks triggered

None.

## 15. Webhooks for the C4c actions

**Documentation:** `https://docs.stripe.com/api/events/types`, `https://docs.stripe.com/events/how-events-work`, `https://docs.stripe.com/webhooks`
**Date:** 28 October 2026.

C4c uses snapshot events. The payload is the Event object in §13.3, with `data.object` set to the affected object. Exact event names and payload types:

| Action | Documented event names | `data.object` |
|---|---|---|
| PaymentIntents — Create | `payment_intent.created` | `payment_intent` |
| PaymentIntents — Retrieve | none | — |
| PaymentIntents — Confirm | `payment_intent.requires_action`, `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.amount_capturable_updated`, `payment_intent.canceled` | `payment_intent` |
| PaymentIntents — Cancel | `payment_intent.canceled` | `payment_intent` |
| PaymentIntents — List | none | — |
| Checkout Sessions — Create | No `checkout.session.created` event is documented. Later: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` | `checkout.session` |
| Checkout Sessions — Retrieve | none | — |
| Checkout Sessions — List | none | — |
| Checkout — local page | `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.requires_action`, `payment_intent.payment_failed`, `checkout.session.expired` as the documented vocabulary; exact local sequence is an Ibeji design decision | `checkout.session` or `payment_intent` |
| Refunds — Create | `refund.created`, `charge.refunded`; later `refund.updated`, `refund.failed`, `charge.refund.updated` | `refund` except `charge.refunded` → `charge` |
| Refunds — Retrieve | none | — |
| Refunds — List | none | — |
| Events — Retrieve | none | — |
| Events — List | none | — |

Additional exact documented events that can be generated by confirmation but whose payload is a Charge:

- `charge.succeeded`
- `charge.failed`
- `charge.captured`
- `charge.refund.updated`
- `charge.refunded`

Charge is outside C4c. A twin that sends `charge.refunded` must send a `charge` object in `data.object`, not a `refund` object. This is a gap for the twin's object model; see §27.

Documented special cases:

- `checkout.session.completed` occurs when the session is successfully completed. For delayed payment methods, `payment_status` can still be `unpaid`; `checkout.session.async_payment_succeeded` follows when the delayed payment succeeds.
- `checkout.session.async_payment_failed` is for a delayed payment method, not a simple immediate card decline.
- `checkout.session.expired` occurs when the session expires.
- `payment_intent.payment_failed` carries the PaymentIntent; inspect `last_payment_error`.
- `payment_intent.requires_action` carries the PaymentIntent with `next_action`.
- `payment_intent.amount_capturable_updated` is relevant only to manual capture.
- `refund.created` carries the Refund; `charge.refunded` carries the Charge.

The Event envelope's `data` may include `previous_attributes` for updated resources. The twin should include it when it models an update event, but it must not invent `previous_attributes` on creation events.

## 16. Authentication

**Documentation:** `https://docs.stripe.com/api/authentication`, `https://docs.stripe.com/keys`, `https://docs.stripe.com/keys/restricted-api-keys`
**Date:** 28 October 2026.

- Stripe uses HTTP Basic Auth: API key as username, empty password. Curl: `-u sk_test_...:`.
- Stripe also documents bearer auth: `Authorization: Bearer <key>`, for cross-origin requests.
- Test secret keys: `sk_test_`.
- Live secret keys: `sk_live_`.
- Test restricted keys: `rk_test_`.
- Live restricted keys: `rk_live_`.
- Restricted keys have explicit Read/Write/None permissions per resource. Stripe recommends restricted keys over unrestricted secret keys.
- Publishable keys (`pk_test_`, `pk_live_`) cannot authenticate these server-side calls. The documented error code is `secret_key_required`.
- Missing or invalid key: Stripe documents HTTP `401 Unauthorized` ("No valid API key provided"). The exact response body and message for a missing key are **UNCONFIRMED** in the cited pages; the response uses the common error envelope in §0.3. The SDK exposes it as `StripeAuthenticationError`.
- The Stripe Node library also has an `apiKey`/per-request key option, but the raw API contract is the Authorization header.

The twin should create fake keys in these formats, clearly marked as Ibeji keys, and reject publishable keys where a secret key is required.

## 17. API versions

**Documentation:** `https://docs.stripe.com/api/versioning`
**Date:** 28 October 2026.

### 17.1 How the header works

- The request header is `Stripe-Version: <version>`.
- If a request omits it, Stripe uses the Stripe account's default API version (controlled in Workbench). Curl requests use the account default unless overridden.
- The header controls the response shape for that request. Stripe's versioning page says requests made with curl use the account's default unless overridden by `Stripe-Version`.
- Webhook events also use the account default unless the endpoint was created with an API version. Snapshot Event objects have an `api_version` field recording the version used to render `data`.
- Since `2024-09-30.acacia`, Stripe releases monthly versions with no breaking changes and a new major release twice a year with breaking changes.
- The current version is `2026-09-30.endive`.
- `stripe-node` 23.0.1 pins `2026-09-30.endive` in `cjs/apiVersion.js`; `stripe-node` v12+ aligns requests with the version current when that library version was released. The library sends `Stripe-Version` automatically and can override it with the `apiVersion` config/per-request option.

### 17.2 What the twin should do

Proposed twin policy:

- Imitate exactly one version: **`2026-09-30.endive`**.
- Missing `Stripe-Version`: serve the pinned version. The twin has no per-account default, so this is the closest deterministic behavior.
- Exact `Stripe-Version: 2026-09-30.endive`: serve the pinned version.
- Any other value: return `400` with the Stripe error envelope, `type: "invalid_request_error"`, and a clear message that this twin implements only `2026-09-30.endive`. Do not invent a `code` because Stripe's docs do not document a code for an unsupported version. Stripe's own exact behavior for an arbitrary invalid version is **UNCONFIRMED** in the cited documentation.
- Apply the same policy to every v1 method in C4c, including reads.
- Emit webhook Event objects with `api_version: "2026-09-30.endive"`.
- Document the restriction prominently in Ibeji's "Connect your app" guide.

This is a twin-specific limitation: real Stripe can serve many versions, but Ibeji cannot. Rejecting an unknown version is safer than silently serving a different shape.

### 17.3 Proposed C21 entry

> **28 October 2026: imitate Stripe API version `2026-09-30.endive`.** Stripe's current version on the research date is `2026-09-30.endive`, and the official `stripe` Node package 23.0.1 pins the same version. The twin will serve only that version: an absent header or the exact version is accepted; any other `Stripe-Version` value is rejected with a Stripe-shaped `400 invalid_request_error` and a plain message. The docs do not document Stripe's own response to an unsupported version, so the rejection rule is a twin policy, not a claim about Stripe. Webhook Event objects use `api_version: "2026-09-30.endive"`.

## 18. Idempotency

**Documentation:** `https://docs.stripe.com/api/idempotent_requests`, `https://docs.stripe.com/error-low-level`
**Date:** 28 October 2026.

- Header name: `Idempotency-Key`.
- Length: up to **255 characters**. Stripe suggests V4 UUIDs or another high-entropy random string. Do not use sensitive data as the key.
- Scope: API v1. All `POST` requests accept idempotency keys. Do not send them on `GET` or `DELETE`; they have no effect and those methods are idempotent by definition.
- Retention: Stripe saves the status code and body of the first request made with a key after endpoint execution begins. Keys are retained for **at least 24 hours** and can be removed after that. Reusing a key after it is pruned generates a new request.
- Same key, same endpoint and parameters: Stripe returns the saved response, including saved `500` errors, while the key is retained. A replayed response has `Idempotent-Replayed: true`.
- Same key, different endpoint or parameters: Stripe's idempotency layer compares the incoming parameters with the original and errors to prevent misuse. The error type is `idempotency_error`. The exact HTTP status and exact `code` for this parameter-mismatch case are **UNCONFIRMED** in the cited pages; the twin should use the documented `idempotency_error` type and a clear message, and should not invent a code.
- Concurrent identical key while the first request is still executing: `409 Conflict`; the documented error code is `idempotency_key_in_use`. Wait and retry with the same key and parameters.
- Results are saved only after endpoint execution begins. Requests that fail before execution begins — invalid parameters, invalid API key, or rate limiting — are not cached and can be retried after fixing the cause.
- `Stripe-Should-Retry` response header: `true` (retry with exponential backoff), `false` (do not retry), or absent (use status/body).
- A `500` with an idempotency key is cached and replayed; do not retry it with a new key until the original outcome is reconciled.

Twin behavior to imitate:

1. Store a key for 24 hours with the exact method, path, and normalized parameter body.
2. If the same key and parameters arrive, replay the stored status/body and add `Idempotent-Replayed: true`.
3. If the parameters differ, return `idempotency_error` without executing the action. Use `400` as Ibeji's policy; the exact Stripe status for this case is **UNCONFIRMED**.
4. If the same key is currently executing, return `409` with code `idempotency_key_in_use`.
5. Do not cache auth failures, validation failures, or rate-limit responses.
6. Do not apply idempotency to `GET` or `DELETE`.

## 19. Webhook signing

**Documentation:** `https://docs.stripe.com/webhooks?verify=verify-manually#verify-manually`, `https://docs.stripe.com/webhooks`
**Date:** 28 October 2026.

- Header name: `Stripe-Signature`.
- Format: a comma-separated list of prefix/value pairs. The timestamp has prefix `t`; signatures have scheme prefixes such as `v1`. Current live scheme is `v1`. Test events also include a fake `v0` signature for testing. Ignore schemes other than `v1` to prevent downgrade attacks.
- Example, with newlines shown for clarity; the real header is one line:

```text
Stripe-Signature:
t=1492774577,
v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd,
v0=6ffbb59b2300aae63f272406069a9788598b792a944a07aba816edb039989a39
```

- Algorithm: HMAC-SHA256.
- Signed payload: the timestamp string, then a literal `.`, then the raw JSON request body: `timestamp + "." + rawBody`.
- Key: the endpoint's signing secret, starting with `whsec_`. This is not the API secret key.
- Verification:
  1. Split the header on `,`, then each element on `=`.
  2. Take `t` as the timestamp and every `v1` value as a candidate signature.
  3. Build `signed_payload = t + "." + rawBody`.
  4. Compute HMAC-SHA256 with the endpoint secret.
  5. Compare candidates in constant time.
  6. Reject if no `v1` matches or if `abs(now - t)` exceeds the tolerance.
- Tolerance: Stripe's libraries default to **5 minutes** (300 seconds) between the timestamp and current time. It is configurable. Stripe warns: do not use tolerance `0`, because that disables the recency check entirely.
- The raw body must be unchanged. Parsing, reordering keys, stripping whitespace, converting to JSON, or changing encoding breaks verification. In Node/Express, register the webhook route before `express.json()` or use `express.raw({type: 'application/json'})`.
- Stripe generates a new timestamp and signature for each delivery attempt, including retries.
- Endpoint secret rotation: multiple `v1` signatures can be present while multiple endpoint secrets are active; Stripe documents keeping the previous secret active for up to 24 hours.
- Test events include `v0`; production uses `v1`.

The twin must sign with `Stripe-Signature`, HMAC-SHA256, `t=...`, one or more `v1=...`, the `whsec_`-format Ibeji secret, and the exact raw body.

## 20. Webhook retries

**Documentation:** `https://docs.stripe.com/events/how-events-work#automatic-retries`, `https://docs.stripe.com/webhooks#automatic-retries`
**Date:** 28 October 2026.

Stripe documents:

- Live mode: Stripe attempts delivery for up to **three days** with exponential backoff.
- Sandbox/test mode: Stripe retries **three times over the course of a few hours**.
- A delivery is successful only on a `2xx` response. Stripe documents `200` as success; other statuses, redirects (`3xx`), timeouts, connection errors, and TLS errors are failures.
- The exact retry delays are not published in the cited pages. This is a gap; C7's fallback schedule applies unless a future Stripe page publishes exact delays.
- Manual resend: Dashboard "Resend" works for up to 15 days after event creation; Stripe CLI `stripe events resend` works for up to 30 days.
- Manual resend does not cancel automatic retries. The endpoint should deduplicate.
- Stripe does **not** guarantee delivery order. Events can arrive out of order.
- Stripe can deliver the same event more than once, and in some cases two separate Event objects can represent the same underlying change. Deduplicate by event ID and by the resource ID plus event type.
- If a destination is disabled or deleted, future retries are prevented; if it is disabled then re-enabled before the retry, retries can still occur.
- Stripe recommends returning a `2xx` quickly before complex processing.

## 21. Pagination

**Documentation:** `https://docs.stripe.com/api/pagination`
**Date:** 28 October 2026.

- All top-level v1 list methods use cursor pagination.
- `limit`: 1–100, default 10.
- `starting_after`: fetch the next page after the named object ID.
- `ending_before`: fetch the previous page before the named object ID.
- `starting_after` and `ending_before` are mutually exclusive.
- Lists are returned in reverse chronological order.
- List envelope: `object: "list"`, `data`, `has_more`, `url`.
- When `has_more` is `false`, the current set is the end.
- Stripe client libraries provide auto-pagination helpers. The raw API is cursor-based.
- v2 APIs use a different pagination interface; C4c uses the v1 API.
- The `url` field identifies the list URL; it is not the next-page URL. Use `starting_after` with the last object's ID.

## 22. Test mode

**Documentation:** `https://docs.stripe.com/testing`
**Date:** 28 October 2026.

Test mode uses test API keys. Test cards simulate outcomes; they do not move funds. Use test PaymentMethod IDs rather than raw card numbers in server code where possible.

### 22.1 Successful cards

| Brand | Card number | CVC | Expiry |
|---|---|---|---|
| Visa | `4242424242424242` | any 3 digits | any future date |
| Visa debit | `4000056655665556` | any 3 digits | any future date |
| Mastercard | `5555555555554444` | any 3 digits | any future date |
| Mastercard debit | `5200828282828210` | any 3 digits | any future date |
| American Express | `378282246310005` | any 4 digits | any future date |
| Discover | `6011111111111117` | any 3 digits | any future date |
| JCB | `3566002020360505` | any 3 digits | any future date |
| UnionPay | `6200000000000005` | any 3 digits | any future date |

Documented PaymentMethod equivalents include `pm_card_visa`, `pm_card_visa_debit`, `pm_card_mastercard`, `pm_card_mastercard_debit`, `pm_card_amex`, `pm_card_discover`, `pm_card_jcb`, and `pm_card_unionpay`.

### 22.2 Declines

| Description | Card number | Error code | Decline code |
|---|---|---|---|
| Generic decline | `4000000000000002` | `card_declined` | `generic_decline` |
| Insufficient funds | `4000000000009995` | `card_declined` | `insufficient_funds` |
| Lost card | `4000000000009987` | `card_declined` | `lost_card` |
| Stolen card | `4000000000009979` | `card_declined` | `stolen_card` |
| Expired card | `4000000000000069` | `expired_card` | n/a |
| Incorrect CVC | `4000000000000127` | `incorrect_cvc` | n/a |
| Processing error | `4000000000000119` | `processing_error` | n/a |
| Incorrect number | `4242424242424241` | `incorrect_number` | n/a |
| Velocity limit | `4000000000006975` | `card_declined` | `card_velocity_exceeded` |

A decline has the Stripe card-error shape, usually `type: "card_error"` and `402` for a synchronous API failure. The PaymentIntent may also be stored in `requires_payment_method` with `last_payment_error`, and the webhook is `payment_intent.payment_failed`.

### 22.3 Extra authentication (3DS)

| Description | Card number | Documented outcome |
|---|---|---|
| Authenticate unless set up | `4000002500003155` | Requires authentication for off-session payments unless set up; on-session always requires authentication. |
| Always authenticate | `4000002760003184` | Requires authentication on all transactions. |
| Already set up | `4000003800000446` | Requires authentication for one-time/on-session payments; off-session succeeds as if set up. |
| Insufficient funds after authentication | `4000008260003178` | Requires authentication for one-time payments; all payments decline with `insufficient_funds` even after authentication. |
| 3DS required; OK | `4000000000003220` | 3D Secure required; payment succeeds after authentication. Ireland-issued. |
| 3DS required; OK | `4000008400000027` | 3D Secure required; payment succeeds after authentication. US-issued. |
| 3DS required; declined | `4000008400001629` | 3DS required; payment declines with `card_declined` after authentication. |
| 3DS required; error | `4000008400001280` | 3DS required; lookup fails with a processing error; payment declines with `card_declined`. |
| 3DS supported; OK | `4000000000003055` | 3DS may be performed but is not required. |
| 3DS supported; error | `4000000000003097` | 3DS may be performed; attempts produce a processing error. |
| 3DS supported; unenrolled | `4242424242424242` | Card not enrolled; no prompt even if requested. |
| 3DS not supported | `378282246310005` | 3DS cannot be invoked; payment proceeds without authentication. |

The 3DS flow is documented as a PaymentIntent `requires_action` state with `next_action.redirect_to_url.url` and `.return_url`. After authentication, the PaymentIntent can become `succeeded` or `requires_payment_method`; authentication failure can produce `authentication_failure`/`payment_intent_authentication_failure`.

Other documented 3DS test cards exist for mobile challenge flows (`4000582600000094`, `4000582600000045`, `4000582600000102`, `4000582600000110`) but are documented as mobile-only and not useful in browser/API calls.

### 22.4 Test clocks and other testing tools

Stripe also documents test clocks for advancing time in test mode. They are outside C4c's action list. Stripe's test mode provides test cards, declines, 3DS, disputes, and other payment-method-specific values. It does not provide arbitrary API slow responses, connection resets, or persistent cross-service failure injection; those are Ibeji's reason to exist.

## 23. Money

**Documentation:** `https://docs.stripe.com/currencies`
**Date:** 28 October 2026.

- Stripe API amounts are integers in the **currency's smallest unit**.
- Most currencies are two-decimal: `1000` = 10.00 USD.
- Zero-decimal currencies are passed as whole units: `10` = 10 JPY.
- Zero-decimal currencies with general API support, as listed by Stripe:

`BIF`, `CLP`, `DJF`, `GNF`, `JPY`, `KMF`, `KRW`, `MGA`, `PYG`, `RWF`, `UGX`, `VND`, `VUV`, `XAF`, `XOF`, `XPF`.

Special cases:

- `ISK` is zero-decimal but must be represented as a two-decimal value with the decimal amount always `00`: 5 ISK = `500`.
- `UGX` is zero-decimal but must be represented as a two-decimal value with the decimal amount always `00`: 5 UGX = `500`.
- `HUF` and `TWD` are treated as zero-decimal for payouts but can be charged with two decimals; manual payouts must be divisible by 100 in the minor-unit value. Payouts are outside C4c.
- `amount` in PaymentIntents and Refunds is an integer in the smallest unit.
- `line_items[0][price_data][unit_amount]` is an integer in the smallest unit; `unit_amount_decimal` is a string in the smallest unit with up to 12 decimal places.
- `amount_total`, `amount_subtotal`, `amount_discount`, `amount_shipping`, and `amount_tax` are integers in the smallest unit.
- Minimum charge amount: 0.50 USD or currency equivalent; exceptions exist for some payment methods.
- The PaymentIntent `amount` supports up to eight digits; card network and currency maximums can be lower.
- Stripe requires lowercase three-letter ISO currency codes.

## 24. Base URL in libraries

**Source exception:** this section uses the official `stripe` Node package 23.0.1 README and type definitions, because `docs.stripe.com` does not document the Node library's custom-host options. The package is Stripe's official library, published from `github.com/stripe/stripe-node`.

The official Node library **can** be pointed at a different host, port, and protocol. The documented README configuration table says:

| Option | Default | Meaning |
|---|---|---|
| `host` | `'api.stripe.com'` | Host that requests are made to. |
| `port` | `443` | Port that requests are made to. |
| `protocol` | `'https'` | `'https'` or `'http'`. |
| `apiVersion` | `null` | Stripe API version; if unset, the library uses the version current at its release. |
| `maxNetworkRetries` | `1` | Automatic network retries. |
| `timeout` | `80000` | Request timeout in milliseconds. |
| `telemetry` | `true` | Sends Stripe request telemetry. |

The README example:

```js
import Stripe from 'stripe';

const stripe = Stripe('sk_test_...', {
  maxNetworkRetries: 1,
  timeout: 1000,
  host: 'api.example.com',
  port: 123,
  telemetry: true,
});
```

The type definitions (`cjs/lib.d.ts`) expose `host?: string`, `port?: string | number`, `protocol?: HttpProtocol`, and `apiVersion?: string`. The source (`cjs/stripe.core.js`) defaults to `api.stripe.com`, port `443`, and protocol `https`. The package's `cjs/apiVersion.js` is `2026-09-30.endive` for 23.0.1.

For T15, a local twin can be used like this:

```js
import Stripe from 'stripe';

const stripe = Stripe('sk_test_ibeji_...', {
  host: '127.0.0.1',
  port: 4403,
  protocol: 'http',
  apiVersion: '2026-09-30.endive',
  telemetry: false,
});
```

The library appends `/v1/...` paths. Use `telemetry: false` so the compatibility test does not send request telemetry to Stripe. The README explicitly warns that `http` is never appropriate for real Stripe and strongly discourages it even in local testing; it is appropriate only for the local twin.

## 25. Stripe's own testing tools

**Documentation:** `https://docs.stripe.com/testing`, `https://docs.stripe.com/cli`, `https://docs.stripe.com/cli/trigger`, `https://docs.stripe.com/cli/listen`, `https://docs.stripe.com/cli/events/resend`
**Source exception for stripe-mock:** the official `github.com/stripe/stripe-mock` README (Stripe's own repository; `docs.stripe.com` has no stripe-mock page).

### 25.1 Test mode

Stripe test mode already provides:

- Test API keys and sandboxes; no real funds move.
- Test cards for success by brand/country, declines, fraud/Radar outcomes, disputes, refunds, and 3DS.
- Test PaymentMethod IDs such as `pm_card_visa` and decline variants.
- Test clocks for advancing time.
- Test-mode webhook delivery through the Dashboard and CLI.

### 25.2 Stripe CLI

The Stripe CLI is official and includes:

- `stripe trigger <event>` — creates the real API objects needed for an event and triggers the event. The docs warn this causes side effects and may trigger related events. Supported examples include `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`, and `charge.refunded`.
- `stripe listen --forward-to localhost:4242/webhook` — receives events and forwards them to a local URL, printing a `whsec_` signing secret. It works without configuring a Dashboard endpoint.
- `stripe listen --latest` — receives events in the latest API version.
- `stripe events resend <event_id> --webhook-endpoint=we_...` — resends an event for up to 30 days.
- `stripe logs tail` — tails API request logs in a sandbox.
- `stripe get`, resource commands, and HTTP commands for API objects.

The CLI can trigger webhook events and real test-mode API objects; it is not a stateful failure-injection server. It cannot make an arbitrary API request hang, drop a connection after commit, duplicate a webhook on a custom schedule, or keep a local stateful record across all three services.

### 25.3 Official mock server (`stripe-mock`)

Stripe's official `stripe-mock` README says:

- It accepts the same request shapes as Stripe and validates parameters against Stripe's OpenAPI schema.
- It does **not** attempt to reproduce the behavior of the real Stripe API.
- Responses are hardcoded fixtures with correct types, not necessarily realistic responses.
- It is **stateless**: data sent on `POST` is validated but ignored for future requests.
- It is locked to the latest Stripe API version and does not support old versions.
- It does not support testing for specific responses and errors; it returns success instead of the desired error.
- It is intended for basic SDK sanity checks, not sophisticated testing.
- Default ports: HTTP `12111`, HTTPS `12112`.

So Stripe already provides a mock server and test-mode tools; Ibeji must not claim those do not exist. Ibeji's difference is stateful records, persistent resources across requests, failure injection and scenarios, and one dashboard across Stripe, Paystack, and Flutterwave (SPEC Part F).

## 26. Real-world behaviour and C5 mapping

**Documentation:** `https://docs.stripe.com/error-low-level`, `https://docs.stripe.com/error-handling`, `https://docs.stripe.com/events/how-events-work`, `https://docs.stripe.com/webhooks`, `https://docs.stripe.com/testing`, `https://docs.stripe.com/api/events/types`

| C5 failure | Applies to Stripe? | Source | Evidence |
|---|---|---|---|
| `slow-response` | yes, but no direct doc | needs a real story | Stripe documents request timeouts and SDK timeout defaults, but not an arbitrary slow API response. |
| `timeout-after-commit` | yes | docs | Stripe's network-error section says a connection can close after the request may have succeeded; idempotency is the documented recovery. |
| `timeout-before-commit` | yes, but no direct doc | needs a real story | Network errors are documented as indeterminate; the docs do not isolate "request never reached Stripe" as a failure. |
| `server-error` | yes | docs | Stripe documents `500`, `502`, `503`, `504` and `api_error`. |
| `rate-limited` | yes | docs | Stripe documents `429`, `rate_limit`, and exponential backoff. |
| `flaky-network` | yes | docs | Stripe documents network/connection errors and indeterminate outcomes. |
| `webhook-delayed` | yes, but no direct doc | needs a real story | Stripe documents automatic retries and asynchronous delivery, not a configurable first-delivery delay. |
| `webhook-duplicated` | yes | docs | Stripe says endpoints might receive the same event more than once and tells apps to deduplicate by event ID. |
| `webhook-out-of-order` | yes | docs | Stripe explicitly says it does not guarantee delivery order. |
| `webhook-never-sent` | yes, but no direct doc | needs a real story | Stripe documents retries and rare event-generation failures, not a deliberate drop. |
| `webhook-verification-fails` | yes | docs | Stripe documents `Stripe-Signature`, HMAC-SHA256, `v1`, endpoint `whsec_`, tolerance, and rejection. |
| `payment-declined` | yes | docs | Stripe documents test cards that produce `card_error`, `card_declined`, and decline codes. |
| `authentication-required` | yes | docs | Stripe documents 3DS, `requires_action`, `next_action.redirect_to_url`, `authentication_required`, and `authentication_failure`. |
| `transfer-stuck-pending` | no | not applicable | Stripe payouts/Connect transfers are outside C4c/v1. |
| `transfer-reversed` | no | not applicable | Stripe payouts/Connect transfers are outside C4c/v1. |
| `bank-resolve-fails` | no | not applicable | C4c has no bank-account lookup action. |

Stripe's documentation does not provide a stateful failure-injection tool that covers these C5 moments. Test mode covers declines, 3DS, and test events, but not arbitrary hangs, resets, delayed webhooks, missing webhooks, or stateful scenarios across services. That is the gap Ibeji fills; Ibeji's docs must still credit Stripe's test mode, CLI, and mock server for what they do provide.

## 27. Gaps

1. **Missing/invalid key response body.** Stripe documents `401` and the common error envelope, but not the exact message for a missing or invalid key.
2. **Idempotency mismatch status/code.** Stripe documents `idempotency_error` and says parameter mismatch errors, but the cited pages do not state the exact HTTP status or `code` for that case. Concurrent same-key use is documented as `409` with `idempotency_key_in_use`.
3. **Unsupported `Stripe-Version` behavior.** Stripe documents how the header selects a version, but not what it returns for an arbitrary unsupported value. The twin's reject policy is a C21 decision, not a Stripe fact.
4. **Exact webhook retry schedule.** Stripe documents "up to three days with exponential backoff" in live mode and "three times over a few hours" in sandbox, but not the exact delays. C7's fallback schedule applies.
5. **Local Checkout page mapping.** Stripe's hosted Checkout is a real page; the C4c local page is Ibeji's. Exact local event order for decline, 3DS approve, and 3DS fail is an Ibeji design decision, although the documented Stripe states/events are known.
6. **`charge.refunded` payload.** The event's `data.object` is a `charge`, but C4c has no Charge API. The twin needs a minimal Charge representation or must omit this event; research cannot decide that silently.
7. **Other Charge events.** `charge.succeeded`, `charge.failed`, `charge.captured`, and `charge.refund.updated` can be generated by flows but are outside C4c. The twin must not pretend Charge is a C4c action.
8. **Checkout Session line items.** `line_items` is not returned by default; it is includable with `expand`. If the twin needs line items, it must implement the documented expansion behavior.
9. **Checkout Session create fields.** The create endpoint has many optional fields for Products, Prices, Tax, Shipping, discounts, and embedded modes. C4c only needs the hosted payment path; the complete optional surface is not documented here.
10. **`next_action` variants.** The 3DS `redirect_to_url` shape is documented. Other `next_action` variants exist for non-card methods and are outside C4c.
11. **`checkout.session.created` does not exist.** Stripe's event catalog does not document a create event for Checkout Sessions. Do not invent one.
12. **Checkout `completed` versus payment success.** For delayed payment methods, `checkout.session.completed` can arrive while `payment_status` is still `unpaid`; `checkout.session.async_payment_succeeded` follows. The simple local checkout only uses card outcomes, but the twin must not equate "completed" with "paid" universally.
13. **Test mode cannot inject arbitrary failures.** Stripe test mode covers cards, declines, 3DS, disputes, and test clocks; it does not provide arbitrary slow responses, connection resets, persistent stateful failures, or custom webhook schedules.
14. **Stripe CLI trigger side effects.** `stripe trigger` creates real test-mode objects and may trigger related events; it is not a pure webhook simulator.
15. **stripe-mock is stateless and not behaviorally accurate.** It returns hardcoded fixtures and does not support specific error responses.
16. **Current version changes monthly.** `2026-09-30.endive` is current on 28 October 2026; Stripe releases monthly versions. The twin must pin this version and re-record before a minor release.
17. **Event API version.** Events are rendered according to the API version at creation; the twin's Event `api_version` must be pinned, and old events must not be retroactively changed.
18. **No Stripe account default version.** Real Stripe falls back to an account default; the twin has no account. The twin's proposed missing-header behavior is to serve its pinned version.
19. **Test/live key formats are documented, but exact key bodies are not published.** Ibeji creates fake keys in the documented prefixes and marks them as Ibeji keys; it must not copy a real Stripe key.
20. **Webhook event payloads beyond the affected object.** The Event envelope is documented, but some nested objects (for example, the full Charge object in `charge.refunded`) are outside C4c and need a separate decision.
