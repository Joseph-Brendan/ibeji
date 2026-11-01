import type { ActionContext, ActionDefinition } from "../framework/types.js";
import { accountNameFor, bankIdFor, isKnownBankCode, listBanks } from "./banks.js";
import {
  bankResolveFailedResponse,
  bankResolveTimeoutResponse,
  invalidAccountNumberResponse,
  invalidBankCodeResponse,
  paystackResponses,
} from "./responses.js";

function queryString(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function listBankAction(context: ActionContext) {
  const country = queryString(context.request.query.country);
  return paystackResponses.success(context.action, listBanks(country));
}

function resolveAccount(context: ActionContext) {
  const accountNumber = queryString(context.request.query.account_number) ?? "";
  const bankCode = queryString(context.request.query.bank_code) ?? "";

  if (!/^\d{10}$/u.test(accountNumber)) {
    return invalidAccountNumberResponse();
  }
  if (!isKnownBankCode(bankCode)) {
    return invalidBankCodeResponse();
  }

  if (context.failures.bankResolveFails?.mode === "timeout") {
    return bankResolveTimeoutResponse();
  }
  if (context.failures.bankResolveFails !== undefined) {
    return bankResolveFailedResponse();
  }

  return paystackResponses.success(context.action, {
    account_number: accountNumber,
    account_name: accountNameFor(accountNumber, bankCode),
    bank_id: bankIdFor(bankCode),
  });
}

export const bankActions: readonly ActionDefinition[] = [
  {
    id: "bank.list",
    method: "GET",
    path: "/bank",
    summary: "List banks",
    kind: "read",
    handler: listBankAction,
  },
  {
    id: "bank.resolve",
    method: "GET",
    path: "/bank/resolve",
    summary: "Resolve an account number",
    kind: "read",
    handler: resolveAccount,
  },
];
