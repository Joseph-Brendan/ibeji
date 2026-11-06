import { fingerprint } from "../core/redact.js";
import {
  createLiveKeyScanner,
  type LiveKeyPattern,
  type LiveKeyScanner,
} from "../shared/live-key-scanner.js";
import type { TwinDefinition } from "../twins/framework/types.js";

const SENSITIVE_HEADER_NAMES = new Set(["authorization", "proxy-authorization", "cookie"]);

function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADER_NAMES.has(lower) || lower.includes("signature");
}

function isHeaderContainer(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "headers" || lower.endsWith("headers");
}

export type RedactionEntry = {
  readonly value: string;
  readonly replacement: string;
};

/**
 * Replaces tokens and credentials in text and nested values. The same rules
 * cover error messages, events, and exports so a secret cannot escape through
 * a less obvious surface.
 */
export class SecretRedactor {
  private readonly entries: readonly RedactionEntry[];
  private readonly definitions: readonly TwinDefinition[];
  private readonly scanner: LiveKeyScanner;

  constructor(
    entries: readonly RedactionEntry[],
    definitions: readonly TwinDefinition[],
    liveKeyPatterns: readonly LiveKeyPattern[] = [],
  ) {
    this.entries = [...entries].sort((left, right) => right.value.length - left.value.length);
    this.definitions = definitions;
    this.scanner = createLiveKeyScanner(liveKeyPatterns);
  }

  static forSecrets(
    secretValues: readonly string[],
    credentialValues: readonly string[],
    definitions: readonly TwinDefinition[],
    liveKeyPatterns: readonly LiveKeyPattern[] = [],
  ): SecretRedactor {
    return new SecretRedactor(
      [
        ...secretValues.map((value) => ({ value, replacement: "[redacted]" })),
        ...credentialValues.map((value) => ({ value, replacement: fingerprint(value) })),
      ],
      definitions,
      liveKeyPatterns,
    );
  }

  redactText(text: string): string {
    let result = text;
    for (const entry of this.entries) {
      result = result.split(entry.value).join(entry.replacement);
    }
    return this.scanner.scanText(result).value;
  }

  redactValue(value: unknown): unknown {
    return this.redact(value, false);
  }

  private redact(value: unknown, inHeaders: boolean): unknown {
    if (typeof value === "string") {
      return this.redactString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, inHeaders));
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (inHeaders && isSensitiveHeaderName(key)) {
          continue;
        }
        result[key] = this.redact(item, isHeaderContainer(key));
      }
      return result;
    }

    return value;
  }

  private redactString(value: string): string {
    for (const entry of this.entries) {
      if (value === entry.value) {
        return entry.replacement;
      }
    }

    const redacted = this.redactText(value);
    if (redacted !== value) {
      return redacted;
    }

    for (const definition of this.definitions) {
      if (definition.auth.isLiveKey(value)) {
        return fingerprint(value);
      }
    }

    return value;
  }
}
