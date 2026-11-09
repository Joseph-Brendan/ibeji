import { describe, expect, it } from "vitest";

import { registry } from "../../src/twins/registry.js";

describe("C10/P7 connection guide jargon", () => {
  it("C10/P7 explains 'API call' in one plain line the first time it appears", () => {
    for (const twin of registry.list()) {
      const guide = twin.connectionGuide;
      expect(guide, twin.id).toBeDefined();
      if (guide === undefined) {
        continue;
      }
      expect(guide.baseUrlNote, twin.id).toMatch(
        /^An API call is one request your app sends to a service over the internet\./u,
      );
    }
  });

  it("C10/P7 explains 'HMAC SHA512' in one plain line the first time it appears", () => {
    for (const twin of registry.list()) {
      const guide = twin.connectionGuide;
      expect(guide, twin.id).toBeDefined();
      if (guide === undefined) {
        continue;
      }
      expect(guide.webhookNote, twin.id).toContain(
        "HMAC SHA512 is a way of mixing a secret key with the message so your app can check who sent it and that it was not changed.",
      );
    }
  });
});
