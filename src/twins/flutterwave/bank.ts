import type { ActionContext, ActionDefinition } from "../framework/types.js";
import { accountNameFor, banksForCountry, findBank } from "./banks.js";
import { parseJsonObject } from "./payments.js";
import {
  bankNotFoundResponse,
  bankResolveFailedResponse,
  bankResolveTimeoutResponse,
  flutterwaveResponses,
  invalidAccountResponse,
  invalidBodyResponse,
} from "./responses.js";

function listBanks(context: ActionContext) {
  const country = context.request.params.country ?? "";
  const banks = banksForCountry(country);
  if (banks.length === 0) {
    return bankNotFoundResponse();
  }
  return flutterwaveResponses.success(context.action, banks);
}

function resolveAccount(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return invalidBodyResponse();
  }

  const accountNumber = typeof body.account_number === "string" ? body.account_number.trim() : "";
  const bankCode = typeof body.account_bank === "string" ? body.account_bank.trim() : "";

  if (!/^\d{10}$/u.test(accountNumber) || findBank(bankCode) === undefined) {
    return invalidAccountResponse();
  }

  if (context.failures.bankResolveFails?.mode === "timeout") {
    return bankResolveTimeoutResponse();
  }
  if (context.failures.bankResolveFails !== undefined) {
    return bankResolveFailedResponse();
  }

  return flutterwaveResponses.success(context.action, {
    account_name: accountNameFor(accountNumber, bankCode),
    account_number: accountNumber,
  });
}

export const bankActions: readonly ActionDefinition[] = [
  {
    id: "bank.list",
    method: "GET",
    path: "/v3/banks/:country",
    summary: "List banks for a country",
    kind: "read",
    handler: listBanks,
  },
  {
    id: "bank.resolve",
    method: "POST",
    path: "/v3/accounts/resolve",
    summary: "Resolve an account number",
    kind: "read",
    handler: resolveAccount,
  },
];
