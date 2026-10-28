import {
  encodeJson,
  extractServiceError,
  FAKE_EMAILS,
  makeReference,
  requireResponseField,
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

export const onlyActions = [
  "checkout.unpaid",
  "checkout.failed",
  "payment.create",
  "payment.list",
  "refund.list",
  "transfer.create",
  "transfer.list",
  "bank.list",
  "bank.resolve",
];

const SUCCESS_CARD = "5531 8866 5214 2950, CVV 564, expiry 09/32, PIN 3310, OTP 12345";
const FAILED_CARD = "5143 0105 2233 9965, CVV 276, expiry 08/32, PIN 3310, OTP 12345";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function makeCheckoutEmailPicker() {
  let index = 0;
  return () => FAKE_EMAILS[index++] ?? FAKE_EMAILS[FAKE_EMAILS.length - 1];
}

function makeActualStatusOutcome(stepLabel) {
  return async (result) => {
    const status = requireResponseField(result, stepLabel, "data.status", "string");
    console.log(`${stepLabel} status: ${status}.`);
    return status;
  };
}

function isTransferAccountLimit(result) {
  const { message = "", code = "" } = extractServiceError(result.responseBody);
  return /enable IP Whitelisting/i.test(message) || /ip[_-]?whitelist/i.test(code);
}

function isUnpaidNoTransaction(result) {
  const { message = "" } = extractServiceError(result.responseBody);
  return result.status === 400 && /No transaction was found for this id/i.test(message);
}

export async function record(ctx) {
  const nextEmail = makeCheckoutEmailPicker();
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
        email: nextEmail(),
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
      customer: { email: nextEmail() },
    }),
  });

  if (createPayment.ok) {
    const link = requireResponseField(createPayment, "payment.create", "data.link", "string");
    await ctx.promptCheckout({
      title: "Flutterwave test checkout",
      url: link,
      card: SUCCESS_CARD,
      extra: "Use the Mastercard test values shown above.",
    });
  } else {
    await ctx.skip("checkout", "payment.create did not return a successful response");
  }

  const verifyReference = await ctx.record({
    action: "payment.verify_by_reference",
    outcome: makeActualStatusOutcome("payment.verify_by_reference"),
    paymentStatusPath: "data.status",
    method: "GET",
    path: "/v3/transactions/verify_by_reference",
    query: { tx_ref: txRef },
  });
  await ctx.recordInvalid("payment.verify_by_reference", {
    method: "GET",
    path: "/v3/transactions/verify_by_reference",
    query: { tx_ref: "ibeji-invalid-reference" },
  });

  const transactionId = verifyReference.ok
    ? requireResponseField(verifyReference, "payment.verify_by_reference", "data.id", "number")
    : undefined;
  if (transactionId !== undefined) {
    await ctx.record({
      action: "payment.verify",
      outcome: makeActualStatusOutcome("payment.verify"),
      paymentStatusPath: "data.status",
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

  const unpaidRef = makeReference("ibeji-unpaid");
  const unpaidCreate = await ctx.record({
    action: "checkout.unpaid",
    fixtureAction: "payment.create",
    fileName: "payment-create-unpaid.json",
    method: "POST",
    path: "/v3/payments",
    body: encodeJson({
      amount: 7500,
      tx_ref: unpaidRef,
      currency: "NGN",
      redirect_url: "https://example.com/ibeji/flutterwave/unpaid",
      customer: {
        email: nextEmail(),
        name: "Test Customer",
      },
    }),
  });
  if (unpaidCreate.ok) {
    await ctx.record({
      action: "checkout.unpaid",
      fixtureAction: "payment.verify_by_reference",
      failureOutcome: "unpaid",
      failureMatches: isUnpaidNoTransaction,
      failureFileName: "payment-verify-by-reference-unpaid.json",
      outcome: makeActualStatusOutcome("checkout.unpaid (verify)"),
      paymentStatusPath: "data.status",
      method: "GET",
      path: "/v3/transactions/verify_by_reference",
      query: { tx_ref: unpaidRef },
    });
  } else {
    await ctx.skip("checkout.unpaid", "payment create did not return a successful response");
  }

  const failedRef = makeReference("ibeji-failed");
  const failedCreate = await ctx.record({
    action: "checkout.failed",
    fixtureAction: "payment.create",
    fileName: "payment-create-for-failed-checkout.json",
    method: "POST",
    path: "/v3/payments",
    body: encodeJson({
      amount: 7500,
      tx_ref: failedRef,
      currency: "NGN",
      redirect_url: "https://example.com/ibeji/flutterwave/failed",
      customer: {
        email: nextEmail(),
        name: "Test Customer",
      },
    }),
  });
  if (failedCreate.ok) {
    const link = requireResponseField(failedCreate, "checkout.failed", "data.link", "string");
    await ctx.promptCheckout({
      title: "Flutterwave failed-card checkout",
      url: link,
      card: FAILED_CARD,
      extra: "Use the failing Mastercard test values shown above. The PIN and OTP are required.",
    });
    await ctx.record({
      action: "checkout.failed",
      fixtureAction: "payment.verify_by_reference",
      outcome: makeActualStatusOutcome("checkout.failed (verify)"),
      paymentStatusPath: "data.status",
      method: "GET",
      path: "/v3/transactions/verify_by_reference",
      query: { tx_ref: failedRef },
    });
  } else {
    await ctx.skip("checkout.failed", "payment create did not return a successful response");
  }

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

  const refundId = refund?.ok
    ? requireResponseField(refund, "refund.create", "data.id", "number")
    : undefined;
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
    failureOutcome: "account-limit",
    failureMatches: isTransferAccountLimit,
    failureFileName: "transfer-create.account-limit.json",
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
  const accountLimit = !transfer.ok && isTransferAccountLimit(transfer);
  if (!accountLimit) {
    await ctx.recordInvalid("transfer.create", {
      method: "POST",
      path: "/v3/transfers",
      body: encodeJson({
        account_bank: "044",
        amount: 100,
        currency: "NGN",
      }),
    });
  }

  const transferId = transfer.ok
    ? requireResponseField(transfer, "transfer.create", "data.id", "number")
    : undefined;
  if (transferId !== undefined) {
    await ctx.record({
      action: "transfer.fetch",
      method: "GET",
      path: `/v3/transfers/${String(transferId)}`,
    });
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

  await ctx.recordInvalidKey("bank.list", {
    method: "GET",
    path: "/v3/banks/NG",
  });
}
