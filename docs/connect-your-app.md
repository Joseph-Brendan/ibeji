# Connect your app

This page mirrors the **Connect your app** page in the Ibeji dashboard. The dashboard shows the real port that Ibeji bound. The examples below use the default ports: Paystack 4401, Flutterwave 4402, and Stripe 4403.

The dashboard calls the twin address **Base URL** on this page and **app address** on Home. They are the same value.

Use fake customer data only. Events, records, exports and the dashboard keep the customer name, email and phone exactly as your app sent them. Never put a secret in a webhook URL, because Ibeji shows the URL and includes it in an export.

Every guide ends with the same rule: **Never put a live key in test settings. Live keys must never be used with Ibeji.**

For a short explanation of what a twin, a test key and a webhook are, see the [README](../README.md). For the safety rules, see [Safety](safety.md).

## How to use the page

1. Start Ibeji with `ibeji start`.
2. Open **Connect your app**.
3. Choose Paystack, Flutterwave or Stripe.
4. Copy the **Base URL**.
5. Copy the test keys into your app's test settings. Use the public key in browser test code and the secret key only on your server.
6. Set the **Webhook URL** to the address in your app that receives webhook messages.
7. Make one request from your app.
8. Look at **Check my connection**. It reads Ibeji's own event log and shows the last request. It never contacts your app.
9. Copy the **For your coding agent** instruction if you want your coding agent to make the change.

## Paystack

**Summary:** Point your app at the local Paystack twin. Use the Ibeji test keys below. No real money moves.

### Test keys

- **Public key:** `pk_test_ibeji_...`
- **Secret key:** `sk_test_ibeji_...`

These keys are fake and only work with Ibeji. Paystack signs webhooks with the secret key. Ibeji does not invent a separate Paystack webhook secret.

### Step 1: Copy the base URL

An API call is one request your app sends to a service over the internet. Copy the base URL and use it for every Paystack API call. The default is `http://127.0.0.1:4401`. Do not use `https://api.paystack.co`.

### Step 2: Copy the test keys

Copy the public key into browser test code. Copy the secret key into your server's test settings.

### Step 3: Use an HTTP client

The official Paystack Node library is `@paystack/paystack-sdk` 1.2.2. It cannot change its base URL. Community libraries also hard-code the Paystack address. Use `fetch` or another HTTP client instead. An HTTP client is a small library that sends web requests.

### Step 4: Create a payment

Send `POST {base}/transaction/initialize` with JSON `{ email, amount }`. The amount is in the smallest unit, for example kobo for NGN.

Read `data.authorization_url` and send the customer there. The twin checkout page opens on this computer.

Read `data.reference`. Use `GET {base}/transaction/verify/{reference}` to check the result.

Send `POST {base}/refund` with `{ transaction: reference }` and an optional amount to test a refund.

Send the secret key in `Authorization: Bearer <secret key>`.

### Step 5: Set the webhook URL

Open the **Webhooks** page and set the Paystack webhook URL to your app's endpoint. Paystack signs each webhook with the `x-paystack-signature` header. The signature is a keyed hash called HMAC SHA512. HMAC SHA512 is a way of mixing a secret key with the message so your app can check who sent it and that it was not changed. It is made from the exact bytes of the request body and the secret key. Verify it before you trust the message.

### Step 6: Check my connection

Make one test request. The panel reads Ibeji's event log and shows the last request that reached Paystack. It never contacts your app.

### Agent instruction for Paystack

```text
You are connecting this app to the local Ibeji Paystack twin.

Read these values from environment variables:
IBEJI_PAYSTACK_BASE_URL
IBEJI_PAYSTACK_PUBLIC_KEY
IBEJI_PAYSTACK_SECRET_KEY

Never write a key in source code, a committed file, or a browser bundle. Use the secret key only on the server.

The official Paystack Node library is @paystack/paystack-sdk 1.2.2. It cannot change its base URL. Use fetch or another HTTP client. Send requests to IBEJI_PAYSTACK_BASE_URL. Do not use https://api.paystack.co.

For a payment:
1. POST {base}/transaction/initialize with JSON { email, amount }. The amount is in the smallest unit, for example kobo for NGN.
2. Send the customer to data.authorization_url.
3. Read data.reference and verify with GET {base}/transaction/verify/{reference}.

For a refund:
POST {base}/refund with JSON { transaction: reference, amount? }.

Send the secret key in Authorization: Bearer <IBEJI_PAYSTACK_SECRET_KEY>.

Verify webhooks with the x-paystack-signature header. It is an HMAC SHA512 of the raw request body using the secret key.

Never put a live key in test settings. Live keys must never be used with Ibeji.

Do not hard-code the port. Read the base URL from IBEJI_PAYSTACK_BASE_URL.
```

## Flutterwave

**Summary:** Point your app at the local Flutterwave twin. Use the Ibeji test keys below. No real money moves.

The Flutterwave twin imitates Flutterwave API v3. Version 4 is not supported. See [Limits](limits.md).

### Test keys

- **Public key:** `FLWPUBK_TEST-ibeji-...`
- **Secret key:** `FLWSECK_TEST-ibeji-...`
- **Webhook hash:** `ibeji_...`

These values are fake and only work with Ibeji. The encryption key is not issued because the hosted payment flow does not use direct card-charge encryption.

### Step 1: Copy the base URL

An API call is one request your app sends to a service over the internet. Copy the base URL and use it for every Flutterwave v3 API call. The default is `http://127.0.0.1:4402`. Do not use `https://api.flutterwave.com/v3`.

### Step 2: Copy the test keys

Copy the public key into browser test code. Copy the secret key into your server's test settings. Copy the webhook hash into your webhook check.

### Step 3: Point the official library at Ibeji

The official v3 Node library is `flutterwave-node-v3` 1.4.1. It accepts the base URL as the third constructor argument. The base URL must end with a slash because the library appends `v3/...` paths.

```js
const baseUrl = process.env.IBEJI_FLUTTERWAVE_BASE_URL;
const withSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
const flw = new Flutterwave(
  process.env.IBEJI_FLUTTERWAVE_PUBLIC_KEY,
  process.env.IBEJI_FLUTTERWAVE_SECRET_KEY,
  withSlash,
);
```

The library has no Standard hosted-payment method. A hosted payment is a payment page that the payment service runs. Its `Charge` group calls `/v3/charges`, not `/v3/payments`. Create the hosted payment with `POST {base}/v3/payments` and `fetch`, read `data.link`, and send the customer there. Then use the library for the operations it does expose.

### Step 4: Create a hosted payment

Send `POST {base}/v3/payments` with JSON `{ amount, tx_ref, currency, redirect_url, customer: { email } }`. Amounts are whole currency amounts, for example `7500` for NGN 7,500.

Read `data.link` and send the customer there.

### Step 5: Verify and refund

Use `flw.Transaction.verify({ id })` or `flw.Transaction.verify_by_tx({ tx_ref })` to check the result.

Use `flw.Transaction.refund({ id: String(transactionId), amount })` to test a refund.

Send the secret key in `Authorization: Bearer <secret key>`.

The library starts telemetry code. Telemetry means automatic usage messages. That code contacts external Flutterwave and SigNoz hosts. Ibeji's compatibility test stubs those calls. If your app must make no outside requests, use direct HTTP calls instead of the library.

### Step 6: Set the webhook URL

Open the **Webhooks** page and set the Flutterwave webhook URL to your app's endpoint. Flutterwave sends a `verif-hash` header. Compare it with the webhook hash before you trust the message. Flutterwave v3 does not sign the body with HMAC SHA512; it uses this shared secret instead. HMAC SHA512 is a way of mixing a secret key with the message so your app can check who sent it and that it was not changed. The v3 refund webhook has no documented event name. Treat the refund payload as its own message.

### Step 7: Check my connection

Make one test request. The panel reads Ibeji's event log and shows the last request that reached Flutterwave. It never contacts your app.

### Agent instruction for Flutterwave

```text
You are connecting this app to the local Ibeji Flutterwave twin.

Read these values from environment variables:
IBEJI_FLUTTERWAVE_BASE_URL
IBEJI_FLUTTERWAVE_PUBLIC_KEY
IBEJI_FLUTTERWAVE_SECRET_KEY
IBEJI_FLUTTERWAVE_WEBHOOK_HASH

Never write a key in source code, a committed file, or a browser bundle. Use the secret key only on the server.

This twin imitates Flutterwave API v3. The base URL default is http://127.0.0.1:4402.

The official flutterwave-node-v3 library can point at Ibeji. Pass the base URL as the third constructor argument and make sure it ends with a slash:
const baseUrl = process.env.IBEJI_FLUTTERWAVE_BASE_URL;
const withSlash = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
const flw = new Flutterwave(publicKey, secretKey, withSlash);

The library has no Standard hosted-payment method. Create the hosted payment with POST {base}/v3/payments using fetch. Read data.link and send the customer there. Then use the library for verify, verify_by_tx and refund.

The library may send telemetry to external hosts when it starts. If the app must stay fully local, use direct HTTP instead.

Verify webhooks by comparing the verif-hash header with IBEJI_FLUTTERWAVE_WEBHOOK_HASH.

Never put a live key in test settings. Live keys must never be used with Ibeji.

Do not hard-code the port. Read the base URL from IBEJI_FLUTTERWAVE_BASE_URL.
```

## Stripe, version 0.2.0

The Stripe twin is not built or registered in version 0.1.0. This guide describes the planned version 0.2.0 behaviour. Do not use it with a 0.1.0 session.

**Summary:** Point your app at the local Stripe twin. Use the Ibeji test keys below. No real money moves.

### Test keys

- **Publishable key:** `pk_test_ibeji_...`
- **Secret key:** `sk_test_ibeji_...`
- **Webhook secret:** `whsec_ibeji_...`

### Step 1: Copy the base URL

Copy the base URL and use it for every Stripe v1 API call. The default is `http://127.0.0.1:4403`. Do not use `https://api.stripe.com`.

### Step 2: Copy the test keys

Copy the publishable key into browser test code if your app uses one. Copy the secret key and webhook secret into your server's test settings.

### Step 3: Point the official library at Ibeji

The official `stripe` Node library supports a custom host, port and protocol. It also lets you disable telemetry. Parse the base URL environment variable so the host and port stay correct when Ibeji uses another port.

```js
const base = new URL(process.env.IBEJI_STRIPE_BASE_URL);
const stripe = new Stripe(process.env.IBEJI_STRIPE_SECRET_KEY, {
  host: base.hostname,
  port: Number(base.port),
  protocol: base.protocol === "https:" ? "https" : "http",
  apiVersion: "2026-09-30.endive",
  telemetry: false,
});
```

The library appends `/v1/...` paths. An API version is the version of the request and response shapes. The Stripe twin serves only API version `2026-09-30.endive`. It accepts no version header or the exact version. It rejects other versions. See [Limits](limits.md).

### Step 4: Create a payment

Create a PaymentIntent with `stripe.paymentIntents.create({ amount, currency })`. A PaymentIntent is one payment record.

Or create a Checkout Session with `stripe.checkout.sessions.create`. A Checkout Session is one checkout page record. The twin returns a local checkout URL.

Complete the local checkout page.

Verify the PaymentIntent or Checkout Session, or use the twin's Events API. The Events API is the list of things that happened.

Refund with `stripe.refunds.create` and a `payment_intent` id.

### Step 5: Set the webhook URL

Open the **Webhooks** page and set the Stripe webhook URL to your app's endpoint. Stripe signs each webhook with the `Stripe-Signature` header. The signature is a keyed hash called HMAC SHA256. It is made from the timestamp, a literal dot, and the exact bytes of the body, using the webhook secret. The timestamp tolerance is the allowed clock difference. Check it and use the exact body bytes.

### Step 6: Check my connection

Make one test request. The panel reads Ibeji's event log and shows the last request that reached Stripe. It never contacts your app.

### Agent instruction for Stripe

```text
You are connecting this app to the local Ibeji Stripe twin.

Read these values from environment variables:
IBEJI_STRIPE_BASE_URL
IBEJI_STRIPE_PUBLIC_KEY
IBEJI_STRIPE_SECRET_KEY
IBEJI_STRIPE_WEBHOOK_SECRET

Never write a key in source code, a committed file, or a browser bundle. Use the secret key and webhook secret only on the server.

This guide is for Ibeji version 0.2.0, when the Stripe twin is registered.

The official stripe Node library can point at Ibeji. Parse the base URL and set host, port, protocol and apiVersion:
const base = new URL(process.env.IBEJI_STRIPE_BASE_URL);
const stripe = new Stripe(process.env.IBEJI_STRIPE_SECRET_KEY, {
  host: base.hostname,
  port: Number(base.port),
  protocol: base.protocol === "https:" ? "https" : "http",
  apiVersion: "2026-09-30.endive",
  telemetry: false,
});

The twin serves only API version 2026-09-30.endive. Use telemetry false so the library does not send telemetry to Stripe.

Create PaymentIntents, Checkout Sessions and Refunds through the library. Complete the local checkout page that the twin returns.

Verify webhooks with the Stripe-Signature header and IBEJI_STRIPE_WEBHOOK_SECRET. Use the raw request body.

Never put a live key in test settings. Live keys must never be used with Ibeji.

Do not hard-code the port. Read the base URL from IBEJI_STRIPE_BASE_URL.
```
