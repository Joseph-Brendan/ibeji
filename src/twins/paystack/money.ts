import { IbejiError } from "../../core/errors.js";
import type { MoneyRules } from "../framework/types.js";

export const PAYSTACK_ZERO_DECIMAL = ["XOF"] as const;

const SYMBOLS: Readonly<Record<string, string>> = {
  NGN: "₦",
  USD: "$",
  GHS: "₵",
  ZAR: "R",
  KES: "Ksh.",
  XOF: "XOF ",
};

function fractionDigits(currency: string): number {
  return currency === "XOF" ? 0 : 2;
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
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
  formatDisplay: (amount, currency) => {
    const symbol = SYMBOLS[currency] ?? `${currency} `;
    if (currency === "XOF") {
      const whole = BigInt(amount) / 100n;
      return `${symbol}${groupDigits(whole.toString())}`;
    }

    const value = BigInt(amount);
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const whole = absolute / 100n;
    const fraction = absolute % 100n;
    const sign = negative ? "-" : "";
    return `${sign}${symbol}${groupDigits(whole.toString())}.${fraction.toString().padStart(2, "0")}`;
  },
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
