import { encodeJson, makeReference, responseData } from "./shared.mjs";

export const meta = {
  id: "paystack",
  displayName: "Paystack",
  envName: "PAYSTACK_TEST_SECRET_KEY",
  baseUrl: "https://api.paystack.co",
  requestFormat: "json",
  auth: "bearer",
  testKey: /^sk_test_[A-Za-z0-9._~+/=-]+$/,
  liveKeys: [/^(?:pk|sk)_live_[A-Za-z0-9._~+/=-]+$/],
  keyPatterns: [/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9._~+/=-]+\b/g],
  preflight: {
    method: "GET",
    path: "/transaction",
    query: { perPage: 50, page: 1 },
  },
  isSuccess(status, body) {
    return (
      status >= 200 &&
      status < 300 &&
      body !== null &&
      typeof body === "object" &&
      body.status === true
    );
  },
};

const EMAIL = "recorder@ibeji.test";

export async function record(ctx) {
  // Paystack transaction references allow only "-", ".", "=" and alphanumeric
  // characters (research/paystack.md section 1.1), so use hyphens here.
  const reference = makeReference("ibeji", "-");

  const initialize = await ctx.record({
    action: "transaction.initialize",
    method: "POST",
    path: "/transaction/initialize",
    body: encodeJson({
      amount: "10000",
      email: EMAIL,
      currency: "NGN",
      reference,
      callback_url: "https://example.com/ibeji/paystack",
      metadata: JSON.stringify({ recorder: "ibeji" }),
    }),
  });
  await ctx.recordInvalid("transaction.initialize", {
    method: "POST",
    path: "/transaction/initialize",
    body: encodeJson({ amount: "10000", currency: "NGN" }),
  });

  const initializeData = responseData(initialize);
  const authorizationUrl =
    initializeData !== null && typeof initializeData === "object"
      ? initializeData.authorization_url
      : undefined;
  if (typeof authorizationUrl === "string") {
    await ctx.promptCheckout({
      title: "Paystack test checkout",
      url: authorizationUrl,
      card: "4084 0840 8408 4081, CVV 408, expiry 10/27",
      extra:
        "The card has no PIN or OTP. Pay any amount; the recorder verifies the result afterward.",
    });
  } else {
    await ctx.skip("checkout", "transaction.initialize did not return data.authorization_url");
  }

  const verify = await ctx.record({
    action: "transaction.verify",
    method: "GET",
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
  });
  await ctx.recordInvalid("transaction.verify", {
    method: "GET",
    path: "/transaction/verify/ibeji-invalid-reference",
  });

  const verifyData = responseData(verify);
  const transactionId =
    verifyData !== null && typeof verifyData === "object" ? verifyData.id : undefined;
  if (transactionId !== undefined) {
    await ctx.record({
      action: "transaction.fetch",
      method: "GET",
      path: `/transaction/${String(transactionId)}`,
    });
  } else {
    await ctx.skip("transaction.fetch", "transaction.verify did not return data.id");
  }
  await ctx.recordInvalid("transaction.fetch", {
    method: "GET",
    path: "/transaction/not-a-number",
  });

  await ctx.record({
    action: "transaction.list",
    method: "GET",
    path: "/transaction",
    query: { perPage: 5, page: 1 },
  });
  await ctx.recordInvalid("transaction.list", {
    method: "GET",
    path: "/transaction",
    query: { page: "not-a-number" },
  });

  const refund = await ctx.record({
    action: "refund.create",
    method: "POST",
    path: "/refund",
    body: encodeJson({ transaction: reference }),
  });
  await ctx.recordInvalid("refund.create", {
    method: "POST",
    path: "/refund",
    body: encodeJson({ transaction: "ibeji-invalid-transaction" }),
  });

  const refundData = responseData(refund);
  const refundId =
    refundData !== null && typeof refundData === "object" ? refundData.id : undefined;
  if (refundId !== undefined) {
    await ctx.record({
      action: "refund.fetch",
      method: "GET",
      path: `/refund/${String(refundId)}`,
    });
  } else {
    await ctx.skip("refund.fetch", "refund.create did not return data.id");
  }
  await ctx.recordInvalid("refund.fetch", {
    method: "GET",
    path: "/refund/not-a-number",
  });

  await ctx.record({
    action: "refund.list",
    method: "GET",
    path: "/refund",
    query: { perPage: 5, page: 1 },
  });
  await ctx.recordInvalid("refund.list", {
    method: "GET",
    path: "/refund",
    query: { page: "not-a-number" },
  });

  const recipient = await ctx.record({
    action: "transfer_recipient.create",
    method: "POST",
    path: "/transferrecipient",
    body: encodeJson({
      type: "nuban",
      name: "Test Recipient",
      account_number: "0000000000",
      bank_code: "057",
      currency: "NGN",
    }),
  });
  await ctx.recordInvalid("transfer_recipient.create", {
    method: "POST",
    path: "/transferrecipient",
    body: encodeJson({ type: "nuban", name: "Test Recipient" }),
  });

  const recipientData = responseData(recipient);
  const recipientCode =
    recipientData !== null && typeof recipientData === "object"
      ? recipientData.recipient_code
      : undefined;
  let transfer = null;
  if (typeof recipientCode === "string") {
    transfer = await ctx.record({
      action: "transfer.create",
      method: "POST",
      path: "/transfer",
      body: encodeJson({
        source: "balance",
        amount: 100,
        recipient: recipientCode,
        reference: makeReference("ibeji"),
        reason: "Ibeji recorder",
        currency: "NGN",
      }),
    });
  } else {
    await ctx.skip(
      "transfer.create",
      "transfer_recipient.create did not return data.recipient_code",
    );
  }
  await ctx.recordInvalid("transfer.create", {
    method: "POST",
    path: "/transfer",
    body: encodeJson({ source: "balance", amount: 100 }),
  });

  const transferData = transfer === null ? undefined : responseData(transfer);
  const transferId =
    transferData !== null && typeof transferData === "object" ? transferData.id : undefined;
  if (transferId !== undefined) {
    await ctx.record({
      action: "transfer.fetch",
      method: "GET",
      path: `/transfer/${String(transferId)}`,
    });
  } else {
    await ctx.skip("transfer.fetch", "transfer.create did not return data.id");
  }
  await ctx.recordInvalid("transfer.fetch", {
    method: "GET",
    path: "/transfer/not-a-transfer",
  });

  const transferReference =
    transferData !== null && typeof transferData === "object" ? transferData.reference : undefined;
  if (typeof transferReference === "string") {
    await ctx.record({
      action: "transfer.verify",
      method: "GET",
      path: `/transfer/verify/${encodeURIComponent(transferReference)}`,
    });
  } else {
    await ctx.skip("transfer.verify", "transfer.create did not return data.reference");
  }
  await ctx.recordInvalid("transfer.verify", {
    method: "GET",
    path: "/transfer/verify/ibeji-invalid-reference",
  });

  await ctx.record({
    action: "bank.list",
    method: "GET",
    path: "/bank",
    query: { country: "nigeria" },
  });
  await ctx.recordInvalid("bank.list", {
    method: "GET",
    path: "/bank",
    query: { country: "not-a-country" },
  });

  await ctx.record({
    action: "bank.resolve",
    method: "GET",
    path: "/bank/resolve",
    query: { account_number: "0000000000", bank_code: "057" },
  });
  await ctx.recordInvalid("bank.resolve", {
    method: "GET",
    path: "/bank/resolve",
    query: { account_number: "not-an-account", bank_code: "057" },
  });

  await ctx.skip(
    "checkout",
    "Paystack has no create-checkout-page API; transaction.initialize returns the hosted link and transaction.verify records the result",
  );
  await ctx.recordInvalidKey("bank.list", {
    method: "GET",
    path: "/bank",
    query: { country: "nigeria" },
  });
}
