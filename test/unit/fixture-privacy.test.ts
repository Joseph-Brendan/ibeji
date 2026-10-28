import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { meta as flutterwave } from "../../scripts/recorder/flutterwave.mjs";
import { meta as paystack } from "../../scripts/recorder/paystack.mjs";
import { FAKE_EMAILS, scanFixtures } from "../../scripts/recorder/shared.mjs";
import { meta as stripe } from "../../scripts/recorder/stripe.mjs";

const keyPatterns = [...paystack.keyPatterns, ...flutterwave.keyPatterns, ...stripe.keyPatterns];

describe("T13 fixture privacy", () => {
  it("scans every fixture service directory and rejects non-fake private data", async () => {
    const actual = await scanFixtures("fixtures", keyPatterns);
    expect(actual.services).toEqual(["flutterwave", "paystack", "stripe"]);
    expect(actual.problems).toEqual([]);

    const root = await mkdtemp(join(tmpdir(), "ibeji-fixture-privacy-"));
    try {
      await mkdir(join(root, "paystack"), { recursive: true });
      await mkdir(join(root, "flutterwave"), { recursive: true });
      await mkdir(join(root, "stripe"), { recursive: true });
      await writeFile(
        join(root, "paystack", "sample.json"),
        JSON.stringify({
          path: "/transaction/verify/ada@real-customer.example",
          responseHeaders: { authorization: "Bearer sk_live_paystack_sample_123" },
          responseBody: { phone: "+234 801 234 5678", account_number: "0123456789" },
        }),
      );
      await writeFile(
        join(root, "flutterwave", "sample.json"),
        JSON.stringify({
          responseBody: {
            customer: { name: "Ada Lovelace", email: "ada@real-customer.example" },
            key: "FLWSECK-ibeji-redaction-sample-123",
          },
        }),
      );
      await writeFile(
        join(root, "stripe", "sample.json"),
        JSON.stringify({
          responseBody: { customer: { name: "Ada Lovelace", email: "ada@real-customer.example" } },
          requestBody: "authorization=Bearer sk_live_stripe_sample_123",
        }),
      );

      const scan = await scanFixtures(root, keyPatterns);
      expect(scan.services).toEqual(["flutterwave", "paystack", "stripe"]);
      expect(scan.problems.some((problem) => problem.kind === "key")).toBe(true);
      expect(scan.problems.some((problem) => problem.kind === "email")).toBe(true);
      expect(scan.problems.some((problem) => problem.kind === "phone")).toBe(true);
      expect(scan.problems.some((problem) => problem.kind === "account")).toBe(true);
      expect(scan.problems.some((problem) => problem.kind === "name")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts the recorder's fixed fake values", async () => {
    const root = await mkdtemp(join(tmpdir(), "ibeji-fixture-fakes-"));
    try {
      await mkdir(join(root, "paystack"), { recursive: true });
      await writeFile(
        join(root, "paystack", "fake.json"),
        JSON.stringify({
          email: "customer.one@example.com",
          emails: FAKE_EMAILS,
          phone: "+15550000001",
          account_number: "0000000001",
          customer_name: "Test Name 1",
        }),
      );
      const scan = await scanFixtures(root, keyPatterns);
      expect(scan.problems).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an example.com address that is not on the fixed fake list", async () => {
    const root = await mkdtemp(join(tmpdir(), "ibeji-fixture-other-email-"));
    try {
      await mkdir(join(root, "paystack"), { recursive: true });
      await writeFile(
        join(root, "paystack", "other-email.json"),
        JSON.stringify({ email: "someone.else@example.com" }),
      );
      const scan = await scanFixtures(root, keyPatterns);
      expect(scan.problems.some((problem) => problem.kind === "email")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
