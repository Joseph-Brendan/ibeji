import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { assertNoDefaultTwinPorts } from "../../scripts/smoke.mjs";

describe("D59/D64 development scripts read twins from the session", () => {
  it("D59/D64 the smoke and screenshot scripts read ids from keys and pass port 0", async () => {
    const smoke = await readFile("scripts/smoke.mjs", "utf8");
    const screenshots = await readFile("scripts/screenshots.mjs", "utf8");
    for (const source of [smoke, screenshots]) {
      expect(source).toContain('"keys", "--json"');
      expect(source).toContain('"--twin-port"');
    }
    expect(smoke).not.toContain('twinId === "flutterwave"');
    expect(smoke).not.toContain('twinId !== "paystack"');
    expect(smoke).not.toContain("Stripe is version");
    expect(smoke).toContain("Object.keys(state.startJson.addresses.twins)");
    expect(screenshots).not.toMatch(/\b(?:paystack|flutterwave|stripe)\b/iu);
    expect(screenshots).toContain("Object.keys(running.session.ports.twins)");
  });

  it("D64 the smoke check fails when a twin is bound to a default port", () => {
    expect(() => assertNoDefaultTwinPorts({ alpha: 4401 }, new Set([4401]))).toThrow(
      /default port/u,
    );
    expect(() => assertNoDefaultTwinPorts({ alpha: 55_001 }, new Set([4401]))).not.toThrow();
  });
});
