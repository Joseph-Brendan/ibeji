import { type ErrorCode, IbejiError } from "../../core/errors.js";

export const MAX_BODY_BYTES = 1_048_576;

/**
 * Compare a Host header with the port this server is actually bound to.
 * Comparison ignores case and a trailing dot on the host name, because both
 * are the same host to a browser and to DNS.
 */
export function isAllowedHost(value: string | undefined, port: number): boolean {
  if (value === undefined) {
    return false;
  }

  const host = value
    .trim()
    .toLowerCase()
    .replace(/\.(?=:|$)/gu, "");

  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/**
 * The browser Origin header must be the control or twin server's own origin.
 * Browsers send origins without a trailing dot, so this comparison is exact.
 */
export function isAllowedOrigin(value: string | undefined, port: number): boolean {
  if (value === undefined) {
    return false;
  }

  const origin = value
    .toLowerCase()
    .replace(/^http:\/\/(localhost|127\.0\.0\.1)\.:/u, "http://$1:");
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

/** C8's HTML protections: no framing and no content sniffing. */
function applyBaseHtmlSecurityHeaders(headers: Headers): void {
  headers.set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'");
  headers.set("X-Content-Type-Options", "nosniff");
}

/** C8's ordinary HTML protections: no framing, no referrer, and no content sniffing. */
export function applyHtmlSecurityHeaders(headers: Headers): void {
  applyBaseHtmlSecurityHeaders(headers);
  headers.set("Referrer-Policy", "no-referrer");
}

/**
 * Checkout pages need the same protections, but a form POST from Chromium sends
 * Origin: null when Referrer-Policy is no-referrer. Same-origin keeps the Origin
 * check working and still never sends a referrer to another site.
 */
export function applyCheckoutSecurityHeaders(headers: Headers): void {
  applyBaseHtmlSecurityHeaders(headers);
  headers.set("Referrer-Policy", "same-origin");
}

export function errorBody(error: IbejiError): string {
  return JSON.stringify({
    error: {
      code: error.code,
      what: error.what,
      why: error.why,
      fix: error.fix,
    },
  });
}

/** Build the C12 JSON response for an HTTP error code. */
export function ibejiErrorResponse(code: ErrorCode): Response {
  return errorResponseFrom(new IbejiError(code));
}

/**
 * Build a C12 JSON response from any Ibeji error. Codes that only exist for
 * the CLI have no HTTP status; over HTTP they become INTERNAL.
 */
export function errorResponseFrom(error: IbejiError): Response {
  return new Response(errorBody(error), {
    status: error.status ?? 500,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
