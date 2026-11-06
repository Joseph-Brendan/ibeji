# Limits

Ibeji version 0.1.0 builds the Paystack and Flutterwave twins. The Stripe twin is planned for version 0.2.0. This page lists what is not supported, so you do not expect a twin to behave like the whole service.

## Rules that apply to every twin

- A twin imitates only the actions in SPEC.md C4. Any other action is outside the twin.
- A twin never contacts the real service and never moves real money.
- A twin never accepts a live key. See [Safety](safety.md).
- The test checkout page is Ibeji's own page. It is not the service's hosted checkout page, and it does not reproduce the service's card forms, bank redirects, OTP screens or 3DS challenge screens.
- No twin uses a service's logo, colours or fonts.
- Webhooks go only to this computer by default. Private and public addresses need extra start flags.
- A twin records state in memory for the life of the session. It is not a database, and it is not a production service.
- The published package does not include the recorder or the fixtures folder. The recorder is a separate development tool. In version 0.1.0, `--service stripe` is refused because Stripe recording and the Stripe twin are part of version 0.2.0. When a test-key prefix is shared by more than one service, the recorder asks the person to type the service name before it sends anything.

## Paystack

### Supported actions

The Paystack twin supports the C4a actions:

- Transactions: initialize, verify, fetch one, list.
- Checkout: the local test checkout page with success, declined and abandoned outcomes.
- Refunds: create, fetch one, list.
- Transfers: create a transfer recipient, initiate a transfer, fetch and verify a transfer.
- Banks: list banks, resolve an account number to an account name.
- The webhooks Paystack sends for these actions.

### Not supported

Any Paystack action that is not in the list above is not supported. This includes Paystack's dashboard and any API endpoint that the twin does not declare. The twin does not guess at an endpoint or return a made-up success.

The following are also outside the twin:

- The real Paystack hosted checkout page.
- Paystack's own payment channels and bank authentication flows.
- Real settlements, payouts or bank transfers.
- Any feature that depends on a live Paystack account or live keys.

### Actions that rely on documentation only

Some Paystack actions could not be recorded with the recorder account. Their shapes follow `research/paystack.md`, not a recorded response:

| Action | Why it is documentation only |
|---|---|
| `transfer.create` | The recorder account was limited to the starter-business transfer response, so no successful transfer was recorded. |
| `transfer.fetch` | The recorded step was skipped. The object follows the documented fetch and verify shape. |
| `transfer.verify` | The recorded step was skipped. The object follows the documented fetch and verify shape. |
| `transfer_recipient.create` with an authorization code | The account-number recipient was recorded. The authorization-code variant is documentation only. |
| `transfer.failed` webhook payload | Only the event name and description are documented. |
| `transfer.reversed` webhook payload | Only the event name and description are documented. |

The local checkout page and webhook deliveries have no recorder fixtures by design. They are part of Ibeji, not a Paystack API response.

Details that remain unconfirmed are also treated as local choices, not Paystack facts:

- The exact body of a missing or invalid key response.
- The exact 5xx body.
- The result of a duplicate transaction reference.
- The error for an unknown numeric transaction id.
- The fee formula on a successful transaction. The twin uses `0`.
- Some refund and transfer webhook payloads.
- Some refund status transitions and timings.

### Library limit

The official Paystack Node library, `@paystack/paystack-sdk` 1.2.2, hard-codes `https://api.paystack.co`. The common community libraries also hard-code the Paystack address. Use `fetch` or another HTTP client and send requests to the twin's base URL. This is a limitation of those libraries, not a feature of the twin.

### Failures

The Paystack twin supports the failures shown in [the failure library](failures.md), including `transfer-stuck-pending`, `transfer-reversed` and `bank-resolve-fails`. `authentication-required` is not available because it is a Stripe-only failure.

## Flutterwave

### Supported actions

The Flutterwave twin imitates API v3, the version used by the official v3 Node library. It supports the C4b actions:

- Payments: create a hosted payment, verify by id, verify by reference, list.
- Checkout: the local test checkout page with success, failed and cancelled outcomes. The cancelled outcome produces Flutterwave's documented failed result because v3 has no separate cancelled status.
- Refunds: refund a transaction, fetch and list refunds.
- Transfers: initiate a transfer, fetch a transfer, list transfers.
- Banks: list banks for a country, resolve an account number.
- The webhooks Flutterwave sends for these actions.

### Not supported

Flutterwave API v4 is not supported. Version 4 uses OAuth 2.0, `/charges`, `X-Idempotency-Key` and `flutterwave-signature` HMAC webhooks. The twin uses the v3 bearer key, `/v3` paths and the `verif-hash` header.

Any Flutterwave action outside the C4b list is not supported. The twin does not implement the real hosted payment page, real bank redirects, OTP screens, settlement processing or a real transfer network.

### Actions that rely on documentation only

| Action or behaviour | Why it is documentation only |
|---|---|
| `transfer.create` | The recorder account was limited by IP whitelisting, so no successful transfer was recorded. |
| `transfer.fetch` | The recorded non-numeric response was an HTML page. The twin uses a documented JSON error instead. |
| `transfer.list` with non-empty items | The recorded list fixture was empty. The item shape follows the documented transfer object. |
| `transfer.completed` webhook payload | The full payload follows the documentation. |
| Test-transfer timing | The `_PMCK`, `_PMCK_ST_F` and `DU_n` schedules come from the testing guide, not a fixture. |
| Duplicate transfer references | The v3 docs call the reference unique but do not state the duplicate behaviour. The twin rejects a reused reference in Flutterwave's error shape. |
| Per-transfer fields not exercised | `callback_url` and the conditional `meta[]` requirements are accepted or ignored for now. The framework has one webhook URL per twin. |
| Non-empty payment list items | The recorded payment list fixtures were empty. The item shape follows the documented list item. |
| The v3 refund webhook event name | v3 has no documented event name. The twin treats the refund payload as its own message. |

The local checkout page and webhook deliveries have no recorder fixtures by design.

Unconfirmed details include exact error bodies for some statuses, the complete list of transaction statuses, the exact refund timing, the v3 decimal rule for every currency, and whether webhook retries are enabled by default. Transfer success, stuck-pending and reversal timings in the twin are local Ibeji test timings, not Flutterwave facts.

### Library limits

The official `flutterwave-node-v3` 1.4.1 library can point at the twin with its third constructor argument. The base URL must end with a slash because the library appends `v3/...` paths.

The library has no Standard hosted-payment method. Its `Charge` group calls `/v3/charges`, not `/v3/payments`. Create the hosted payment with `fetch`, then use the library for verify and refund.

The library starts telemetry code that contacts external Flutterwave and SigNoz hosts. Ibeji's compatibility test stubs those calls. If your app must make no outside requests, use direct HTTP calls instead.

Flutterwave's testing guide tells a local app to use `localhost`. Ibeji binds to `127.0.0.1` for every server. This is an intentional Ibeji difference and a gap for exact checkout behaviour.

### Failures

The Flutterwave twin supports the failures shown in [the failure library](failures.md), including `transfer-stuck-pending` and `bank-resolve-fails`. It does not support `transfer-reversed`, because v3 documents no transfer reversal status or event. `authentication-required` is Stripe-only.

## Stripe, version 0.2.0

The Stripe twin is not built or registered in version 0.1.0. This section describes the planned version 0.2.0 scope.

### Supported actions planned for 0.2.0

- PaymentIntents: create, retrieve, confirm, cancel, list.
- Checkout Sessions: create, retrieve, list. Create returns a link to the local test checkout.
- Checkout: the local test checkout page with success, card declined, and extra authentication with approve or fail.
- Refunds: create, retrieve, list.
- Events: retrieve and list.
- The webhooks Stripe sends for these actions.

### Not supported

The following are outside the planned C4c scope:

- Stripe payouts and Stripe Connect transfers.
- The Charges API.
- Customers, Prices, PaymentMethods, products, tax, shipping, invoices, subscriptions and disputes.
- Webhook endpoint management.
- The `checkout.session.created` event. Stripe does not document one, so the twin will not invent it.
- Radar and fraud rules.
- Test clocks.
- Stripe v2 APIs.
- Thin events. The twin uses snapshot Event objects.
- API versions other than `2026-09-30.endive`.
- Optional Checkout Session fields beyond the hosted payment path.
- `next_action` variants other than the documented 3DS redirect shape.
- The full Charge object outside the `charge.refunded` event decision.
- The real Stripe hosted checkout page and real card network behaviour.

### Documentation only

No Stripe fixtures have been recorded yet, because the twin is version 0.2.0. Until they are recorded, every Stripe action follows `research/stripe.md` only. Known gaps include:

- The exact missing or invalid key response body.
- The exact status and code for an idempotency parameter mismatch.
- Stripe's own response to an unsupported `Stripe-Version` value. The twin's reject rule is an Ibeji policy.
- The exact automatic webhook retry delays.
- The payload for `charge.refunded`, which carries a Charge object although the Charges API is outside C4c.
- The exact local checkout event order for decline, 3DS approve and 3DS fail.

### Library limits

The official `stripe` Node library can point at a local host, port and protocol. Use `telemetry: false` so the library does not send telemetry to Stripe. Use API version `2026-09-30.endive`.

The twin does not reproduce real Stripe card forms or real 3DS. It uses the documented test outcomes as the guide for its local page.

## Failures not supported by each twin

| Failure | Paystack | Flutterwave | Stripe |
|---|---|---|---|
| `authentication-required` | No | No | Yes, in 0.2.0 |
| `transfer-stuck-pending` | Yes | Yes | No, because payouts and Connect transfers are outside C4c |
| `transfer-reversed` | Yes | No, because v3 has no reversal status or event | No |
| `bank-resolve-fails` | Yes | Yes | No, because C4c has no bank lookup action |

The failure library labels a failure as assumed when the service documentation does not confirm the behaviour. The UI shows that label. Read [the failure library](failures.md) for the exact text and settings.

## Related pages

- [Safety](safety.md)
- [Connect your app](connect-your-app.md)
- [Stripe and Ibeji](stripe-and-ibeji.md)
- [Failure library](failures.md)
