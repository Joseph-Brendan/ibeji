import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("D52 fee documentation", () => {
  it("D52 labels Flutterwave fees illustrative and the failed-transfer message a placeholder", async () => {
    const limits = await readFile("docs/limits.md", "utf8");
    expect(limits).toContain("Fees are illustrative");
    expect(limits).toContain("app_fee");
    expect(limits).toContain("merchant_fee");
    expect(limits).toContain("transfer `fee`");
    expect(limits).toContain("must not be used to test fee arithmetic");
    expect(limits).toContain("failed-transfer message is a placeholder");
  });
});

describe("D53 customer-data documentation", () => {
  it("D53 tells people to use fake customer data and never put a secret in a webhook URL", async () => {
    for (const file of ["docs/safety.md", "docs/connect-your-app.md"]) {
      const text = await readFile(file, "utf8");
      expect(text, file).toContain("Use fake customer data only");
      expect(text, file).toContain("Never put a secret in a webhook URL");
    }
  });
});

describe("D63 Flutterwave webhook documentation", () => {
  it("D63 says verif-hash proves the sender, not an unchanged body", async () => {
    const safety = await readFile("docs/safety.md", "utf8");
    expect(safety).toContain("Flutterwave webhook check");
    expect(safety).toContain("proves who sent the webhook, not that its body is unchanged");
    expect(safety).toContain("Flutterwave v3 does not sign the body");
  });
});

describe("D62 official library documentation", () => {
  it("D62 names which official libraries can point at a twin", async () => {
    const limits = await readFile("docs/limits.md", "utf8");
    expect(limits).toContain("Paystack: no official library");
    expect(limits).toContain("Flutterwave: the official library");
    expect(limits).toContain("Stripe: decided in version 0.2.0");
  });
});
