import type { ActionContext, ActionDefinition } from "../framework/types.js";
import { accountNameFor, bankNameFor, isKnownBankCode } from "./banks.js";
import {
  invalidBankCodeResponse,
  invalidBodyResponse,
  invalidTransferAccountResponse,
  paystackResponses,
  recipientFieldsRequiredResponse,
  recipientMissingAccountResponse,
} from "./responses.js";
import type { PaystackRecipient } from "./state.js";
import { paystackRecipientSchema } from "./state.js";
import { isRecord, parseJsonObject } from "./transactions.js";

const RECIPIENTS = "recipients";
const INTEGRATION_ID = 1_044_674;
let nextRecipientId = 137_169_645;

function nextNumber(): number {
  const id = nextRecipientId;
  nextRecipientId += 1;
  return id;
}

export function recipientData(recipient: PaystackRecipient): Record<string, unknown> {
  return {
    active: true,
    createdAt: recipient.createdAt,
    currency: recipient.currency,
    description: recipient.description,
    domain: "test",
    email: recipient.email,
    id: recipient.recipientId,
    integration: INTEGRATION_ID,
    metadata: recipient.metadata,
    name: recipient.name,
    recipient_code: recipient.recipientCode,
    type: recipient.type,
    updatedAt: recipient.updatedAt,
    is_deleted: false,
    isDeleted: false,
    details: {
      authorization_code: recipient.authorizationCode,
      account_number: recipient.accountNumber,
      account_name: recipient.accountName,
      bank_code: recipient.bankCode,
      bank_name: recipient.bankName,
    },
  };
}

export function findRecipient(
  state: ActionContext["state"],
  recipientCode: string,
): PaystackRecipient | undefined {
  return state.read(RECIPIENTS, recipientCode, paystackRecipientSchema);
}

function metadataValue(value: unknown): PaystackRecipient["metadata"] {
  return value === undefined ? null : (value as PaystackRecipient["metadata"]);
}

function createRecipient(context: ActionContext) {
  const body = parseJsonObject(context.request.rawBody);
  if (body === undefined) {
    return invalidBodyResponse();
  }

  const type = typeof body.type === "string" ? body.type : "";
  const name = typeof body.name === "string" ? body.name : "";
  if (type.length === 0 || name.length === 0) {
    return recipientFieldsRequiredResponse();
  }

  const accountNumber =
    typeof body.account_number === "string" && body.account_number.length > 0
      ? body.account_number
      : null;
  const authorizationCode =
    typeof body.authorization_code === "string" && body.authorization_code.length > 0
      ? body.authorization_code
      : null;

  if (accountNumber === null && authorizationCode === null) {
    return recipientMissingAccountResponse();
  }

  let bankCode: string | null = null;
  let bankName: string | null = null;
  let accountName: string | null = null;

  // The authorization_code recipient variant is documentation-only.
  // Source: documentation, not recorded.
  if (accountNumber !== null) {
    if (!/^\d{10}$/u.test(accountNumber)) {
      return invalidTransferAccountResponse();
    }
    const rawBankCode = typeof body.bank_code === "string" ? body.bank_code : "";
    if (rawBankCode.length === 0 || !isKnownBankCode(rawBankCode)) {
      return invalidBankCodeResponse();
    }
    bankCode = rawBankCode;
    bankName = bankNameFor(rawBankCode);
    accountName = accountNameFor(accountNumber, rawBankCode);
  }

  const currency =
    typeof body.currency === "string" && body.currency.trim().length > 0
      ? body.currency.trim().toUpperCase()
      : "NGN";

  // Paystack's duplicate rule is about an account number. The documentation-only
  // authorization_code variant has no account number, so it always creates a record.
  const existing =
    accountNumber === null
      ? undefined
      : context.state
          .list(RECIPIENTS, paystackRecipientSchema)
          .find(
            (recipient) =>
              recipient.accountNumber === accountNumber &&
              recipient.bankCode === bankCode &&
              recipient.currency === currency,
          );
  if (existing !== undefined) {
    return paystackResponses.created(context.action, recipientData(existing));
  }

  const now = new Date(context.clock.now()).toISOString();
  const recipientId = nextNumber();
  const recipientCode = `RCP_ibeji${recipientId}`;
  const recipient: PaystackRecipient = {
    id: recipientCode,
    recipientId,
    type,
    name,
    accountNumber,
    bankCode,
    bankName,
    accountName,
    authorizationCode,
    currency,
    description: typeof body.description === "string" ? body.description : null,
    email: typeof body.email === "string" ? body.email : null,
    metadata: metadataValue(body.metadata),
    recipientCode,
    createdAt: now,
    updatedAt: now,
  };
  context.state.insert(RECIPIENTS, recipient);

  return paystackResponses.created(context.action, recipientData(recipient));
}

function recipientEventSummary(request: { readonly rawBody: Uint8Array }): string {
  const body = parseJsonObject(request.rawBody);
  if (body === undefined || !isRecord(body) || typeof body.name !== "string") {
    return "Your app tried to create a Paystack transfer recipient.";
  }
  return `Your app created a Paystack transfer recipient for ${body.name}`;
}

export const recipientActions: readonly ActionDefinition[] = [
  {
    id: "transfer_recipient.create",
    method: "POST",
    path: "/transferrecipient",
    summary: "Create a transfer recipient",
    kind: "write",
    eventSummary: recipientEventSummary,
    handler: createRecipient,
  },
];
