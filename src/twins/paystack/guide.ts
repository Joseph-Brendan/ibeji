import type { ConnectionGuideInfo } from "../../shared/control.js";

export const paystackConnectionGuide: ConnectionGuideInfo = {
  summary:
    "Point your app at the local Paystack twin. Use the Ibeji test keys below. No real money moves.",
  baseUrlNote:
    "Copy the base URL and use it for every Paystack API call. The default port is 4401, but always use the address shown here. Do not use https://api.paystack.co.",
  keysNote:
    "Copy the public key into browser test code. Copy the secret key into your server's test settings. These keys are fake and only work with Ibeji. Paystack signs webhooks with the secret key; there is no separate webhook secret.",
  steps: [
    {
      title: "Use an HTTP client",
      body: "The official Paystack Node library is @paystack/paystack-sdk 1.2.2. It cannot change its base URL. Community libraries also hard-code the Paystack address. Use fetch or another HTTP client instead. An HTTP client is a small library that sends web requests.",
    },
    {
      title: "Create a payment",
      body: "Send POST {base}/transaction/initialize with JSON { email, amount }. The amount is in the smallest unit, for example kobo for NGN.",
    },
    {
      title: "Open the checkout page",
      body: "Read data.authorization_url and send the customer there. The twin checkout page opens on this computer.",
    },
    {
      title: "Verify the payment",
      body: "Read data.reference. Use GET {base}/transaction/verify/{reference} to check the result.",
    },
    {
      title: "Test a refund",
      body: "Send POST {base}/refund with { transaction: reference } and an optional amount to test a refund.",
    },
    {
      title: "Send the secret key",
      body: "Send the secret key in Authorization: Bearer <secret key>.",
    },
  ],
  webhookNote:
    "Open the Webhooks page and set the Paystack webhook URL to your app's endpoint. Paystack signs each webhook with the x-paystack-signature header. The signature is a keyed hash called HMAC SHA512. It is made from the exact bytes of the request body and the secret key. Verify it before you trust the message.",
  agentInstruction: `You are connecting this app to the local Ibeji Paystack twin.

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

Do not hard-code the port. Read the base URL from IBEJI_PAYSTACK_BASE_URL.`,
};
