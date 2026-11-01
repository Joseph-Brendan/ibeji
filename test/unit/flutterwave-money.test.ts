import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import { flutterwaveMoney } from "../../src/twins/flutterwave/money.js";
import { paystackTwin } from "../../src/twins/paystack/definition.js";

describe("C4 Flutterwave money units", () => {
  it("C4 uses main units, not Paystack's smallest-unit rule", () => {
    expect(flutterwaveMoney.parseServiceAmount("7500", "NGN")).toBe(750_000);
    expect(paystackTwin.money.parseServiceAmount("7500", "NGN")).toBe(7_500);
    expect(flutterwaveMoney.formatServiceAmount(750_000, "NGN")).toBe("7500");
    expect(flutterwaveMoney.formatDisplay(750_000, "NGN")).toBe("NGN 7,500.00");
    expect(flutterwaveMoney.fractionDigits("NGN")).toBe(2);
    expect(flutterwaveMoney.zeroDecimal).toEqual([]);
  });

  it("C4 accepts decimal main-unit amounts and stores whole smallest units", () => {
    expect(flutterwaveMoney.parseServiceAmount("12.34", "USD")).toBe(1_234);
    expect(flutterwaveMoney.parseServiceAmount("12.3", "USD")).toBe(1_230);
    expect(flutterwaveMoney.parseServiceAmount("12", "USD")).toBe(1_200);
    expect(flutterwaveMoney.formatServiceAmount(1_234, "USD")).toBe("12.34");
    expect(flutterwaveMoney.formatServiceAmount(1_230, "USD")).toBe("12.3");
    expect(flutterwaveMoney.formatServiceAmount(1_200, "USD")).toBe("12");
    expect(flutterwaveMoney.formatDisplay(1_234, "USD")).toBe("USD 12.34");
  });

  it("C4 rejects too many decimal places and malformed amounts", () => {
    expect(() => flutterwaveMoney.parseServiceAmount("12.345", "USD")).toThrow(
      /too many decimal places/u,
    );
    expect(() => flutterwaveMoney.parseServiceAmount("12.3.4", "USD")).toThrow(/not a number/u);
    expect(() => flutterwaveMoney.parseServiceAmount("-12", "USD")).toThrow(/not a number/u);
    expect(() => flutterwaveMoney.parseServiceAmount("", "USD")).toThrow(/not a number/u);
  });

  it("C4/T2 any valid minor-unit amount formats and parses back unchanged", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (minor) => {
        const serviceText = flutterwaveMoney.formatServiceAmount(minor, "NGN");
        expect(flutterwaveMoney.parseServiceAmount(serviceText, "NGN")).toBe(minor);
      }),
      { numRuns: 500 },
    );
  });

  it("C4/T2 any canonical decimal text round-trips to the same text", () => {
    const canonicalText = fc
      .tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 99 }))
      .map(([whole, fraction]) => {
        if (fraction === 0) {
          return String(whole);
        }
        if (fraction % 10 === 0) {
          return `${whole}.${fraction / 10}`;
        }
        return `${whole}.${fraction.toString().padStart(2, "0")}`;
      });

    fc.assert(
      fc.property(canonicalText, (text) => {
        const minor = flutterwaveMoney.parseServiceAmount(text, "NGN");
        expect(flutterwaveMoney.formatServiceAmount(minor, "NGN")).toBe(text);
      }),
      { numRuns: 500 },
    );
  });

  it("C4 exposes the Flutterwave money rule on the twin definition", () => {
    expect(flutterwaveTwin.money).toBe(flutterwaveMoney);
    expect(flutterwaveTwin.money.formatServiceAmount(1_234, "USD")).toBe("12.34");
  });
});
