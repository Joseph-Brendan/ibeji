import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CHECKOUT_STYLES,
  renderCheckoutPage,
  renderCheckoutResult,
} from "../../src/twins/framework/html.js";
import { fakeTwinDefinition } from "../fixtures/fake-twin/definition.js";

const UI_STYLES = readFileSync(new URL("../../ui/src/styles.css", import.meta.url), "utf8");

function ibejiTokens(css: string): Readonly<Record<string, string>> {
  const tokens: Record<string, string> = {};
  for (const match of css.matchAll(
    /--ibeji-(white|black|purple|dark-grey|dark-purple|red):\s*(#[0-9a-f]{6});/gu,
  )) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      tokens[name] = value;
    }
  }
  return tokens;
}

describe("T14 shared checkout renderer", () => {
  it("T14 renders an authentication outcome and no optional email", () => {
    const html = renderCheckoutPage(
      {
        twinDisplayName: "Fake <Twin>",
        amountMinor: 1_000,
        currency: "USD",
        reference: "ref-1",
        outcomes: [
          {
            id: "check",
            label: "Check",
            description: "Needs a check",
            authentication: { approveLabel: "Approve", failLabel: "Fail" },
          },
        ],
        failureNotice: "A rule changed this.",
      },
      fakeTwinDefinition.money,
    );

    expect(html).toContain("Fake &lt;Twin&gt;");
    expect(html).toContain("Approve");
    expect(html).toContain("Fail");
    expect(html).toContain("check|approve");
    expect(html).toContain("A rule changed this.");
    expect(html).toContain("Choose a result.");
    expect(html).toContain("This page is part of Ibeji. It is not the real service.");
    expect(html).toContain("Ibeji is not affiliated with Fake &lt;Twin&gt;.");
    expect(html).not.toContain("Customer");
  });

  it("T14 uses the UI tokens and local fonts, with no service branding", () => {
    const html = renderCheckoutPage(
      {
        twinDisplayName: "Paystack twin",
        amountMinor: 1_000,
        currency: "USD",
        reference: "ref-1",
        outcomes: [{ id: "success", label: "Pay successfully", description: "Test" }],
      },
      fakeTwinDefinition.money,
    );

    for (const token of [
      "--ibeji-white: #ffffff;",
      "--ibeji-black: #111111;",
      "--ibeji-purple: #6b4fa1;",
      "--ibeji-dark-grey: #3a3a3a;",
      "--ibeji-dark-purple: #2f1b45;",
      "--ibeji-red: #8f1d21;",
    ]) {
      expect(CHECKOUT_STYLES).toContain(token);
    }
    expect(CHECKOUT_STYLES).toContain("@font-face");
    expect(CHECKOUT_STYLES).toContain('font-family: "IBM Plex Sans"');
    expect(CHECKOUT_STYLES).toContain('font-family: "IBM Plex Mono"');
    expect(CHECKOUT_STYLES).toContain('url("/_ibeji/fonts/ibm-plex-sans-latin-400-normal.woff2")');
    expect(CHECKOUT_STYLES).not.toContain("http://");
    expect(CHECKOUT_STYLES).not.toContain("https://");
    expect(CHECKOUT_STYLES).not.toMatch(/box-shadow|gradient\(/u);
    expect(ibejiTokens(CHECKOUT_STYLES)).toEqual(ibejiTokens(UI_STYLES));
    expect(html).toContain('href="/_ibeji/checkout.css"');
    expect(html).toContain('rel="preload"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("react");
    expect(html).toContain("Ibeji test checkout");
  });

  it("T14 styles the result page with the same tokens and local fonts", () => {
    const html = renderCheckoutResult({ notice: "Payment successful.", webhooks: [] });
    expect(CHECKOUT_STYLES).toContain("--ibeji-purple: #6b4fa1;");
    expect(CHECKOUT_STYLES).not.toMatch(/box-shadow|gradient\(/u);
    expect(html).toContain('href="/_ibeji/checkout.css"');
    expect(html).toContain("This page is part of Ibeji. It is not the real service.");

    const named = renderCheckoutResult(
      { notice: "Payment successful.", webhooks: [] },
      "Flutterwave",
    );
    expect(named).toContain("Ibeji test checkout result: Flutterwave twin");
    expect(named).toContain("Ibeji is not affiliated with Flutterwave.");
    expect(named).not.toContain("<script");
  });
});
