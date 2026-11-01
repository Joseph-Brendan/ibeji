import type {
  ActionDefinition,
  JsonValue,
  ResponseBuilder,
  TwinFailure,
  TwinResponse,
} from "../framework/types.js";

export function jsonResponse(status: number, body: unknown): TwinResponse {
  return {
    status,
    headers: {},
    body: JSON.stringify(body),
    contentType: "application/json",
  };
}

export function flutterwaveError(
  status: number,
  message: string,
  data: JsonValue = null,
): TwinResponse {
  return jsonResponse(status, { status: "error", message, data });
}

export function flutterwaveSuccess(message: string, data: unknown, meta?: unknown): TwinResponse {
  return jsonResponse(200, {
    status: "success",
    message,
    ...(meta === undefined ? {} : { meta }),
    data,
  });
}

function messageFor(action: ActionDefinition): string {
  switch (action.id) {
    case "payment.create":
      return "Hosted Link";
    case "payment.verify":
    case "payment.verify_by_reference":
      return "Transaction fetched successfully";
    case "payment.list":
      return "Transactions fetched";
    case "refund.create":
      return "Transaction refund initiated";
    case "refund.fetch":
      return "Refund fetched";
    case "refund.list":
      return "Refunds fetched";
    default:
      return "Request successful";
  }
}

export const unauthorizedResponse = (message: string): TwinResponse =>
  flutterwaveError(401, message);

export const notFoundResponse = (): TwinResponse => flutterwaveError(404, "Not found");

export const invalidBodyResponse = (): TwinResponse => flutterwaveError(400, "Invalid JSON body");

export const paymentValidationError = (field: string, message: string): TwinResponse =>
  jsonResponse(400, {
    status: "error",
    errors: [{ field, message }],
    message: "One or more required parameters missing",
  });

export const paymentNotFoundResponse = (): TwinResponse =>
  flutterwaveError(400, "No transaction was found for this id");

export const duplicatePaymentReferenceResponse = (): TwinResponse =>
  flutterwaveError(400, "tx_ref has already been used");

export const invalidPaymentAmountResponse = (): TwinResponse =>
  flutterwaveError(400, "Amount should be a valid amount with at most 2 decimal places");

export const invalidRefundAmountResponse = (): TwinResponse =>
  flutterwaveError(400, "Amount should be a valid amount with at most 2 decimal places");

export const refundIntValidationResponse = (id: string): TwinResponse =>
  flutterwaveError(400, `Error: ${id} failed isInt validation`);

export const refundNotFoundResponse = (): TwinResponse =>
  flutterwaveError(400, "Error: Refund Id Not Found");

export const refundTransactionNotFoundResponse = (): TwinResponse =>
  flutterwaveError(400, "No transaction was found for this id");

export const refundTransactionNotSuccessfulResponse = (): TwinResponse =>
  flutterwaveError(400, "Transaction was not successful");

export const refundProcessingResponse = (): TwinResponse =>
  flutterwaveError(
    400,
    "Some error occured",
    "A partial refund is currently processing on this transaction. Please, try again in 2 mins.",
  );

export const refundMinimumResponse = (currency: string, minimum: number): TwinResponse =>
  flutterwaveError(400, `Amount should be above ${currency}${minimum}`);

export const refundExceedsTransactionResponse = (): TwinResponse =>
  flutterwaveError(400, "Amount should not be greater than the transaction amount");

export const refundExceedsRemainingResponse = (): TwinResponse =>
  flutterwaveError(400, "Amount should not be greater than the refundable amount");

export const refundFullyRefundedResponse = (): TwinResponse =>
  flutterwaveError(400, "Transaction has been fully refunded");

export const serverErrorResponse = (status: number): TwinResponse => {
  if (status === 500) {
    return jsonResponse(500, {
      error_id: "ERRNOIBEJI500",
      message: "Application error. Please contact support",
      code: "app_error",
    });
  }
  return flutterwaveError(status, "An error occurred. Please contact support");
};

export const rateLimitedResponse = (): TwinResponse => flutterwaveError(429, "Too many requests");

const defaultMessage = (failure: TwinFailure): string => {
  switch (failure.kind) {
    case "invalid-request":
      return "One or more required parameters missing";
    case "not-found":
      return "Not found";
    case "unauthorized":
      return "Authorization required";
    case "server":
      return "Application error. Please contact support";
    case "rate-limited":
      return "Too many requests";
    case "version-unsupported":
      return "Unsupported API version";
  }
};

export const flutterwaveResponses: ResponseBuilder = {
  success: (action, data, meta) => flutterwaveSuccess(messageFor(action), data, meta),
  created: (action, data) => flutterwaveSuccess(messageFor(action), data),
  error: (failure) => {
    switch (failure.kind) {
      case "server":
        return serverErrorResponse(failure.status ?? 500);
      case "rate-limited":
        return rateLimitedResponse();
      case "unauthorized":
        return unauthorizedResponse(failure.message ?? defaultMessage(failure));
      case "not-found":
        return notFoundResponse();
      case "invalid-request":
      case "version-unsupported":
        return flutterwaveError(failure.status ?? 400, failure.message ?? defaultMessage(failure));
    }
  },
  notFound: () => notFoundResponse(),
};
