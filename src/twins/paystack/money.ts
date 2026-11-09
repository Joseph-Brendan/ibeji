import { IbejiError } from "../../core/errors.js";
import { formatMoney } from "../../shared/money.js";
import type { MoneyRules } from "../framework/types.js";

export const PAYSTACK_ZERO_DECIMAL = ["XOF"] as const;

function fractionDigits(currency: string): number {
  return currency === "XOF" ? 0 : 2;
}

function parseInteger(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The Paystack amount is not a whole number.",
      why: "Paystack sends amounts as whole numbers in the currency's smallest unit.",
      fix: "Send an integer amount such as 10000 (₦100.00).",
    });
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The Paystack amount is too large.",
      why: "The amount must fit in a safe JavaScript integer.",
      fix: "Send a smaller integer amount.",
    });
  }
  return value;
}

/**
 * Paystack's API amounts are already whole numbers in the currency subunit.
 * The XOF exception is a display rule: Paystack still requires the API amount
 * multiplied by 100 even though XOF has no displayed subunit.
 */
export const paystackMoney: MoneyRules = {
  zeroDecimal: PAYSTACK_ZERO_DECIMAL,
  fractionDigits,
  parseServiceAmount: (text) => parseInteger(text),
  formatServiceAmount: (amount) => String(amount),
  // Paystack requires XOF amounts multiplied by 100 even though XOF is shown
  // with no decimal places (research/paystack.md section 12).
  formatDisplay: (amount, currency) =>
    formatMoney(
      currency === "XOF" ? BigInt(amount) / 100n : amount,
      currency,
      fractionDigits(currency),
    ),
  assertValid: (amount) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new IbejiError("BAD_REQUEST", {
        what: "The Paystack amount is not valid.",
        why: "Amounts must be positive whole numbers in the currency's smallest unit.",
        fix: "Send an integer amount greater than zero, such as 10000.",
      });
    }
  },
};
