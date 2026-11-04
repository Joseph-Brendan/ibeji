import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  apiUrl,
  authHeaders,
  type ControlSessionHarness,
  startControlSession,
} from "../helpers/control.js";

let harness: ControlSessionHarness;

beforeAll(async () => {
  harness = await startControlSession({ twins: ["paystack"] });
});

afterAll(async () => {
  await harness.cleanup();
});

describe("T8 control server UI serving", () => {
  it("T8: serves index.html with security and cache headers", async () => {
    const response = await fetch(harness.session.addresses.control.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'; frame-ancestors 'none'",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();

    const html = await response.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain("Ibeji");
  });

  it("T8: serves hashed assets with a long cache and the right content type", async () => {
    const index = await fetch(harness.session.addresses.control.url);
    const html = await index.text();
    const script = /src="([^"]+\.js)"/u.exec(html)?.[1];
    const style = /href="([^"]+\.css)"/u.exec(html)?.[1];
    expect(script).toBeDefined();
    expect(style).toBeDefined();
    if (script === undefined || style === undefined) {
      throw new Error("the built index did not name a script and a stylesheet");
    }

    const scriptResponse = await fetch(`${harness.session.addresses.control.url}${script}`);
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get("content-type")).toContain("javascript");
    expect(scriptResponse.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(scriptResponse.headers.get("access-control-allow-origin")).toBeNull();

    const styleResponse = await fetch(`${harness.session.addresses.control.url}${style}`);
    expect(styleResponse.status).toBe(200);
    expect(styleResponse.headers.get("content-type")).toContain("text/css");
    expect(styleResponse.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("T8: serves the local font files, licences and notices", async () => {
    const fonts = readdirSync(join(process.cwd(), "dist", "ui", "assets", "fonts")).sort();
    expect(fonts).toEqual([
      "LICENSE-IBM-Plex-Mono.txt",
      "LICENSE-IBM-Plex-Sans.txt",
      "ibm-plex-mono-latin-400-normal.woff2",
      "ibm-plex-mono-latin-ext-400-normal.woff2",
      "ibm-plex-sans-latin-400-normal.woff2",
      "ibm-plex-sans-latin-600-normal.woff2",
      "ibm-plex-sans-latin-ext-400-normal.woff2",
      "ibm-plex-sans-latin-ext-600-normal.woff2",
    ]);
    expect(existsSync(join(process.cwd(), "dist", "ui", "THIRD-PARTY-NOTICES.txt"))).toBe(true);

    const latin = await fetch(
      `${harness.session.addresses.control.url}/assets/fonts/ibm-plex-sans-latin-400-normal.woff2`,
    );
    expect(latin.status).toBe(200);
    expect(latin.headers.get("content-type")).toContain("font/woff2");
    expect(latin.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("T8: falls back to index.html for page routes and keeps API 404s JSON", async () => {
    const page = await fetch(`${harness.session.addresses.control.url}/failures?twin=paystack`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root"></div>');

    const api = await fetch(apiUrl(harness.session, "/not-a-route"), {
      headers: authHeaders(harness.session),
    });
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect(await api.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

    const asset = await fetch(`${harness.session.addresses.control.url}/assets/missing.js`);
    expect(asset.status).toBe(404);
    expect(await asset.text()).not.toContain('<div id="root"></div>');
  });

  it("T8: the UI routes do not weaken API sign-in", async () => {
    const unauthorised = await fetch(apiUrl(harness.session, "/status"));
    expect(unauthorised.status).toBe(401);
    expect(await unauthorised.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });

    const authorised = await fetch(apiUrl(harness.session, "/status"), {
      headers: authHeaders(harness.session),
    });
    expect(authorised.status).toBe(200);
  });
});
