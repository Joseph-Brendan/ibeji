Flutterwave is a trademark of its owner. Ibeji is not affiliated with Flutterwave.

# Flutterwave research for Ibeji

Research date: **27 October 2026**.

Source rule: every Flutterwave fact below comes from Flutterwave's official developer documentation (`developer.flutterwave.com`). Section 13 uses the published npm packages and their source files for library base-URL behaviour because the Flutterwave API docs do not document Node base-URL overrides. That exception is labelled. No Paystack or Stripe research was used.

Markings:

- **UNCONFIRMED** means Flutterwave's documentation does not state the fact, or two official pages disagree.
- Types in response tables are inferred from the documented OpenAPI schemas/examples unless a type is stated. Some examples are inconsistent with their own schema.
- "Not documented" means no statement was found on the cited official pages on the research date.

## 0. API version decision

### 0.1 Versions the official documentation currently describes

Flutterwave currently publishes two versioned developer-documentation trees that cover the C4b actions:

| Version | Documentation | What it documents for C4b |
|---|---|---|
| **v3.0.0** | `https://developer.flutterwave.com/v3.0.0/...` (also the default `/docs` and `/reference` tree) | Standard hosted-checkout link (`POST /payments`), verify by ID and by `tx_ref`, transaction list, refunds, transfers, banks, account resolve, v3 webhooks |
| **v4.0.0** | `https://developer.flutterwave.com/v4.0.0/...` | Charges (`POST /charges`), refunds, transfers, banks, account resolve, OAuth authentication, v4 webhooks and idempotency |

An older **Rave** generation exists in npm as `flutterwave-node` (described as "Official Node library for Rave by Flutterwave"), but the current official documentation does not describe Rave as a version for these C4b actions. I do not count it as a current documented version.

### 0.2 Version comparison

| Point | v3.0.0 | v4.0.0 |
|---|---|---|
| Current or being phased out? | Current docs; updated 19 October 2026. No official deprecation notice found. Used by the official Node library and the Standard hosted checkout. | Current/newer docs; updated 19 October 2026. No official statement that it replaces v3 immediately. |
| Authentication | Secret key in `Authorization: Bearer ...`; test keys contain `_TEST`; public + secret + encryption keys. | OAuth 2.0 client credentials; exchange `client_id` + `client_secret` at `https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token` for a 10-minute access token. |
| Base URL | `https://api.flutterwave.com/v3` | Test: `https://developersandbox-api.flutterwave.com`; production: `https://f4bexperience.flutterwave.com` |
| Hosted checkout link | `POST /v3/payments` returns `data.link`; documented Standard flow. | The v4 API reference lists `POST /charges` with `next_action` and redirect handling; it does not list the v3 `/payments` hosted-link endpoint. The v4 prose mentions "Flutterwave standard", but the v4 API reference does not document a `/payments` link endpoint. |
| Webhook verification | `verif-hash` header containing the secret hash you set in the dashboard. This is a shared secret comparison, not HMAC. | `flutterwave-signature` header containing HMAC-SHA256 of the raw body using the secret hash, Base64 encoded. |
| Webhook event names | `charge.completed`, `transfer.completed`; refund webhook is a bare payload with no documented event name. | `charge.completed`, `transfer.disburse`, `transfer.reversal`, `refund.completed`; plus order authorization. |
| Idempotency | Not documented. | `X-Idempotency-Key` on `POST` endpoints; repeated key returns original response and `X-Idempotency-Cache-Hit: true`. |
| Official Node library | `flutterwave-node-v3` 1.4.1, described as "The official Node.JS integration library for Flutterwave v3 payment APIs"; the official SDK directory lists Node.js with **API v3**, version 1.4.1. | No official Flutterwave v4 Node library found. `flutterwave-node-v4` 0.2.1 is explicitly "The unofficial Flutterwave Node.js SDK for v4 APIs". |
| Money format | Whole currency amounts in the documented examples (for example `amount: 7500` for an NGN charge, `amount: 5500` for a transfer). No minor-unit terminology found. | Decimal whole-currency amounts (`amount: 12.34`, `amount: 1234.56`); not minor units. |

### 0.3 Recommendation (proposed C21 decision)

**Imitate Flutterwave API v3.0.0.**

Reasons:

1. C4b requires the **hosted payment/checkout-link flow**. v3 documents `POST /v3/payments` returning `data.link`; the v4 API reference uses `POST /charges` and does not list the v3 `/payments` endpoint.
2. C4b says the chosen version must be the one Flutterwave's **official Node library uses**. The official Node library is `flutterwave-node-v3` 1.4.1, and the official SDK directory explicitly labels Node.js as **API v3**.
3. v3 is still current in Flutterwave's documentation (updated 19 October 2026) and there is no official deprecation notice. v4 is newer, but choosing it would break the "official Node library" condition and change authentication to OAuth.
4. The v3 API is simpler for a local twin: secret-key bearer auth and a shared `verif-hash` webhook check, rather than OAuth token exchange and HMAC webhook signatures.

Proposed C21 entry:

> **27 October 2026: imitate Flutterwave API v3.0.0.** v3 is the version of the official Node library (`flutterwave-node-v3` 1.4.1, official SDK directory "API v3") and documents the hosted checkout-link flow required by C4b (`POST /v3/payments` → `data.link`). v4 is newer and documented, but its API reference uses `/charges`, switches to OAuth 2.0, has `X-Idempotency-Key`, and has no official Flutterwave Node library at the research date. v3 documentation was current and not marked deprecated on 27 October 2026. The rest of this file is v3-only.

## 1. Shared v3 response objects

### 1.1 Success envelope

Most v3 endpoints use:

```json
{
  "status": "success",
  "message": "Human-readable summary",
  "data": {}
}
```

List endpoints add `meta`. Two important exceptions documented later:

- `GET /v3/refunds/{id}` returns the refund object directly, with no `status`/`message`/`data` envelope.
- The v3 refund webhook example is a bare refund object with no `event` field.

### 1.2 Error envelope

Source: [Common Errors](https://developer.flutterwave.com/v3.0.0/docs/common-errors).

Most errors:

```json
{
  "status": "error",
  "message": "Human-readable error",
  "data": null
}
```

`data` is optional and may contain details. The 500 error sample is different:

```json
{
  "error_id": "ERRNO796977608T1620310828419",
  "message": "Application error. Please contact support",
  "code": "app_error"
}
```

The 503 timeout sample is:

```json
{
  "status": "error",
  "message": "An error occurred. Please contact support",
  "data": null
}
```

The 429 body is not documented; only the status is.

### 1.3 Transaction object (verify by ID/reference)

Source: [Verify transaction status](https://developer.flutterwave.com/v3.0.0/reference/verify-transaction), [Verify with reference](https://developer.flutterwave.com/v3.0.0/reference/verify-transaction-with-tx_ref).

| Field | Type | Example |
|---|---|---|
| `id` | integer | `288200108` |
| `tx_ref` | string | `"LiveCardTest"` |
| `flw_ref` | string | `"YemiDesola/FLW275407301"` |
| `device_fingerprint` | string | `"N/A"` |
| `amount` | integer | `100` |
| `currency` | string | `"NGN"` |
| `charged_amount` | integer | `100` |
| `app_fee` | number/integer | `1.4` / `14` |
| `merchant_fee` | integer | `0` |
| `processor_response` | string | `"Approved by Financial Institution"` |
| `auth_model` | string | `"PIN"` |
| `ip` | string | `"::ffff:10.5.179.3"` |
| `narration` | string | `"CARD Transaction "` |
| `status` | string | `"successful"` |
| `payment_type` | string | `"card"` |
| `created_at` | ISO date string | `"2020-07-15T14:31:16.000Z"` |
| `account_id` | integer | `17321` |
| `card.first_6digits` | string | `"232343"` |
| `card.last_4digits` | string | `"4567"` |
| `card.issuer` | string | `"FIRST CITY MONUMENT BANK PLC"` |
| `card.country` | string | `"NIGERIA NG"` |
| `card.type` | string | `"VERVE"` |
| `card.token` | string | `"flw-t1nf-4676a40c7ddf5f12scr432aa12d471973-k3n"` |
| `card.expiry` | string | `"02/23"` |
| `meta` | object or null | `null` |
| `amount_settled` | number/integer | `98.6` / `986` |
| `customer.id` | integer | `216519823` |
| `customer.name` | string | `"Yemi Desola"` |
| `customer.phone_number` | string | `"N/A"` |
| `customer.email` | string | `"user@gmail.com"` (docs sample) |
| `customer.created_at` | ISO date string | `"2020-07-15T14:31:15.000Z"` |

`card` is documented as present only for card transactions; it is absent for other payment types. The docs do not give a complete schema for all payment types. **UNCONFIRMED** for non-card variants.

### 1.4 Transaction list item

Source: [Get multiple transactions](https://developer.flutterwave.com/v3.0.0/reference/get-all-transactions).

| Field | Type | Example |
|---|---|---|
| `id` | string | `"989226"` |
| `tx_ref` | string | `"m0ckaham-1578002686748"` |
| `flw_ref` | string | `"N/A"` |
| `device_fingerprint` | string | `"e2b5cd3ec0fa99d45bf204a1401fb981"` |
| `amount` | integer | `1000` |
| `currency` | string | `"NGN"` |
| `charged_amount` | integer | `1000` |
| `app_fee` | null or number | `null` / `14` |
| `merchant_fee` | integer | `0` |
| `processor_response` | null or string | `null` / `"Approved Or Completed Successfully"` |
| `auth_model` | string | `"AUTH"` |
| `ip` | string | `"197.211.58.137"` |
| `narration` | string | `"Earth Gang"` |
| `status` | string | `"pending"` / `"successful"` |
| `payment_type` | string | `"account"` |
| `created_at` | ISO date string | `"2020-01-02T22:06:45.000Z"` |
| `amount_settled` | null or number | `null` / `98550` |
| `account.nuban` | string | `"0690000031"` |
| `account.bank` | string | `"ACCESS BANK NIGERIA"` |
| `customer_name` | string | `"Yemi Desola"` |
| `customer_email` | string | `"user@gmail.com"` |
| `account_id` | string | `"73362"` |

The list item does **not** use the same shape as the verify object: `id` and `account_id` are strings in the list sample, and the customer is flattened into `customer_name`/`customer_email`. Treat the shapes as endpoint-specific.

### 1.5 Refund object

Source: [Refund a transaction](https://developer.flutterwave.com/v3.0.0/reference/transaction-refund), [Fetch a refunded transaction](https://developer.flutterwave.com/v3.0.0/reference/get-transaction-refunds), [Fetch multiple refunded transactions](https://developer.flutterwave.com/v3.0.0/reference/get-all-refunds), [Refunds guide](https://developer.flutterwave.com/v3.0.0/docs/refunds).

Create response `data`:

| Field | Type | Example |
|---|---|---|
| `id` | integer | `8612` |
| `account_id` | integer | `73362` |
| `tx_id` | integer | `908790` |
| `flw_ref` | string | `"URF_1577867664541_3572735"` |
| `wallet_id` | integer | `74639` |
| `amount_refunded` | integer/number | `5000` |
| `status` | string | `"completed"` |
| `destination` | string | `"payment_source"` |
| `meta.source` | string | `"availablebalance"` |
| `created_at` | ISO date string | `"2020-01-24T09:18:37.366Z"` |

Fetch response (bare object, no envelope):

| Field | Type | Example |
|---|---|---|
| `id` | integer | `469462` |
| `amount_refunded` | number | `101.4` |
| `status` | string | `"completed-mpgs"` |
| `flw_ref` | string | `"ZRIR3520596614954"` |
| `comment` | null or string | `null` |
| `settlement_id` | string | `"735099"` |
| `meta` | string containing JSON | `"{\"source\":\"ledgerbalance\",...}"` |
| `created_at` | ISO date string | `"2021-05-12T23:19:11.000Z"` |
| `account_id` | integer | `35308` |
| `transaction_id` | integer | `394347475` |

List response `data[]` item:

| Field | Type | Example |
|---|---|---|
| `id` | integer | `258505` |
| `amount_refunded` | integer | `150` |
| `status` | string | `"completed-mpgs"` |
| `flw_ref` | string | `"FLW265072855"` |
| `comment` | string | `""` |
| `settlement_id` | string | `"412245"` |
| `meta` | string containing JSON | `"{\"source\":\"ledgerbalance\"}"` |
| `created_at` | ISO date string | `"2020-06-26T13:07:15.000Z"` |
| `account_id` | integer | `82796` |
| `transaction_id` | integer | `263746647` |

Documented refund statuses: `completed`, `completed-bank-transfer`, `completed-momo`, `completed-mpgs`, `completed-offline`, `completed-preauth`, `pending-momo`, `pending-bank-transfer`, `pending-mpgs`, `processing`. See §14.

### 1.6 Transfer object

Sources: [Create a transfer](https://developer.flutterwave.com/v3.0.0/reference/create-a-transfer), [Get a transfer](https://developer.flutterwave.com/v3.0.0/reference/get-a-transfer), [Get all transfers](https://developer.flutterwave.com/v3.0.0/reference/get-all-transfers), [Bank Account Transfer](https://developer.flutterwave.com/v3.0.0/docs/bank-account).

| Field | Type | Create example | Fetch/list example |
|---|---|---|---|
| `id` | integer | `26251` | `1933222` / `408827` |
| `account_number` | string | `"1234567840"` | `"0251238458"` |
| `bank_code` | string | `"044"` | `"058"` |
| `full_name` | string | `"Flutterwave Developers"` | `" Flutterwave Developers"` |
| `created_at` | ISO date string | `"2020-01-20T16:09:34.000Z"` | `"2020-06-11T00:36:20.000Z"` |
| `currency` | string | `"NGN"` | `"NGN"` |
| `debit_currency` | string | `"NGN"` | `"NGN"` |
| `amount` | integer | `5500` | `300` |
| `fee` | integer/number | `45` | `10.75` |
| `status` | string | `"NEW"` | `"SUCCESSFUL"` |
| `reference` | string | `"akhlm-pstmnpyt-rfxx007_PMCKDU_1"` | `"new-actual-transfer-ref1"` |
| `meta` | object/array/null | `null` | `null` |
| `narration` | string | `"Akhlm Pstmn Trnsfr xx007"` | `"Akhlm Pstmn Trnsfr xx007"` |
| `approver` | null or object | — | `null` |
| `complete_message` | string | `""` | `"Transaction was successful"` |
| `requires_approval` | integer | `0` | `0` |
| `is_approved` | integer | `1` | `1` |
| `bank_name` | string | `"ACCESS BANK NIGERIA"` | `"GTBANK PLC"` |
| `debit_currency_amount` | null or number | — | `null` |
| `rate` | null or number | — | `null` |

Transfer status values in documented examples: `NEW` on creation, `PENDING` while processing, `SUCCESSFUL`, `FAILED`. The docs do not document a v3 `REVERSED` transfer status; v4 documents `transfer.reversal`, but that is not v3. **UNCONFIRMED** for v3 reversal.

### 1.7 Bank object and resolve object

Source: [Get all banks](https://developer.flutterwave.com/v3.0.0/reference/get-all-banks), [Retrieve Bank Account Name](https://developer.flutterwave.com/v3.0.0/reference/resolve-account-transfer-details).

Bank list `data[]`:

| Field | Type | Example |
|---|---|---|
| `id` | integer | `132` |
| `code` | string | `"560"` |
| `name` | string | `"Page MFBank"` |

Resolve `data`:

| Field | Type | Example |
|---|---|---|
| `account_number` | string | `"0690000032"` |
| `account_name` | string | `"Pastor Bright"` |

## 2. Payments

### 2.1 Create hosted payment (Standard API)

Sources: [Standard API reference](https://developer.flutterwave.com/v3.0.0/reference/checkout), [Flutterwave Standard guide](https://developer.flutterwave.com/v3.0.0/docs/flutterwave-standard-1), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/v3/payments` (base URL `https://api.flutterwave.com/v3` + `/payments`)
- **Request format:** JSON body
- **Headers:** `Authorization: Bearer <secret key>`, `Content-Type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `amount` | integer | Yes | The v3 examples use whole currency amounts, e.g. `7500` for NGN 7,500. |
| `tx_ref` | string | Yes | Unique transaction reference. |
| `currency` | string | No | Defaults to `NGN`. |
| `redirect_url` | string | No per OpenAPI schema | URL to return the customer to. |
| `customer` | object | Yes | Required container. |
| `customer.email` | string | Yes | Customer email. |
| `customer.phone_number` | string | No | OpenAPI schema spelling. |
| `customer.name` | string | No | Customer name. |
| `customizations` | object | No | Checkout appearance. |
| `customizations.title` | string | No | Title on the checkout page. |
| `customizations.logo` | string | No | Merchant logo URL. |
| `customizations.description` | string | No | Mentioned in the guide but absent from the OpenAPI schema. **UNCONFIRMED**. |
| `configuration` | object | No | OpenAPI schema spelling. |
| `configuration.session_duration` | integer | No | Session lifetime in minutes, max 1440. |
| `configuration.max_retry_attempt` | integer | No | Maximum failed attempts. |
| `configurations` | object | No | Spelling used in the Standard guide and its example. The OpenAPI schema uses `configuration`. **UNCONFIRMED** which spelling the live API accepts. |
| `payment_plan` | integer | No | Payment-plan ID. |
| `payment_options` | string | No | Comma-separated payment methods. |
| `link_expiration` | string (date) | No | Hosted-link expiry. Schema format says `date`; example looks date-time. **UNCONFIRMED** exact accepted format. |
| `subaccounts` | array of objects | No | Split payments. |
| `subaccounts[].id` | string | No | Subaccount ID. |
| `meta` | object | No | Extra metadata. |
| `payload_hash` | string | No | Mentioned in the Standard guide's "Transaction Integrity" section for checksum; not in the OpenAPI schema. **UNCONFIRMED**. |

The guide uses `phonenumber`, while the OpenAPI schema uses `phone_number`. This is an official inconsistency; do not silently pick one without a fixture. **UNCONFIRMED** which field the live endpoint expects.

#### Success response

```json
{
  "status": "success",
  "message": "Hosted Link",
  "data": {
    "link": "https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-01j4dc4maegqf82pfqg4chw46b"
  }
}
```

| Field | Type | Example |
|---|---|---|
| `status` | string | `"success"` |
| `message` | string | `"Hosted Link"` |
| `data.link` | string | `"https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-01j4dc4maegqf82pfqg4chw46b"` |

The create-payment response does not include the transaction ID or customer object; get those from the redirect query, verify endpoint, or webhook.

#### Errors and documented statuses

- Action page sample: `200`, `400`.
- Common v3 statuses: `401`, `500`, `503`, `429`; see §1.2 and §7.
- Exact 400 body for this action: **UNCONFIRMED** (OpenAPI shows `{}`).

#### Webhook events this action can trigger

After checkout, `charge.completed` on success or failure. The Standard guide says Flutterwave sends a notification for each failed attempt if webhooks are enabled. See §6.

### 2.2 Verify transaction by ID

Sources: [Verify transaction status](https://developer.flutterwave.com/v3.0.0/reference/verify-transaction), [Transaction Verification guide](https://developer.flutterwave.com/v3.0.0/docs/transaction-verification), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/transactions/{id}/verify`
- **Base URL:** `https://api.flutterwave.com/v3`
- **Request format:** no body; `id` in path
- **Headers:** `Authorization: Bearer <secret key>`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | integer | Yes (path) | Transaction ID, e.g. `288200108`. |

#### Success response

`data` is the Transaction object in §1.3.

#### Errors and documented statuses

- Action page sample: `200`, `400`.
- The guide shows a "Transaction Not Found" body but not its HTTP status. **UNCONFIRMED** whether it is `404`; the message is `"No transaction was found for this id"`.
- Common: `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

None.

### 2.3 Verify transaction by reference

Source: [Verify transaction status with reference](https://developer.flutterwave.com/v3.0.0/reference/verify-transaction-with-tx_ref), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/transactions/verify_by_reference`
- **Query:** `tx_ref=<merchant reference>`
- **Headers:** `Authorization: Bearer <secret key>`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `tx_ref` | string | Required in practice; OpenAPI does not mark it required | Merchant transaction reference. |

#### Success response

`data` is the Transaction object in §1.3.

#### Errors and documented statuses

- Action page sample: `200`, `400`.
- Common: `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

None.

### 2.4 Fetch one transaction

**There is no distinct documented v3 endpoint for fetching one transaction by ID.** The v3 API reference lists:

- `GET /v3/transactions` (list/filter; supports `tx_ref`)
- `GET /v3/transactions/{id}/verify` (verify/fetch by ID)
- `GET /v3/transactions/verify_by_reference` (verify by `tx_ref`)

C4b names "fetch" separately from "verify by id and by reference". The closest documented single-record operation is `GET /v3/transactions/{id}/verify`; the closest filtered operation is `GET /v3/transactions?tx_ref=...&from=...&to=...`, which returns an array.

**C4b "fetch" is therefore UNCONFIRMED as a distinct endpoint.** Do not invent `GET /v3/transactions/{id}` without a fixture. This is a C21 gap.

### 2.5 List transactions

Source: [Get multiple transactions](https://developer.flutterwave.com/v3.0.0/reference/get-all-transactions), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/transactions`
- **Request format:** query parameters
- **Headers:** `Authorization: Bearer <secret key>`

#### Query parameters

| Field | Type | Required? | Notes |
|---|---|---|---|
| `from` | string `YYYY-MM-DD` | Yes | Start date. |
| `to` | string `YYYY-MM-DD` | Yes | End date. |
| `page` | integer | No | Page number. |
| `customer_email` | string | No | Filter by customer email. |
| `status` | string | No | `successful` or `failed` per docs. |
| `tx_ref` | string | No | Filter by merchant reference. |
| `customer_fullname` | string | No | Filter by customer name. |
| `currency` | string | No | Filter by currency. |

#### Success response

`status` string, `message` string, `meta.page_info` object, `data` array of list items (§1.4).

`meta.page_info` fields: `total` integer, `current_page` integer, `total_pages` integer.

#### Errors and documented statuses

- Action page: `200`, `400`; example 400 message `"page parameter must be a positive integer"`.
- Common: `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

None.

## 3. Checkout

Sources: [Flutterwave Standard](https://developer.flutterwave.com/v3.0.0/docs/flutterwave-standard-1), [Testing](https://developer.flutterwave.com/v3.0.0/docs/testing), [Webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks), accessed 27 October 2026.

Flutterwave v3 checkout is hosted. The flow is:

1. `POST /v3/payments` returns `data.link`, e.g. `https://checkout.flutterwave.com/v3/hosted/pay/...`.
2. Redirect the customer to that link.
3. After success or failure, Flutterwave redirects to `redirect_url` with `status`, `tx_ref`, and `transaction_id`.
4. Verify the transaction server-side; do not trust the redirect alone.
5. If webhooks are enabled, `charge.completed` is sent for successful and failed payment attempts.

There is no documented API endpoint or JSON schema for the hosted checkout page itself. Ibeji's local test checkout page is an Ibeji feature, not a Flutterwave endpoint. It should imitate these documented outcomes:

- **Success:** transaction status `successful`; `charge.completed` with `data.status: "successful"`.
- **Failed:** transaction status `failed`; `charge.completed` with `data.status: "failed"`; the Standard guide says the page stays open for retries until the customer cancels, then redirects with `status=failed`.
- **Cancelled:** the Standard guide says a customer who chooses to cancel is redirected with `status=failed`. It does **not** document a separate `cancelled` transaction status. C4b's distinct "cancelled" button is therefore a local Ibeji choice; it must map to a documented failed result or be marked **UNCONFIRMED**.

Documented checkout controls:

- `session_duration`: minutes, max 1440; when it expires, the payment window closes and the transaction is cancelled and marked failed.
- `max_retry_attempt`: stops further attempts after the configured number; transaction is cancelled and marked failed.
- The testing guide says to use `localhost:<port>` for local checkout; pointing at `127.0.0.1` "would result in errors." Ibeji's local twin binds `127.0.0.1` per C3, so this is a deliberate deviation to record, not a Flutterwave behaviour to copy.

#### Errors and statuses

There is no Flutterwave API status for the local page. The Standard/create API uses `200`/`400`; common v3 errors are `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

`charge.completed` for both success and failure. The exact payload is in §6.2.

## 4. Refunds

### 4.1 Refund a transaction

Sources: [Refund a transaction](https://developer.flutterwave.com/v3.0.0/reference/transaction-refund), [Refunds guide](https://developer.flutterwave.com/v3.0.0/docs/refunds), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/v3/transactions/{id}/refund`
- **Base URL:** `https://api.flutterwave.com/v3`
- **Headers:** `Authorization: Bearer <secret key>`, `Content-Type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | integer | Yes (path) | Original transaction ID. |
| `amount` | integer | No | Partial refund amount; omit for full refund. |
| `comments` | string | No | Custom refund description. |
| `callbackurl` | string | No | Refund callback URL; overrides the dashboard refund webhook URL for this request per the guide. |

Documented minimum refund: NGN 100 and KES 10. A lower amount returns `400 Bad Request` with `"Amount should be above NGN100"` as the example.

#### Success response

`status` string, `message` string, `data` refund-create object in §1.5.

#### Errors and documented statuses

- Action page: `200`, `400`.
- Common: `401`, `500`, `503`, `429`.
- Exact 400 examples: `"Amount should be above NGN100"`; OpenAPI also shows `{}`. **UNCONFIRMED** full validation set.

#### Webhook events this action can trigger

A refund webhook is documented in the Refunds guide and the Webhooks page. The Webhooks page's "Refund" example is a **bare object with no `event` field**; no v3 refund event name is documented. **UNCONFIRMED event name.** The payload fields are in §6.4. The guide says a `callbackurl` in the request overrides the dashboard refund webhook URL for that request.

### 4.2 Fetch a refunded transaction

Source: [Fetch a refunded transaction](https://developer.flutterwave.com/v3.0.0/reference/get-transaction-refunds), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/refunds/{id}`
- **Base URL:** `https://api.flutterwave.com/v3`
- **Headers:** `Authorization: Bearer <secret key>`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | integer | Yes (path) | The docs call it a "unique transaction identifier" but the path is `/refunds/{id}`. The guide says use the refund ID returned as `data.id` from the refund call. **UNCONFIRMED** whether the path expects refund ID or transaction ID; the two official pages disagree. |

#### Success response

The response is a **bare object**, not the usual `{status,message,data}` envelope. Fields are in §1.5.

#### Errors and documented statuses

- Action page: `200`, `400`.
- Exact 400 body: `{"status":"error","message":"Error: Refund Id Not Found","data":null}`.
- Common: `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

None.

### 4.3 List refunds

Source: [Fetch multiple refunded transactions](https://developer.flutterwave.com/v3.0.0/reference/get-all-refunds), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/refunds`
- **Headers:** `Authorization: Bearer <secret key>`

#### Query parameters

| Field | Type | Required? | Notes |
|---|---|---|---|
| `from` | date `YYYY-MM-DD` | No | Start date. |
| `to` | date `YYYY-MM-DD` | No | End date. |
| `status` | string | No | Docs mention `successful`, `failed`, `completed`. |
| `currency` | string | No | Currency. |
| `flw_ref` | string | No | Refund reference. |
| `id` | string | No | Transaction ID. |

#### Success response

`status` string, `message` string, `meta.page_info` (`total`, `current_page`, `total_pages`, `page_size` integers), `data` array of refund list items (§1.5).

#### Errors and documented statuses

- Action page: `200`, `400`; exact 400 sample `"Error: Refund Id Not Found"`.
- Common: `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

None.

## 5. Transfers and banks

### 5.1 Initiate transfer

Sources: [Create a transfer](https://developer.flutterwave.com/v3.0.0/reference/create-a-transfer), [Bank Account Transfer guide](https://developer.flutterwave.com/v3.0.0/docs/bank-account), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/v3/transfers`
- **Base URL:** `https://api.flutterwave.com/v3`
- **Headers:** `Authorization: Bearer <secret key>`, `Content-Type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `account_bank` | string | Yes | Recipient bank code or identifier. |
| `account_number` | string | Yes | Recipient account number. |
| `amount` | integer | Yes | Whole currency amount in the documented examples, e.g. `5500` NGN. |
| `currency` | string | Yes | Transfer currency. |
| `debit_subaccount` | string | No | Payout subaccount wallet used as source. |
| `beneficiary` | integer | No | Existing beneficiary ID. |
| `beneficiary_name` | string | No | Beneficiary full name. |
| `reference` | string | No | Merchant unique reference; if omitted Flutterwave generates one. |
| `debit_currency` | string | No | Source balance currency; defaults to transfer currency. |
| `destination_branch_code` | string | No | Required for banks that have branches; provider-dependent. |
| `callback_url` | string | No | Transfer response callback URL. |
| `narration` | string | No | Transfer narration. |
| `meta` | array of objects | No | Extra transfer details. |
| `skip_beneficiary_creation` | string | No | `"1"` to skip automatic beneficiary creation. |

`meta[]` documented fields (all optional in the schema unless stated; many are conditionally required for specific transfer types): `sender`, `sender_address`, `sender_city`, `sender_country`, `sender_id_number`, `sender_id_type`, `sender_id_expiry`, `sender_mobile_number`, `sender_email_address`, `sender_occupation`, `sender_beneficiary_relationship`, `first_name`, `last_name`, `email`, `mobile_number`, `beneficiary_mobile_number`, `recipient_address`, `beneficiary_state`, `beneficiary_country`, `beneficiary_occupation`, `transfer_purpose`, `routing_number`, `merchant_name`, `account_number`. The schema marks `sender`, `sender_country`, `first_name`, `last_name`, `email`, `mobile_number`, `beneficiary_mobile_number`, `recipient_address`, `beneficiary_state`, `beneficiary_country`, and `beneficiary_occupation` as required inside `meta` when `meta` is used. The docs say requirements vary by destination.

#### Success response

`status` string, `message` string, `data` transfer object in §1.6. The sample message is `"Transfer Queued Successfully"` and `data.status` is `"NEW"`.

#### Errors and documented statuses

- Create sample: `200`, `400`, `401`, `404`, `503`; guide also shows a 500 HTML error.
- Exact 400: `{"status":"error","message":"amount is required","data":null}`.
- Exact 404: `{"status":"error","message":"Transfer not found","data":null}`.
- 503: `{"status":"error","data":null}` in the guide.
- Common: `429`.
- Processing failures can return `200` with `data.status: "FAILED"` and a `complete_message`.

#### Webhook events this action can trigger

`transfer.completed` with `data.status: "SUCCESSFUL"` or `"FAILED"`. v3 documents no separate `transfer.failed` event and no v3 `transfer.reversal` event. See §6.3.

### 5.2 Fetch a transfer

Source: [Get a transfer](https://developer.flutterwave.com/v3.0.0/reference/get-a-transfer), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/transfers/{id}`
- **Headers:** `Authorization: Bearer <secret key>`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | integer | Yes (path) | Numeric transfer ID from the create response. |

#### Success response

`status` string, `message` string, `data` transfer object §1.6. Sample `message`: `"Transfer fetched"`; sample `data.status`: `"SUCCESSFUL"`.

#### Errors and documented statuses

- Action page: `200`, `400`, `404`; exact 404 `"Transfer not found"`.
- Common: `401`, `500`, `503`, `429`.
- **observed while recording on 28 October 2026:** `GET /v3/transfers/not-a-number` returned HTTP `200` with an HTML page `Cannot GET /v3/transfers/not-a-number`. The twin should **not** copy this: the documented v3 response for a missing transfer is a JSON `404` with message `"Transfer not found"`. The HTML fixture is kept only as evidence of the real endpoint's lenient Express-style response.

#### Webhook events this action can trigger

None.

### 5.3 List transfers

Source: [Get all transfers](https://developer.flutterwave.com/v3.0.0/reference/get-all-transfers), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/transfers`
- **Headers:** `Authorization: Bearer <secret key>`

#### Query parameters

| Field | Type | Required? | Notes |
|---|---|---|---|
| `reference` | string | No | Merchant transfer reference. |
| `page` | string | No | Page number. |
| `status` | string | No | Docs mention `failed`, `successful`. |
| `from` | string | No | Start date. |
| `to` | string | No | End date. |
| `include_proof` | boolean | No | Include session proof. |
| `include_provider_ref` | boolean | No | Include provider reference. |
| `include_approver_info` | boolean | No | Include approval information. |
| `include_vat` | boolean | No | Include VAT. |
| `include_date_completed` | boolean | No | Include completion date. |
| `include_rate` | boolean | No | Include FX rate. |
| `include_debit_currency_amount` | boolean | No | Include debit-currency amount. |
| `page_size` | string | No | Default 10. |

#### Success response

`status` string, `message` string, `meta.page_info` (`total`, `current_page`, `total_pages` integers), `data` array of transfer objects §1.6.

#### Errors and documented statuses

- Action page: `200`, `400`; exact 400 `"page parameter must be a positive integer"`.
- Common: `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

None.

### 5.4 List banks for a country

Source: [Get all banks](https://developer.flutterwave.com/v3.0.0/reference/get-all-banks), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/v3/banks/{country}`
- **Headers:** `Authorization: Bearer <secret key>`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `country` | string | Yes (path) | ISO-2 code, e.g. `NG`. |
| `include_provider_type` | string | No | Adds a field distinguishing bank from mobile-money provider. |

#### Success response

`status` string, `message` string, `data` array of bank objects §1.7. No `meta` in the sample.

#### Errors and documented statuses

- Action page: `200`, `400`.
- Common: `401`, `500`, `503`, `429`.

#### Webhook events this action can trigger

None.

### 5.5 Resolve account number

Sources: [Retrieve Bank Account Name](https://developer.flutterwave.com/v3.0.0/reference/resolve-account-transfer-details), [Bank Account Verification guide](https://developer.flutterwave.com/v3.0.0/docs/bank-account-verification-1), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/v3/accounts/resolve`
- **Headers:** `Authorization: Bearer <secret key>`, `Content-Type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `account_number` | string | Yes | Customer bank account number. |
| `account_bank` | string | Yes | Bank code. |

#### Success response

`status` string, `message` string, `data` with `account_number` and `account_name` (§1.7).

#### Errors and documented statuses

- Action page: `200`, `400`.
- Common: `401`, `500`, `503`, `429`.
- Exact validation body: **UNCONFIRMED**; common errors show the general error shape.

#### Webhook events this action can trigger

None documented.

## 6. Webhooks for the C4b actions

Sources: [Webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks), [Refunds guide](https://developer.flutterwave.com/v3.0.0/docs/refunds), [Bank Account Transfer](https://developer.flutterwave.com/v3.0.0/docs/bank-account), accessed 27 October 2026.

### 6.1 Common v3 webhook shape

v3 webhooks are `POST` requests with a JSON body. The general shape is:

```json
{
  "event": "charge.completed",
  "data": {}
}
```

`transfer.completed` also includes `event.type: "Transfer"`. The v3 Webhooks page says all payloads except virtual-card debits follow the event/data structure, but the refund example is a bare object with no `event` field. Treat that as a documented exception/conflict.

The app must return HTTP `200`; any other status, including 3xx, is a failure. Verification uses the `verif-hash` header (§8); retries are in §9.

### 6.2 `charge.completed`

Exact event name: `charge.completed`. It is sent for successful and failed payment attempts.

Successful payload example:

```json
{
  "event": "charge.completed",
  "data": {
    "id": 285959875,
    "tx_ref": "Links-616626414629",
    "flw_ref": "PeterEkene/FLW270177170",
    "device_fingerprint": "a42937f4a73ce8bb8b8df14e63a2df31",
    "amount": 100,
    "currency": "NGN",
    "charged_amount": 100,
    "app_fee": 1.4,
    "merchant_fee": 0,
    "processor_response": "Approved by Financial Institution",
    "auth_model": "PIN",
    "ip": "197.210.64.96",
    "narration": "CARD Transaction ",
    "status": "successful",
    "payment_type": "card",
    "created_at": "2020-07-06T19:17:04.000Z",
    "account_id": 17321,
    "customer": {
      "id": 215604089,
      "name": "Yemi Desola",
      "phone_number": null,
      "email": "user@gmail.com",
      "created_at": "2020-07-06T19:17:04.000Z"
    },
    "card": {
      "first_6digits": "123456",
      "last_4digits": "7889",
      "issuer": "VERVE FIRST CITY MONUMENT BANK PLC",
      "country": "NG",
      "type": "VERVE",
      "expiry": "02/23"
    }
  }
}
```

Failed payload example (the docs also include `event.type: "CARD_TRANSACTION"` in this sample):

```json
{
  "event": "charge.completed",
  "event.type": "CARD_TRANSACTION",
  "data": {
    "id": 408136545,
    "tx_ref": "Links-618617883594",
    "flw_ref": "NETFLIX/SM31570678271",
    "device_fingerprint": "7852b6c97d67edce50a5f1e540719e39",
    "amount": 100000,
    "currency": "NGN",
    "charged_amount": 100000,
    "app_fee": 1400,
    "merchant_fee": 0,
    "processor_response": "invalid token supplied",
    "auth_model": "PIN",
    "ip": "72.140.222.142",
    "narration": "CARD Transaction ",
    "status": "failed",
    "payment_type": "card",
    "created_at": "2021-04-16T14:52:37.000Z",
    "account_id": 82913,
    "customer": {
      "id": 255128611,
      "name": "a a",
      "phone_number": null,
      "email": "a@b.com",
      "created_at": "2021-04-16T14:52:37.000Z"
    },
    "card": {
      "first_6digits": "536613",
      "last_4digits": "8816",
      "issuer": "MASTERCARD ACCESS BANK PLC  CREDIT",
      "country": "NG",
      "type": "MASTERCARD",
      "expiry": "12/21"
    }
  }
}
```

Fields:

| Field | Type | Example |
|---|---|---|
| `event` | string | `"charge.completed"` |
| `event.type` | string, optional in samples | `"CARD_TRANSACTION"` on the failed sample; absent on the success sample |
| `data.id` | integer | `285959875` |
| `data.tx_ref` | string | `"Links-616626414629"` |
| `data.flw_ref` | string | `"PeterEkene/FLW270177170"` |
| `data.device_fingerprint` | string | `"a42937f4a73ce8bb8b8df14e63a2df31"` |
| `data.amount` | integer | `100` |
| `data.currency` | string | `"NGN"` |
| `data.charged_amount` | integer | `100` |
| `data.app_fee` | number/integer | `1.4` |
| `data.merchant_fee` | integer | `0` |
| `data.processor_response` | string | `"Approved by Financial Institution"` |
| `data.auth_model` | string | `"PIN"` |
| `data.ip` | string | `"197.210.64.96"` |
| `data.narration` | string | `"CARD Transaction "` |
| `data.status` | string | `"successful"` / `"failed"` |
| `data.payment_type` | string | `"card"` |
| `data.created_at` | ISO date string | `"2020-07-06T19:17:04.000Z"` |
| `data.account_id` | integer | `17321` |
| `data.customer.id` | integer | `215604089` |
| `data.customer.name` | string | `"Yemi Desola"` |
| `data.customer.phone_number` | null/string | `null` |
| `data.customer.email` | string | `"user@gmail.com"` |
| `data.customer.created_at` | ISO date string | `"2020-07-06T19:17:04.000Z"` |
| `data.card.first_6digits` | string | `"123456"` |
| `data.card.last_4digits` | string | `"7889"` |
| `data.card.issuer` | string | `"VERVE FIRST CITY MONUMENT BANK PLC"` |
| `data.card.country` | string | `"NG"` |
| `data.card.type` | string | `"VERVE"` |
| `data.card.expiry` | string | `"02/23"` |

The `card` object is documented for card payments; the docs do not show a complete shape for every payment type. **UNCONFIRMED** for non-card variants.

### 6.3 `transfer.completed`

Exact event name: `transfer.completed`. It is sent for successful and failed transfers. The status is inside `data.status` and is uppercase in the samples.

Successful payload:

```json
{
  "event": "transfer.completed",
  "event.type": "Transfer",
  "data": {
    "id": 33286,
    "account_number": "0690000033",
    "bank_name": "ACCESS BANK NIGERIA",
    "bank_code": "044",
    "fullname": "Bale Gary",
    "created_at": "2020-04-14T16:39:17.000Z",
    "currency": "NGN",
    "debit_currency": "NGN",
    "amount": 30020,
    "fee": 26.875,
    "status": "SUCCESSFUL",
    "reference": "a0a827b1eca65311_PMCKDU_5",
    "meta": null,
    "narration": "lolololo",
    "approver": null,
    "complete_message": "Successful",
    "requires_approval": 0,
    "is_approved": 1
  }
}
```

Failed payload:

```json
{
  "event": "transfer.completed",
  "event.type": "Transfer",
  "data": {
    "id": 2207648,
    "account_number": "0731702***",
    "bank_name": "ACCESS BANK NIGERIA",
    "bank_code": "044",
    "fullname": "Yemi Desola",
    "created_at": "2020-07-06T21:49:02.000Z",
    "currency": "NGN",
    "debit_currency": "NGN",
    "amount": 5000000000,
    "fee": 53.75,
    "status": "FAILED",
    "reference": "ionn1594072140865",
    "meta": null,
    "narration": "ionnodo",
    "approver": null,
    "complete_message": "DISBURSE FAILED: You can only spend NGN 1000000.00 at once",
    "requires_approval": 0,
    "is_approved": 1
  }
}
```

Fields:

| Field | Type | Example |
|---|---|---|
| `event` | string | `"transfer.completed"` |
| `event.type` | string | `"Transfer"` |
| `data.id` | integer | `33286` |
| `data.account_number` | string | `"0690000033"` |
| `data.bank_name` | string | `"ACCESS BANK NIGERIA"` |
| `data.bank_code` | string | `"044"` |
| `data.fullname` | string | `"Bale Gary"` |
| `data.created_at` | ISO date string | `"2020-04-14T16:39:17.000Z"` |
| `data.currency` | string | `"NGN"` |
| `data.debit_currency` | string | `"NGN"` |
| `data.amount` | integer | `30020` |
| `data.fee` | number | `26.875` |
| `data.status` | string | `"SUCCESSFUL"` / `"FAILED"` |
| `data.reference` | string | `"a0a827b1eca65311_PMCKDU_5"` |
| `data.meta` | object/array/null | `null` |
| `data.narration` | string | `"lolololo"` |
| `data.approver` | null/object | `null` |
| `data.complete_message` | string | `"Successful"` |
| `data.requires_approval` | integer | `0` |
| `data.is_approved` | integer | `1` |

The docs show no v3 `transfer.reversal` event. v4 documents `transfer.reversal`; it is not a v3 fact.

### 6.4 Refund webhook

The v3 Webhooks page shows a refund payload as a **bare object**, with no `event` field and no documented event name. The Refunds guide says the refund webhook can be configured separately and that `callbackurl` on the request overrides the dashboard refund webhook URL.

Exact documented payload example:

```json
{
  "id": 99025,
  "AmountRefunded": 100,
  "status": "completed",
  "FlwRef": "4687213286",
  "destination": "payment_source",
  "comments": null,
  "settlement_id": "142228",
  "meta": "{\"source\":\"ledgerbalance\",\"isPartialRefund\":true,\"disburse_ref\":\"CC-REFD-20529545675-4687213286\",\"disburse_status\":\"failed\"}",
  "createdAt": "2026-01-30T08:35:45.000Z",
  "updatedAt": "2026-01-30T08:35:46.000Z",
  "deletedAt": null,
  "walletId": 684098,
  "AccountId": 169295,
  "TransactionId": 9231836
}
```

| Field | Type | Example |
|---|---|---|
| `id` | integer | `99025` |
| `AmountRefunded` | integer/number | `100` |
| `status` | string | `"completed"` |
| `FlwRef` | string | `"4687213286"` |
| `destination` | string | `"payment_source"` |
| `comments` | null/string | `null` |
| `settlement_id` | string | `"142228"` |
| `meta` | string containing JSON | `"{\"source\":\"ledgerbalance\",...}"` |
| `createdAt` | ISO date string | `"2026-01-30T08:35:45.000Z"` |
| `updatedAt` | ISO date string | `"2026-01-30T08:35:46.000Z"` |
| `deletedAt` | null | `null` |
| `walletId` | integer | `684098` |
| `AccountId` | integer | `169295` |
| `TransactionId` | integer | `9231836` |

**Event name: UNCONFIRMED.** v3 does not publish one. v4 publishes `refund.completed`, but that is v4 and must not be assumed for v3.

### 6.5 Event summary for C4b

| Action | Documented v3 events |
|---|---|
| Create hosted payment / checkout | `charge.completed` (`data.status` `successful` or `failed`) |
| Verify/fetch/list payments | None |
| Refund a transaction | Refund webhook bare payload; **event name UNCONFIRMED** |
| Fetch/list refunds | None |
| Initiate transfer | `transfer.completed` (`data.status` `SUCCESSFUL` or `FAILED`) |
| Fetch/list transfers | None |
| List/resolve banks | None documented |

No v3 bank/resolve/recipient event is documented. No v3 `charge.failed` event exists; failure is `charge.completed` with `data.status: "failed"`. No v3 transfer reversal event is documented.

## 7. Authentication

Sources: [Authentication](https://developer.flutterwave.com/v3.0.0/docs/authentication), [Common Errors](https://developer.flutterwave.com/v3.0.0/docs/common-errors), accessed 27 October 2026.

- All v3 server API calls use the secret key in the `Authorization` header: `Authorization: Bearer <secret key>`.
- JSON request bodies also send `Content-Type: application/json`.
- Test keys contain `_TEST`; the docs example public key is `FLWPUBK_TEST-...` and the secret key is `FLWSECK_TEST-...`.
- Live keys are the same key families without `_TEST`: `FLWPUBK-...` (public) and `FLWSECK-...` (secret). The docs explicitly say the secret key starts with `FLWSECK`; they do not publish a complete live-key example, so the exact full live-key format is **UNCONFIRMED**.
- The public key is for client-side use (Inline); the encryption key is for direct card-charge payload encryption.
- Missing or invalid authorization returns HTTP `401` with:

```json
{
  "status": "error",
  "message": "Authorization required",
  "data": null
}
```

- The v3 docs do not document key lengths, restricted/limited key formats, or any additional live-key prefix. **UNCONFIRMED.**

## 8. Webhook verification

Source: [Webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks), accessed 27 October 2026.

v3 uses a **shared secret hash**, not an HMAC signature:

1. Set a secret hash in the Flutterwave dashboard's webhook settings.
2. Flutterwave sends it in the `verif-hash` header.
3. The app checks that `verif-hash` is present and equals the secret hash.
4. If missing or different, discard the request.

This is documented as a string comparison. The docs recommend a timing-safe comparison in examples. Flutterwave's IP addresses are dynamic; the docs recommend not using strict IP allowlisting, and signature/hash verification instead.

v4 differs: v4 uses `flutterwave-signature` with HMAC-SHA256 of the raw body using the secret hash, Base64 encoded. That is not the v3 method.

## 9. Webhook retries

Source: [Webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks), accessed 27 October 2026.

- The endpoint must return exactly `200`; any other response, including 3xx, is a failure.
- Timeout: 60 seconds per attempt.
- If webhook retries are enabled in the dashboard, Flutterwave retries **3 times** with a **30-minute interval** between attempts.
- Without a 200, the delivery is treated as failed.
- Flutterwave says it may occasionally send the same webhook event more than once and recommends idempotent processing.
- The docs do not state a default retry setting; the wording is "if webhook retries are enabled." **UNCONFIRMED** whether retries are on by default.

## 10. Idempotency

Sources: [Flutterwave Standard](https://developer.flutterwave.com/v3.0.0/docs/flutterwave-standard-1), [Create a transfer](https://developer.flutterwave.com/v3.0.0/reference/create-a-transfer), [Refund a transaction](https://developer.flutterwave.com/v3.0.0/reference/transaction-refund), [Webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks), accessed 27 October 2026.

For **v3**, no general idempotency header or rule is documented. **Not documented.**

Specific v3 statements:

- `tx_ref` is described as a reference that must be unique for every transaction. The behaviour for a repeated `tx_ref` is **UNCONFIRMED**.
- Transfer `reference` is a merchant unique reference; if omitted Flutterwave generates one. The v3 docs do not document replaying the same transfer reference as idempotent. **UNCONFIRMED.**
- Refund creation has no idempotency key or duplicate-refund rule. **Not documented.**
- Webhooks may be delivered more than once; apps must be idempotent.
- v4 documents `X-Idempotency-Key` with `X-Idempotency-Cache-Hit`; that is a v4 feature, not v3. Do not apply it to the v3 twin.

## 11. Test mode

Source: [Testing](https://developer.flutterwave.com/v3.0.0/docs/testing), accessed 27 October 2026.

Test credentials work only in Test Mode. Test receipt emails go to the business email, not the customer's.

### 11.1 Cards

The docs state that the card expiry can be any future date; these are the listed test values.

Successful payments:

| Type | Network | Card number | Expiry | CVV | OTP | PIN |
|---|---|---|---|---|---|---|
| PIN authentication | Mastercard | `5531886652142950` | `09/32` | `564` | `12345` | `3310` |
| 3DS authentication | Mastercard | `5438898014560229` | `10/31` | `564` | `12345` | `3310` |
| 3DS authentication | Visa | `4187427415564246` | `09/32` | `828` | `12345` | `3310` |
| 3DS authentication | Afrigo | `5640003941605320` | `05/31` | `044` | — | — |
| PIN authentication | Verve | `5061460410120223210` | `10/31` | `780` | `12345` | `3310` |
| NoAuth | Verve | `5061460166976054667` | `10/29` | `564` | — | `3310` |
| Address Verification (AVS) | Visa | `4556052704172643` | `09/32` | `899` | `12345` | `3310` |
| Pre-authentication | Mastercard | `5377283645077450` | `09/31` | `789` | — | `3310` |

Failed payments:

| Type | Network | Card number | Expiry | CVV | OTP | PIN |
|---|---|---|---|---|---|---|
| Do Not Honour | Mastercard | `5143010522339965` | `08/32` | `276` | `12345` | `3310` |
| Card Fraudulent | Mastercard | `5590131743294314` | `11/32` | `887` | `12345` | `3310` |
| Insufficient Funds | Mastercard | `5258585922666506` | `09/31` | `883` | `12345` | `3310` |
| Do Not Honour | Mastercard | `5143010522339965` | `08/31` | `276` | — | `3310` |
| Insufficient Funds | Mastercard | `5258585922666506` | `09/31` | `883` | `12345` | — |
| Insufficient Funds | Afrigo | `5640007065275380` | `05/31` | `044` | — | — |
| Incorrect PIN | Mastercard | `5399834697894723` | `09/31` | `883` | `12345` | `3310` |

Special OTPs: any OTP passes in test mode; `5548` mocks a wrong OTP and `6648` mocks insufficient funds when the OTP is validated inside the payment modal. The docs say these special OTPs do not apply if redirected to the OTP validation page.

### 11.2 Bank accounts

Successful payment test accounts:

| Bank | Account number | OTP |
|---|---|---|
| Access Bank (044) | `0690000031` | `12345` |
| Access Bank (044) | `0690000032` | `12345` |
| Access Bank (044) | `0690000033` | `12345` |
| Access Bank (044) | `0690000034` | `12345` |

The docs say the last digit can be incremented up to `0690000041`.

Blacklisted test account: Access Bank `0690000036`, account name `Bode George`; it returns `400` with `"Payout was made to a blacklisted account number"`.

Mobile money: any mobile number with OTP `123456` succeeds; WAVE can use any number. Failed numbers: `233121212121`, `233010101011` (failed transaction), and `121212121` (Wave failed transaction).

### 11.3 Test transfers

The docs say test transfers using the test accounts always remain `PENDING` by default. Special reference suffixes change the outcome:

- Ends with `_PMCK`: success after 10 minutes.
- Ends with `_PMCK_ST_F`: failure after 10 minutes.
- Append `DU_{minutes}` to change the delay, e.g. `_PMCKDU_1` succeeds after 1 minute, `_PMCK_ST_FDU_1` fails after 1 minute.

This directly supports the "stuck pending" failure and shows that both success and failure can be deliberately delayed.

### 11.4 Test checkout localhost note

The testing guide says to route a local app to `localhost:<preferred-port>` for checkout and that pointing it at `127.0.0.1:<port>` causes errors. Ibeji binds `127.0.0.1` per C3. This is an intentional local-twin difference and a gap for exact Flutterwave checkout behaviour.

## 12. Money

Sources: [Standard API](https://developer.flutterwave.com/v3.0.0/reference/checkout), [Bank Account Transfer](https://developer.flutterwave.com/v3.0.0/docs/bank-account), [Refunds guide](https://developer.flutterwave.com/v3.0.0/docs/refunds), accessed 27 October 2026.

**Flutterwave v3 uses whole currency amounts, not minor units, in the documented examples.** For example:

- Standard charge: `amount: 7500` with `currency: "NGN"` for an NGN 7,500 charge (v3 guide).
- Transfer: `amount: 5500` with `currency: "NGN"` for an NGN 5,500 transfer.
- Refund: `amount: 6900`; minimum NGN 100 / KES 10.

The v3 docs do not use "subunit", "kobo", or "minor unit" language. v4 explicitly defines `amount` as a decimal (`12.34`, `1234.56`), which is also a whole-currency amount. Treat v3 as whole currency units. **UNCONFIRMED** whether any currency has a documented exception; no v3 currency subunit table was found.

`amount` types are inconsistent in the docs:

- Standard OpenAPI schema: integer; guide example uses a string `"7500"`.
- Refund create: integer.
- Transfer create: integer.
- Response `amount`: integer in samples.
- `fee`, `app_fee`, `amount_settled` can be numbers with decimals (e.g. `45`, `10.75`, `98.6`).
- Refund webhook uses `AmountRefunded` as a number.
- Wallet funding webhook sample uses `"amount": "10.70"` and `"fee": "7.00"` (strings).

Documented v3 transfer currencies (Bank Account Transfer guide): EUR, GBP, GHS, KES, MWK, NGN, TZS, UGX, USD, XAF, XOF, ZAR. The v3 payment docs do not publish an exhaustive supported-currency list; use fixtures for exact payment currency coverage. **UNCONFIRMED.**

## 13. Base URL in libraries

The Flutterwave API docs do not document a Node base-URL override. This section uses the published npm packages and their source, because the task asks a library-specific question. Download counts are npm weekly downloads for 20–26 October 2026 from `https://api.npmjs.org/downloads/point/last-week/<package>`.

| Library | Role / downloads | Can an app change the base URL to a v3 twin? | Source |
|---|---|---|---|
| `flutterwave-node-v3` 1.4.1 | Official Node library for v3; 7,643/week | **Yes, by source, though not shown in the README.** The constructor accepts a third `base_url_or_production_flag` argument; a string overrides `base_url`. Pass a URL ending in `/` because the library appends paths such as `v3/transactions/...`. Example: `new Flutterwave(pub, sec, "http://127.0.0.1:4402/")`; the twin must serve `/v3/...`. | [npm](https://www.npmjs.com/package/flutterwave-node-v3), [official source](https://github.com/Flutterwave/Flutterwave-node-v3), tarball `index.js:22`, `lib/rave.base.js:7-19`; official SDK directory labels it API v3. |
| `flutterwave` 2.2.8 | Community; 335/week | **Yes** via the third constructor argument, but this is the old Rave/PWC API, not v3. Default base is `http://staging1flutterwave.co:8080/pwc/rest`. It cannot be used as a v3 compatibility test. | [npm](https://www.npmjs.com/package/flutterwave), tarball `lib/flw.base.js:7-24`, `Readme.md:26-31`. |
| `flutterwave-node` 1.2.2 | Community/official old Rave; 112/week | **Yes** via the third constructor argument, but it targets the old Rave API (`https://api.ravepay.co`), not v3. It cannot be used as a v3 compatibility test. | [npm](https://www.npmjs.com/package/flutterwave-node), tarball `lib/rave.base.js:7-24`, `Readme.md:56`. |
| `flutterwave-node-v4` 0.2.1 | Community; 20/week | **v4 only.** It is explicitly "The unofficial Flutterwave Node.js SDK for v4 APIs" and uses v4 base URLs/OAuth. Not a v3 client. | [npm](https://www.npmjs.com/package/flutterwave-node-v4), README; tarball `dist/` shows v4 base URLs. |

T15 consequence: the official v3 Node library can be pointed at a local twin via the third constructor argument, provided the twin serves the `/v3/...` paths and the base ends with `/`. This is the best compatibility route. Two caveats: (1) the library's `Charge` group calls `v3/charges`, not the Standard `v3/payments` hosted-link endpoint, so pointing it at the twin does not automatically exercise C4b's hosted checkout; T15 must decide which library methods map to C4b. (2) The official v3 library includes telemetry code in `utils/logger.js` that contacts `api.ravepay.co` and `signozservice-prod.f4b-flutterwave.com`; T15 must verify whether this fires and must not depend on external network access. The docs' `localhost` checkout note also conflicts with Ibeji's `127.0.0.1` binding for the real hosted page, but that is separate from pointing the library at a local twin.

## 14. Real-world behaviour and C5 mapping

Sources: [Bank Account Transfer](https://developer.flutterwave.com/v3.0.0/docs/bank-account), [Testing: Testing Transfers](https://developer.flutterwave.com/v3.0.0/docs/testing#testing-transfers), [Refunds guide](https://developer.flutterwave.com/v3.0.0/docs/refunds), [Webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks), [Handling Error Timeouts](https://developer.flutterwave.com/v3.0.0/docs/handling-error-timeouts), [Rate Limit](https://developer.flutterwave.com/v3.0.0/docs/rate-limit), [Common Errors](https://developer.flutterwave.com/v3.0.0/docs/common-errors), accessed 27 October 2026.

### 14.1 Documented delays, pending states, reversals, and retries

- Transfer statuses documented in the Bank Account Transfer guide: `NEW` (created), `PENDING` (processing), `SUCCESSFUL`, `FAILED`. `complete_message` explains the status. There is no v3 `REVERSED` status documented.
- Test transfers default to `PENDING` and can be forced to succeed/fail after a delay (§11.3). This is documented evidence that pending transfers and delayed outcomes are realistic for the test environment.
- A transfer can fail with HTTP 200 and `data.status: "FAILED"`; technical failures use 400/401/404/503.
- Refund statuses are listed in §1.5; card refunds 3–15 days, mobile money 3–5 days, bank 24 hours. A refund can be `processing` or `pending-*`.
- Webhooks may occasionally be delivered more than once; apps must be idempotent. Retries: 3 times, 30-minute interval, if enabled; 60-second timeout.
- API timeout: the docs say the system waits about 28 seconds and returns `503` with `{"status":"error","message":"An error occurred. Please contact support","data":null}`. A timeout can mean the request is still processing; query status before retrying.
- Rate limit: HTTP `429`; no exact numeric limit or response body is documented in v3. The docs recommend backoff.
- Payment failures are documented through failed test cards and `charge.completed` with `data.status: "failed"`.
- v3 documents no transfer reversal status or reversal webhook. v4 documents `transfer.reversal`; that is not v3 and must not be used as a v3 fact.

### 14.2 C5 failures applicable to Flutterwave

`authentication-required` is Stripe-only and not applicable to Flutterwave.

| C5 failure | Verdict | Source / reason |
|---|---|---|
| `slow-response` | **docs** | Handling Error Timeouts documents a ~28-second wait before a 503 timeout. The exact synthetic delay is Ibeji's. |
| `timeout-after-commit` | **docs** | The timeout guide says a timeout may mean the request is still processing; query before retrying. |
| `timeout-before-commit` | **docs** | The same guide covers timeouts where no record may exist and the request should be retried after checking. |
| `server-error` | **docs** | Common Errors documents 500 and its different error shape; transfer guide also shows 503. |
| `rate-limited` | **docs** | Rate Limit documents HTTP 429 and recommended backoff. |
| `flaky-network` | **needs a real story** | No documented connection-drop behaviour. |
| `webhook-delayed` | **needs a real story** | The docs give retries, not arbitrary delay of the first webhook. |
| `webhook-duplicated` | **docs** | Webhooks says Flutterwave may occasionally send the same event more than once. |
| `webhook-out-of-order` | **needs a real story** | No ordering statement. |
| `webhook-never-sent` | **needs a real story** | No "never sent" case; only failure/retry. |
| `webhook-verification-fails` | **docs** | Webhooks documents the `verif-hash` shared-secret check and says to discard a missing/mismatched value. |
| `payment-declined` | **docs** | Testing documents failed cards; Standard guide documents failed payment attempts; `charge.completed` has `data.status: "failed"`. |
| `transfer-stuck-pending` | **docs** | Bank Account Transfer documents `PENDING`; Testing says test transfers default to `PENDING`; `_PMCK`/`_PMCK_ST_F` control delayed success/failure. |
| `transfer-reversed` | **needs a real story for v3** | v3 documents `NEW`/`PENDING`/`SUCCESSFUL`/`FAILED` and no reversal event. v4 documents `transfer.reversal`, but that is not v3. |
| `bank-resolve-fails` | **needs a real story** | The resolve endpoint has 400/common errors but no documented account-lookup failure mode or exact error. |

## 15. Gaps

These are facts SPEC.md needs that the v3 documentation does not answer, or where official pages disagree. Keep them **UNCONFIRMED** until fixtures or a real story supply them.

1. C4b's "fetch one transaction" has no distinct v3 endpoint in the official API reference. The closest are verify-by-ID and the filtered transaction list. Do not invent `GET /transactions/{id}`.
2. The v3 refund webhook has no documented event name; the official example is a bare object with no `event` field.
3. v3 does not document a transfer reversal status or `transfer.reversal` event. The only reversal evidence is v4, which is not the chosen version.
4. v3 does not document any API idempotency key. Duplicate `tx_ref`, duplicate transfer references, and double refunds are UNCONFIRMED.
5. The v3 docs do not state "whole currency unit" explicitly; they only show whole-currency examples. The exact rule for every currency is UNCONFIRMED.
6. The v3 payment docs do not publish an exhaustive supported-currency list. Use fixtures.
7. Full response schemas are not always given; some OpenAPI fields are `{}` or inconsistent types. `id` is an integer in verify and a string in list; `account_id` is an integer in verify and a string in list.
8. Official pages disagree on the Standard request: `configuration` (OpenAPI) vs `configurations` (guide); `phone_number` (OpenAPI) vs `phonenumber` (guide); `customizations.description` appears only in the guide; `payload_hash` is guide-only.
9. The refund fetch path `/refunds/{id}` describes `id` as a transaction ID in one place and a refund ID in the guide. Whether it accepts both is UNCONFIRMED.
10. Exact 400/401/404/429/500/503 bodies for each action are not all documented. 500 uses a different shape; 429 has no documented body.
11. The v3 transfer guide shows a 500 HTML body, a 503 JSON body, and an OpenAPI 400 `{}`; exact per-action error bodies are inconsistent.
12. Webhook payloads for refunds lack an event name; the v3 webhook page's general "event + data" rule is contradicted by the refund sample.
13. Automatic webhook duplicate, out-of-order, arbitrary-delay, and never-sent behaviour beyond the "occasionally duplicate" statement is UNCONFIRMED.
14. Whether webhook retries are enabled by default is UNCONFIRMED; the docs say "if webhook retries are enabled."
15. Webhook IPs are dynamic; no fixed allowlist is documented. Verification must use `verif-hash`.
16. The local checkout page has no Flutterwave API contract. The local "cancelled" choice has no distinct Flutterwave status; the Standard guide maps cancellation to failed. The test checkout guide's `localhost` requirement conflicts with Ibeji's `127.0.0.1` binding.
17. The full checkout UI, 3DS/OTP challenge flow, and all test-card interaction details are not documented as an API schema. Only outcomes and test credentials are.
18. The v3 official Node library's third constructor argument is not documented in its README; it is visible only in source. Its telemetry code contacts `api.ravepay.co` and `signozservice-prod.f4b-flutterwave.com`; T15 must account for this.
19. The v3 docs do not state how `session_duration`/`max_retry_attempt` behave for every payment method beyond the checkout guide.
20. Refund status timing is approximate (3–15 days cards, 3–5 days mobile money, 24 hours bank); exact transitions are not documented.
21. The v3 docs do not document all supported bank/mobile-money provider fields returned by `include_provider_type`.
22. There is no official Flutterwave v4 Node library; the v4 community package is not official. This supports the v3 choice but remains a version/future risk.
23. The v3 docs do not state whether a failed `charge.completed` event is sent for every failed attempt or only some methods; the Standard guide says notifications for failed attempts, but the event schema is not exhaustive.
24. The v3 docs do not state whether a refund webhook uses the same `verif-hash` header as charge/transfer webhooks; it is assumed from the general webhook section. **UNCONFIRMED.**
25. The v3 docs do not publish a complete list of transaction status values; examples show `successful`, `failed`, `pending` and list filters mention `successful`/`failed`. Other statuses are UNCONFIRMED.
26. The v3 docs do not document how `amount` behaves for currencies with no minor unit or for cross-currency transfers; the transfer guide mostly gives whole-amount examples.
27. The official v3 library's base URL override requires a trailing slash; the README does not say this. A wrong base can produce malformed URLs.
28. The v3 docs do not document a single-refund "fetch by transaction reference"; the list filter is the only alternative.
29. The v3 webhook verification is a static `verif-hash` string, not a signature over the body; an attacker who learns the hash can forge payloads. This is Flutterwave's documented method, not an Ibeji improvement.
30. The v3 rate-limit response has no documented body, numeric limit, or reset headers, unlike some other services.
31. The official v3 Node library's `Charge` group uses `v3/charges`, not the Standard `v3/payments` hosted-link flow. It can be pointed at a twin, but it may not provide a C4b hosted-checkout test without an additional decision.
