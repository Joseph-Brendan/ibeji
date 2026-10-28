import { encodeForm, makeReference } from "./shared.mjs";

const API_VERSION = "2026-09-30.endive";
const STRIPE_HEADERS = { "stripe-version": API_VERSION };

export const meta = {
  id: "stripe",
  displayName: "Stripe",
  envName: "STRIPE_TEST_SECRET_KEY",
  baseUrl: "https://api.stripe.com",
  requestFormat: "form",
  auth: "basic",
  testKey: /^sk_test_\S+$/,
  liveKeys: [/^(?:pk|sk|rk)_live_\S+$/],
  keyPatterns: [
    /\b(?:pk|sk|rk)_(?:test|live)_[A-Za-z0-9._~+/=-]+\b/g,
    /\bwhsec_[A-Za-z0-9._~+/=-]+\b/g,
    /\b(?:pi|cs|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/g,
  ],
  isSuccess(status, body) {
    return (
      status >= 200 &&
      status < 300 &&
      (body === null || typeof body !== "object" || !Object.hasOwn(body, "error"))
    );
  },
};

const PI_BODY = {
  amount: 2000,
  currency: "usd",
  payment_method_types: ["card"],
  metadata: { recorder: "ibeji" },
};

function idFrom(result) {
  if (result === null || result === undefined) {
    return undefined;
  }
  const body = result.body;
  if (body !== null && typeof body === "object" && "id" in body) {
    return body.id;
  }
  return undefined;
}

export async function record(ctx) {
  const createPaymentIntent = await ctx.record({
    action: "payment_intent.create",
    method: "POST",
    path: "/v1/payment_intents",
    body: encodeForm(PI_BODY),
    headers: STRIPE_HEADERS,
  });
  await ctx.recordInvalid("payment_intent.create", {
    method: "POST",
    path: "/v1/payment_intents",
    body: encodeForm({ amount: 2000, payment_method_types: ["card"] }),
    headers: STRIPE_HEADERS,
  });

  const paymentIntentId = idFrom(createPaymentIntent);
  if (paymentIntentId !== undefined) {
    await ctx.record({
      action: "payment_intent.retrieve",
      method: "GET",
      path: `/v1/payment_intents/${String(paymentIntentId)}`,
      headers: STRIPE_HEADERS,
    });
  } else {
    await ctx.skip("payment_intent.retrieve", "payment_intent.create did not return an id");
  }
  await ctx.recordInvalid("payment_intent.retrieve", {
    method: "GET",
    path: "/v1/payment_intents/pi_invalid",
    headers: STRIPE_HEADERS,
  });

  if (paymentIntentId !== undefined) {
    await ctx.record({
      action: "payment_intent.confirm",
      method: "POST",
      path: `/v1/payment_intents/${String(paymentIntentId)}/confirm`,
      body: encodeForm({ payment_method: "pm_card_visa" }),
      headers: STRIPE_HEADERS,
    });
  } else {
    await ctx.skip("payment_intent.confirm", "payment_intent.create did not return an id");
  }
  await ctx.recordInvalid("payment_intent.confirm", {
    method: "POST",
    path: "/v1/payment_intents/pi_invalid/confirm",
    body: encodeForm({ payment_method: "pm_card_visa" }),
    headers: STRIPE_HEADERS,
  });

  const cancelSetup = await ctx.record({
    action: "payment_intent.create",
    outcome: "setup",
    method: "POST",
    path: "/v1/payment_intents",
    body: encodeForm({
      amount: 1200,
      currency: "usd",
      payment_method_types: ["card"],
      metadata: { recorder: "ibeji", purpose: "cancel" },
    }),
    headers: STRIPE_HEADERS,
  });
  const cancelId = idFrom(cancelSetup);
  if (cancelId !== undefined) {
    await ctx.record({
      action: "payment_intent.cancel",
      method: "POST",
      path: `/v1/payment_intents/${String(cancelId)}/cancel`,
      headers: STRIPE_HEADERS,
    });
  } else {
    await ctx.skip("payment_intent.cancel", "cancel setup did not return a PaymentIntent id");
  }
  await ctx.recordInvalid("payment_intent.cancel", {
    method: "POST",
    path: "/v1/payment_intents/pi_invalid/cancel",
    headers: STRIPE_HEADERS,
  });

  await ctx.record({
    action: "payment_intent.list",
    method: "GET",
    path: "/v1/payment_intents",
    query: { limit: 5 },
    headers: STRIPE_HEADERS,
  });
  await ctx.recordInvalid("payment_intent.list", {
    method: "GET",
    path: "/v1/payment_intents",
    query: { limit: 0 },
    headers: STRIPE_HEADERS,
  });

  const checkoutSession = await ctx.record({
    action: "checkout_session.create",
    method: "POST",
    path: "/v1/checkout/sessions",
    body: encodeForm({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Ibeji recorder" },
            unit_amount: 2000,
          },
          quantity: 1,
        },
      ],
      success_url: "https://example.com/ibeji/stripe/success",
      cancel_url: "https://example.com/ibeji/stripe/cancel",
    }),
    headers: STRIPE_HEADERS,
  });
  await ctx.recordInvalid("checkout_session.create", {
    method: "POST",
    path: "/v1/checkout/sessions",
    body: encodeForm({
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Ibeji recorder" },
            unit_amount: 2000,
          },
          quantity: 1,
        },
      ],
      success_url: "https://example.com/ibeji/stripe/success",
    }),
    headers: STRIPE_HEADERS,
  });

  const checkoutId = idFrom(checkoutSession);
  const checkoutUrl =
    checkoutSession.body !== null &&
    typeof checkoutSession.body === "object" &&
    "url" in checkoutSession.body
      ? checkoutSession.body.url
      : undefined;
  if (typeof checkoutUrl === "string") {
    await ctx.promptCheckout({
      title: "Stripe test checkout",
      url: checkoutUrl,
      card: "4242 4242 4242 4242, any CVC, any future expiry",
      extra: "Complete the hosted Checkout payment, then return here.",
    });
  } else {
    await ctx.skip("checkout", "checkout_session.create did not return a hosted url");
  }

  if (checkoutId !== undefined) {
    await ctx.record({
      action: "checkout_session.retrieve",
      method: "GET",
      path: `/v1/checkout/sessions/${String(checkoutId)}`,
      headers: STRIPE_HEADERS,
    });
  } else {
    await ctx.skip("checkout_session.retrieve", "checkout_session.create did not return an id");
  }
  await ctx.recordInvalid("checkout_session.retrieve", {
    method: "GET",
    path: "/v1/checkout/sessions/cs_invalid",
    headers: STRIPE_HEADERS,
  });

  await ctx.record({
    action: "checkout_session.list",
    method: "GET",
    path: "/v1/checkout/sessions",
    query: { limit: 5 },
    headers: STRIPE_HEADERS,
  });
  await ctx.recordInvalid("checkout_session.list", {
    method: "GET",
    path: "/v1/checkout/sessions",
    query: { limit: 0 },
    headers: STRIPE_HEADERS,
  });

  const refund = await ctx.record({
    action: "refund.create",
    method: "POST",
    path: "/v1/refunds",
    body: encodeForm(
      paymentIntentId === undefined
        ? { payment_intent: "pi_invalid", reason: "requested_by_customer" }
        : { payment_intent: paymentIntentId, reason: "requested_by_customer" },
    ),
    headers: STRIPE_HEADERS,
  });
  await ctx.recordInvalid("refund.create", {
    method: "POST",
    path: "/v1/refunds",
    body: encodeForm({ payment_intent: "pi_invalid" }),
    headers: STRIPE_HEADERS,
  });

  const refundId = idFrom(refund);
  if (refundId !== undefined) {
    await ctx.record({
      action: "refund.retrieve",
      method: "GET",
      path: `/v1/refunds/${String(refundId)}`,
      headers: STRIPE_HEADERS,
    });
  } else {
    await ctx.skip("refund.retrieve", "refund.create did not return an id");
  }
  await ctx.recordInvalid("refund.retrieve", {
    method: "GET",
    path: "/v1/refunds/re_invalid",
    headers: STRIPE_HEADERS,
  });

  await ctx.record({
    action: "refund.list",
    method: "GET",
    path: "/v1/refunds",
    query: { limit: 5 },
    headers: STRIPE_HEADERS,
  });
  await ctx.recordInvalid("refund.list", {
    method: "GET",
    path: "/v1/refunds",
    query: { limit: 0 },
    headers: STRIPE_HEADERS,
  });

  const events = await ctx.record({
    action: "event.list",
    method: "GET",
    path: "/v1/events",
    query: { limit: 5 },
    headers: STRIPE_HEADERS,
  });
  await ctx.recordInvalid("event.list", {
    method: "GET",
    path: "/v1/events",
    query: { limit: 0 },
    headers: STRIPE_HEADERS,
  });

  const eventId =
    events.body !== null &&
    typeof events.body === "object" &&
    Array.isArray(events.body.data) &&
    events.body.data.length > 0 &&
    events.body.data[0] !== null &&
    typeof events.body.data[0] === "object" &&
    "id" in events.body.data[0]
      ? events.body.data[0].id
      : undefined;
  if (eventId !== undefined) {
    await ctx.record({
      action: "event.retrieve",
      method: "GET",
      path: `/v1/events/${String(eventId)}`,
      headers: STRIPE_HEADERS,
    });
  } else {
    await ctx.skip("event.retrieve", "event.list did not return an event id");
  }
  await ctx.recordInvalid("event.retrieve", {
    method: "GET",
    path: "/v1/events/evt_invalid",
    headers: STRIPE_HEADERS,
  });

  const idempotencyKey = makeReference("ibeji-idem");
  const idempotentBody = encodeForm({
    amount: 1500,
    currency: "usd",
    payment_method_types: ["card"],
    metadata: { recorder: "ibeji", case: "idempotency" },
  });
  await ctx.record({
    action: "payment_intent.create",
    outcome: "idempotent-original",
    method: "POST",
    path: "/v1/payment_intents",
    body: idempotentBody,
    headers: { ...STRIPE_HEADERS, "idempotency-key": idempotencyKey },
  });
  await ctx.record({
    action: "payment_intent.create",
    outcome: "idempotent-replay",
    method: "POST",
    path: "/v1/payment_intents",
    body: idempotentBody,
    headers: { ...STRIPE_HEADERS, "idempotency-key": idempotencyKey },
  });
  await ctx.record({
    action: "payment_intent.create",
    outcome: "idempotency-mismatch",
    method: "POST",
    path: "/v1/payment_intents",
    body: encodeForm({
      amount: 1600,
      currency: "usd",
      payment_method_types: ["card"],
      metadata: { recorder: "ibeji", case: "idempotency" },
    }),
    headers: { ...STRIPE_HEADERS, "idempotency-key": idempotencyKey },
  });

  await ctx.skip(
    "checkout",
    "Stripe has no local API for the Ibeji checkout page; checkout_session.create returns the hosted link and checkout_session.retrieve records the result",
  );
  await ctx.recordInvalidKey("payment_intent.list", {
    method: "GET",
    path: "/v1/payment_intents",
    query: { limit: 1 },
    headers: STRIPE_HEADERS,
  });
}
