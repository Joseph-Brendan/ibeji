Paystack is a trademark of its owner. Ibeji is not affiliated with Paystack.

# Paystack research for Ibeji

Research date: **27 October 2026**.

Source rule: every Paystack API fact below comes from `paystack.com/docs`. Library base-URL facts in section 13 come from the published npm packages and their source files, because the Paystack API documentation does not document a Node base-URL override. That exception is labelled in section 13.

Markings:

- **UNCONFIRMED** means the documentation does not state the fact, or the sample and another official page disagree. Never fill this in from memory.
- Types in response tables are inferred from the documented JSON examples unless the page states a type. The docs publish examples, not a response schema.
- "Not documented" means no statement was found on the cited Paystack pages on the research date.

Base URL for all API calls: `https://api.paystack.com`. All requests must use HTTPS; unencrypted HTTP is not supported. Requests and responses are JSON, `Content-Type: application/json`. Sources: [API introduction](https://paystack.com/docs/api/), [Authentication](https://paystack.com/docs/api/authentication/).

## 0. Shared response envelopes and objects

### 0.1 Success envelope

Most endpoints return:

| Field | Type | Example |
|---|---|---|
| `status` | boolean | `true` |
| `message` | string | `"Transactions retrieved"` |
| `data` | object or array | endpoint-specific |

A list response also generally has `meta`. The API introduction shows one meta shape and individual list endpoints show another. See §0.10.

Error responses use a different envelope; see §0.11.

### 0.2 Transaction object

Used by verify, fetch, and list. The docs examples do not contain every field in every endpoint; fields marked "—" were absent from that sample. Types are inferred from the samples.

| Field | Type | Verify example | Fetch example | List example |
|---|---|---|---|---|
| `id` | integer (docs warn: use unsigned 64-bit) | `4099260516` | `4099260516` | `4099260516` |
| `domain` | string | `"test"` | `"test"` | `"test"` |
| `status` | string | `"success"` | `"success"` | `"success"` |
| `reference` | string | `"re4lyvq3s3"` | `"re4lyvq3s3"` | `"re4lyvq3s3"` |
| `receipt_number` | string or null | `null` | `null` | — |
| `amount` | integer | `40333` | `40333` | `40333` |
| `message` | string or null | `null` | `null` | `null` |
| `gateway_response` | string | `"Successful"` | `"Successful"` | `"Successful"` |
| `helpdesk_link` | string or null | — | `null` | — |
| `paid_at` | ISO date string or null | `"2024-08-22T09:15:02.000Z"` | `"2024-08-22T09:15:02.000Z"` | `"2024-08-22T09:15:02.000Z"` |
| `created_at` | ISO date string | `"2024-08-22T09:14:24.000Z"` | `"2024-08-22T09:14:24.000Z"` | `"2024-08-22T09:14:24.000Z"` |
| `channel` | string | `"card"` | `"card"` | `"card"` |
| `currency` | string | `"NGN"` | `"NGN"` | `"NGN"` |
| `ip_address` | string or null | `"197.210.54.33"` | `"197.210.54.33"` | `"197.210.54.33"` |
| `metadata` | string or null in these samples; docs do not clarify object form | `""` | `""` | `null` |
| `log` | object or null | Log object | Log object | Log object |
| `fees` | integer | `10283` | `10283` | `10283` |
| `fees_split` | null in samples | `null` | `null` | `null` |
| `authorization` | object | Authorization object | Authorization object | Authorization object |
| `customer` | object | Customer object | Customer object | Customer object |
| `plan` | object or null | `null` | `{}` | `{}` |
| `split` | object | `{}` | `{}` | `{}` |
| `order_id` | integer or null | `null` | `null` | `null` |
| `paidAt` | ISO date string | `"2024-08-22T09:15:02.000Z"` | `"2024-08-22T09:15:02.000Z"` | `"2024-08-22T09:15:02.000Z"` |
| `createdAt` | ISO date string | `"2024-08-22T09:14:24.000Z"` | `"2024-08-22T09:14:24.000Z"` | `"2024-08-22T09:14:24.000Z"` |
| `requested_amount` | integer | `30050` | `30050` | `30050` |
| `pos_transaction_data` | null in samples | `null` | `null` | `null` |
| `source` | object or null | `null` | Source object | Source object |
| `fees_breakdown` | null in samples | `null` | `null` | — |
| `connect` | null in samples | `null` | `null` | `null` |
| `transaction_date` | ISO date string | `"2024-08-22T09:14:24.000Z"` | — | — |
| `plan_object` | object | `{}` | — | — |
| `subaccount` | object | `{}` | `{}` | `{}` |

The sample also contains `log.history`, `authorization`, and `customer` nested objects; these are listed separately below.

### 0.3 Log object

| Field | Type | Example |
|---|---|---|
| `start_time` | integer (Unix seconds) | `1724318098` |
| `time_spent` | integer | `4` |
| `attempts` | integer | `1` |
| `errors` | integer | `0` |
| `success` | boolean | `true` |
| `mobile` | boolean | `false` |
| `input` | array | `[]` |
| `history` | array of objects | see below |
| `history[].type` | string | `"action"` |
| `history[].message` | string | `"Attempted to pay with card"` |
| `history[].time` | integer | `3` |

The docs do not state the element types of `input` or the complete set of `history[].type` values. **UNCONFIRMED.**

### 0.4 Authorization object

| Field | Type | Example |
|---|---|---|
| `authorization_code` | string | `"AUTH_uh8bcl3zbn"` |
| `bin` | string | `"408408"` |
| `last4` | string | `"4081"` |
| `exp_month` | string or null | `"12"` |
| `exp_year` | string or null | `"2030"` |
| `channel` | string | `"card"` |
| `card_type` | string | `"visa "` (trailing space in the docs sample) |
| `bank` | string | `"TEST BANK"` |
| `country_code` | string | `"NG"` |
| `brand` | string | `"visa"` |
| `reusable` | boolean | `true` |
| `signature` | string | `"SIG_yEXu7dLBeqG0kU7g95Ke"` |
| `account_name` | string or null | `null` |

### 0.5 Customer object

| Field | Type | Example |
|---|---|---|
| `id` | integer | `181873746` |
| `first_name` | string or null | `null` |
| `last_name` | string or null | `null` |
| `email` | string | `"customer@example.com"` (docs email is protected in the fetched page) |
| `customer_code` | string | `"CUS_1rkzaqsv4rrhqo6"` |
| `phone` | string or null | `null` |
| `metadata` | object or null | `null`, or a `custom_fields` array in the list sample |
| `risk_action` | string | `"default"` |
| `international_format_phone` | string or null | `null` |

### 0.6 Source object

| Field | Type | Example |
|---|---|---|
| `source` | string | `"merchant_api"` |
| `type` | string | `"api"` |
| `identifier` | null in samples | `null` |
| `entry_point` | string | `"transaction_initialize"` |

### 0.7 Refund object

The shape differs between create, list, and fetch. Types are inferred; `fully_deducted` is inconsistent in the official examples.

| Field | Type | Create example | List example | Fetch example |
|---|---|---|---|---|
| `transaction` | object (create) or integer (list/fetch) | Refund transaction object | `1641` | `1641` |
| `integration` | integer | `412829` | `100982` | `100982` |
| `dispute` | integer or null | — | `20` | `null` |
| `settlement` | null in samples | — | `null` | `null` |
| `domain` | string | `"live"` | `"live"` | `"live"` |
| `amount` | integer | `10000` | `500000` | `500000` |
| `deducted_amount` | integer | `0` | `500000` | `500000` |
| `fully_deducted` | boolean, integer `1`, or null; **UNCONFIRMED** | `false` | `1` or `null` | `true` |
| `currency` | string | `"NGN"` | `"NGN"` | `"NGN"` |
| `channel` | string or null | `null` | `"migs"` | `"migs"` |
| `status` | string | `"pending"` | `"processed"` / `"pending"` | `"processed"` |
| `refunded_by` | string (email) | `"refund@example.com"` (protected in page) | same | same |
| `refunded_at` | ISO date string or null | — | `"2018-01-12T10:54:47.000Z"` | `"2018-01-12T10:54:47.000Z"` |
| `expected_at` | ISO date string | `"2021-12-16T09:21:17.016Z"` | `"2017-10-01T21:10:59.000Z"` | `"2017-10-01T21:10:59.000Z"` |
| `customer_note` | string | `"Refund for transaction T685312322670591"` | `"xxx"` | `"xxx"` |
| `merchant_note` | string | `"Refund for transaction T685312322670591 by customer@example.com"` | `"xxx"` | `"xxx"` |
| `id` | integer | `3018284` | `1` | `1` |
| `createdAt` | ISO date string (camel case) | `"2021-12-07T09:21:17.122Z"` | — | `"2017-09-24T21:10:59.000Z"` |
| `created_at` | ISO date string (snake case) | — | `"2017-09-24T21:10:59.000Z"` | — |
| `updatedAt` | ISO date string (camel case) | `"2021-12-07T09:21:17.122Z"` | — | `"2018-01-18T11:59:56.000Z"` |
| `updated_at` | ISO date string (snake case) | — | `"2018-01-18T11:59:56.000Z"` | — |

Refund transaction object (create sample only):

| Field | Type | Example |
|---|---|---|
| `id` | integer | `1004723697` |
| `domain` | string | `"live"` |
| `reference` | string | `"T685312322670591"` |
| `amount` | integer | `10000` |
| `paid_at` | ISO date string | `"2021-08-20T18:34:11.000Z"` |
| `channel` | string | `"apple_pay"` |
| `currency` | string | `"NGN"` |
| `authorization.exp_month` | null | `null` |
| `authorization.exp_year` | null | `null` |
| `authorization.account_name` | null | `null` |
| `customer.international_format_phone` | null | `null` |
| `plan` | object | `{}` |
| `subaccount.currency` | null | `null` |
| `split` | object | `{}` |
| `order_id` | null | `null` |
| `paidAt` | ISO date string | `"2021-08-20T18:34:11.000Z"` |
| `pos_transaction_data` | null | `null` |
| `source` | null | `null` |
| `fees_breakdown` | null | `null` |

### 0.8 Transfer object

C4a uses initiate, fetch, and verify. The objects differ, especially `recipient` (integer vs object) and the fields shown.

| Field | Type | Initiate example | Fetch/verify example |
|---|---|---|---|
| `transfersessionid` | array | `[]` | — |
| `transfertrials` | array | `[]` | — |
| `domain` | string | `"test"` | `"test"` |
| `amount` | integer | `100000` | `100000` / `20000` |
| `currency` | string | `"NGN"` | `"NGN"` |
| `reference` | string | `"acv_9ee55786-2323-4760-98e2-6380c9cb3f68"` | `"acv_9ee55786-2323-4760-98e2-6380c9cb3f67"` |
| `source` | string | `"balance"` | `"balance"` |
| `source_details` | null | `null` | `null` |
| `reason` | string | `"Bonus for the week"` | `"Bonus for the week"` / `"Life go better for you"` |
| `status` | string | `"success"` | `"success"` |
| `failures` | null | `null` | `null` |
| `transfer_code` | string | `"TRF_v5tip3zx8nna9o78"` | `"TRF_fpmd0l8uta8upow7"` |
| `titan_code` | null | `null` | `null` |
| `transferred_at` | null in samples | `null` | `null` |
| `id` | integer | `860703114` | `451930323` |
| `integration` | integer | `463433` | `463433` |
| `request` | integer | `1068439313` | `502643104` |
| `recipient` | integer (initiate) or object (fetch/verify) | `56824902` | Transfer recipient object |
| `createdAt` | ISO date string | `"2025-08-04T10:32:40.000Z"` | `"2024-02-01T08:32:21.000Z"` |
| `updatedAt` | ISO date string | `"2025-08-04T10:32:40.000Z"` | `"2024-02-01T08:34:07.000Z"` |
| `session` | object | — | `{ "provider": null, "id": null }` |
| `fee_charged` | integer | — | `0` / `1000` |
| `fees_breakdown` | null | — | `null` |
| `gateway_response` | null | — | `null` |

The docs also document these transfer statuses: `pending`, `success`, `reversed`, `failed`, `otp`, `abandoned`, `blocked`, `rejected`, `received`. See section 14.

### 0.9 Transfer recipient object

| Field | Type | Example |
|---|---|---|
| `active` | boolean | `true` |
| `createdAt` | ISO date string | `"2021-11-05T11:27:53.131Z"` |
| `currency` | string | `"NGN"` |
| `domain` | string | `"test"` |
| `id` | integer | `20317609` |
| `integration` | integer | `463433` |
| `name` | string | `"Tolu Robert"` |
| `recipient_code` | string | `"RCP_m7ljkv8leesep7p"` |
| `type` | string | `"nuban"` |
| `updatedAt` | ISO date string | `"2021-11-05T11:27:53.131Z"` |
| `is_deleted` | boolean | `false` |
| `description` | string or null | `null` / `""` |
| `email` | string or null | `null` |
| `metadata` | object or null | `null` |
| `isDeleted` | boolean | `false` (fetch/verify samples) |
| `details.authorization_code` | null | `null` |
| `details.account_number` | string | `"01000000010"` |
| `details.account_name` | string or null | `"Tolu Robert"` / `null` |
| `details.bank_code` | string | `"058"` |
| `details.bank_name` | string | `"Guaranty Trust Bank"` |

### 0.10 Meta object

Two meta shapes appear in the official docs:

| Shape | Fields | Example |
|---|---|---|
| Offset pagination | `total` integer, `skipped` integer, `perPage` integer, `page` integer, `pageCount` integer | `{ "total": 2, "skipped": 0, "perPage": 50, "page": 1, "pageCount": 1 }` |
| Cursor pagination | `next` string or null, `previous` string or null, `perPage` integer | `{ "next": "dW5kZWZpbmVkOjQwMTM3MDk2MzU=", "previous": null, "perPage": 50 }` |

Individual list endpoints use one or the other. The refunds guide shows the offset shape for `GET /refund`, while the Refund API page sample does not show `meta`. **UNCONFIRMED** whether both are always present.

### 0.11 Error envelope and statuses

Source: [Errors](https://paystack.com/docs/api/errors/). Every error response documented uses:

| Field | Type | Meaning / example |
|---|---|---|
| `status` | boolean | `false` |
| `message` | string | `"Email Address is required"` |
| `meta` | object | Contains `nextStep` and possibly other diagnostic fields |
| `meta.nextStep` | string | `"Provide all required params"` |
| `type` | string | `api_error`, `validation_error`, or `processor_error` |
| `code` | string | Paystack-defined code, e.g. `missing_params` |
| `data` | object | Usually absent; may be present when data is being processed |

Documented HTTP codes, globally:

| Status | Documentation meaning |
|---|---|
| `200` | Successful; for charge/verify, the docs say always 200 and you must inspect `data` |
| `201` | Resource created |
| `400` | Validation/client error |
| `401` | Missing or invalid secret key |
| `404` | Resource does not exist |
| `429` | Rate limited; see the rate-limits page |
| `5xx` | Paystack-side error; "shouldn't happen" |

The exact error body, `message`, and `code` for an individual action are mostly **UNCONFIRMED**; the docs give the general shape and a validation sample. The 401 body for a missing/invalid key is **UNCONFIRMED**. The 429 body is documented separately in §7. A 5xx body is **UNCONFIRMED**.

## 1. Transactions

### 1.1 Initialize transaction

Source: [Transactions API: Initialize](https://paystack.com/docs/api/transaction/#initialize), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/transaction/initialize`
- **Base URL:** `https://api.paystack.co`
- **Request format:** JSON body
- **Headers:** `authorization: Bearer SECRET_KEY`, `content-type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `amount` | string | Yes | Amount in the subunit of the supported currency; docs label it String. |
| `email` | string | Yes | Customer email. |
| `channels` | array of strings | Optional | Allowed values in docs: `card`, `bank`, `apple_pay`, `ussd`, `qr`, `mobile_money`, `bank_transfer`, `eft`, `capitec_pay`, `payattitude`. |
| `currency` | string | Optional | Supported currency; defaults to integration currency. |
| `reference` | string | Optional | Unique; only `-`, `.`, `=` and alphanumeric characters allowed. |
| `callback_url` | string | Optional | Fully qualified URL. |
| `plan` | string | Optional | Plan code; invalidates `amount`. |
| `invoice_limit` | integer | Optional | Number of charges during subscription. |
| `metadata` | string | Optional | Docs say "Stringified JSON object of custom data". |
| `split_code` | string | Optional | e.g. `SPL_98WF13Eb3w`. |
| `subaccount` | string | Optional | e.g. `ACCT_8f4s1eq7ml6rlzj`. |
| `transaction_charge` | integer | Optional | Overrides split configuration. |
| `bearer` | string | Optional | `account` or `subaccount`; defaults to `account`. |

#### Success response

```json
{
  "status": true,
  "message": "Authorization URL created",
  "data": {
    "authorization_url": "https://checkout.paystack.com/3ni8kdavz62431k",
    "access_code": "3ni8kdavz62431k",
    "reference": "re4lyvq3s3"
  }
}
```

| Field | Type | Example |
|---|---|---|
| `status` | boolean | `true` |
| `message` | string | `"Authorization URL created"` |
| `data.authorization_url` | string | `"https://checkout.paystack.com/3ni8kdavz62431k"` |
| `data.access_code` | string | `"3ni8kdavz62431k"` |
| `data.reference` | string | `"re4lyvq3s3"` |

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Global documented statuses: `400`, `401`, `404`, `5xx`, `429`; `201` exists globally but is not shown for this action.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None directly. If the customer completes the transaction successfully, Paystack sends `charge.success` later. The docs say webhook events are currently sent only for successful transactions, so no `charge.failed` or abandoned-transaction webhook is documented. See §6.

### 1.2 Verify transaction

Source: [Transactions API: Verify](https://paystack.com/docs/api/transaction/#verify) and [Verify Payments](https://paystack.com/docs/payments/verify-payments/), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/transaction/verify/:reference`
- **Base URL:** `https://api.paystack.co`
- **Request format:** no body; `reference` in path
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `reference` | string | Yes (path) | Transaction reference. |

#### Success response

`data` is the Transaction object in §0.2, as shown in this sample. The docs say `data.status` is the transaction status, not the top-level API status.

```json
{
  "status": true,
  "message": "Verification successful",
  "data": {
    "id": 4099260516,
    "domain": "test",
    "status": "success",
    "reference": "re4lyvq3s3",
    "amount": 40333,
    "gateway_response": "Successful",
    "paid_at": "2024-08-22T09:15:02.000Z",
    "created_at": "2024-08-22T09:14:24.000Z",
    "channel": "card",
    "currency": "NGN"
  }
}
```

The sample also contains the full Customer, Authorization, and Log objects listed in §0.2–§0.5.

#### Errors and documented statuses

- Action page sample: `200 Ok`, `400 Invalid`.
- The Errors page also says Paystack "will always send a 200 if a charge or verify request was made" and the caller should inspect `data`; this conflicts with the action page's `400 Invalid` sample. **UNCONFIRMED** which behavior applies to which invalid-reference case.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None. Verification reads the current status.

### 1.3 Fetch one transaction

Source: [Transactions API: Fetch](https://paystack.com/docs/api/transaction/#fetch), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/transaction/:id`
- **Base URL:** `https://api.paystack.co`
- **Request format:** no body; `id` in path
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | integer | Yes (path) | Transaction ID; represent as unsigned 64-bit if stored. |

#### Success response

`data` is the Transaction object in §0.2, as shown in this sample. It includes `helpdesk_link`, which is absent from the verify and list samples.

#### Errors and documented statuses

- Action page sample: `200 Ok`, `400 Invalid`.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None.

### 1.4 List transactions

Source: [Transactions API: List](https://paystack.com/docs/api/transaction/#list), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/transaction`
- **Base URL:** `https://api.paystack.co`
- **Request format:** query parameters
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Query parameters

| Field | Type | Required? | Notes |
|---|---|---|---|
| `perPage` | integer | Optional in practice; default 50 | Docs do not mark it optional but state the default. |
| `page` | integer | Optional in practice; default 1 | Docs do not mark it optional but state the default. |
| `customer` | integer | Optional | Customer ID. |
| `terminalid` | string | Optional | Terminal ID. |
| `status` | string | Optional | `failed`, `success`, or `abandoned` (docs list). |
| `from` | datetime | Optional | e.g. `2016-09-24T00:00:05.000Z` or `2016-09-21`. |
| `to` | datetime | Optional | e.g. `2016-09-24T00:00:05.000Z` or `2016-09-21`. |
| `amount` | integer | Optional | Filter by amount in the supported currency. |

#### Success response

`data` is an array of Transaction objects (§0.2). `meta` is a cursor meta object in the sample:

```json
{
  "status": true,
  "message": "Transactions retrieved",
  "data": [],
  "meta": {
    "next": "dW5kZWZpbmVkOjQwMTM3MDk2MzU=",
    "previous": null,
    "perPage": 50
  }
}
```

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None.

## 2. Checkout (hosted page and Ibeji's local page)

Sources: [Accept Payments](https://paystack.com/docs/payments/accept-payments/), [Test Payments](https://paystack.com/docs/payments/test-payments/), [Verify Payments](https://paystack.com/docs/payments/verify-payments/), accessed 27 October 2026.

Paystack has no documented "create checkout page" endpoint. The documented flow is:

1. `POST /transaction/initialize` (see §1.1) returns `data.authorization_url`, for example `https://checkout.paystack.com/nkdks46nymizns7`.
2. The app redirects the customer to that URL, or uses the access code with the official frontend libraries/SDKs.
3. Paystack redirects back to `callback_url` with the transaction reference.
4. The app calls `GET /transaction/verify/:reference` and checks `data.status` and `data.amount`.

There is no documented HTTP method/path or success-response schema for the hosted checkout page itself. Ibeji's local "test checkout page" is an Ibeji feature, not a Paystack endpoint. It must imitate the documented outcomes:

- Success: transaction status `success`; `charge.success` webhook.
- Declined card: the test card "Declined" is documented; transaction status is `failed`; no failed-payment webhook is documented.
- Abandoned: the transaction status `abandoned` is documented; no abandoned-payment webhook is documented.

The docs say: "we currently send webhook events for just successful transactions." Therefore the only checkout-related webhook documented for these outcomes is `charge.success`.

Documented statuses for the checkout flow: the action page is not an API, so there are no Paystack API HTTP statuses. The initialize, verify, and webhook pages supply the API statuses and delivery rules.

#### Webhook events this action can trigger

`charge.success` only, on success. `charge.failed` and an abandoned-payment event are not documented.

## 3. Refunds

### 3.1 Create refund

Sources: [Refund API: Create](https://paystack.com/docs/api/refund/#create) and [Refunds guide](https://paystack.com/docs/payments/refunds/), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/refund`
- **Base URL:** `https://api.paystack.co`
- **Request format:** JSON body
- **Headers:** `authorization: Bearer SECRET_KEY`, `content-type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `transaction` | string | Yes | Transaction reference or ID. |
| `amount` | integer | Optional | Subunit; defaults to the original transaction amount; cannot exceed it. |
| `currency` | string | Optional | Any supported currency. |
| `customer_note` | string | Optional | Customer reason. |
| `merchant_note` | string | Optional | Merchant reason. |

The related Retry Refund endpoint (`POST /refund/retry_with_customer_details/{id}`) is not in C4a. It is documented for a `refund.needs-attention` refund and returns `422 - unprocessable entity` if used otherwise.

#### Success response

`data` is the Refund object in §0.7 (create column).

```json
{
  "status": true,
  "message": "Refund has been queued for processing",
  "data": {
    "status": "pending",
    "amount": 10000,
    "currency": "NGN",
    "id": 3018284,
    "createdAt": "2021-12-07T09:21:17.122Z",
    "updatedAt": "2021-12-07T09:21:17.122Z"
  }
}
```

The full sample contains the nested transaction object listed in §0.7.

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Global documented statuses: `400`, `401`, `404`, `5xx`, `429`.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

The refunds guide documents: `refund.pending`, `refund.processing`, `refund.needs-attention`, `refund.failed`, `refund.processed`. Only `refund.pending` has a full payload example in the docs. See §6.

### 3.2 Fetch one refund

Source: [Refund API: Fetch](https://paystack.com/docs/api/refund/#fetch), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/refund/:id`
- **Base URL:** `https://api.paystack.co`
- **Request format:** no body; `id` in path
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | integer | Yes (path) | Refund ID. |

#### Success response

`data` is the Refund object in §0.7 (fetch column).

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Exact error body/code: **UNCONFIRMED**.
- A non-integer refund id returns HTTP `401` with code `missing_params`. Observed while recording on 28 October 2026. The twin must copy this behaviour.

#### Webhook events this action can trigger

None.

### 3.3 List refunds

Source: [Refund API: List](https://paystack.com/docs/api/refund/#list), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/refund`
- **Base URL:** `https://api.paystack.co`
- **Request format:** query parameters
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Query parameters

| Field | Type | Required? | Notes |
|---|---|---|---|
| `transaction` | string | Docs do not mark optional | The transaction ID of the refunded transaction. The page's sample calls `GET /refund` with no query; **UNCONFIRMED** whether it is truly required. |
| `currency` | string | Docs do not mark optional | Any supported currency; same ambiguity as `transaction`. |
| `from` | date | Optional | Start date, e.g. `2016-09-21`. |
| `to` | date | Optional | End date, e.g. `2016-09-21`. |
| `perPage` | integer | Optional; default 50 | Page size. |
| `page` | integer | Optional; default 1 | Page number. |

#### Success response

`data` is an array of Refund objects in §0.7 (list column). The refunds guide also shows a `meta` object with `total`, `skipped`, `perPage`, `page`, and `pageCount`; the API page sample omits `meta`.

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None.

## 4. Transfers

> **Documentation-only on 28 October 2026:** transfer create, transfer fetch, and transfer verify could not be recorded. Paystack returned `"You cannot initiate third party payouts as a starter business"` with code `transfer_unavailable` on `POST /transfer`. These three actions stay documentation-only until the recorder uses a business account without this limit.

### 4.1 Create transfer recipient

Sources: [Transfer Recipient API: Create](https://paystack.com/docs/api/transfer-recipient/#create) and [Single Transfers: Create a transfer recipient](https://paystack.com/docs/transfers/single-transfers/#create-a-transfer-recipient), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/transferrecipient`
- **Base URL:** `https://api.paystack.co`
- **Request format:** JSON body
- **Headers:** `authorization: Bearer SECRET_KEY`, `content-type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `type` | string | Yes | `nuban`, `ghipss`, `mobile_money`, `basa`; the transfer guide also lists `kepss` and `authorization`. |
| `name` | string | Yes | Recipient name as registered. |
| `account_number` | string | Required except `authorization` | Account number. |
| `bank_code` | string | Required except `authorization` | From List Banks. |
| `description` | string | Optional | Recipient description. |
| `currency` | string | Optional | Receiving currency. |
| `authorization_code` | string | Optional | From a previous transaction. |
| `metadata` | object | Optional | Structured JSON metadata. |

The docs state: "A duplicate account number will lead to the retrieval of the existing record."

#### Success response

`data` is the Transfer recipient object in §0.9.

```json
{
  "status": true,
  "message": "Transfer recipient created successfully",
  "data": {
    "active": true,
    "createdAt": "2021-11-05T11:27:53.131Z",
    "currency": "NGN",
    "domain": "test",
    "id": 20317609,
    "integration": 463433,
    "name": "Tolu Robert",
    "recipient_code": "RCP_m7ljkv8leesep7p",
    "type": "nuban",
    "updatedAt": "2021-11-05T11:27:53.131Z",
    "is_deleted": false,
    "details": {
      "authorization_code": null,
      "account_number": "01000000010",
      "account_name": "Tolu Robert",
      "bank_code": "058",
      "bank_name": "Guaranty Trust Bank"
    }
  }
}
```

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None documented.

### 4.2 Initiate transfer

Sources: [Transfer API: Initiate](https://paystack.com/docs/api/transfer/#initiate) and [Single Transfers: Initiate](https://paystack.com/docs/transfers/single-transfers/#initiate-a-transfer), accessed 27 October 2026.

- **Method:** `POST`
- **Path:** `/transfer`
- **Base URL:** `https://api.paystack.co`
- **Request format:** JSON body
- **Headers:** `authorization: Bearer SECRET_KEY`, `content-type: application/json`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `source` | string | Yes | Only `balance` for now. |
| `amount` | integer | Yes | "kobo if currency is NGN and pesewas if currency is GHS." |
| `recipient` | string | Yes | Transfer recipient code. |
| `reference` | string | Yes | Unique; min 16, max 50; lowercase letters, digits, `-`, `_`. |
| `reason` | string | Optional | Shows in the customer credit narration. |
| `currency` | string | Optional | Defaults to NGN. |
| `account_reference` | string | Optional | Required in Kenya for MPESA Paybill/Till transfers per docs. |

The page says the returned status is `pending` if OTP is disabled, and `otp` if OTP is required. The sample shows `status: "success"`; the single-transfers guide says test transfers always return success because there is no processing.

#### Success response

`data` is the Transfer object in §0.8 (initiate column).

#### Errors and documented statuses

- Action page sample: `200 Ok`, `400 Bad Request`.
- Exact error body/code: **UNCONFIRMED**.
- Documented validation errors include invalid reference characters, insufficient balance, invalid recipient, account closed, and invalid bank code. Exact error codes/statuses for each are **UNCONFIRMED**.

#### Webhook events this action can trigger

`transfer.success`, `transfer.failed`, `transfer.reversed`. See §6.

### 4.3 Fetch transfer

Source: [Transfer API: Fetch](https://paystack.com/docs/api/transfer/#fetch), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/transfer/:id_or_code`
- **Base URL:** `https://api.paystack.co`
- **Request format:** no body; `id_or_code` in path
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id_or_code` | string | Yes (path) | Transfer ID or code. |

#### Success response

`data` is the Transfer object in §0.8 (fetch/verify column). The sample includes the full recipient object, `session`, `fee_charged`, `fees_breakdown`, and `gateway_response`.

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None.

### 4.4 Verify transfer

Sources: [Transfer API: Verify](https://paystack.com/docs/api/transfer/#verify) and [Single Transfers: Verify](https://paystack.com/docs/transfers/single-transfers/#verify-a-transfer), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/transfer/verify/:reference`
- **Base URL:** `https://api.paystack.co`
- **Request format:** no body; `reference` in path
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Request fields

| Field | Type | Required? | Notes |
|---|---|---|---|
| `reference` | string | Yes (path) | Transfer reference. |

#### Success response

`data` is the Transfer object in §0.8 (fetch/verify column).

#### Errors and documented statuses

- Action page sample: `200 Ok`, `404 Not Found`.
- The docs warn that the HTTP status is the API status, not the transfer status; read `data.status` only on a 200.
- Exact error body/code: **UNCONFIRMED**.

#### Webhook events this action can trigger

None.

## 5. Banks

### 5.1 List banks

Source: [Miscellaneous API: List Banks](https://paystack.com/docs/api/miscellaneous/#bank), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/bank`
- **Base URL:** `https://api.paystack.co`
- **Request format:** query parameters
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Query parameters

| Field | Type | Required? | Notes |
|---|---|---|---|
| `country` | string | Docs do not mark optional | `ghana`, `kenya`, `nigeria`, `south africa`. The page's sample calls `GET /bank` with no query; **UNCONFIRMED** whether it is truly required. |
| `use_cursor` | boolean | Not marked optional | Enables cursor pagination. |
| `perPage` | integer | Not marked optional | Defaults to 50; limited to 100. |
| `pay_with_bank_transfer` | boolean | Optional | Filter for banks for a transfer payment. |
| `pay_with_bank` | boolean | Optional | Filter for banks a customer can pay from. |
| `enabled_for_verification` | boolean | Optional | South Africa; combine with `currency` or `country`. |
| `next` | string | Optional | Cursor for the next page. |
| `previous` | string | Optional | Cursor for the previous page. |
| `gateway` | string | Optional | `emandate` or `digitalbankmandate`. |
| `type` | string | Optional | For Ghana: `mobile_money` or `ghipss`. |
| `currency` | string | Optional | Supported currency. |
| `include_nip_sort_code` | boolean | Optional | Return Nigerian banks with `nip institution code`. |

#### Success response

`data` is an array of Bank objects. `meta` is a cursor meta object in the sample.

| Field | Type | Example |
|---|---|---|
| `name` | string | `"Abbey Mortgage Bank"` |
| `slug` | string | `"abbey-mortgage-bank"` |
| `code` | string | `"801"` |
| `longcode` | string | `""` |
| `gateway` | null in sample | `null` |
| `pay_with_bank` | boolean | `false` |
| `active` | boolean | `true` |
| `is_deleted` | boolean | `false` |
| `country` | string | `"Nigeria"` |
| `currency` | string | `"NGN"` |
| `type` | string | `"nuban"` |
| `id` | integer | `174` |
| `createdAt` | ISO date string | `"2020-12-07T16:19:09.000Z"` |
| `updatedAt` | ISO date string | `"2020-12-07T16:19:19.000Z"` |
| `supported_types` | array of strings, optional | Appears in the account-validation guide sample; not in the API sample. **UNCONFIRMED** as always present. |
| NIP institution code | string, optional | Not shown; the query parameter says it can be returned. **UNCONFIRMED** exact field name. |

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Exact error body/code: **UNCONFIRMED**.
- **observed while recording, needs a fixture to confirm:** in a recorded run on 28 October 2026, `GET /bank` answered `200` with a deliberately wrong key. This conflicts with the documented `401` for a missing or invalid secret key in §7. Do not use the bank list as an authentication check until a fixture confirms it.

#### Webhook events this action can trigger

None documented.

### 5.2 Resolve account number

Sources: [Verification API: Resolve Account](https://paystack.com/docs/api/verification/#resolve-account) and [Verify Account Number guide](https://paystack.com/docs/identity-verification/verify-account-number/#resolve-account-number), accessed 27 October 2026.

- **Method:** `GET`
- **Path:** `/bank/resolve`
- **Base URL:** `https://api.paystack.co`
- **Request format:** query parameters
- **Headers:** `authorization: Bearer SECRET_KEY`

#### Query parameters

| Field | Type | Required? | Notes |
|---|---|---|---|
| `account_number` | string | Yes | Account number. |
| `bank_code` | string | Yes | From List Banks. |

#### Success response

```json
{
  "status": true,
  "message": "Account number resolved",
  "data": {
    "account_number": "0022728151",
    "account_name": "WES GIBBONS",
    "bank_id": 9
  }
}
```

| Field | Type | Example |
|---|---|---|
| `status` | boolean | `true` |
| `message` | string | `"Account number resolved"` |
| `data.account_number` | string | `"0022728151"` |
| `data.account_name` | string | `"WES GIBBONS"` |
| `data.bank_id` | integer | `9` (appears in the guide sample; the API page sample shows only `account_number` and `account_name`) |

The API page's resolve sample has only `account_number` and `account_name`; the guide sample includes `bank_id`. **UNCONFIRMED** whether `bank_id` is always returned.

#### Errors and documented statuses

- Action page sample: `200 Ok`.
- Global documented statuses: `400`, `401`, `404`, `5xx`, `429`.
- Exact error body/code/message for an invalid account: **UNCONFIRMED**.

#### Webhook events this action can trigger

None documented.

## 6. Webhooks for the C4a actions

Sources: [Webhooks](https://paystack.com/docs/payments/webhooks/), [Refunds guide](https://paystack.com/docs/payments/refunds/), [Single Transfers](https://paystack.com/docs/transfers/single-transfers/), [How Transfers Work](https://paystack.com/docs/transfers/how-transfers-work/), [Verify Payments](https://paystack.com/docs/payments/verify-payments/), [Webhook Events API](https://paystack.com/docs/api/webhook-events/), accessed 27 October 2026.

### 6.1 General webhook requirements

Paystack posts a JSON object to the tester's webhook URL. The app must return `200 OK`; otherwise Paystack treats the attempt as failed and retries. The docs recommend acknowledging immediately and doing long work after the response.

The top-level event envelope shown in examples is:

```json
{
  "event": "refund.pending",
  "data": {}
}
```

The docs do not show a documented event id, delivery id, or attempt number in the webhook payload. **UNCONFIRMED** whether any exists.

### 6.2 Event names relevant to C4a

| Exact event name | Documentation description | Triggered by C4a action | Full payload documented? |
|---|---|---|---|
| `charge.success` | "A successful charge was made" | Initialize/checkout success | No. The docs show the event name and a partial Webhook Events API example; full `data` shape is **UNCONFIRMED**. |
| `refund.pending` | "This is sent when a refund is initiated and we're waiting for a response from the processor." | Create refund | Yes, full example below. |
| `refund.processing` | "This is sent when the refund has been received by the processor." | Create refund | No. **UNCONFIRMED** payload. |
| `refund.needs-attention` | "This is sent when we need an account number to complete a refund." | Create refund | No. **UNCONFIRMED** payload. Also absent from the Webhooks page's "Supported events" list, while present in the Refunds guide. |
| `refund.failed` | "This is sent when a refund can't be processed. Your account is credited with the refund amount." | Create refund | No. **UNCONFIRMED** payload. |
| `refund.processed` | "This is sent when the refund has been successfully processed by the processor." | Create refund | No. **UNCONFIRMED** payload. |
| `transfer.success` | "This is sent when the transfer is successful." | Initiate transfer | Yes, full example below. |
| `transfer.failed` | "This is sent when the transfer fails." | Initiate transfer | No. **UNCONFIRMED** payload. |
| `transfer.reversed` | "This is sent when we refund a previously debited amount for a transfer that couldn't be completed." | Initiate transfer | No. **UNCONFIRMED** payload. |

No `charge.failed` or abandoned-payment webhook is documented. The Verify Payments page says: "we currently send webhook events for just successful transactions."

### 6.3 `refund.pending` payload

Exact documented example:

```json
{
  "event": "refund.pending",
  "data": {
    "status": "pending",
    "transaction_reference": "tvunjbbd_412829_4b18075d_c7had",
    "refund_reference": null,
    "amount": "10000",
    "currency": "NGN",
    "processor": "instant-transfer",
    "customer": {
      "first_name": "Drew",
      "last_name": "Berry",
      "email": "customer@example.com"
    },
    "integration": 412829,
    "domain": "live"
  }
}
```

| Field | Type | Example |
|---|---|---|
| `event` | string | `"refund.pending"` |
| `data.status` | string | `"pending"` |
| `data.transaction_reference` | string | `"tvunjbbd_412829_4b18075d_c7had"` |
| `data.refund_reference` | string or null | `null` |
| `data.amount` | string | `"10000"` (string in the documented webhook example) |
| `data.currency` | string | `"NGN"` |
| `data.processor` | string | `"instant-transfer"` |
| `data.customer.first_name` | string | `"Drew"` |
| `data.customer.last_name` | string | `"Berry"` |
| `data.customer.email` | string | `"customer@example.com"` (protected in page) |
| `data.integration` | integer | `412829` |
| `data.domain` | string | `"live"` |

### 6.4 `transfer.success` payload

Exact documented example, abridged only at the nested recipient details:

```json
{
  "event": "transfer.success",
  "data": {
    "amount": 100000,
    "createdAt": "2025-08-04T10:32:40.000Z",
    "currency": "NGN",
    "domain": "test",
    "failures": null,
    "id": 860703114,
    "integration": {
      "id": 463433,
      "is_live": true,
      "business_name": "Paystack Demo",
      "logo_path": "https://public-files-paystack-prod.s3.eu-west-1.amazonaws.com/integration-logos/hpyxo8n1c7du6gxup7h6.png"
    },
    "reason": "Bonus for the week",
    "reference": "acv_9ee55786-2323-4760-98e2-6380c9cb3f68",
    "source": "balance",
    "source_details": null,
    "status": "success",
    "titan_code": null,
    "transfer_code": "TRF_v5tip3zx8nna9o78",
    "transferred_at": null,
    "updatedAt": "2025-08-04T10:32:40.000Z",
    "recipient": {},
    "session": { "provider": null, "id": null },
    "fee_charged": 0,
    "gateway_response": null
  }
}
```

| Field | Type | Example |
|---|---|---|
| `event` | string | `"transfer.success"` |
| `data.amount` | integer | `100000` |
| `data.createdAt` | ISO date string | `"2025-08-04T10:32:40.000Z"` |
| `data.currency` | string | `"NGN"` |
| `data.domain` | string | `"test"` |
| `data.failures` | null | `null` |
| `data.id` | integer | `860703114` |
| `data.integration.id` | integer | `463433` |
| `data.integration.is_live` | boolean | `true` |
| `data.integration.business_name` | string | `"Paystack Demo"` |
| `data.integration.logo_path` | string (URL) | `"https://public-files-paystack-prod.s3.eu-west-1.amazonaws.com/integration-logos/hpyxo8n1c7du6gxup7h6.png"` |
| `data.reason` | string | `"Bonus for the week"` |
| `data.reference` | string | `"acv_9ee55786-2323-4760-98e2-6380c9cb3f68"` |
| `data.source` | string | `"balance"` |
| `data.source_details` | null | `null` |
| `data.status` | string | `"success"` |
| `data.titan_code` | null | `null` |
| `data.transfer_code` | string | `"TRF_v5tip3zx8nna9o78"` |
| `data.transferred_at` | null in sample | `null` |
| `data.updatedAt` | ISO date string | `"2025-08-04T10:32:40.000Z"` |
| `data.recipient` | object | Transfer recipient object in §0.9 |
| `data.session.provider` | null | `null` |
| `data.session.id` | null | `null` |
| `data.fee_charged` | integer | `0` |
| `data.gateway_response` | null | `null` |

The API transfer object uses `integration` as a number, but this webhook example uses an integration object. The twin must follow the webhook shape for webhooks.

### 6.5 `charge.success` payload

The exact full payload is **UNCONFIRMED**. The docs confirm the event name and that the top-level object has `event` and `data`. The Webhook Events API example shows only:

```json
{
  "event": "charge.success",
  "data": {
    "id": 4045667488,
    "amount": 15300
  }
}
```

The docs do not publish a complete `data` object for this event. Do not assume it is identical to the verify response without a fixture. **UNCONFIRMED.**

### 6.6 Other event payloads

`transfer.failed`, `transfer.reversed`, `refund.processing`, `refund.needs-attention`, `refund.failed`, and `refund.processed` have exact event names and descriptions in §§6.2, but no full payload examples were found. Their `data` shapes are **UNCONFIRMED**.

## 7. Authentication

Source: [Authentication](https://paystack.com/docs/api/authentication/), accessed 27 October 2026.

- Every API request uses the secret key in the `Authorization` header: `Authorization: Bearer SECRET_KEY`.
- `content-type: application/json` is required for JSON request bodies.
- Public keys use prefix `pk_`; secret keys use prefix `sk_`.
- Test public key: `pk_test_...`
- Test secret key: `sk_test_...`
- Live public key: `pk_live_...`
- Live secret key: `sk_live_...`
- Public keys are for frontend Inline/mobile SDK use only; the API uses secret keys.
- A request with no authentication fails with `401: Unauthorized`.
- The exact 401 response body, `message`, and `code` are **UNCONFIRMED**. The general error shape is in §0.11.
- The docs do not document restricted-key formats, key lengths, or any live key format beyond the `pk_live_`/`sk_live_` prefixes. **UNCONFIRMED.**

## 8. Webhook signing

Sources: [Webhooks](https://paystack.com/docs/payments/webhooks/), accessed 27 October 2026.

- Header name: `x-paystack-signature`.
- Algorithm: `HMAC SHA512`.
- Signed content: the event payload (the raw request body).
- Key: the secret key (`SECRET_KEY`).
- Encoding: hexadecimal digest.
- The docs' verification example hashes the raw body and compares the hex digest to the header:

```js
const hash = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex');
if (hash == req.headers['x-paystack-signature']) {
  // valid
}
```

The app must keep the raw body; parsing it as JSON and re-stringifying can change the bytes. The docs show `==`; Ibeji should use a timing-safe comparison as an implementation choice, not as a claim about Paystack.

Paystack also documents IP allowlisting for webhook senders:

- `52.31.139.75`
- `52.49.173.169`
- `52.214.14.220`

These addresses apply to both test and live environments per the docs.

## 9. Webhook retries

Source: [Webhooks](https://paystack.com/docs/payments/webhooks/), accessed 27 October 2026.

- Without a `200 OK`, events are treated as failed.
- Live mode: retried every 3 minutes for the first 4 tries, then hourly for the next 72 hours.
- Test mode: retried hourly for 10 hours.
- Request timeout: 30 seconds per attempt.
- The docs recommend returning `200 OK` before long-running work.
- The docs say webhook URLs must be publicly available and that "localhost URLs can't receive events." Ibeji's local twin deliberately differs here: it sends to localhost/private addresses per Ibeji's safety policy. This is an Ibeji feature, not Paystack behaviour.
- The docs do not mention jitter, duplicate delivery beyond retries, out-of-order delivery, or a maximum number of retries beyond the time windows above. Those behaviours are **UNCONFIRMED**.
- Whether any 2xx other than `200` stops retries is **UNCONFIRMED**; the docs say `200 OK`.

## 10. Idempotency

Sources: [Transactions API](https://paystack.com/docs/api/transaction/), [Single Transfers](https://paystack.com/docs/transfers/single-transfers/), [Transfer Recipient API](https://paystack.com/docs/api/transfer-recipient/), [Refund API](https://paystack.com/docs/api/refund/), [Webhook Events API](https://paystack.com/docs/api/webhook-events/), accessed 27 October 2026.

Paystack does **not** document a general `Idempotency-Key` header or a general idempotency rule. **Not documented.**

Specific documented behaviours:

- Transaction `reference`: "Unique transaction reference." The behaviour for a duplicate reference on `POST /transaction/initialize` is **UNCONFIRMED**.
- Transfer `reference`: unique; retry an inconclusive transfer with the **same** reference to avoid double credit. A new reference is treated as a new transfer.
- Transfer recipient: "A duplicate account number will lead to the retrieval of the existing record."
- Refund create: no idempotency key or duplicate-refund rule is documented. **Not documented.**
- Webhook resend: "Resending isn't idempotent—submitting the same event id twice delivers it twice."
- There is no documented idempotency rule for `GET` requests, which is expected.

## 11. Test mode

Source: [Test Payments](https://paystack.com/docs/payments/test-payments/), accessed 27 October 2026.

Test mode uses test keys. Test mode limitations documented on the Authentication page: settlements aren't processed in test mode and some payment channels are unavailable. The single-transfers guide says test transfers always return success because there is no processing.

### 11.1 Cards

The docs state the expiry date can be any future date.

| Behaviour | Card number | Expiry | CVV | PIN / OTP |
|---|---|---|---|---|
| No validation (reusable) | `4084 0840 8408 4081` | `10/27` | `408` | — |
| PIN validation | `5078 5078 5078 5078 12` | `10/27` | `081` | PIN `1111` |
| PIN + OTP validation | `5060 6666 6666 6666 666` | `10/27` | `123` | PIN `1234`, OTP `123456` |
| PIN + Phone + OTP | `5078 5078 5078 5078 04` | `10/27` | `884` | PIN `0000`, OTP `123456` |
| Bank Auth Simulation (reusable) | `5192 6027 2058 4796` | `10/27` | `123` | — |
| Declined | `4084 0800 0000 5408` | `10/27` | `001` | — |
| Token Not Generated | `5078 5078 5078 5078 53` | `10/27` | `082` | PIN `0000` |
| Refund: Failed | `4084 0800 0067 1803` | `10/27` | `180` | — |
| Refund: Needs attention | `4084 0800 0067 1902` | `10/27` | `190` | — |
| API errors: Insufficient funds | `4084 0800 0067 0037` | `10/27` | `787` | — |

### 11.2 EFT test accounts

| Behaviour | Account number |
|---|---|
| Refund failed | `101 220 493 6` |
| Refund needs attention | `101 220 493 5` |

### 11.3 Bank accounts

The docs say Nigerian merchants can use a regular bank account to create a transfer recipient when testing in test mode.

| Test detail | Value | Purpose / notes |
|---|---|---|
| Zenith Bank (transaction) | `000 000 000 0` | Birthday `1999-04-20`, OTP `123456` |
| Zenith Bank (transfer) | `000 000 000 0` | Code `057` |
| Kuda Bank | `+234 810 000 000 0` | Code `50211`, token `123456` |
| Mobile money (MTN) | `055 123 498 7` | No PIN/OTP |
| Mobile money (M-Pesa) | `+254 710 000 000` | No PIN/OTP |
| Mobile money (Orange) | `070 000 000 0` | OTP `1234` |
| Dedicated virtual account: Demo Bank | `123 000 164 4` | PIN `0000` |

## 12. Money

Source: [API introduction: Supported currency](https://paystack.com/docs/api/#supported-currency), [Single Transfers](https://paystack.com/docs/transfers/single-transfers/), accessed 27 October 2026.

- Amounts are whole numbers in the subunit of the currency. The docs say to multiply the base amount by **100**.
- Currency codes use ISO 4217.

| Currency | Subunit | Description | Transaction minimum | Availability |
|---|---|---|---|---|
| NGN | Kobo | Nigerian Naira | ₦ 50.00 | Nigeria |
| USD | Cent | US Dollar | $ 2.00 | Kenya and Nigeria |
| GHS | Pesewa | Ghanaian Cedi | ₵ 0.10 | Ghana |
| ZAR | Cent | South African Rand | R 1.00 | South Africa |
| KES | Cent | Kenyan Shilling | Ksh. 3.00 | Kenya |
| XOF | none | West African CFA Franc | XOF 1.00 | Côte d'Ivoire |

XOF special rule: the docs say there is no subunit, but developers **must** still multiply the amount by 100. If Paystack notices a fractional part, it ignores the fractional part.

Transfer-specific docs say amount is in **kobo** if currency is NGN and **pesewas** if GHS. The API page does not state the unit rules for every other transfer currency. **UNCONFIRMED** for transfer currencies beyond NGN/GHS.

Number formats are inconsistent in the docs:

- Initialize request `amount` is labelled String.
- Refund create `amount` is Integer.
- Transfer `amount` is Integer.
- Transaction response `amount` is a JSON number in the sample.
- Refund API `amount` is a JSON number in the sample.
- The `refund.pending` webhook example uses `"amount": "10000"` (string). This is a documented inconsistency the twin must preserve for that event.

## 13. Base URL in libraries

The Paystack API docs do not document a Node library base-URL override. This section uses the published npm packages and their source because the task asks a library-specific question. Download counts are npm weekly downloads for 20–26 October 2026, from `https://api.npmjs.org/downloads/point/last-week/<package>`.

| Library | Role / downloads | Can an app change the base URL to a twin? | Source |
|---|---|---|---|
| `@paystack/paystack-sdk` 1.2.2 | Official Paystack Node library; 1,404/week | **No documented/supported way.** Constructor takes only `apiKey`; source hardcodes `BASE_PATH = "https://api.paystack.co"`. | [npm](https://www.npmjs.com/package/@paystack/paystack-sdk), package tarball `dist/index.js:8`; README shows `new Paystack("sk_test_xxxxxx")` only. |
| `paystack` 2.0.1 | Community; 2,817/week | **No documented way.** `root = 'https://api.paystack.co'` is module-local; constructor takes only the key. | [npm](https://www.npmjs.com/package/paystack), package tarball `index.js:10`. |
| `paystack-sdk` 4.2.1 | Community; 1,866/week | **No.** Source hardcodes `BASE_URL = 'https://api.paystack.co'` in the HTTP client. | [npm](https://www.npmjs.com/package/paystack-sdk), package tarball `dist/http.js:13`. |
| `paystack-node` 0.3.0 | Community; 1,180/week | **No documented option.** Constructor sets `clientOptions.baseUrl` from fixed `apiBase.sandbox`/`apiBase.live`, both `https://api.paystack.co`; an undocumented `mergeNewOptions()` method exists. | [npm](https://www.npmjs.com/package/paystack-node), package tarball `src/PayStack/index.js:395-401`, `mergeNewOptions` at `:407`. |
| `paystack-api` 2.0.6 | Community; 1,031/week | **No documented option.** `endpoint` is a module constant assigned to `this.endpoint`; mutating the instance property might work but is undocumented and unsupported. | [npm](https://www.npmjs.com/package/paystack-api), package tarball `index.js:7`, `index.js:15`. |

Frontend-only packages such as `@paystack/inline-js` and `react-paystack` are not Node API wrappers and cannot be used as a server-side base-URL replacement; `@paystack/inline-js` is the official checkout loader.

Consequence for T15: the official Paystack Node library appears unable to point at a local twin without an unsupported monkey-patch. The same is true for the most-used community libraries. This must be recorded in `docs/limits.md` or addressed by a compatibility decision; do not assume T15 can pass for Paystack.

## 14. Real-world behaviour and C5 mapping

Sources: [How Transfers Work](https://paystack.com/docs/transfers/how-transfers-work/), [Single Transfers](https://paystack.com/docs/transfers/single-transfers/), [Refunds guide](https://paystack.com/docs/payments/refunds/), [Verify Payments](https://paystack.com/docs/payments/verify-payments/), [Webhooks](https://paystack.com/docs/payments/webhooks/), [Rate limits](https://paystack.com/docs/api/rate-limits/), [Errors](https://paystack.com/docs/api/errors/), accessed 27 October 2026.

### 14.1 Documented delays, pending states, reversals, and retries

- Transaction statuses: `abandoned`, `failed`, `ongoing`, `pending`, `processing`, `queued`, `reversed`, `success`. Only successful transactions generate webhooks.
- Test transfers always return success; live transfers usually take a few seconds to a few minutes.
- Transfer statuses: `pending` (being processed), `success`, `reversed`, `failed`, `otp`, `abandoned`, `blocked`, `rejected`, `received`.
- `pending` can remain for a long time if the bank cannot be reached; Paystack queues and retries until its retry limit, then marks the transfer failed.
- `reversed`: the transfer could not be processed and the amount is returned; Paystack sends `transfer.reversed`.
- `abandoned`: OTP not provided within 30 minutes. `blocked`: the merchant server did not answer approval in a few seconds. `rejected`: the merchant approval server returned 400.
- Refund statuses: `pending`, `processing`, `needs-attention`, `failed`, `processed`; the refunds guide says a processed refund may still take up to 10 business days for the customer to receive funds.
- Webhook retry schedule: see §9.
- Rate limits: default live 600 requests/60 seconds and test 100 requests/60 seconds; some endpoints have higher live limits. `429` includes `x-ratelimit-reset`, `x-ratelimit-remaining`, `x-ratelimit-limit`; body example has `code: "rate_limited"`.

### 14.2 C5 failures applicable to Paystack

`authentication-required` is Stripe-only and is not applicable to Paystack.

| C5 failure | Paystack support | Source / reason |
|---|---|---|
| `slow-response` | **needs a real story** | The Webhooks intro says some requests may take a long time and can timeout, but no API response-delay behaviour is documented. |
| `timeout-after-commit` | **needs a real story** | No documented transaction/refund/transfer request that commits and then drops the reply. |
| `timeout-before-commit` | **needs a real story** | No documented pre-commit drop. |
| `server-error` | **docs** | The Errors page documents 5xx as a Paystack-side error, "shouldn't happen". Exact body is UNCONFIRMED. |
| `rate-limited` | **docs** | The Rate limits page documents `429`, headers, and the `rate_limited` body. |
| `flaky-network` | **needs a real story** | No documented partial connection-drop behaviour. |
| `webhook-delayed` | **needs a real story** | The docs give a retry schedule, not arbitrary delay of a first delivery. |
| `webhook-duplicated` | **needs a real story** | Automatic duplicate delivery is not documented. The docs only say a manual resend is not idempotent. |
| `webhook-out-of-order` | **needs a real story** | No ordering statement. |
| `webhook-never-sent` | **needs a real story** | The docs only describe failed attempts and retries, no "never sent" case. |
| `webhook-verification-fails` | **docs** | Webhooks documents `x-paystack-signature`, HMAC SHA512, the secret key, raw-body verification, and IP allowlisting. |
| `payment-declined` | **docs** | Test Payments documents a "Declined" card; Verify Payments documents the `failed` transaction status. No failed-payment webhook is sent. |
| `transfer-stuck-pending` | **docs** | How Transfers Work says `pending` can remain a long time and documents queue/retry behaviour. |
| `transfer-reversed` | **docs** | How Transfers Work documents `reversed` and `transfer.reversed`; Single Transfers shows the event. Payload for the event is UNCONFIRMED. |
| `bank-resolve-fails` | **needs a real story** | The docs give the global error shape but no account-resolution failure behaviour or exact error. |

No failure is marked `docs` unless the cited page actually states the behaviour. `slow-response` is not marked docs merely because the Webhooks intro mentions long-running requests; that is not the same as delaying an API response.

## 15. Gaps

These are facts SPEC.md needs that the official documentation did not answer, or where official pages disagree. Anything here must remain **UNCONFIRMED** until a fixture or a real story supplies it.

1. Full response schemas and documented types for transactions, refunds, transfers, recipients, banks, and errors. The docs provide examples, not schemas. Most types in this file are inferred from examples.
2. Exact error body, `message`, and `code` for each action, including 400, 401, 404, and 5xx.
3. The exact 401 body for a missing or invalid secret key.
4. The 5xx body shape; only the general error shape and status meaning are documented.
5. Whether a failed verify/charge returns HTTP 200 or 400. The Errors page says 200 for charge/verify; the Verify action page shows a `400 Invalid` sample. This conflict is unresolved.
6. Full `charge.success` payload.
7. Full `transfer.failed` and `transfer.reversed` payloads.
8. Full `refund.processing`, `refund.needs-attention`, `refund.failed`, and `refund.processed` payloads.
9. `refund.needs-attention` is documented in the Refunds guide but absent from the Webhooks page's supported-events list.
10. No documented webhook event id, delivery id, or attempt number inside the event payload.
11. Whether any 2xx response other than exactly 200 stops webhook retries.
12. Automatic webhook duplicate, out-of-order, arbitrary-delay, and never-sent behaviour is not documented.
13. General idempotency: no `Idempotency-Key`. The result of a duplicate transaction reference is UNCONFIRMED; double-refund behaviour is not documented.
14. Refund status transition timings, `expected_at` semantics, and the exact 10-business-day rule for customer receipt.
15. Transfer retry limit, queue timing, and maximum time in `pending`; the docs mention a retry limit but do not state it.
16. Transfer currency/unit rules beyond NGN kobo and GHS pesewas.
17. Amount and metadata type inconsistencies: initialize `amount` String vs refund/transfer Integer; response amounts integer but `refund.pending` webhook amount string; transaction `metadata` string vs recipient `metadata` object.
18. `fully_deducted` is boolean in some samples and `1` in the list sample; `createdAt`/`updatedAt` and `created_at`/`updated_at` vary by endpoint.
19. `bank_id` appears in the Resolve guide sample but not the Resolve API sample; whether it is always returned is UNCONFIRMED.
20. Whether `country` is required for `GET /bank`; the page does not mark it optional but its sample calls `/bank` without it.
21. Exact bank fields for `nip institution code`, `supported_types`, and other filter-specific fields.
22. Restricted/limited API key formats and key lengths; only `pk_test_`, `sk_test_`, `pk_live_`, `sk_live_` prefixes are documented.
23. Checkout page UI, exact decline/abandon flows, and the local test page behaviour are not Paystack API documentation. Ibeji's page is a local imitation; only the resulting transaction statuses and success-only webhook are documented.
24. No Paystack endpoint exists for Ibeji's local checkout page; do not document one as a Paystack path.
25. Official and community Node libraries do not document a base-URL override. The official library hardcodes `https://api.paystack.co`; T15 compatibility is therefore doubtful without an unsupported patch.
26. Whether `refund` list accepts no `transaction`/`currency` filters, despite the sample showing `GET /refund` without them.
27. The exact `meta` shape on refund, bank, and transaction lists; the docs show two different pagination shapes and do not always show `meta`.
28. The full shape and status values of `transfersessionid` and `transfertrials` arrays.
29. The exact event set for a refund that becomes `needs-attention` and whether `refund.needs-attention` is still emitted after a retry.
30. Whether Paystack sends any webhook for a declined or abandoned transaction. The docs currently say only successful transaction webhooks are sent; no failed/abandoned event name is published.
