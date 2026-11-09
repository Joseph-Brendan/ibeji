import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { CurrencyRules } from "../../src/shared/control.js";
import { formatMinorUnits, parseFormattedMoney } from "../../ui/src/money.js";

const RULES: CurrencyRules = {
  zeroDecimal: ["XOF"],
  defaultFractionDigits: 2,
  fractionDigits: {
    NGN: 2,
    USD: 2,
    KWD: 3,
    XOF: 0,
  },
};

describe("T8 UI money formatting", () => {
  it("T8: formats zero and the smallest unit", () => {
    expect(formatMinorUnits(0, "NGN", RULES).text).toBe("₦0.00");
    expect(formatMinorUnits(0, "USD", RULES).text).toBe("$0.00");
    expect(formatMinorUnits(1, "NGN", RULES).text).toBe("₦0.01");
    expect(formatMinorUnits(1, "USD", RULES).text).toBe("$0.01");
  });

  it("T8: formats large amounts without floating-point loss", () => {
    expect(formatMinorUnits(123_456_789_012_345, "NGN", RULES).text).toBe("₦1,234,567,890,123.45");
    expect(formatMinorUnits(10n ** 18n, "USD", RULES).text).toBe("$10,000,000,000,000,000.00");
  });

  it("T8: formats currencies with no minor unit", () => {
    expect(formatMinorUnits(0, "XOF", RULES).text).toBe("XOF 0");
    expect(formatMinorUnits(500, "XOF", RULES).text).toBe("XOF 500");
    expect(formatMinorUnits(123_456, "XOF", RULES).text).toBe("XOF 123,456");
  });

  it("T8: uses explicit and default fraction digits", () => {
    expect(formatMinorUnits(1_234, "KWD", RULES).text).toBe("KWD 1.234");
    expect(formatMinorUnits(1_234, "GHS", RULES).text).toBe("₵12.34");
    expect(formatMinorUnits(-1, "NGN", RULES).text).toBe("-₦0.01");
  });

  it("T8: shows a whole amount when the currency code is not known", () => {
    const display = formatMinorUnits(123, "", RULES);
    expect(display.text).toBe("Unknown currency 123");
    expect(display.known).toBe(false);
  });

  it("T8: formatting then parsing returns the same minor-unit value", () => {
    const currencies = ["NGN", "USD", "XOF", "KWD", "GHS"] as const;
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
        fc.constantFrom(...currencies),
        (amount, currency) => {
          const display = formatMinorUnits(amount, currency, RULES);
          expect(parseFormattedMoney(display.text, display.digits)).toBe(amount);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
