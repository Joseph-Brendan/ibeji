import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { unregisteredServiceKeywords } from "../../scripts/check-package.mjs";

const SERVICES = ["paystack", "flutterwave", "stripe"];

describe("C21 D42 check:package service keywords", () => {
  it("C21 D42 rejects a service keyword when its twin is not registered", () => {
    expect(
      unregisteredServiceKeywords(
        ["paystack", "flutterwave", "stripe", "testing"],
        ["paystack", "flutterwave"],
        SERVICES,
      ),
    ).toEqual(["stripe"]);
  });

  it("C21 D42 accepts service keywords that have registered twins", () => {
    expect(
      unregisteredServiceKeywords(
        ["paystack", "flutterwave"],
        ["paystack", "flutterwave"],
        SERVICES,
      ),
    ).toEqual([]);
  });

  it("C21 D42 keeps Stripe out of the 0.1.0 package keywords", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly keywords?: readonly string[];
    };
    expect(pkg.keywords ?? []).not.toContain("stripe");
  });
});
