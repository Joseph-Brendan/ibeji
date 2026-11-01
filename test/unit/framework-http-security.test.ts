import { describe, expect, it } from "vitest";

import { IbejiError } from "../../src/core/errors.js";
import {
  applyHtmlSecurityHeaders,
  errorBody,
  errorResponseFrom,
  ibejiErrorResponse,
  isAllowedHost,
  isAllowedOrigin,
  MAX_BODY_BYTES,
} from "../../src/twins/framework/http-security.js";

describe("T6 shared HTTP security helpers", () => {
  it("T6 accepts 127.0.0.1 and localhost with the bound port, ignoring case and a trailing dot", () => {
    expect(isAllowedHost("127.0.0.1:4123", 4123)).toBe(true);
    expect(isAllowedHost("localhost:4123", 4123)).toBe(true);
    expect(isAllowedHost("LOCALHOST:4123", 4123)).toBe(true);
    expect(isAllowedHost("localhost.:4123", 4123)).toBe(true);
    expect(isAllowedHost("127.0.0.1.:4123", 4123)).toBe(true);
    expect(isAllowedHost("  127.0.0.1:4123  ", 4123)).toBe(true);
  });

  it("T6 rejects a missing or different Host header", () => {
    expect(isAllowedHost(undefined, 4123)).toBe(false);
    expect(isAllowedHost("", 4123)).toBe(false);
    expect(isAllowedHost("evil.com:4123", 4123)).toBe(false);
    expect(isAllowedHost("127.0.0.1.evil.com:4123", 4123)).toBe(false);
    expect(isAllowedHost("127.0.0.1:4124", 4123)).toBe(false);
    expect(isAllowedHost("localhost", 4123)).toBe(false);
  });

  it("T6 accepts only the server's own HTTP origin", () => {
    expect(isAllowedOrigin("http://127.0.0.1:4123", 4123)).toBe(true);
    expect(isAllowedOrigin("http://localhost:4123", 4123)).toBe(true);
    expect(isAllowedOrigin("HTTP://LOCALHOST:4123", 4123)).toBe(true);
    expect(isAllowedOrigin("http://localhost.:4123", 4123)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1.:4123", 4123)).toBe(true);
    expect(isAllowedOrigin(undefined, 4123)).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:4124", 4123)).toBe(false);
    expect(isAllowedOrigin("https://127.0.0.1:4123", 4123)).toBe(false);
    expect(isAllowedOrigin("http://evil.com:4123", 4123)).toBe(false);
    expect(isAllowedOrigin("null", 4123)).toBe(false);
  });

  it("T6 adds the C8 HTML security headers", () => {
    const headers = new Headers();
    applyHtmlSecurityHeaders(headers);

    expect(headers.get("content-security-policy")).toBe(
      "default-src 'self'; frame-ancestors 'none'",
    );
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("T6 builds the C12 error body and status", async () => {
    const response = ibejiErrorResponse("NOT_FOUND");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        what: "The requested item was not found.",
        why: "No item matches the identifier or path in the request.",
        fix: "Check the identifier or path and try again.",
      },
    });
  });

  it("T6 maps a CLI-only error with no HTTP status to INTERNAL", async () => {
    const response = errorResponseFrom(new IbejiError("PORT_IN_USE"));
    expect(response.status).toBe(500);
    expect(JSON.parse(errorBody(new IbejiError("PORT_IN_USE"))).error.code).toBe("PORT_IN_USE");
  });

  it("T6 exposes the 1 MB body limit", () => {
    expect(MAX_BODY_BYTES).toBe(1_048_576);
  });
});
