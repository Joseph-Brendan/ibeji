import { createHash } from "node:crypto";

import { IbejiError } from "./errors.js";

/**
 * The only representation of a secret that Ibeji may show: the first eight
 * hexadecimal characters of its SHA-256 hash.
 */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/**
 * Show a credential as its known public prefix plus the fingerprint. The rest
 * of the value is never returned. A value that does not begin with the public
 * prefix is refused, because echoing any other part could leak the secret.
 */
export function redactCredential(value: string, knownPrefix: string): string {
  if (knownPrefix.length === 0 || !value.startsWith(knownPrefix)) {
    throw new IbejiError("BAD_REQUEST", {
      what: "The credential cannot be redacted.",
      why: "The value does not start with the public prefix it was expected to have.",
      fix: "Pass the credential's documented public prefix and the full credential value.",
    });
  }

  return `${knownPrefix}${fingerprint(value)}`;
}
