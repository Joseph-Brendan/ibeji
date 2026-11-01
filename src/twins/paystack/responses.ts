import type { ActionDefinition, JsonValue, TwinFailure, TwinResponse } from "../framework/types.js";

export const PAYSTACK_CONTENT_TYPE = "application/json; charset=utf-8";

function json(status: number, body: unknown): TwinResponse {
  return {
    status,
    headers: {},
    body: JSON.stringify(body),
    contentType: PAYSTACK_CONTENT_TYPE,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type PaystackErrorDetails = {
  readonly nextStep: string;
  readonly type: string;
  readonly code: string;
};

function detailsOf(value: JsonValue | undefined): Partial<PaystackErrorDetails> {
  if (!isRecord(value)) {
    return {};
  }
  const details: {
    nextStep?: string;
    type?: string;
    code?: string;
  } = {};
  if (typeof value.nextStep === "string") {
    details.nextStep = value.nextStep;
  }
  if (typeof value.type === "string") {
    details.type = value.type;
  }
  if (typeof value.code === "string") {
    details.code = value.code;
  }
  return details;
}

export function paystackError(
  status: number,
  message: string,
  details: PaystackErrorDetails,
): TwinResponse {
  return json(status, {
    status: false,
    message,
    meta: {
      nextStep: details.nextStep,
    },
    type: details.type,
    code: details.code,
  });
}

export function paystackSuccess(message: string, data: unknown, meta?: unknown): TwinResponse {
  return json(200, {
    status: true,
    message,
    data,
    ...(meta === undefined ? {} : { meta }),
  });
}

function messageFor(action: ActionDefinition): string {
  switch (action.id) {
    case "transaction.initialize":
      return "Authorization URL created";
    case "transaction.verify":
      return "Verification successful";
    case "transaction.fetch":
      return "Transaction retrieved";
    case "transaction.list":
      return "Transactions retrieved";
    case "refund.create":
      return "Refund has been queued for processing";
    case "refund.fetch":
      return "Refund retrieved";
    case "refund.list":
      return "Refunds retrieved";
    default:
      return "Request successful";
  }
}

function defaultCode(failure: TwinFailure): string {
  switch (failure.kind) {
    case "unauthorized":
      return "unauthorized";
    case "not-found":
      return "transaction_not_found";
    case "server":
      return "server_error";
    case "rate-limited":
      return "rate_limited";
    case "version-unsupported":
      return "invalid_params";
    case "invalid-request":
      return "invalid_params";
  }
}

function defaultMessage(failure: TwinFailure): string {
  switch (failure.kind) {
    case "unauthorized":
      return "Unauthorized";
    case "not-found":
      return "Not found";
    case "server":
      return "Server error";
    case "rate-limited":
      return "Too many requests";
    case "version-unsupported":
      return "Unsupported version";
    case "invalid-request":
      return "Invalid request";
  }
}

function defaultNextStep(failure: TwinFailure): string {
  switch (failure.kind) {
    case "unauthorized":
      return "Provide a valid Paystack test secret key.";
    case "not-found":
      return "Check the identifier and try again.";
    case "server":
      return "Try again later.";
    case "rate-limited":
      return "Wait a moment and try again.";
    case "version-unsupported":
      return "Use a supported API version.";
    case "invalid-request":
      return "Ensure that the value(s) you're passing are valid.";
  }
}

export const paystackResponses = {
  success: (action: ActionDefinition, data: unknown, meta?: unknown): TwinResponse =>
    paystackSuccess(messageFor(action), data, meta),
  created: (action: ActionDefinition, data: unknown): TwinResponse =>
    json(201, {
      status: true,
      message: messageFor(action),
      data,
    }),
  error: (failure: TwinFailure): TwinResponse => {
    const details = detailsOf(failure.details);
    return paystackError(failure.status ?? 500, failure.message ?? defaultMessage(failure), {
      nextStep: details.nextStep ?? defaultNextStep(failure),
      type:
        details.type ??
        (failure.kind === "invalid-request" || failure.kind === "not-found"
          ? "validation_error"
          : "api_error"),
      code: details.code ?? defaultCode(failure),
    });
  },
  notFound: (): TwinResponse =>
    paystackError(404, "Not found", {
      nextStep: "Check the URL and try again.",
      type: "api_error",
      code: "not_found",
    }),
};

export const missingEmailResponse = (): TwinResponse =>
  paystackError(400, "Email Address is required", {
    nextStep: "Provide all required params ",
    type: "validation_error",
    code: "missing_params",
  });

export const missingAmountResponse = (): TwinResponse =>
  paystackError(400, "Amount is required", {
    nextStep: "Provide all required params ",
    type: "validation_error",
    code: "missing_params",
  });

export const invalidAmountResponse = (): TwinResponse =>
  paystackError(400, "Amount should be a valid integer", {
    nextStep: "Ensure that the value(s) you're passing are valid.",
    type: "validation_error",
    code: "invalid_params",
  });

export const invalidReferenceResponse = (): TwinResponse =>
  paystackError(400, "Transaction reference not found.", {
    nextStep:
      "Ensure that you're passing the reference of a transaction that exists on this integration",
    type: "validation_error",
    code: "transaction_not_found",
  });

export const invalidTransactionIdResponse = (): TwinResponse =>
  paystackError(400, "Transaction ID should be numeric.", {
    nextStep: "Ensure that the value(s) you're passing are valid.",
    type: "validation_error",
    code: "invalid_params",
  });

export const transactionNotFoundResponse = (): TwinResponse =>
  paystackError(400, "Transaction not found", {
    nextStep: "Check the transaction ID and try again.",
    type: "validation_error",
    code: "transaction_not_found",
  });

export const unauthorizedResponse = (reason: string): TwinResponse =>
  paystackError(401, reason, {
    nextStep: "Use the Paystack test secret key issued by Ibeji.",
    type: "api_error",
    code: "unauthorized",
  });

export const serverErrorResponse = (status: number): TwinResponse =>
  paystackError(status, "Server error", {
    nextStep: "Try again later.",
    type: "api_error",
    code: "server_error",
  });

export const rateLimitedResponse = (): TwinResponse =>
  paystackError(429, "Too many requests", {
    nextStep: "Wait a moment and try again.",
    type: "api_error",
    code: "rate_limited",
  });

export const duplicateReferenceResponse = (): TwinResponse =>
  paystackError(400, "Transaction reference already exists", {
    nextStep: "Use a unique transaction reference.",
    type: "validation_error",
    code: "duplicate_reference",
  });

export const invalidCallbackUrlResponse = (): TwinResponse =>
  paystackError(400, "Callback URL is invalid", {
    nextStep: "Provide a fully qualified http or https URL.",
    type: "validation_error",
    code: "invalid_params",
  });

export const invalidBodyResponse = (): TwinResponse =>
  paystackError(400, "Invalid JSON body", {
    nextStep: "Send a JSON object in the request body.",
    type: "validation_error",
    code: "invalid_params",
  });

export function validationErrorResponse(message: string, code: string): TwinResponse {
  return paystackError(400, message, {
    nextStep: "Ensure that the value(s) you're passing are valid.",
    type: "validation_error",
    code,
  });
}

export const refundTransactionNotFoundResponse = (): TwinResponse =>
  paystackError(400, "Transaction not found", {
    nextStep: "Ensure the transaction reference or ID is correct",
    type: "validation_error",
    code: "transaction_not_found",
  });

export const refundTransactionRequiredResponse = (): TwinResponse =>
  paystackError(400, "Transaction is required", {
    nextStep: "Provide the transaction reference or ID.",
    type: "validation_error",
    code: "missing_params",
  });

export const refundTransactionNotSuccessfulResponse = (): TwinResponse =>
  paystackError(400, "Transaction has not been successful", {
    nextStep: "Only successful transactions can be refunded.",
    type: "validation_error",
    code: "transaction_not_successful",
  });

export const refundAmountExceedsPaidResponse = (): TwinResponse =>
  paystackError(400, "Refund amount cannot exceed the transaction amount", {
    nextStep: "Use an amount no larger than the amount paid.",
    type: "validation_error",
    code: "amount_exceeds_transaction_amount",
  });

export const refundAmountExceedsRemainingResponse = (): TwinResponse =>
  paystackError(400, "Refund amount exceeds the remaining refundable amount", {
    nextStep: "Use the remaining amount or less.",
    type: "validation_error",
    code: "refund_amount_exceeds_remaining",
  });

export const refundFullyRefundedResponse = (): TwinResponse =>
  paystackError(400, "Transaction has already been fully refunded", {
    nextStep: "Create a new payment before refunding again.",
    type: "validation_error",
    code: "transaction_fully_refunded",
  });

export const invalidRefundIdResponse = (): TwinResponse =>
  paystackError(401, "Please provide a valid refund ID. ID should be a valid integer", {
    nextStep: "Provide all required params ",
    type: "validation_error",
    code: "missing_params",
  });

export const refundNotFoundResponse = (): TwinResponse =>
  paystackError(404, "Refund not found", {
    nextStep: "Check the refund ID and try again.",
    type: "validation_error",
    code: "refund_not_found",
  });
