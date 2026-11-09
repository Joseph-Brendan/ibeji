/**
 * One display formatter for every amount Ibeji shows to a person (SPEC.md C21
 * D66). The twin supplies the currency's fraction digits from its own money
 * rules; this module owns the symbol, grouping and decimal text.
 */
const SYMBOLS: Readonly<Record<string, string>> = {
  NGN: "₦",
  USD: "$",
  GHS: "₵",
  ZAR: "R",
  KES: "Ksh.",
  EUR: "€",
  GBP: "£",
};

const DEFAULT_DIGITS = 2;
const MAX_DIGITS = 6;

function normaliseDigits(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_DIGITS) {
    return DEFAULT_DIGITS;
  }
  return value;
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

export function formatMoney(
  amount: number | bigint,
  currency: string,
  fractionDigits: number,
): string {
  const code = currency.trim().toUpperCase();
  const label = code === "" ? "Unknown currency" : code;
  const digits = normaliseDigits(fractionDigits);
  const value = toBigInt(amount);
  if (value === undefined) {
    return `${label} ${String(amount)}`;
  }

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const unit = 10n ** BigInt(digits);
  const whole = absolute / unit;
  const fraction = absolute % unit;
  const fractionText = digits === 0 ? "" : `.${fraction.toString().padStart(digits, "0")}`;
  const sign = negative ? "-" : "";
  const prefix = SYMBOLS[label] ?? `${label} `;
  return `${sign}${prefix}${groupDigits(whole.toString())}${fractionText}`;
}
