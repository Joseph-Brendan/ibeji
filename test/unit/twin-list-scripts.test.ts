import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("D59 development scripts read twins from the session", () => {
  it("D59 the smoke script does not hard-code twin ports or providers", async () => {
    const smoke = await readFile("scripts/smoke.mjs", "utf8");
    expect(smoke).not.toContain("--twin-port");
    expect(smoke).not.toContain('twinId === "flutterwave"');
    expect(smoke).not.toContain('twinId !== "paystack"');
    expect(smoke).not.toContain("Stripe is version");
    expect(smoke).toContain("Object.keys(state.startJson.addresses.twins)");
  });

  it("D59 the screenshot script reads the twin cards from the session", async () => {
    const screenshots = await readFile("scripts/screenshots.mjs", "utf8");
    expect(screenshots).not.toMatch(/\b(?:paystack|flutterwave|stripe)\b/iu);
    expect(screenshots).toContain("Object.keys(running.started.addresses.twins)");
  });
});
