import { describe, expect, it } from "vitest";
import { buildSessionExport } from "../../src/control/export.js";
import { SecretRedactor } from "../../src/control/redact.js";
import { FakeClock } from "../../src/core/clock.js";
import { EventLog } from "../../src/core/events.js";
import { fingerprint } from "../../src/core/redact.js";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import { paystackTwin } from "../../src/twins/paystack/definition.js";
import { liveKeyPatterns } from "../../src/twins/registry.js";

const definitions = [paystackTwin, flutterwaveTwin];
const token = "session-token-value";
const uiToken = "ui-token-value";
const launchCode = "launch-code-value";
const credential = "sk_test_ibeji_export_test_0001";
const liveKey = ["sk", "live", "ibeji_export_test_0001"].join("_");

function redactor(): SecretRedactor {
  return SecretRedactor.forSecrets(
    [token, uiToken, launchCode],
    [credential],
    definitions,
    liveKeyPatterns(),
  );
}

describe("T6 export and event redaction", () => {
  it("T6 replaces tokens, launch codes, credentials, and live keys", () => {
    const value = redactor().redactValue({
      token,
      nested: {
        ui: uiToken,
        code: launchCode,
        credential,
        liveKey,
        keep: "ordinary",
      },
      list: [token, credential],
    });

    expect(value).toEqual({
      token: "[redacted]",
      nested: {
        ui: "[redacted]",
        code: "[redacted]",
        credential: fingerprint(credential),
        liveKey: `[live key removed: ${fingerprint(liveKey)}]`,
        keep: "ordinary",
      },
      list: ["[redacted]", fingerprint(credential)],
    });
  });

  it("T6 removes authorization and signature values from header objects", () => {
    const value = redactor().redactValue({
      responseHeaders: {
        authorization: "Bearer something",
        "x-paystack-signature": "signature",
        "content-type": "application/json",
      },
      headers: {
        cookie: "ibeji_ui=value",
        accept: "application/json",
      },
    });

    expect(value).toEqual({
      responseHeaders: { "content-type": "application/json" },
      headers: { accept: "application/json" },
    });
  });

  it("T6 scrubs text used in an error message", () => {
    expect(redactor().redactText(`Bad token ${token} and key ${credential}`)).toBe(
      `Bad token [redacted] and key ${fingerprint(credential)}`,
    );
    expect(redactor().redactText(`Bad field prefix ${liveKey} suffix`)).toBe(
      `Bad field prefix [live key removed: ${fingerprint(liveKey)}] suffix`,
    );
  });

  it("T6 builds the C9 export without secrets and with credential fingerprints", () => {
    const clock = new FakeClock(1_000);
    const events = new EventLog(clock);
    events.publish({
      type: "warning",
      scope: "ibeji",
      summary: `Started with ${credential}.`,
      details: { key: liveKey },
    });

    const value = buildSessionExport({
      version: "0.0.0",
      seed: 7,
      startTime: new Date(1_000).toISOString(),
      twins: [
        { id: paystackTwin.id, displayName: paystackTwin.displayName, running: true, port: 4401 },
      ],
      ports: { control: 4400, twins: { [paystackTwin.id]: 4401 } },
      rules: [],
      scenario: null,
      webhookUrls: { [paystackTwin.id]: "http://127.0.0.1:3000/hook" },
      state: { [paystackTwin.id]: { transactions: [] } },
      deliveries: [],
      events: events.after(0),
      credentials: { [paystackTwin.id]: { secret: fingerprint(credential) } },
      redactor: redactor(),
    });

    expect(value).toMatchObject({
      version: "0.0.0",
      seed: 7,
      twins: [{ id: paystackTwin.id, running: true }],
      ports: { control: 4400 },
    });
    const serialised = JSON.stringify(value);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(uiToken);
    expect(serialised).not.toContain(launchCode);
    expect(serialised).not.toContain(credential);
    expect(serialised).not.toContain(liveKey);
    expect(serialised).toContain(fingerprint(credential));
    expect(serialised).toContain(fingerprint(liveKey));
  });
});
