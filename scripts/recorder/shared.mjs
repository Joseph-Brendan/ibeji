import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

export const VALID_SERVICES = ["paystack", "flutterwave", "stripe"];

/**
 * Reserved example.com addresses used for every customer email the recorder
 * sends or saves. T13 accepts only these addresses, so a real address can never
 * pass the fixture privacy scan.
 */
export const FAKE_EMAILS = [
  "customer.one@example.com",
  "customer.two@example.com",
  "customer.three@example.com",
];
export const RECORDER_EMAIL = FAKE_EMAILS[0];

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-type",
  "request-id",
  "idempotent-replayed",
  "stripe-version",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
]);

const KEY_FIELD_NAMES = new Set([
  "authorization",
  "api_key",
  "apikey",
  "secret",
  "secret_key",
  "secretkey",
  "idempotency-key",
  "idempotency_key",
  "password",
  "signature",
  "verif-hash",
  "verif_hash",
  "stripe-signature",
  "stripe_signature",
]);

const CLIENT_SECRET_FIELD_NAMES = new Set(["client_secret", "clientsecret"]);
const TOKEN_FIELD_NAMES = new Set(["token", "access_token", "refresh_token", "pin", "otp"]);
const AUTH_CODE_FIELD_NAMES = new Set([
  "authorization_code",
  "authorizationcode",
  "auth_code",
  "authcode",
  "access_code",
  "accesscode",
]);
const EMAIL_FIELD_NAMES = new Set([
  "email",
  "customer_email",
  "receipt_email",
  "sender_email_address",
]);
const PHONE_FIELD_NAMES = new Set([
  "phone",
  "phone_number",
  "phonenumber",
  "mobile",
  "mobile_number",
  "sender_mobile_number",
  "beneficiary_mobile_number",
  "telephone",
]);
const ACCOUNT_FIELD_NAMES = new Set([
  "account_number",
  "accountnumber",
  "account",
  "bank_account",
  "bank_account_number",
  "recipient_account",
]);
const NAME_FIELD_NAMES = new Set([
  "name",
  "first_name",
  "firstname",
  "last_name",
  "lastname",
  "full_name",
  "customer_name",
  "account_name",
  "beneficiary_name",
  "sender_name",
  "cardholder_name",
  "recipient_name",
]);
const EMAIL_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const BEARER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const CLIENT_SECRET_PATTERN = /\b(?:pi|cs|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/g;
const PHONE_PATTERN = /^\+(?:\d[\s().-]*){7,}\d$/;
const PHONE_TEXT_PATTERN = /\+(?:\d[\s().-]*){7,}\d/g;

/**
 * Return the first 8 hexadecimal characters of the SHA-256 hash. This is the
 * only representation of a key that the recorder may print.
 */
export function fingerprintKey(key) {
  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 8);
}

/**
 * A key result is intentionally data, not an exception, so the CLI can exit
 * with code 1 without making any request.
 */
export function validateKey(meta, key) {
  if (typeof key !== "string" || key.trim() === "") {
    return {
      ok: false,
      code: "missing",
      message: `${meta.envName} is missing. What: the recorder needs ${meta.displayName}'s test secret key. Why: the environment variable is empty or unset. Fix: set ${meta.envName} to the ${meta.displayName} test secret key and run the recorder again.`,
    };
  }

  const trimmed = key.trim();

  if (meta.liveKeys.some((pattern) => pattern.test(trimmed))) {
    return {
      ok: false,
      code: "live",
      message: `${meta.envName} contains a live key (length ${trimmed.length}, fingerprint ${fingerprintKey(trimmed)}). What: the recorder refuses live keys. Why: live keys can move real money and must never be used with Ibeji. Fix: replace ${meta.envName} with the ${meta.displayName} test secret key.`,
    };
  }

  if (!meta.testKey.test(trimmed)) {
    return {
      ok: false,
      code: "wrong-format",
      message: `${meta.envName} does not match the ${meta.displayName} test secret-key format (length ${trimmed.length}, fingerprint ${fingerprintKey(trimmed)}). What: the recorder refuses this key. Why: it is not a test secret key in the format recorded in research, or it contains whitespace or hidden characters outside that format. Fix: copy the ${meta.displayName} test secret key again with the dashboard's copy button and run the recorder again.`,
    };
  }

  return { ok: true, code: "valid", key: trimmed };
}

/**
 * A stop raised by the recorder itself. Its message already has what, why, and
 * fix, and never includes a key.
 */
export class RecorderStopError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecorderStopError";
  }
}

export class KeyRejectedError extends RecorderStopError {
  constructor(message) {
    super(message);
    this.name = "KeyRejectedError";
  }
}

/**
 * Return the service's own error message and code from a response body. Paystack
 * and Flutterwave put them at the top level; Stripe nests them under `error`.
 */
export function extractServiceError(body) {
  if (typeof body === "string") {
    const text = body.trim();
    return {
      message: text === "" ? undefined : text.slice(0, 500),
      code: undefined,
    };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { message: undefined, code: undefined };
  }

  const nested = body.error;
  if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
    const message = nested.message;
    const code = nested.code;
    return {
      message: typeof message === "string" ? message : undefined,
      code: typeof code === "string" ? code : undefined,
    };
  }

  const message = body.message;
  const code = body.code;
  return {
    message:
      typeof message === "string" ? message : typeof nested === "string" ? nested : undefined,
    code: typeof code === "string" ? code : undefined,
  };
}

function describeServiceError(status, body, redactor) {
  const info = extractServiceError(body);
  const message =
    info.message === undefined
      ? "(the response body had no error message)"
      : redactor.redactText(info.message);
  const code = info.code === undefined ? "" : ` Code: ${redactor.redactText(info.code)}.`;
  return `HTTP ${status}. Service message: ${message}.${code}`;
}

export function keyRejectionMessage({ meta, status, body, redactor, action }) {
  const detail = describeServiceError(status, body, redactor);
  const where =
    action === undefined
      ? "before recording anything"
      : `while recording ${action}; the run stopped and that request is saved as a skipped fixture for review`;
  return (
    `${meta.displayName} rejected the test secret key ${where}. ${detail} ` +
    `What: the key was rejected, so the recorder stopped. ` +
    `Why: an authenticated request with this key did not succeed. ` +
    `Fix: check all of these and run the recorder again: ` +
    `(1) test mode is on in the ${meta.displayName} dashboard; ` +
    `(2) the test secret key was copied again with the dashboard's copy button; ` +
    `(3) you are in the right business or account.`
  );
}

export function preflightFailureMessage({ meta, status, body, redactor }) {
  const detail = describeServiceError(status, body, redactor);
  return (
    `${meta.displayName} did not answer the recorder's key-check list request. ${detail} ` +
    `What: the recorder stopped before recording anything and saved nothing. ` +
    `Why: the authenticated list request did not return a 2xx response. ` +
    `Fix: check ${meta.displayName}'s status and this computer's network, then run the recorder again.`
  );
}

export function authorizationHeader(meta, key, invalid = false) {
  if (meta.auth === "basic") {
    return `Basic ${Buffer.from(`${invalid ? "invalid-ibeji-recorder" : key}:`, "utf8").toString("base64")}`;
  }
  return `Bearer ${invalid ? "invalid-ibeji-recorder" : key}`;
}

export function encodeJson(value) {
  return JSON.stringify(value);
}

export function encodeForm(value) {
  const params = new URLSearchParams();
  appendForm(params, value, "");
  return params.toString();
}

function appendForm(params, value, prefix) {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    const hasObjectItems = value.some((item) => item !== null && typeof item === "object");
    if (hasObjectItems) {
      value.forEach((item, index) => {
        appendForm(params, item, `${prefix}[${index}]`);
      });
      return;
    }
    for (const item of value) {
      params.append(`${prefix}[]`, String(item));
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const nextPrefix = prefix === "" ? key : `${prefix}[${key}]`;
      appendForm(params, item, nextPrefix);
    }
    return;
  }
  params.append(prefix, String(value));
}

export function readResponseField(result, fieldPath) {
  if (result === null || typeof result !== "object") {
    return undefined;
  }
  let current = result.responseBody;
  for (const segment of fieldPath.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else {
      current = current[segment];
    }
  }
  return current;
}

export function responseData(result) {
  return readResponseField(result, "data");
}

function responseTopLevelFields(result) {
  const body = result === null || typeof result !== "object" ? undefined : result.responseBody;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "(response body is not a JSON object)";
  }
  const keys = Object.keys(body);
  return keys.length === 0 ? "(none)" : keys.join(", ");
}

export function requireResponseField(result, action, fieldPath, expectedType) {
  const value = readResponseField(result, fieldPath);
  const typeMatches =
    expectedType === undefined ||
    (expectedType === "array" ? Array.isArray(value) : typeof value === expectedType);
  if (value === undefined || value === null || !typeMatches) {
    throw new RecorderStopError(
      `${action} returned HTTP ${result.status} but the field ${fieldPath} was missing or invalid. ` +
        `What: the recorder needs ${fieldPath} to build the next step. ` +
        `Why: the successful response did not contain a usable ${fieldPath}. ` +
        `Top-level fields present: ${responseTopLevelFields(result)}. ` +
        `Fix: check the saved fixture for ${action}, correct the recorder's field path, and run it again.`,
    );
  }
  return value;
}

export function makeReference(prefix, separator = "_") {
  return `${prefix}${separator}${Date.now()}${separator}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function createPrompt() {
  const readline = createInterface({ input: stdin, output: stdout });
  return {
    ask: (question) => readline.question(question),
    close: () => readline.close(),
  };
}

export class Redactor {
  constructor(options = {}) {
    this.keyPatterns = options.keyPatterns ?? [];
    this.replacements = new Map();
    this.counters = new Map();
  }

  redact(value, fieldName = "", path = []) {
    if (Array.isArray(value)) {
      return value.map((item, index) => this.redact(item, fieldName, [...path, String(index)]));
    }
    if (value !== null && typeof value === "object") {
      const output = {};
      for (const [key, item] of Object.entries(value)) {
        output[key] = this.redact(item, key, [...path, key]);
      }
      return output;
    }
    if (typeof value === "number" && this.isSensitiveField(fieldName, path)) {
      return this.redactString(String(value), fieldName, path);
    }
    if (typeof value === "string") {
      return this.redactString(value, fieldName, path);
    }
    return value;
  }

  redactText(value) {
    return this.redactString(value, "", []);
  }

  redactString(value, fieldName = "", path = []) {
    if (this.replacements.has(value)) {
      return this.replacements.get(value);
    }

    const normalized = fieldName.toLowerCase();
    if (KEY_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "key");
    }
    if (CLIENT_SECRET_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "client-secret");
    }
    if (AUTH_CODE_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "auth-code");
    }
    if (TOKEN_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "token");
    }
    if (EMAIL_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "email");
    }
    if (PHONE_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "phone");
    }
    if (ACCOUNT_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "account");
    }
    if (NAME_FIELD_NAMES.has(normalized)) {
      return this.fakeFor(value, "name");
    }
    if (normalized === "ip" || normalized === "ip_address" || normalized === "remote_addr") {
      return this.fakeFor(value, "ip");
    }
    if (normalized === "cvc" || normalized === "cvv" || normalized === "security_code") {
      return this.fakeFor(value, "cvc");
    }
    if (normalized === "last4" || normalized === "card_last4" || normalized === "cardlast4") {
      return this.fakeFor(value, "last4");
    }
    if (normalized === "exp_month") {
      return this.fakeFor(value, "exp-month");
    }
    if (normalized === "exp_year") {
      return this.fakeFor(value, "exp-year");
    }
    if (normalized === "expiry" || normalized === "expiry_date") {
      return this.fakeFor(value, "expiry");
    }
    if (
      normalized === "card_number" ||
      normalized === "cardnumber" ||
      (normalized === "number" && path.some((part) => part.toLowerCase().includes("card")))
    ) {
      return this.fakeFor(value, "card");
    }

    let output = value;
    for (const pattern of this.keyPatterns) {
      output = output.replace(pattern, (match) => this.fakeFor(match, "key"));
    }
    output = output.replace(BEARER_PATTERN, (match) => this.fakeFor(match, "key"));
    output = output.replace(JWT_PATTERN, (match) => this.fakeFor(match, "token"));
    output = output.replace(CLIENT_SECRET_PATTERN, (match) => this.fakeFor(match, "client-secret"));
    output = output.replace(EMAIL_PATTERN, (match) =>
      isFakeEmail(match) ? match : this.fakeFor(match, "email"),
    );
    output = output.replace(IPV4_PATTERN, (match) => this.fakeFor(match, "ip"));
    output = output.replace(PHONE_TEXT_PATTERN, (match) =>
      isFakePhone(match) ? match : this.fakeFor(match, "phone"),
    );

    if (isCardLike(output)) {
      output = this.fakeFor(output, "card");
    } else if (PHONE_PATTERN.test(output)) {
      output = this.fakeFor(output, "phone");
    } else if (normalized === "idempotency_key" || normalized === "idempotency-key") {
      output = this.fakeFor(output, "key");
    }

    return output;
  }

  isSensitiveField(fieldName, path) {
    const normalized = fieldName.toLowerCase();
    return (
      KEY_FIELD_NAMES.has(normalized) ||
      CLIENT_SECRET_FIELD_NAMES.has(normalized) ||
      TOKEN_FIELD_NAMES.has(normalized) ||
      AUTH_CODE_FIELD_NAMES.has(normalized) ||
      EMAIL_FIELD_NAMES.has(normalized) ||
      PHONE_FIELD_NAMES.has(normalized) ||
      ACCOUNT_FIELD_NAMES.has(normalized) ||
      NAME_FIELD_NAMES.has(normalized) ||
      normalized === "ip" ||
      normalized === "ip_address" ||
      normalized === "cvc" ||
      normalized === "cvv" ||
      normalized === "last4" ||
      normalized === "card_last4" ||
      normalized === "cardlast4" ||
      normalized === "exp_month" ||
      normalized === "exp_year" ||
      normalized === "expiry" ||
      normalized === "card_number" ||
      normalized === "cardnumber" ||
      (normalized === "number" && path.some((part) => part.toLowerCase().includes("card")))
    );
  }

  fakeFor(realValue, category) {
    if (this.replacements.has(realValue)) {
      return this.replacements.get(realValue);
    }
    const next = (this.counters.get(category) ?? 0) + 1;
    this.counters.set(category, next);
    let fake;
    switch (category) {
      case "email":
        fake = FAKE_EMAILS[(next - 1) % FAKE_EMAILS.length];
        break;
      case "name":
        fake = `Test Name ${next}`;
        break;
      case "phone":
        fake = `+1555${String(next).padStart(7, "0")}`;
        break;
      case "account":
        fake = `000000${String(next).padStart(4, "0")}`;
        break;
      case "ip":
        fake = `203.0.113.${next}`;
        break;
      case "card":
        fake = "0000000000000000";
        break;
      case "cvc":
        fake = "000";
        break;
      case "last4":
        fake = "0000";
        break;
      case "exp-month":
        fake = "12";
        break;
      case "exp-year":
        fake = "2099";
        break;
      case "expiry":
        fake = "12/2099";
        break;
      case "client-secret":
        fake = `[REDACTED_CLIENT_SECRET_${next}]`;
        break;
      case "token":
        fake = `[REDACTED_TOKEN_${next}]`;
        break;
      case "auth-code":
        fake = `[REDACTED_AUTH_CODE_${next}]`;
        break;
      default:
        fake = `[REDACTED_KEY_${next}]`;
        break;
    }
    this.replacements.set(realValue, fake);
    return fake;
  }
}

export function isFakeEmail(value) {
  const normalized = value.toLowerCase();
  return FAKE_EMAILS.some((email) => email.toLowerCase() === normalized);
}

export function isFakePhone(value) {
  return /^\+1555\d{7}$/.test(value);
}

export function isFakeName(value) {
  return /^Test Name \d+$/.test(value);
}

export function isFakeAccount(value) {
  return /^0{6}\d{4}$/.test(value);
}

function isCardLike(value) {
  const digits = value.replaceAll(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = Number(digits[index]);
    let valueToAdd = digit;
    if (double) {
      valueToAdd *= 2;
      if (valueToAdd > 9) {
        valueToAdd -= 9;
      }
    }
    sum += valueToAdd;
    double = !double;
  }
  return sum % 10 === 0;
}

function parseBody(text, contentType) {
  if (text === "") {
    return null;
  }
  if (contentType.includes("json") || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function redactRequestBody(body, contentType, redactor) {
  if (body === null || body === undefined || body === "") {
    return null;
  }
  if (contentType.includes("json")) {
    try {
      return JSON.stringify(redactor.redact(JSON.parse(body)));
    } catch {
      return redactor.redactText(body);
    }
  }
  if (contentType.includes("x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    const redacted = new URLSearchParams();
    for (const [key, value] of params) {
      const segments = key.split(/[[\]]+/).filter((segment) => segment !== "");
      const fieldName = segments.at(-1) ?? key;
      redacted.append(key, String(redactor.redact(value, fieldName, segments)));
    }
    return redacted.toString();
  }
  return redactor.redactText(body);
}

function redactResponseHeaders(headers, redactor) {
  const output = {};
  for (const [name, value] of Object.entries(headers)) {
    if (RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase())) {
      output[name.toLowerCase()] = redactor.redactText(value);
    }
  }
  return output;
}

export async function saveFixture({
  cwd,
  service,
  action,
  outcome,
  recordedAt,
  method,
  path,
  query,
  requestBody,
  status,
  responseHeaders,
  responseBody,
  note,
  fileName,
}) {
  const directory = join(cwd, "fixtures", service);
  await mkdir(directory, { recursive: true });
  const slug = action.replaceAll(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const file = join(directory, fileName ?? `${slug}-${outcome}.json`);
  const fixture = {
    action,
    outcome,
    ...(note === undefined ? {} : { note }),
    recordedAt,
    method,
    path,
    query,
    requestBody,
    status,
    responseHeaders,
    responseBody,
  };
  await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return file;
}

/**
 * Save a failed or skipped step for review. These files always carry
 * `outcome: "skipped"`; T3 must never use them as expected answers.
 */
export async function saveSkippedFixture({
  cwd,
  service,
  action,
  reason,
  recordedAt,
  method,
  path,
  query,
  requestBody,
  requestContentType,
  status,
  responseHeaders,
  responseBody,
  note,
}) {
  const directory = join(cwd, "fixtures", service);
  await mkdir(directory, { recursive: true });
  const safeAction =
    action.replaceAll(/[^a-z0-9._-]+/gi, "-").replace(/^[.-]+|[.-]+$/g, "") || "step";
  const file = join(directory, `${safeAction}.skipped.json`);
  const fixture = {
    action,
    outcome: "skipped",
    reason,
    ...(note === undefined ? {} : { note }),
    recordedAt,
    method: method ?? null,
    path: path ?? null,
    query: query ?? null,
    requestBody: requestBody ?? null,
    requestContentType: requestContentType ?? null,
    status: status ?? null,
    responseHeaders: responseHeaders ?? {},
    responseBody: responseBody ?? null,
  };
  await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return file;
}

function serviceSucceeded(meta, status, body) {
  return meta.isSuccess(status, body);
}

export function createRecorderContext({
  meta,
  key,
  baseUrl = meta.baseUrl,
  cwd = process.cwd(),
  fetchImpl = globalThis.fetch,
  prompt = createPrompt(),
  redactor,
  now = () => new Date(),
}) {
  const activeRedactor = redactor ?? new Redactor({ keyPatterns: meta.keyPatterns });
  const results = [];
  const state = new Map();

  function redactedRequestResponse(result) {
    return {
      path: activeRedactor.redactText(result.path),
      query: activeRedactor.redact(result.query),
      requestBody: redactRequestBody(
        result.requestBody,
        result.requestContentType ?? "",
        activeRedactor,
      ),
      responseHeaders: redactResponseHeaders(result.responseHeaders, activeRedactor),
      responseBody: activeRedactor.redact(result.responseBody),
    };
  }

  function serviceError(result) {
    const info = extractServiceError(result.responseBody);
    return {
      message: info.message === undefined ? undefined : activeRedactor.redactText(info.message),
      code: info.code === undefined ? undefined : activeRedactor.redactText(info.code),
    };
  }

  function failureReason(result) {
    if (result.status === 0) {
      return "no response";
    }
    const error = serviceError(result);
    if (error.message === undefined && error.code === undefined) {
      return `HTTP ${result.status}`;
    }
    const code = error.code === undefined ? "" : ` (${error.code})`;
    return `HTTP ${result.status}: ${error.message ?? "service error"}${code}`;
  }

  function inputErrorNote(status) {
    return `The service returned ${status} for an input error, not a key error.`;
  }

  function pushResult(action, result, outcome, reason, file, note) {
    const error = serviceError(result);
    results.push({
      action,
      outcome,
      status: result.status,
      reason,
      file,
      serviceMessage: error.message,
      serviceCode: error.code,
      note,
    });
  }

  async function saveSkipped(result, action, reason, note) {
    const redacted = redactedRequestResponse(result);
    return saveSkippedFixture({
      cwd,
      service: meta.id,
      action,
      reason,
      note,
      recordedAt: now().toISOString(),
      method: result.method,
      path: redacted.path,
      query: redacted.query,
      requestBody: redacted.requestBody,
      requestContentType: result.requestContentType,
      status: result.status,
      responseHeaders: redacted.responseHeaders,
      responseBody: redacted.responseBody,
    });
  }

  async function send({
    method,
    path,
    query,
    body = null,
    contentType = meta.requestFormat === "form"
      ? "application/x-www-form-urlencoded"
      : "application/json",
    invalidKey = false,
    headers: extraHeaders = {},
  }) {
    const url = new URL(path, baseUrl);
    if (query !== undefined && query !== null) {
      for (const [name, value] of Object.entries(query)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(name, String(item));
          }
        } else {
          url.searchParams.append(name, String(value));
        }
      }
    }
    const headers = {
      accept: "application/json",
      ...extraHeaders,
      authorization: authorizationHeader(meta, key, invalidKey),
    };
    if (body !== null) {
      headers["content-type"] = contentType;
    }

    const printableBody = redactRequestBody(body, contentType, activeRedactor);
    console.log(`Request: ${method} ${activeRedactor.redactText(path)}`);
    if (query !== undefined && query !== null) {
      console.log(`Query: ${JSON.stringify(activeRedactor.redact(query))}`);
    }
    console.log(`Body: ${printableBody === null ? "(none)" : printableBody}`);

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      const responseHeaders = {};
      for (const [name, value] of response.headers) {
        responseHeaders[name] = value;
      }
      return {
        method,
        path,
        query: query ?? null,
        requestBody: body,
        requestContentType: body === null ? null : contentType,
        status: response.status,
        responseHeaders,
        responseBody: parseBody(text, response.headers.get("content-type") ?? ""),
      };
    } catch (error) {
      return {
        method,
        path,
        query: query ?? null,
        requestBody: body,
        requestContentType: body === null ? null : contentType,
        status: 0,
        responseHeaders: {},
        responseBody: {
          error: "request failed before a response was received",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async function preflight() {
    const request = meta.preflight;
    const result = await send({
      method: request.method,
      path: request.path,
      query: request.query,
    });
    if (result.status >= 200 && result.status < 300) {
      return result;
    }
    if (result.status === 401 || result.status === 403) {
      throw new KeyRejectedError(
        keyRejectionMessage({
          meta,
          status: result.status,
          body: result.responseBody,
          redactor: activeRedactor,
        }),
      );
    }
    throw new RecorderStopError(
      preflightFailureMessage({
        meta,
        status: result.status,
        body: result.responseBody,
        redactor: activeRedactor,
      }),
    );
  }

  async function record({
    action,
    method,
    path,
    query,
    body = null,
    contentType,
    outcome,
    failureOutcome,
    failureMatches,
    failureFileName,
    invalidKey = false,
    headers,
  }) {
    const result = await send({ method, path, query, body, contentType, invalidKey, headers });
    const authStatus = result.status === 401 || result.status === 403;
    const keyError =
      !invalidKey && authStatus && meta.isKeyError(result.status, result.responseBody);

    if (keyError) {
      const reason = `key rejected: ${failureReason(result)}`;
      const file = await saveSkipped(result, action, reason);
      pushResult(action, result, "skipped", reason, file);
      throw new KeyRejectedError(
        keyRejectionMessage({
          meta,
          status: result.status,
          body: result.responseBody,
          redactor: activeRedactor,
          action,
        }),
      );
    }

    const success = serviceSucceeded(meta, result.status, result.responseBody);
    const expectedFailure =
      result.status !== 0 &&
      !success &&
      failureOutcome !== undefined &&
      (failureMatches === undefined || failureMatches(result));
    const note =
      !invalidKey && authStatus && !keyError && !expectedFailure
        ? inputErrorNote(result.status)
        : undefined;

    if (expectedFailure) {
      const redacted = redactedRequestResponse(result);
      const stored = await saveFixture({
        cwd,
        service: meta.id,
        action,
        outcome: failureOutcome,
        note,
        fileName: failureFileName,
        recordedAt: now().toISOString(),
        method: result.method,
        path: redacted.path,
        query: redacted.query,
        requestBody: redacted.requestBody,
        status: result.status,
        responseHeaders: redacted.responseHeaders,
        responseBody: redacted.responseBody,
      });
      pushResult(action, result, failureOutcome, undefined, stored, note);
      return { ...result, ok: false, file: stored };
    }
    const outcomeIsResolver = typeof outcome === "function";
    const expectedSuccess =
      !outcomeIsResolver &&
      (outcome === undefined ||
        outcome === "setup" ||
        outcome === "idempotent-original" ||
        outcome === "idempotent-replay");

    if (result.status === 0 || (expectedSuccess && !success) || (outcomeIsResolver && !success)) {
      const reason = failureReason(result);
      const file = await saveSkipped(result, action, reason, note);
      pushResult(action, result, "skipped", reason, file, note);
      return { ...result, ok: false, file };
    }

    const effectiveOutcome = outcomeIsResolver
      ? outcome({ status: result.status, responseBody: result.responseBody, ok: success })
      : (outcome ?? (invalidKey ? "invalid-key" : success ? "success" : "skipped"));
    const redacted = redactedRequestResponse(result);
    const stored = await saveFixture({
      cwd,
      service: meta.id,
      action,
      outcome: effectiveOutcome,
      note,
      recordedAt: now().toISOString(),
      method: result.method,
      path: redacted.path,
      query: redacted.query,
      requestBody: redacted.requestBody,
      status: result.status,
      responseHeaders: redacted.responseHeaders,
      responseBody: redacted.responseBody,
    });
    pushResult(action, result, effectiveOutcome, undefined, stored, note);
    return { ...result, ok: success, file: stored };
  }

  async function skip(action, reason) {
    const file = await saveSkippedFixture({
      cwd,
      service: meta.id,
      action,
      reason,
      recordedAt: now().toISOString(),
      method: null,
      path: null,
      query: null,
      requestBody: null,
      requestContentType: null,
      status: null,
      responseHeaders: {},
      responseBody: null,
    });
    results.push({ action, outcome: "skipped", status: null, reason, file });
  }

  async function recordInvalid(action, request) {
    const result = await send({ ...request, invalidKey: false });
    const authStatus = result.status === 401 || result.status === 403;
    const keyError = authStatus && meta.isKeyError(result.status, result.responseBody);

    if (keyError) {
      const reason = `key rejected: ${failureReason(result)}`;
      const file = await saveSkipped(result, action, reason);
      pushResult(action, result, "skipped", reason, file);
      throw new KeyRejectedError(
        keyRejectionMessage({
          meta,
          status: result.status,
          body: result.responseBody,
          redactor: activeRedactor,
          action,
        }),
      );
    }

    if (
      result.status === 0 ||
      (result.status >= 300 && result.status < 400) ||
      result.status >= 500
    ) {
      const reason =
        result.status === 0
          ? "no response"
          : `service error while testing wrong input: ${failureReason(result)}`;
      const file = await saveSkipped(result, action, reason);
      pushResult(action, result, "skipped", reason, file);
      return { ...result, ok: false, file };
    }

    const lenient = result.status >= 200 && result.status < 300;
    const effectiveOutcome = lenient ? "lenient-input" : "invalid-request";
    const inputNote = authStatus ? inputErrorNote(result.status) : undefined;
    const note = lenient
      ? `${meta.displayName} accepted the deliberately wrong input with HTTP ${result.status}; saved as lenient-input instead of invalid-request.`
      : inputNote;
    const redacted = redactedRequestResponse(result);
    const stored = await saveFixture({
      cwd,
      service: meta.id,
      action,
      outcome: effectiveOutcome,
      note,
      recordedAt: now().toISOString(),
      method: result.method,
      path: redacted.path,
      query: redacted.query,
      requestBody: redacted.requestBody,
      status: result.status,
      responseHeaders: redacted.responseHeaders,
      responseBody: redacted.responseBody,
    });
    pushResult(action, result, effectiveOutcome, undefined, stored, note);
    return { ...result, ok: false, file: stored };
  }

  async function recordInvalidKey(action, request) {
    const result = await send({ ...request, invalidKey: true });

    if (result.status === 0) {
      const reason = "no response";
      const file = await saveSkipped(result, action, reason);
      pushResult(action, result, "skipped", reason, file);
      return { ...result, ok: false, file };
    }

    const accepted = result.status >= 200 && result.status < 300;
    const note = accepted
      ? `${meta.displayName} accepted the deliberately wrong key with HTTP ${result.status}; saved as invalid-key with this note.`
      : undefined;
    const redacted = redactedRequestResponse(result);
    const stored = await saveFixture({
      cwd,
      service: meta.id,
      action,
      outcome: "invalid-key",
      recordedAt: now().toISOString(),
      method: result.method,
      path: redacted.path,
      query: redacted.query,
      requestBody: redacted.requestBody,
      status: result.status,
      responseHeaders: redacted.responseHeaders,
      responseBody: redacted.responseBody,
    });
    pushResult(action, result, "invalid-key", undefined, stored, note);
    return { ...result, ok: !accepted, file: stored };
  }

  async function promptCheckout({ title, url, card, extra }) {
    console.log("");
    console.log(title);
    console.log(`Link: ${url}`);
    console.log(`Test card: ${card}`);
    if (extra !== undefined && extra !== "") {
      console.log(extra);
    }
    console.log("Open the link, finish the test checkout, then return here.");
    await prompt.ask("Press Enter after the checkout page is finished...");
  }

  return {
    meta,
    keyFingerprint: fingerprintKey(key),
    state,
    results,
    preflight,
    record,
    skip,
    recordInvalid,
    recordInvalidKey,
    promptCheckout,
    ask: (question) => prompt.ask(question),
    close: () => prompt.close(),
  };
}

export async function scanFixtures(root = "fixtures", keyPatterns = []) {
  const base = resolve(root);
  const files = [];
  const problems = [];
  const services = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".json")) {
        files.push(full);
      }
    }
  }

  try {
    const rootEntries = await readdir(base, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isDirectory() && !services.includes(entry.name)) {
        services.push(entry.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  await walk(base);
  for (const file of files) {
    const relativePath = file.slice(base.length + 1);
    const service = relativePath.split(/[\\/]/)[0] ?? "";
    if (!services.includes(service)) {
      services.push(service);
    }
    let data;
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch {
      problems.push({ file: relativePath, kind: "invalid-json", fingerprint: null });
      continue;
    }
    scanValue(data, relativePath, "", [], problems, keyPatterns);
  }
  return { files, services: services.sort(), problems };
}

function scanValue(value, file, fieldName, path, problems, keyPatterns) {
  if (Array.isArray(value)) {
    for (const item of value) {
      scanValue(item, file, fieldName, path, problems, keyPatterns);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      scanValue(item, file, key, [...path, key], problems, keyPatterns);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }

  for (const pattern of keyPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      problems.push({ file, kind: "key", fingerprint: fingerprintKey(value) });
      break;
    }
  }

  const emails = value.match(EMAIL_PATTERN) ?? [];
  for (const email of emails) {
    if (!isFakeEmail(email)) {
      problems.push({ file, kind: "email", fingerprint: fingerprintKey(email) });
    }
  }

  const normalized = fieldName.toLowerCase();
  if (PHONE_FIELD_NAMES.has(normalized) || PHONE_PATTERN.test(value)) {
    if (PHONE_FIELD_NAMES.has(normalized) || value.startsWith("+")) {
      if (!isFakePhone(value)) {
        problems.push({ file, kind: "phone", fingerprint: fingerprintKey(value) });
      }
    }
  }
  if (ACCOUNT_FIELD_NAMES.has(normalized) && !isFakeAccount(value)) {
    problems.push({ file, kind: "account", fingerprint: fingerprintKey(value) });
  }
  if (NAME_FIELD_NAMES.has(normalized) && !isFakeName(value)) {
    problems.push({ file, kind: "name", fingerprint: fingerprintKey(value) });
  }
}
