import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { IbejiError } from "../../src/core/errors.js";
import { fingerprint, redactCredential } from "../../src/core/redact.js";

describe("C12 redaction", () => {
  it("C12: fingerprint is the first eight hexadecimal characters of SHA-256", () => {
    expect(fingerprint("hello")).toBe("2cf24dba");
    expect(fingerprint("hello")).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint("hello")).not.toBe(fingerprint("hello "));
  });

  it("C12: redactCredential returns the public prefix plus the fingerprint", () => {
    const secret = "sk_test_ibeji_redaction_sample";
    expect(redactCredential(secret, "sk_test_")).toBe(`sk_test_${fingerprint(secret)}`);
    expect(redactCredential(secret, "sk_test_")).not.toContain("ibeji_redaction_sample");
  });

  it("C12: refuses a value that does not start with the known public prefix", () => {
    const secret = "sk_test_ibeji_redaction_sample";

    for (const prefix of ["", "pk_test_", "sk_live_"]) {
      expect(() => redactCredential(secret, prefix)).toThrow(IbejiError);
    }
  });

  it("C12: never returns a six-character run from the secret part", () => {
    const nonHex = fc.constantFrom(
      ..."ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{};:,.<>/?".split(""),
    );
    const secretPart = fc.string({ unit: nonHex, minLength: 6, maxLength: 40 });
    const prefix = fc.constantFrom("sk_test_", "FLWSECK_TEST-", "whsec_");

    fc.assert(
      fc.property(prefix, secretPart, (knownPrefix, suffix) => {
        const value = `${knownPrefix}${suffix}`;
        const output = redactCredential(value, knownPrefix);
        const fingerprintPart = output.slice(knownPrefix.length);

        for (let index = 0; index + 6 <= suffix.length; index += 1) {
          const run = suffix.slice(index, index + 6);
          if (fingerprintPart.includes(run)) {
            return false;
          }
        }

        return true;
      }),
    );
  });
});
