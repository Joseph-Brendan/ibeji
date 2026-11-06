import { describe, expect, it } from "vitest";

import { fingerprint } from "../../src/core/redact.js";
import {
  createLiveKeyScanner,
  matchesLiveKey,
  scanLiveKeyText,
  scanLiveKeyValue,
} from "../../src/shared/live-key-scanner.js";
import { createTwinLiveKeyScanner } from "../../src/twins/framework/live-keys.js";
import type { TwinRequest } from "../../src/twins/framework/types.js";
import { liveKeyPatterns, registry } from "../../src/twins/registry.js";

const PAYSTACK = "sk_live_SCANNER_UNIT_PAYSTACK_1234567890";
const PAYSTACK_PUBLIC = "pk_live_SCANNER_UNIT_PAYSTACK_PUBLIC_1234567890";
const FLUTTERWAVE = "FLWSECK-LIVE_SCANNER_UNIT_FLUTTERWAVE_1234567890";
const FLUTTERWAVE_PUBLIC = "FLWPUBK-LIVE_SCANNER_UNIT_FLUTTERWAVE_PUBLIC_1234567890";
const STRIPE_SECRET = "sk_live_SCANNER_UNIT_STRIPE_1234567890";
const STRIPE_PUBLIC = "pk_live_SCANNER_UNIT_STRIPE_PUBLIC_1234567890";
const STRIPE_RESTRICTED = "rk_live_SCANNER_UNIT_STRIPE_RESTRICTED_1234567890";

const LIVE_KEYS = [
  PAYSTACK,
  PAYSTACK_PUBLIC,
  FLUTTERWAVE,
  FLUTTERWAVE_PUBLIC,
  STRIPE_SECRET,
  STRIPE_PUBLIC,
  STRIPE_RESTRICTED,
];

function request(overrides: Partial<TwinRequest> = {}): TwinRequest {
  return {
    method: "POST",
    path: "/transaction/initialize",
    headers: { "content-type": "application/json" },
    query: {},
    params: {},
    rawBody: new TextEncoder().encode("{}"),
    ...overrides,
  };
}

describe("D43 live-key scanner", () => {
  it("D43 every documented Paystack, Flutterwave and Stripe live format matches", () => {
    for (const key of LIVE_KEYS) {
      expect(matchesLiveKey(key, liveKeyPatterns()), key).toBe(true);
    }
    expect(registry.has("stripe")).toBe(false);
    expect(liveKeyPatterns().some((entry) => entry.service === "Stripe")).toBe(true);
    expect(matchesLiveKey("sk_test_SCANNER_UNIT_1234567890", liveKeyPatterns())).toBe(false);
    expect(matchesLiveKey("FLWSECK_TEST-SCANNER-UNIT-1234567890", liveKeyPatterns())).toBe(false);
    expect(matchesLiveKey("FLWPUBK_TEST-SCANNER-UNIT-1234567890", liveKeyPatterns())).toBe(false);
    expect(matchesLiveKey("rk_test_SCANNER_UNIT_1234567890", liveKeyPatterns())).toBe(false);
  });

  it("D43 replaces a live key inside a longer string and keeps its fingerprint", () => {
    const key = PAYSTACK;
    const scanned = scanLiveKeyText(`prefix ${key} suffix`, liveKeyPatterns());
    expect(scanned.value).toBe(`prefix [live key removed: ${fingerprint(key)}] suffix`);
    const joined = scanLiveKeyText(`prefix${key}@suffix`, liveKeyPatterns());
    expect(joined.value).toBe(`prefix[live key removed: ${fingerprint(key)}]@suffix`);
    expect(scanned.matches).toEqual([
      { key, fingerprint: fingerprint(key), services: ["Paystack", "Stripe"] },
    ]);
  });

  it("D43 replaces every occurrence and records one match per key", () => {
    const scanned = scanLiveKeyText(`${PAYSTACK} ${PAYSTACK} ${FLUTTERWAVE}`, liveKeyPatterns());
    expect(scanned.value.match(/\[live key removed:/gu)).toHaveLength(3);
    expect(scanned.matches.map((match) => match.key)).toEqual([PAYSTACK, FLUTTERWAVE]);
  });

  it("D43 scans nested arrays and objects without changing non-string values", () => {
    const scanned = scanLiveKeyValue(
      {
        email: PAYSTACK,
        nested: { keys: [FLUTTERWAVE, 4, true, null] },
        unchanged: "plain",
      },
      liveKeyPatterns(),
    );
    expect(scanned.value).toEqual({
      email: `[live key removed: ${fingerprint(PAYSTACK)}]`,
      nested: {
        keys: [`[live key removed: ${fingerprint(FLUTTERWAVE)}]`, 4, true, null],
      },
      unchanged: "plain",
    });
    expect(scanned.matches.map((match) => match.key)).toEqual([PAYSTACK, FLUTTERWAVE]);
  });

  it("D43 handles patterns without the global flag and a key ending in equals", () => {
    const key = "sk_live_SCANNER_END_EQUALS=";
    const scanned = scanLiveKeyText(`x ${key} y`, [
      { service: "Paystack", pattern: /\b(?:pk|sk)_live_[A-Za-z0-9._~+/=-]+/u },
    ]);
    expect(scanned.value).toBe(`x [live key removed: ${fingerprint(key)}] y`);
    expect(scanned.matches[0]?.services).toEqual(["Paystack"]);
  });

  it("D43 returns the original text and no matches when nothing matches", () => {
    const scanned = scanLiveKeyText("nothing secret here", liveKeyPatterns());
    expect(scanned).toEqual({ value: "nothing secret here", matches: [] });
    const scanner = createLiveKeyScanner([]);
    expect(scanner.patterns).toEqual([]);
    expect(scanner.scanText("nothing").value).toBe("nothing");
  });

  it("D43 scans headers, query values and nested JSON body values", () => {
    const scan = createTwinLiveKeyScanner(liveKeyPatterns());
    const scanned = scan(
      request({
        headers: {
          "content-type": "application/json",
          "x-review-key": PAYSTACK,
        },
        query: { note: FLUTTERWAVE, tags: [STRIPE_RESTRICTED, "plain"] },
        rawBody: new TextEncoder().encode(
          JSON.stringify({
            email: PAYSTACK_PUBLIC,
            metadata: { nested: { key: FLUTTERWAVE_PUBLIC } },
          }),
        ),
      }),
    );

    expect(scanned.request.headers["x-review-key"]).toBe(
      `[live key removed: ${fingerprint(PAYSTACK)}]`,
    );
    expect(scanned.request.query.note).toBe(`[live key removed: ${fingerprint(FLUTTERWAVE)}]`);
    expect(scanned.request.query.tags).toEqual([
      `[live key removed: ${fingerprint(STRIPE_RESTRICTED)}]`,
      "plain",
    ]);
    expect(new TextDecoder().decode(scanned.request.rawBody)).toContain(
      `[live key removed: ${fingerprint(PAYSTACK_PUBLIC)}]`,
    );
    expect(new TextDecoder().decode(scanned.request.rawBody)).toContain(
      `[live key removed: ${fingerprint(FLUTTERWAVE_PUBLIC)}]`,
    );
    expect(scanned.matches.map((match) => match.key)).toEqual([
      PAYSTACK,
      FLUTTERWAVE,
      STRIPE_RESTRICTED,
      PAYSTACK_PUBLIC,
      FLUTTERWAVE_PUBLIC,
    ]);
  });

  it("D43 scans form bodies and text bodies", () => {
    const scan = createTwinLiveKeyScanner(liveKeyPatterns());
    const form = scan(
      request({
        headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
        rawBody: new TextEncoder().encode(`email=${encodeURIComponent(PAYSTACK)}&plain=yes`),
      }),
    );
    expect(new TextDecoder().decode(form.request.rawBody)).toBe(
      new URLSearchParams({
        email: `[live key removed: ${fingerprint(PAYSTACK)}]`,
        plain: "yes",
      }).toString(),
    );
    expect(form.matches[0]?.key).toBe(PAYSTACK);

    const text = scan(
      request({
        headers: { "content-type": "text/plain" },
        rawBody: new TextEncoder().encode(`hello ${FLUTTERWAVE}`),
      }),
    );
    expect(new TextDecoder().decode(text.request.rawBody)).toBe(
      `hello [live key removed: ${fingerprint(FLUTTERWAVE)}]`,
    );
    expect(text.matches[0]?.key).toBe(FLUTTERWAVE);
  });

  it("D43 scans a malformed JSON body as text and a body with no content type", () => {
    const scan = createTwinLiveKeyScanner(liveKeyPatterns());
    const malformed = scan(
      request({
        rawBody: new TextEncoder().encode(`{"email":"${PAYSTACK}"`),
      }),
    );
    expect(new TextDecoder().decode(malformed.request.rawBody)).toBe(
      `{"email":"[live key removed: ${fingerprint(PAYSTACK)}]"`,
    );
    expect(malformed.matches[0]?.key).toBe(PAYSTACK);

    const noType = scan(
      request({
        headers: {},
        rawBody: new TextEncoder().encode(STRIPE_SECRET),
      }),
    );
    expect(new TextDecoder().decode(noType.request.rawBody)).toBe(
      `[live key removed: ${fingerprint(STRIPE_SECRET)}]`,
    );
    expect(noType.matches[0]?.key).toBe(STRIPE_SECRET);
  });

  it("D43 leaves a clean request unchanged", () => {
    const original = request({
      headers: { "content-type": "application/json", accept: "application/json" },
      query: { plain: ["one", "two"] },
      rawBody: new TextEncoder().encode('{"email":"customer@example.com"}'),
    });
    const scan = createTwinLiveKeyScanner(liveKeyPatterns());
    const scanned = scan(original);
    expect(scanned.matches).toEqual([]);
    expect(scanned.request.headers).toEqual(original.headers);
    expect(scanned.request.query).toEqual(original.query);
    expect(new TextDecoder().decode(scanned.request.rawBody)).toBe(
      '{"email":"customer@example.com"}',
    );
  });
});
