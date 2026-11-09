import type { ConnectionGuideInfo } from "../../shared/control.js";

export const flutterwaveConnectionGuide: ConnectionGuideInfo = {
  summary:
    "Point your app at the local Flutterwave twin. Use the Ibeji test keys below. No real money moves.",
  baseUrlNote:
    "An API call is one request your app sends to a service over the internet. Copy the base URL and use it for every Flutterwave v3 API call. The default port is 4402, but always use the address shown here. Do not use https://api.flutterwave.com/v3.",
  keysNote:
    "Copy the public key into browser test code. Copy the secret key into your server's test settings. Copy the webhook hash into your webhook check. These values are fake and only work with Ibeji.",
  steps: [
    {
      title: "Point the official library at Ibeji",
      body: "This twin imitates Flutterwave API v3. v3 is the API version used by the official Node library. The official v3 Node library is flutterwave-node-v3 1.4.1. It accepts the base URL as the third constructor argument. The base URL must end with a slash because the library appends v3/... paths.",
      code: `const baseUrl = process.env.IBEJI_FLUTTERWAVE_BASE_URL;
const withSlash = baseUrl.endsWith("/") ? baseUrl : \`\${baseUrl}/\`;
const flw = new Flutterwave(
  process.env.IBEJI_FLUTTERWAVE_PUBLIC_KEY,
  process.env.IBEJI_FLUTTERWAVE_SECRET_KEY,
  withSlash,
);`,
    },
    {
      title: "Create a hosted payment",
      body: "The library has no Standard hosted-payment method. A hosted payment is a payment page that the payment service runs. Its Charge group calls /v3/charges, not /v3/payments. Create the hosted payment with POST {base}/v3/payments and fetch, read data.link, and send the customer there. Then use the library for the operations it does expose.",
    },
    {
      title: "Send the payment fields",
      body: "Send POST {base}/v3/payments with JSON { amount, tx_ref, currency, redirect_url, customer: { email } }. Amounts are whole currency amounts, for example 7500 for NGN 7,500.",
    },
    {
      title: "Verify the payment",
      body: "Use flw.Transaction.verify({ id }) or flw.Transaction.verify_by_tx({ tx_ref }) to check the result.",
    },
    {
      title: "Test a refund",
      body: "Use flw.Transaction.refund({ id: String(transactionId), amount }).",
    },
    {
      title: "Send the secret key",
      body: "Send the secret key in Authorization: Bearer <secret key>.",
    },
    {
      title: "Telemetry caveat",
      body: "The library starts telemetry code. Telemetry means automatic usage messages. That code contacts external Flutterwave and SigNoz hosts. Ibeji's compatibility test stubs those calls. If your app must make no outside requests, use direct HTTP calls instead of the library.",
    },
  ],
  webhookNote:
    "Open the Webhooks page and set the Flutterwave webhook URL to your app's endpoint. Flutterwave sends a verif-hash header. Compare it with the webhook hash before you trust the message. Flutterwave v3 does not sign the body with HMAC SHA512; it uses this shared secret instead. HMAC SHA512 is a way of mixing a secret key with the message so your app can check who sent it and that it was not changed. The v3 refund webhook has no documented event name. Treat the refund payload as its own message.",
  agentInstruction: `You are connecting this app to the local Ibeji Flutterwave twin.

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

Do not hard-code the port. Read the base URL from IBEJI_FLUTTERWAVE_BASE_URL.`,
};
