import { describe, expect, it } from "vitest";
import { meta as flutterwave } from "../../scripts/recorder/flutterwave.mjs";
import { meta as paystack } from "../../scripts/recorder/paystack.mjs";
import { Redactor } from "../../scripts/recorder/shared.mjs";
import { meta as stripe } from "../../scripts/recorder/stripe.mjs";

const keyPatterns = [...paystack.keyPatterns, ...flutterwave.keyPatterns, ...stripe.keyPatterns];

describe("C15 recorder redaction", () => {
  it("replaces every listed kind of value consistently for all three services", () => {
    const paystackSecret = "sk_test_paystack_redaction_sample_123";
    const paystackLive = "pk_live_paystack_redaction_sample_123";
    const flutterwaveSecret = "FLWSECK_TEST-ibeji-redaction-sample-123";
    const flutterwaveLive = "FLWPUBK-ibeji-redaction-sample-123";
    const stripeSecret = "sk_test_stripe_redaction_sample_123";
    const stripeLive = "rk_live_stripe_redaction_sample_123";
    const stripeWebhook = "whsec_ibeji_redaction_sample_123";
    const email = "ada@real-customer.example";
    const phone = "+234 801 234 5678";
    const account = "0123456789";
    const ip = "102.89.33.4";
    const card = "4242424242424242";

    const sample = {
      authorization: `Bearer ${paystackSecret}`,
      paystackSecret,
      paystackLive,
      flutterwaveSecret,
      flutterwaveLive,
      stripeSecret,
      stripeLive,
      stripeWebhook,
      token: "tok_redaction_sample_123",
      authorization_code: "AUTH_REDACTION_SAMPLE_123",
      access_code: "ACCESS_REDACTION_SAMPLE_123",
      client_secret: "pi_123_secret_redactionSample123",
      email,
      customer: {
        name: "Ada Lovelace",
        email,
        phone,
        account_number: account,
        ip_address: ip,
      },
      card: {
        number: card,
        last4: "4242",
        cvc: "123",
        exp_month: "12",
        exp_year: "30",
      },
    };

    const redactor = new Redactor({ keyPatterns });
    const first = redactor.redact(sample);
    const second = redactor.redact(sample);
    expect(first).toEqual(second);

    const text = JSON.stringify(first);
    for (const original of [
      paystackSecret,
      paystackLive,
      flutterwaveSecret,
      flutterwaveLive,
      stripeSecret,
      stripeLive,
      stripeWebhook,
      email,
      phone,
      account,
      ip,
      card,
      "Ada Lovelace",
      "tok_redaction_sample_123",
      "AUTH_REDACTION_SAMPLE_123",
      "ACCESS_REDACTION_SAMPLE_123",
      "pi_123_secret_redactionSample123",
    ]) {
      expect(text).not.toContain(original);
    }

    expect(text).toContain("customer.one@example.com");
    expect(text).toContain("+15550000001");
    expect(text).toContain("0000000001");
    expect(text).toContain("203.0.113.1");
    expect(text).toContain("Test Name 1");
    expect(text).toContain("[REDACTED_KEY_1]");
    expect(text).toContain("[REDACTED_TOKEN_1]");
    expect(text).toContain("[REDACTED_CLIENT_SECRET_1]");
    expect(text).toContain("[REDACTED_AUTH_CODE_1]");
    expect(text).toContain("0000000000000000");
    expect(text).toContain('"last4":"0000"');
  });

  it("redacts arbitrary text values as well as structured values", () => {
    const redactor = new Redactor({ keyPatterns });
    const result = redactor.redact({
      note: "Send to ada@real-customer.example, call +234 801 234 5678, use sk_test_paystack_redaction_sample_123",
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("ada@real-customer.example");
    expect(text).not.toContain("+234 801 234 5678");
    expect(text).not.toContain("sk_test_paystack_redaction_sample_123");
    expect(text).toContain("@example.com");
    expect(text).toContain("+1555");
  });
});
