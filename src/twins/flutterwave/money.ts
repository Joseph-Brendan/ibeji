import { IbejiError } from "../../core/errors.js";
import { formatMoney } from "../../shared/money.js";
import type { MoneyRules } from "../framework/types.js";

/**
 * Flutterwave v3 sends main-unit amounts, not minor units. The v3 research
 * examples use whole currency amounts, and the v4 examples use two decimal
 * places. The v3 documentation has no per-currency decimal table, so the twin
 * uses the two-decimal shape for every currency and rejects more decimals.
 * Amounts are stored inside Ibeji as whole numbers in the smallest unit.
 */
const FRACTION_DIGITS = 2;

function fractionDigits(_currency: string): number {
  return FRACTION_DIGITS;
}

function invalidAmount(what: string, why: string, fix: string): IbejiError {
  return new IbejiError("BAD_REQUEST", { what, why, fix });
}

function parseDigits(text: string, currency: string): number {
  const trimmed = text.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    throw invalidAmount(
      "The Flutterwave amount is not a number.",
      `"${text}" is not a whole or decimal currency amount.`,
      "Send an amount such as 7500 or 7500.50.",
    );
  }

  const [wholePart = "0", fractionPart = ""] = trimmed.split(".");
  const digits = fractionDigits(currency);
  if (fractionPart.length > digits) {
    throw invalidAmount(
      "The Flutterwave amount has too many decimal places.",
      `${currency} accepts at most ${digits} decimal place${digits === 1 ? "" : "s"}, but "${text}" has ${fractionPart.length}.`,
      `Send at most ${digits} decimal place${digits === 1 ? "" : "s"}.`,
    );
  }

  const paddedFraction = fractionPart.padEnd(digits, "0");
  const minorText = `${wholePart}${paddedFraction}`.replace(/^0+(?=\d)/u, "");
  const minor = BigInt(minorText.length === 0 ? "0" : minorText);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidAmount(
      "The Flutterwave amount is too large.",
      "The amount must fit in a safe JavaScript integer after conversion.",
      "Send a smaller amount.",
    );
  }
  return Number(minor);
}

function formatMinor(amount: number, currency: string): string {
  const digits = fractionDigits(currency);
  if (digits === 0) {
    return String(amount);
  }

  const unit = 10 ** digits;
  const whole = Math.trunc(amount / unit);
  const fraction = amount % unit;
  if (fraction === 0) {
    return String(whole);
  }

  const fractionText = String(fraction).padStart(digits, "0").replace(/0+$/u, "");
  return `${whole}.${fractionText}`;
}

function formatDisplay(amount: number, currency: string): string {
  return formatMoney(amount, currency, fractionDigits(currency));
}

/** Flutterwave has no documented v3 zero-decimal currency table. */
export const FLUTTERWAVE_ZERO_DECIMAL: readonly string[] = [];

export const flutterwaveMoney: MoneyRules = {
  zeroDecimal: FLUTTERWAVE_ZERO_DECIMAL,
  fractionDigits,
  parseServiceAmount: parseDigits,
  formatServiceAmount: formatMinor,
  formatDisplay,
  assertValid: (amount, _currency) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw invalidAmount(
        "The Flutterwave amount is not valid.",
        "Amounts must be positive whole numbers in Ibeji's smallest unit.",
        "Send an amount greater than zero, such as 7500.",
      );
    }
  },
};
