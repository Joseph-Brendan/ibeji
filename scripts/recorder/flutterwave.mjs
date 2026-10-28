import {
  encodeJson,
  extractServiceError,
  makeReference,
  RECORDER_EMAIL,
  responseData,
} from "./shared.mjs";

export const meta = {
  id: "flutterwave",
  displayName: "Flutterwave",
  envName: "FLUTTERWAVE_TEST_SECRET_KEY",
  baseUrl: "https://api.flutterwave.com",
  requestFormat: "json",
  auth: "bearer",
  testKey: /^FLWSECK_TEST-[A-Za-z0-9._~+/=-]+$/,
  liveKeys: [/^FLWSECK-(?!TEST-)[A-Za-z0-9._~+/=-]+$/, /^FLWPUBK-[A-Za-z0-9._~+/=-]+$/],
  keyPatterns: [/\bFLW(?:PUBK|SECK)(?:_TEST)?-[A-Za-z0-9._~+/=-]+\b/g],
  preflight: {
    method: "GET",
    path: "/v3/transfers",
    query: { page: "1", page_size: "10" },
  },
  isKeyError(status, body) {
    if (status !== 401 && status !== 403) {
      return false;
    }
    const { message = "" } = extractServiceError(body);
    return /^authorization required$/i.test(message.trim());
  },
  isSuccess(status, body) {
    return (
      status >= 200 &&
      status < 300 &&
      body !== null &&
      typeof body === "object" &&
      body.status !== "error"
    );
  },
};

const EMAIL = RECORDER_EMAIL;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function record(ctx) {
  const txRef = makeReference("ibeji");

  const createPayment = await ctx.record({
    action: "payment.create",
    method: "POST",
    path: "/v3/payments",
    body: encodeJson({
      amount: 7500,
      tx_ref: txRef,
      currency: "NGN",
      redirect_url: "https://example.com/ibeji/flutterwave",
      customer: {
        email: EMAIL,
        name: "Test Customer",
      },
    }),
  });
  await ctx.recordInvalid("payment.create", {
    method: "POST",
    path: "/v3/payments",
    body: encodeJson({
      tx_ref: txRef,
      currency: "NGN",
      customer: { email: EMAIL },
    }),
  });

  const createData = responseData(createPayment);
  const link = createData !== null && typeof createData === "object" ? createData.link : undefined;
  if (typeof link === "string") {
    await ctx.promptCheckout({
      title: "Flutterwave test checkout",
      url: link,
      card: "5531 8866 5214 2950, CVV 564, expiry 09/32, PIN 3310, OTP 12345",
      extra: "Use the Mastercard test values shown above.",
    });
  } else {
    await ctx.skip("checkout", "payment.create did not return data.link");
  }

  const verifyReference = await ctx.record({
    action: "payment.verify_by_reference",
    method: "GET",
    path: "/v3/transactions/verify_by_reference",
    query: { tx_ref: txRef },
  });
  await ctx.recordInvalid("payment.verify_by_reference", {
    method: "GET",
    path: "/v3/transactions/verify_by_reference",
    query: { tx_ref: "ibeji-invalid-reference" },
  });

  const verifyReferenceData = responseData(verifyReference);
  const transactionId =
    verifyReferenceData !== null && typeof verifyReferenceData === "object"
      ? verifyReferenceData.id
      : undefined;
  if (transactionId !== undefined) {
    await ctx.record({
      action: "payment.verify",
      method: "GET",
      path: `/v3/transactions/${String(transactionId)}/verify`,
    });
  } else {
    await ctx.skip("payment.verify", "payment.verify_by_reference did not return data.id");
  }
  await ctx.recordInvalid("payment.verify", {
    method: "GET",
    path: "/v3/transactions/not-a-number/verify",
  });

  await ctx.record({
    action: "payment.list",
    method: "GET",
    path: "/v3/transactions",
    query: { from: today(), to: today(), page: 1 },
  });
  await ctx.recordInvalid("payment.list", {
    method: "GET",
    path: "/v3/transactions",
    query: { from: today(), to: today(), page: "not-a-number" },
  });

  let refund = null;
  if (transactionId !== undefined) {
    refund = await ctx.record({
      action: "refund.create",
      method: "POST",
      path: `/v3/transactions/${String(transactionId)}/refund`,
      body: encodeJson({ amount: 100 }),
    });
    await ctx.recordInvalid("refund.create", {
      method: "POST",
      path: `/v3/transactions/${String(transactionId)}/refund`,
      body: encodeJson({ amount: 1 }),
    });
  } else {
    await ctx.skip("refund.create", "transaction id is unavailable");
    await ctx.recordInvalid("refund.create", {
      method: "POST",
      path: "/v3/transactions/not-a-number/refund",
      body: encodeJson({ amount: 1 }),
    });
  }

  const refundData = refund === null ? undefined : responseData(refund);
  const refundId =
    refundData !== null && typeof refundData === "object" ? refundData.id : undefined;
  if (refundId !== undefined) {
    await ctx.record({
      action: "refund.fetch",
      method: "GET",
      path: `/v3/refunds/${String(refundId)}`,
    });
  } else {
    await ctx.skip("refund.fetch", "refund.create did not return data.id");
  }
  await ctx.recordInvalid("refund.fetch", {
    method: "GET",
    path: "/v3/refunds/not-a-number",
  });

  await ctx.record({
    action: "refund.list",
    method: "GET",
    path: "/v3/refunds",
    query: { from: today(), to: today() },
  });
  await ctx.recordInvalid("refund.list", {
    method: "GET",
    path: "/v3/refunds",
    query: { from: "not-a-date", to: today() },
  });

  const transfer = await ctx.record({
    action: "transfer.create",
    method: "POST",
    path: "/v3/transfers",
    body: encodeJson({
      account_bank: "044",
      account_number: "0690000031",
      amount: 100,
      currency: "NGN",
      narration: "Ibeji recorder",
      reference: makeReference("ibeji"),
    }),
  });
  await ctx.recordInvalid("transfer.create", {
    method: "POST",
    path: "/v3/transfers",
    body: encodeJson({
      account_bank: "044",
      amount: 100,
      currency: "NGN",
    }),
  });

  const transferData = responseData(transfer);
  const transferId =
    transferData !== null && typeof transferData === "object" ? transferData.id : undefined;
  if (transferId !== undefined) {
    await ctx.record({
      action: "transfer.fetch",
      method: "GET",
      path: `/v3/transfers/${String(transferId)}`,
    });
  } else {
    await ctx.skip("transfer.fetch", "transfer.create did not return data.id");
  }
  await ctx.recordInvalid("transfer.fetch", {
    method: "GET",
    path: "/v3/transfers/not-a-number",
  });

  await ctx.record({
    action: "transfer.list",
    method: "GET",
    path: "/v3/transfers",
    query: { page: 1 },
  });
  await ctx.recordInvalid("transfer.list", {
    method: "GET",
    path: "/v3/transfers",
    query: { page: "not-a-number" },
  });

  await ctx.record({
    action: "bank.list",
    method: "GET",
    path: "/v3/banks/NG",
  });
  await ctx.recordInvalid("bank.list", {
    method: "GET",
    path: "/v3/banks/INVALID",
  });

  await ctx.record({
    action: "bank.resolve",
    method: "POST",
    path: "/v3/accounts/resolve",
    body: encodeJson({ account_number: "0690000031", account_bank: "044" }),
  });
  await ctx.recordInvalid("bank.resolve", {
    method: "POST",
    path: "/v3/accounts/resolve",
    body: encodeJson({ account_number: "not-an-account", account_bank: "044" }),
  });

  await ctx.skip(
    "checkout",
    "Flutterwave has no checkout-page API; payment.create returns the hosted link and the verify actions record the result",
  );
  await ctx.recordInvalidKey("bank.list", {
    method: "GET",
    path: "/v3/banks/NG",
  });
}
