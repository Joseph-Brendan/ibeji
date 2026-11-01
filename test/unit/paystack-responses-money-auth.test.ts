import { describe, expect, it } from "vitest";

import type { ActionDefinition, TwinRequest } from "../../src/twins/framework/types.js";
import { paystackAuth } from "../../src/twins/paystack/auth.js";
import { paystackMoney } from "../../src/twins/paystack/money.js";
import {
  duplicateReferenceResponse,
  invalidAmountResponse,
  invalidBodyResponse,
  invalidCallbackUrlResponse,
  invalidReferenceResponse,
  invalidTransactionIdResponse,
  missingAmountResponse,
  missingEmailResponse,
  paystackError,
  paystackResponses,
  rateLimitedResponse,
  serverErrorResponse,
  transactionNotFoundResponse,
  unauthorizedResponse,
  validationErrorResponse,
} from "../../src/twins/paystack/responses.js";

const action = {
  id: "transaction.initialize",
  method: "POST",
  path: "/transaction/initialize",
  summary: "Initialize a transaction",
  kind: "write",
  handler: () => {
    throw new Error("not called");
  },
} satisfies ActionDefinition;

function bodyOf(response: { readonly body: string | Uint8Array }): Record<string, unknown> {
  expect(typeof response.body).toBe("string");
  return JSON.parse(response.body as string) as Record<string, unknown>;
}

describe("Paystack response builders", () => {
  it("C4 copies the fixture-confirmed missing email error exactly", () => {
    expect(bodyOf(missingEmailResponse())).toEqual({
      status: false,
      message: "Email Address is required",
      meta: { nextStep: "Provide all required params " },
      type: "validation_error",
      code: "missing_params",
    });
  });

  it("C4 copies the fixture-confirmed verify and fetch errors exactly", () => {
    expect(bodyOf(invalidReferenceResponse())).toEqual({
      status: false,
      message: "Transaction reference not found.",
      meta: {
        nextStep:
          "Ensure that you're passing the reference of a transaction that exists on this integration",
      },
      type: "validation_error",
      code: "transaction_not_found",
    });
    expect(bodyOf(invalidTransactionIdResponse())).toEqual({
      status: false,
      message: "Transaction ID should be numeric.",
      meta: { nextStep: "Ensure that the value(s) you're passing are valid." },
      type: "validation_error",
      code: "invalid_params",
    });
  });

  it("C4 uses one Paystack error envelope for the remaining validation errors", () => {
    for (const response of [
      missingAmountResponse(),
      invalidAmountResponse(),
      invalidBodyResponse(),
      invalidCallbackUrlResponse(),
      duplicateReferenceResponse(),
      transactionNotFoundResponse(),
      validationErrorResponse("Bad value", "invalid_params"),
    ]) {
      const body = bodyOf(response);
      expect(body.status).toBe(false);
      expect(typeof body.message).toBe("string");
      expect(typeof body.meta).toBe("object");
      expect(body.type).toBe("validation_error");
      expect(typeof body.code).toBe("string");
    }
  });

  it("T4 builds Paystack-shaped 401, 429 and 5xx errors", () => {
    expect(bodyOf(unauthorizedResponse("No key"))).toMatchObject({
      status: false,
      message: "No key",
      type: "api_error",
      code: "unauthorized",
    });
    expect(bodyOf(rateLimitedResponse())).toMatchObject({
      status: false,
      message: "Too many requests",
      type: "api_error",
      code: "rate_limited",
    });
    expect(bodyOf(serverErrorResponse(503))).toMatchObject({
      status: false,
      message: "Server error",
      type: "api_error",
      code: "server_error",
    });
    expect(
      bodyOf(
        paystackError(418, "Teapot", {
          nextStep: "Try another pot.",
          type: "api_error",
          code: "teapot",
        }),
      ),
    ).toMatchObject({ status: false, message: "Teapot", code: "teapot" });
  });

  it("C4 builds the documented success messages", () => {
    for (const [id, message] of [
      ["transaction.initialize", "Authorization URL created"],
      ["transaction.verify", "Verification successful"],
      ["transaction.fetch", "Transaction retrieved"],
      ["transaction.list", "Transactions retrieved"],
      ["other", "Request successful"],
    ] as const) {
      const response = paystackResponses.success({ ...action, id }, { ok: true });
      expect(bodyOf(response).message).toBe(message);
    }
    expect(paystackResponses.created(action, { id: 1 }).status).toBe(201);
    expect(paystackResponses.success(action, { id: 1 }, { page: 1 }).status).toBe(200);
  });

  it("C4 maps generic failures without a body shape from the core", () => {
    for (const kind of [
      "invalid-request",
      "not-found",
      "unauthorized",
      "server",
      "rate-limited",
      "version-unsupported",
    ] as const) {
      const response = paystackResponses.error({ kind });
      const body = bodyOf(response);
      expect(body.status).toBe(false);
      expect(typeof body.code).toBe("string");
    }
    expect(
      paystackResponses.error({
        kind: "server",
        status: 503,
        message: "Overloaded",
        details: { nextStep: "Later", type: "api_error", code: "busy" },
      }).status,
    ).toBe(503);
    expect(bodyOf(paystackResponses.notFound()).code).toBe("not_found");
  });
});

describe("Paystack money", () => {
  it("C4 keeps API amounts as integer minor units", () => {
    expect(paystackMoney.parseServiceAmount("10000", "NGN")).toBe(10_000);
    expect(paystackMoney.parseServiceAmount("5000", "NGN")).toBe(5_000);
    expect(paystackMoney.formatServiceAmount(10_000, "NGN")).toBe("10000");
    expect(paystackMoney.formatDisplay(10_000, "NGN")).toBe("₦100.00");
    expect(paystackMoney.formatDisplay(500_000, "NGN")).toBe("₦5,000.00");
    expect(paystackMoney.formatDisplay(100, "USD")).toBe("$1.00");
    expect(paystackMoney.formatDisplay(100, "GHS")).toBe("₵1.00");
    expect(paystackMoney.formatDisplay(100, "ZAR")).toBe("R1.00");
    expect(paystackMoney.formatDisplay(100, "KES")).toBe("Ksh.1.00");
    expect(paystackMoney.formatDisplay(10_000, "XOF")).toBe("XOF 100");
    expect(paystackMoney.formatDisplay(100, "XYZ")).toBe("XYZ 1.00");
  });

  it("C4 rejects non-integer and invalid amounts", () => {
    expect(() => paystackMoney.parseServiceAmount("10.00", "NGN")).toThrow();
    expect(() => paystackMoney.parseServiceAmount("999999999999999999999", "NGN")).toThrow();
    expect(() => paystackMoney.assertValid(0, "NGN")).toThrow();
    expect(() => paystackMoney.assertValid(-1, "NGN")).toThrow();
    expect(() => paystackMoney.assertValid(1.5, "NGN")).toThrow();
    expect(paystackMoney.fractionDigits("XOF")).toBe(0);
    expect(paystackMoney.zeroDecimal).toEqual(["XOF"]);
  });
});

describe("Paystack authentication", () => {
  const requestWith = (authorization: string | undefined): TwinRequest => ({
    method: "GET",
    path: "/transaction",
    headers: authorization === undefined ? {} : { authorization },
    query: {},
    params: {},
    rawBody: new Uint8Array(),
  });

  it("C4 reads Bearer tokens and rejects malformed headers", () => {
    expect(paystackAuth.readKey(requestWith("Bearer sk_test_ibeji_abc"))).toBe("sk_test_ibeji_abc");
    expect(paystackAuth.readKey(requestWith("bearer sk_test_ibeji_abc"))).toBe("sk_test_ibeji_abc");
    expect(paystackAuth.readKey(requestWith("Basic abc"))).toBeNull();
    expect(paystackAuth.readKey(requestWith("Bearer "))).toBeNull();
    expect(paystackAuth.readKey(requestWith(undefined))).toBeNull();
  });

  it("C4 detects both Paystack live key prefixes", () => {
    expect(paystackAuth.isLiveKey(["sk", "live", "abc"].join("_"))).toBe(true);
    expect(paystackAuth.isLiveKey(["pk", "live", "abc"].join("_"))).toBe(true);
    expect(paystackAuth.isLiveKey("sk_test_abc")).toBe(false);
  });

  it("C4 accepts only the issued secret and shapes every failure as 401", () => {
    const credentials = { secret: "sk_test_ibeji_abc" };
    expect(paystackAuth.classify(null, credentials)).toEqual({ kind: "missing" });
    expect(paystackAuth.classify("sk_test_wrong", credentials)).toEqual({ kind: "wrong" });
    expect(paystackAuth.classify("sk_test_ibeji_abc", credentials)).toEqual({ kind: "valid" });
    for (const kind of ["missing", "wrong", "live"] as const) {
      const response = paystackAuth.unauthorized({ kind });
      expect(response.status).toBe(401);
      expect(bodyOf(response).code).toBe("unauthorized");
    }
  });
});
