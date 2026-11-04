import type { CurrencyRules } from "../../src/shared/control.js";

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

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

function toBigInt(amount: number | bigint): bigint | undefined {
  if (typeof amount === "bigint") {
    return amount;
  }
  return Number.isSafeInteger(amount) ? BigInt(amount) : undefined;
}

export function formatMinorUnits(
  amount: number | bigint,
  currency: string,
  rules: CurrencyRules,
): MoneyDisplay {
  const code = currency.trim().toUpperCase();
  const label = code === "" ? "Unknown currency" : code;
  const { digits, known } = currencyDigits(currency, rules);
  const value = toBigInt(amount);
  if (value === undefined) {
    return { text: `${label} ${String(amount)}`, digits, known: false };
  }

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const unit = 10n ** BigInt(digits);
  const whole = absolute / unit;
  const fraction = absolute % unit;
  const fractionText = digits === 0 ? "" : `.${fraction.toString().padStart(digits, "0")}`;
  const sign = negative ? "-" : "";
  return {
    text: `${sign}${label} ${groupDigits(whole.toString())}${fractionText}`,
    digits,
    known,
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
