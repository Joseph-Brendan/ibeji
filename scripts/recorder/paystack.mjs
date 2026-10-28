import {
  encodeJson,
  extractServiceError,
  makeReference,
  RECORDER_EMAIL,
  RecorderStopError,
  requireResponseField,
} from "./shared.mjs";

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
  isKeyError(status, body) {
    if (status !== 401 && status !== 403) {
      return false;
    }
    const { message = "", code = "" } = extractServiceError(body);
    return (
      /key|auth/i.test(code) ||
      /invalid (api )?key|unauthori[sz]ed|authorization required/i.test(message)
    );
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

const EMAIL = RECORDER_EMAIL;
const SUCCESS_CARD = "4084 0840 8408 4081, CVV 408, expiry 10/27 (no PIN or OTP)";
const DECLINED_CARD = "4084 0800 0000 5408, CVV 001, expiry 10/27 (declines)";

class RetryCheckoutSignal extends Error {
  constructor() {
    super("retry checkout with a new payment link");
    this.name = "RetryCheckoutSignal";
  }
}

function statusMatchesExpected(expectedStatus, actualStatus) {
  if (expectedStatus === "success") {
    return actualStatus === "success";
  }
  if (expectedStatus === "declined") {
    return actualStatus === "failed" || actualStatus === "declined";
  }
  return false;
}

function makeActualStatusOutcome(stepLabel) {
  return async (result) => {
    const status = requireResponseField(result, stepLabel, "data.status", "string");
    console.log(`${stepLabel} status: ${status}.`);
    return status;
  };
}

function makeExpectedStatusOutcome(ctx, expectedStatus, stepLabel) {
  return async (result) => {
    const actualStatus = requireResponseField(result, stepLabel, "data.status", "string");
    if (statusMatchesExpected(expectedStatus, actualStatus)) {
      console.log(`${stepLabel} status: ${actualStatus}.`);
      return actualStatus;
    }

    for (;;) {
      console.log(`Expected status: ${expectedStatus}. Paystack returned: ${actualStatus}.`);
      const answer = await ctx.ask(
        "Type r to retry with a new payment link, s to save it under its real status and continue, or q to stop: ",
      );
      const choice = answer.trim().toLowerCase();
      if (choice === "s") {
        return actualStatus;
      }
      if (choice === "r") {
        throw new RetryCheckoutSignal();
      }
      if (choice === "q") {
        throw new RecorderStopError(
          `Recorder stopped at the payment status prompt for ${stepLabel}. ` +
            `Expected status: ${expectedStatus}. Paystack returned: ${actualStatus}. ` +
            `What: you chose q, so the recorder stopped. ` +
            `Why: the payment did not end in the expected status. ` +
            `Fix: run the recorder again when you are ready to retry or save the real status.`,
        );
      }
      console.log("Please type r, s, or q, then press Enter.");
    }
  };
}

function isTransferUnavailable(result) {
  const { message = "", code = "" } = extractServiceError(result.responseBody);
  return code === "transfer_unavailable" || /starter business/i.test(message);
}

async function initializeTransaction(ctx, outcome, stepLabel) {
  const reference = makeReference("ibeji", "-");
  const result = await ctx.record({
    action: "transaction.initialize",
    outcome,
    stepLabel,
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
  return { reference, result };
}

async function verifyTransaction(ctx, reference, outcome, stepLabel) {
  return ctx.record({
    action: "transaction.verify",
    outcome,
    stepLabel,
    paymentStatusPath: "data.status",
    method: "GET",
    path: `/transaction/verify/${encodeURIComponent(reference)}`,
  });
}

async function runExpectedCheckout(ctx, initial, options) {
  let current = initial;
  let retryCount = 0;

  for (;;) {
    if (!current.result.ok) {
      throw new RecorderStopError(
        `${options.title} could not start because transaction.initialize did not succeed. ` +
          `What: the recorder stopped before the checkout. ` +
          `Why: transaction.initialize did not return a successful Paystack response. ` +
          `Fix: check the saved transaction.initialize fixture, then run the recorder again.`,
      );
    }
    const authorizationUrl = requireResponseField(
      current.result,
      "transaction.initialize",
      "data.authorization_url",
      "string",
    );
    await ctx.promptCheckout({
      title: options.title,
      url: authorizationUrl,
      card: options.card,
      extra: options.extra,
    });

    try {
      const verify = await verifyTransaction(
        ctx,
        current.reference,
        makeExpectedStatusOutcome(ctx, options.expectedStatus, options.stepLabel),
        options.stepLabel,
      );
      return { current, verify };
    } catch (error) {
      if (error instanceof RetryCheckoutSignal) {
        retryCount += 1;
        current = await initializeTransaction(
          ctx,
          options.retryOutcome(retryCount),
          options.retryStepLabel(retryCount),
        );
        continue;
      }
      throw error;
    }
  }
}

export async function record(ctx) {
  // Paystack transaction references allow only "-", ".", "=" and alphanumeric
  // characters (research/paystack.md section 1.1), so use hyphens here.
  const main = await initializeTransaction(ctx, undefined, "transaction.initialize (main)");
  let mainReference = main.reference;

  await ctx.recordInvalid("transaction.initialize", {
    method: "POST",
    path: "/transaction/initialize",
    body: encodeJson({ amount: "10000", currency: "NGN" }),
  });

  let verify = null;
  if (main.result.ok) {
    const mainRun = await runExpectedCheckout(ctx, main, {
      title: "Paystack test checkout",
      card: SUCCESS_CARD,
      extra:
        "The card has no PIN or OTP. Pay any amount; the recorder verifies the result afterward.",
      expectedStatus: "success",
      stepLabel: "transaction.verify (success checkout)",
      retryOutcome: (attempt) => (attempt === 1 ? "retry" : `retry-${attempt}`),
      retryStepLabel: (attempt) => `transaction.initialize (retry ${attempt})`,
    });
    mainReference = mainRun.current.reference;
    verify = mainRun.verify;
  } else {
    await ctx.skip(
      "transaction.verify",
      "transaction.initialize did not succeed, so there was no checkout to verify",
    );
  }

  await ctx.recordInvalid("transaction.verify", {
    method: "GET",
    path: "/transaction/verify/ibeji-invalid-reference",
  });

  if (verify?.ok) {
    const transactionId = requireResponseField(
      verify,
      "transaction.verify (success checkout)",
      "data.id",
      "number",
    );
    await ctx.record({
      action: "transaction.fetch",
      method: "GET",
      path: `/transaction/${String(transactionId)}`,
    });
  } else {
    await ctx.skip("transaction.fetch", "transaction.verify did not return a successful response");
  }
  await ctx.recordInvalid("transaction.fetch", {
    method: "GET",
    path: "/transaction/not-a-number",
  });

  const unpaid = await initializeTransaction(ctx, "unpaid", "transaction.initialize (unpaid)");
  if (unpaid.result.ok) {
    await verifyTransaction(
      ctx,
      unpaid.reference,
      makeActualStatusOutcome("transaction.verify (unpaid)"),
      "transaction.verify (unpaid)",
    );
  } else {
    await ctx.skip("transaction.verify", "unpaid transaction.initialize did not succeed");
  }

  const declined = await initializeTransaction(
    ctx,
    "declined",
    "transaction.initialize (declined)",
  );
  if (declined.result.ok) {
    await runExpectedCheckout(ctx, declined, {
      title: "Paystack declined-card checkout",
      card: DECLINED_CARD,
      extra:
        "Use the declining test card shown above. The verify result is saved under its real status.",
      expectedStatus: "declined",
      stepLabel: "transaction.verify (declined checkout)",
      retryOutcome: (attempt) => (attempt === 1 ? "declined-retry" : `declined-retry-${attempt}`),
      retryStepLabel: (attempt) => `transaction.initialize (declined retry ${attempt})`,
    });
  } else {
    await ctx.skip("transaction.verify", "declined transaction.initialize did not succeed");
  }

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
    body: encodeJson({ transaction: mainReference }),
  });
  await ctx.recordInvalid("refund.create", {
    method: "POST",
    path: "/refund",
    body: encodeJson({ transaction: "ibeji-invalid-transaction" }),
  });

  if (refund.ok) {
    const refundId = requireResponseField(refund, "refund.create", "data.id", "number");
    await ctx.record({
      action: "refund.fetch",
      method: "GET",
      path: `/refund/${String(refundId)}`,
    });
  } else {
    await ctx.skip("refund.fetch", "refund.create did not return a successful response");
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

  const recipientCode = recipient.ok
    ? requireResponseField(recipient, "transfer_recipient.create", "data.recipient_code", "string")
    : undefined;
  let transfer = null;
  if (typeof recipientCode === "string") {
    transfer = await ctx.record({
      action: "transfer.create",
      failureOutcome: "account-limit",
      failureMatches: isTransferUnavailable,
      failureFileName: "transfer-create.account-limit.json",
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
    await ctx.skip("transfer.create", "transfer_recipient.create did not return recipient_code");
  }
  await ctx.recordInvalid("transfer.create", {
    method: "POST",
    path: "/transfer",
    body: encodeJson({ source: "balance", amount: 100 }),
  });

  if (transfer?.ok) {
    const transferId = requireResponseField(transfer, "transfer.create", "data.id", "number");
    const transferReference = requireResponseField(
      transfer,
      "transfer.create",
      "data.reference",
      "string",
    );
    await ctx.record({
      action: "transfer.fetch",
      method: "GET",
      path: `/transfer/${String(transferId)}`,
    });
    await ctx.recordInvalid("transfer.fetch", {
      method: "GET",
      path: "/transfer/not-a-transfer",
    });
    await ctx.record({
      action: "transfer.verify",
      method: "GET",
      path: `/transfer/verify/${encodeURIComponent(transferReference)}`,
    });
    await ctx.recordInvalid("transfer.verify", {
      method: "GET",
      path: "/transfer/verify/ibeji-invalid-reference",
    });
  } else {
    const reason =
      "transfer.create is documentation-only: Paystack returned transfer_unavailable (account limit)";
    await ctx.skip("transfer.fetch", reason);
    await ctx.skip("transfer.verify", reason);
  }

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

  await ctx.recordInvalidKey("bank.list", {
    method: "GET",
    path: "/bank",
    query: { country: "nigeria" },
  });
}
