import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${name} is missing. Copy it from the Ibeji Connect your app page or from ibeji keys.`,
    );
  }
  return value.trim();
}

function localBaseUrl(env, name) {
  const value = required(env, name);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a full http:// address, for example http://127.0.0.1:4401.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must start with http:// or https://.`);
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${name} must point at this computer. Use the address shown by Ibeji.`);
  }
  return url.origin;
}

function headerValue(headers, name) {
  const value = headers[name];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function safeEqualText(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function paymentError(providerName, body) {
  if (typeof body === "object" && body !== null) {
    if (typeof body.message === "string" && body.message.length > 0) {
      return `${providerName} refused the payment: ${body.message}`;
    }
    if (typeof body.error === "object" && body.error !== null) {
      const message = body.error.message;
      if (typeof message === "string" && message.length > 0) {
        return `${providerName} refused the payment: ${message}`;
      }
    }
  }
  return `${providerName} refused the payment.`;
}

function checkoutUrl(value, providerName) {
  if (typeof value !== "string") {
    throw new Error(`${providerName} did not return a checkout link.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${providerName} returned a checkout link that is not a valid address.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${providerName} returned a checkout link with an unsafe scheme.`);
  }
  return url.toString();
}

async function postJson(url, secretKey, body, providerName) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    throw new Error(paymentError(providerName, parsed));
  }
  return parsed;
}

export const providers = {
  paystack: {
    id: "paystack",
    displayName: "Paystack",
    webhookPath: "/webhooks/paystack",
    returnPath: "/return/paystack",
    readConfig(env) {
      const config = {
        baseUrl: localBaseUrl(env, "IBEJI_PAYSTACK_BASE_URL"),
        publicKey: required(env, "IBEJI_PAYSTACK_PUBLIC_KEY"),
        secretKey: required(env, "IBEJI_PAYSTACK_SECRET_KEY"),
      };
      if (config.publicKey.startsWith("pk_live_")) {
        throw new Error(
          "IBEJI_PAYSTACK_PUBLIC_KEY is a live key. Never use a live key with Ibeji.",
        );
      }
      if (config.secretKey.startsWith("sk_live_")) {
        throw new Error(
          "IBEJI_PAYSTACK_SECRET_KEY is a live key. Never use a live key with Ibeji.",
        );
      }
      if (!config.publicKey.startsWith("pk_test_") || !config.secretKey.startsWith("sk_test_")) {
        throw new Error("The Paystack keys must be Ibeji test keys. Copy them from Ibeji.");
      }
      return config;
    },
    async createPayment({ config, student, appBaseUrl }) {
      // The official Paystack Node library hard-codes https://api.paystack.co and
      // has no supported base-URL override (research/paystack.md section 13 and
      // BUILD-LOG.md Phase 4 Step 4.7). The real flow is therefore plain fetch:
      // initialize, then send the parent to data.authorization_url.
      const reference = `school-${student.id}-${randomUUID()}`;
      const body = await postJson(
        `${config.baseUrl}/transaction/initialize`,
        config.secretKey,
        {
          email: `parent.${student.id}@example.com`,
          amount: String(student.fee * 100),
          currency: "NGN",
          reference,
          callback_url: `${appBaseUrl}/return/paystack`,
          metadata: JSON.stringify({ studentId: student.id }),
        },
        "Paystack",
      );
      if (body?.status !== true || typeof body.data !== "object" || body.data === null) {
        throw new Error(paymentError("Paystack", body));
      }
      return {
        reference,
        checkoutUrl: checkoutUrl(body.data.authorization_url, "Paystack"),
      };
    },
    verifyWebhook({ config, rawBody, headers }) {
      const signature = headerValue(headers, "x-paystack-signature");
      if (signature === undefined) {
        return false;
      }
      const expected = createHmac("sha512", config.secretKey).update(rawBody).digest("hex");
      return safeEqualText(expected, signature.trim());
    },
    webhookKey(event, data) {
      if (event !== "charge.success") {
        return undefined;
      }
      if (typeof data.reference === "string" && data.reference.length > 0) {
        return data.reference;
      }
      return typeof data.id === "number" ? String(data.id) : undefined;
    },
    isSuccess(event, data) {
      return event === "charge.success" && data.status === "success";
    },
  },

  flutterwave: {
    id: "flutterwave",
    displayName: "Flutterwave",
    webhookPath: "/webhooks/flutterwave",
    returnPath: "/return/flutterwave",
    readConfig(env) {
      const config = {
        baseUrl: localBaseUrl(env, "IBEJI_FLUTTERWAVE_BASE_URL"),
        publicKey: required(env, "IBEJI_FLUTTERWAVE_PUBLIC_KEY"),
        secretKey: required(env, "IBEJI_FLUTTERWAVE_SECRET_KEY"),
        webhookHash: required(env, "IBEJI_FLUTTERWAVE_WEBHOOK_HASH"),
      };
      if (config.publicKey.startsWith("FLWPUBK-")) {
        throw new Error(
          "IBEJI_FLUTTERWAVE_PUBLIC_KEY is a live key. Never use a live key with Ibeji.",
        );
      }
      if (config.secretKey.startsWith("FLWSECK-")) {
        throw new Error(
          "IBEJI_FLUTTERWAVE_SECRET_KEY is a live key. Never use a live key with Ibeji.",
        );
      }
      if (
        !config.publicKey.startsWith("FLWPUBK_TEST-") ||
        !config.secretKey.startsWith("FLWSECK_TEST-")
      ) {
        throw new Error("The Flutterwave keys must be Ibeji test keys. Copy them from Ibeji.");
      }
      return config;
    },
    async createPayment({ config, student, appBaseUrl }) {
      // Step 4.7 shows flutterwave-node-v3 can point at a twin for verify and
      // refund, but its Charge group calls /v3/charges, not the Standard hosted
      // /v3/payments flow used here. Constructing that library also starts its
      // telemetry calls to external hosts. This example therefore uses fetch for
      // the hosted create, and keeps webhook checks local.
      const txRef = `school-${student.id}-${randomUUID()}`;
      const body = await postJson(
        `${config.baseUrl}/v3/payments`,
        config.secretKey,
        {
          amount: student.fee,
          tx_ref: txRef,
          currency: "NGN",
          redirect_url: `${appBaseUrl}/return/flutterwave`,
          customer: { email: `parent.${student.id}@example.com` },
          customizations: { title: "School fees" },
          meta: { studentId: student.id },
        },
        "Flutterwave",
      );
      if (body?.status !== "success" || typeof body.data !== "object" || body.data === null) {
        throw new Error(paymentError("Flutterwave", body));
      }
      return {
        reference: txRef,
        checkoutUrl: checkoutUrl(body.data.link, "Flutterwave"),
      };
    },
    verifyWebhook({ config, headers }) {
      const hash = headerValue(headers, "verif-hash");
      return hash !== undefined && safeEqualText(config.webhookHash, hash);
    },
    webhookKey(event, data) {
      if (event !== "charge.completed") {
        return undefined;
      }
      if (typeof data.tx_ref === "string" && data.tx_ref.length > 0) {
        return data.tx_ref;
      }
      return typeof data.id === "number" ? String(data.id) : undefined;
    },
    isSuccess(event, data) {
      return event === "charge.completed" && data.status === "successful";
    },
  },
};

export const providerIds = Object.keys(providers);
