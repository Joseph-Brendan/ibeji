import type { CurrencyRules } from "../../src/shared/control.js";
import { formatMoney } from "../../src/shared/money.js";

export type MoneyDisplay = {
  readonly text: string;
  readonly digits: number;
  readonly known: boolean;
};

const DEFAULT_DIGITS = 2;
const MAX_DIGITS = 6;
const THREE_LETTER_CODE = /^[A-Za-z]{3}$/u;

function normaliseDigits(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_DIGITS) {
    return DEFAULT_DIGITS;
  }
  return value;
}

function currencyDigits(
  currency: string,
  rules: CurrencyRules,
): { digits: number; known: boolean } {
  const code = currency.trim();
  if (!THREE_LETTER_CODE.test(code)) {
    return { digits: 0, known: false };
  }
  const upper = code.toUpperCase();
  if (rules.zeroDecimal.some((item) => item.toUpperCase() === upper)) {
    return { digits: 0, known: true };
  }
  const explicit = Object.entries(rules.fractionDigits).find(
    ([key]) => key.toUpperCase() === upper,
  )?.[1];
  return {
    digits: normaliseDigits(explicit ?? rules.defaultFractionDigits),
    known: true,
  };
}

export function formatMinorUnits(
  amount: number | bigint,
  currency: string,
  rules: CurrencyRules,
): MoneyDisplay {
  const { digits, known } = currencyDigits(currency, rules);
  const amountKnown = typeof amount === "bigint" || Number.isSafeInteger(amount);
  return {
    text: formatMoney(amount, currency, digits),
    digits,
    known: known && amountKnown,
  };
}

export function parseFormattedMoney(text: string, digits: number): bigint {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const cleaned = trimmed.replace(/[^0-9.]/gu, "");
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const padded = fraction.padEnd(digits, "0").slice(0, digits);
  const minor = BigInt(`${whole === "" ? "0" : whole}${padded}`);
  return negative ? -minor : minor;
}
