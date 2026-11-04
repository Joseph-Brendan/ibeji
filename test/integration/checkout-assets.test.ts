import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startTwin } from "../../src/twins/framework/server.js";
import { fakeCredentials, fakeTwinDefinition } from "../fixtures/fake-twin/definition.js";
import { withControlSession } from "../helpers/control.js";

describe("T14 checkout assets", () => {
  it("T14 returns 404 when a declared font file is missing", async () => {
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      fontsDir: join(tmpdir(), `ibeji-missing-fonts-${randomUUID()}`),
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${running.port}/_ibeji/fonts/ibm-plex-sans-latin-400-normal.woff2`,
      );
      expect(response.status).toBe(404);
    } finally {
      await running.stop();
    }
  });

  it("T14 serves the UI font files locally on every twin port", async () => {
    await withControlSession({}, async ({ session }) => {
      for (const twinId of ["paystack", "flutterwave"]) {
        const address = session.addresses.twins[twinId];
        expect(address).toBeDefined();
        if (address === undefined) {
          throw new Error(`the ${twinId} twin is not running`);
        }

        const before = session.events.size;
        const response = await fetch(
          `${address.url}/_ibeji/fonts/ibm-plex-sans-latin-400-normal.woff2`,
        );
        expect(session.events.size, `${twinId} font requests must not create events`).toBe(before);
        expect(response.status, twinId).toBe(200);
        expect(response.headers.get("content-type")).toBe("font/woff2");
        expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        expect(response.headers.get("access-control-allow-origin")).toBeNull();

        const missing = await fetch(`${address.url}/_ibeji/fonts/not-a-font.woff2`);
        expect(missing.status).toBe(404);

        const stylesBefore = session.events.size;
        const styles = await fetch(`${address.url}/_ibeji/checkout.css`);
        expect(session.events.size, `${twinId} CSS requests must not create events`).toBe(
          stylesBefore,
        );
        expect(styles.status).toBe(200);
        expect(styles.headers.get("content-type")).toContain("text/css");
        const css = await styles.text();
        expect(css).toContain("--ibeji-purple: #6b4fa1;");
        expect(css).not.toMatch(/box-shadow|gradient\(/u);
        expect(styles.headers.get("access-control-allow-origin")).toBeNull();
      }
    });
  });
});
