import type { IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";

import {
  apiUrl,
  authHeaders,
  cookieFrom,
  exchangeCode,
  startControlSession,
  withControlSession,
} from "../helpers/control.js";

type RawResult = {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

function rawRequest(options: {
  readonly port: number;
  readonly path: string;
  readonly host?: string;
  readonly method?: string;
  readonly setHost?: boolean;
}): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: options.port,
        path: options.path,
        method: options.method ?? "GET",
        ...(options.host === undefined ? {} : { headers: { host: options.host } }),
        ...(options.setHost === undefined ? {} : { setHost: options.setHost }),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function rawNoHost(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.write(`GET ${path} HTTP/1.0\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}

function rawEmptyHost(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost:\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}

function controlPort(session: { addresses: { control: { port: number } } }): number {
  return session.addresses.control.port;
}

function hasCors(headers: IncomingHttpHeaders): boolean {
  return (
    headers["access-control-allow-origin"] !== undefined ||
    headers["access-control-allow-credentials"] !== undefined ||
    headers["access-control-allow-methods"] !== undefined ||
    headers["access-control-allow-headers"] !== undefined
  );
}

describe("T6 control API security", () => {
  it("T6 binds the control server and every twin to 127.0.0.1", async () => {
    await withControlSession({}, async ({ session }) => {
      expect(session.control.address.hostname).toBe("127.0.0.1");
      expect(session.control.address.address).toBe("127.0.0.1");
      const controlAddress = session.control.server.address();
      expect(controlAddress).not.toBeNull();
      if (controlAddress !== null && typeof controlAddress !== "string") {
        expect(controlAddress.address).toBe("127.0.0.1");
      }

      for (const twin of session.twins.values()) {
        expect(twin.running.hostname).toBe("127.0.0.1");
        expect(twin.running.address).toBe("127.0.0.1");
        expect(twin.address.address).toBe("127.0.0.1");
        const address = twin.running.server.address();
        expect(address).not.toBeNull();
        if (address !== null && typeof address !== "string") {
          expect(address.address).toBe("127.0.0.1");
        }
      }
    });
  });

  it("T6 serves health without sign-in and returns the instance id", async () => {
    await withControlSession({}, async ({ session }) => {
      const response = await fetch(apiUrl(session, "/health"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, instance: session.instanceId });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("T6 rejects a missing, wrong, or one-character-different bearer token", async () => {
    await withControlSession({}, async ({ session }) => {
      const missing = await fetch(apiUrl(session, "/status"));
      const wrong = await fetch(apiUrl(session, "/status"), {
        headers: { authorization: "Bearer this-is-wrong" },
      });
      const different = `${session.token.slice(0, -1)}${session.token.endsWith("A") ? "B" : "A"}`;
      const near = await fetch(apiUrl(session, "/status"), {
        headers: { authorization: `Bearer ${different}` },
      });

      for (const response of [missing, wrong, near]) {
        expect(response.status).toBe(401);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe("UNAUTHORIZED");
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }

      const accepted = await fetch(apiUrl(session, "/status"), { headers: authHeaders(session) });
      expect(accepted.status).toBe(200);
    });
  });

  it("T6 marks a stale UI cookie so the dashboard can say Ibeji was restarted", async () => {
    await withControlSession({}, async ({ session }) => {
      const missing = await fetch(apiUrl(session, "/status"));
      expect(missing.headers.get("x-ibeji-stale-session")).toBeNull();

      const stale = await fetch(apiUrl(session, "/status"), {
        headers: { cookie: "ibeji_ui=this-is-not-a-live-token" },
      });
      expect(stale.status).toBe(401);
      expect(stale.headers.get("x-ibeji-stale-session")).toBe("1");
      expect(await stale.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    });
  });

  it("T6 rejects a token placed in the query string", async () => {
    await withControlSession({}, async ({ session }) => {
      const response = await fetch(apiUrl(session, `/status?token=${session.token}`));
      expect(response.status).toBe(401);
    });
  });

  it("T6 exchanges a launch code for an HttpOnly SameSite=Strict cookie", async () => {
    await withControlSession({}, async ({ session }) => {
      const code = session.createLaunchCode();
      const response = await exchangeCode(session, code);
      expect(response.status).toBe(200);
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("ibeji_ui=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Path=/_ibeji");

      const cookie = cookieFrom(response);
      const accepted = await fetch(apiUrl(session, "/status"), { headers: { cookie } });
      expect(accepted.status).toBe(200);

      const again = await exchangeCode(session, code);
      expect(again.status).toBe(401);
      expect(await again.json()).toMatchObject({ error: { code: "LAUNCH_CODE_INVALID" } });
    });
  });

  it("T6 validates the exchange body with Zod", async () => {
    await withControlSession({}, async ({ session }) => {
      const bodies = [
        "",
        "{not json",
        "{}",
        JSON.stringify({ code: "one", launchCode: "two" }),
        JSON.stringify({ unexpected: true }),
      ];
      for (const body of bodies) {
        const response = await fetch(apiUrl(session, "/auth/exchange"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        expect(response.status, body).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
      }
    });
  });

  it("T6 rejects a made-up launch code and an expired launch code", async () => {
    await withControlSession({}, async ({ session, clock }) => {
      expect((await exchangeCode(session, "made-up-code")).status).toBe(401);

      const code = session.createLaunchCode();
      clock.advanceBy(120_000);
      const expired = await exchangeCode(session, code);
      expect(expired.status).toBe(401);
      expect(await expired.json()).toMatchObject({ error: { code: "LAUNCH_CODE_INVALID" } });
    });
  });

  it("T6 accepts the cookie for GET and requires X-Ibeji-Request and the own Origin for changes", async () => {
    await withControlSession({}, async ({ session }) => {
      const cookie = cookieFrom(await exchangeCode(session, session.createLaunchCode()));
      const origin = session.addresses.control.url;
      const body = JSON.stringify({
        failureId: "server-error",
        twins: ["paystack"],
        settings: { times: 1, status: 500 },
      });
      const base = {
        cookie,
        "content-type": "application/json",
      };

      const get = await fetch(apiUrl(session, "/rules"), { headers: { cookie } });
      expect(get.status).toBe(200);

      for (const headers of [
        { ...base, origin },
        { ...base, "x-ibeji-request": "1" },
        { ...base, "x-ibeji-request": "1", origin: "http://evil.example:4400" },
      ]) {
        const response = await fetch(apiUrl(session, "/rules"), {
          method: "POST",
          headers,
          body,
        });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN_ORIGIN" } });
      }

      const created = await fetch(apiUrl(session, "/rules"), {
        method: "POST",
        headers: { ...base, "x-ibeji-request": "1", origin },
        body,
      });
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as { rule: { id: string } };

      const putWithout = await fetch(apiUrl(session, "/twins/paystack/webhook-url"), {
        method: "PUT",
        headers: { ...base, origin },
        body: JSON.stringify({ url: "http://127.0.0.1:3000/hook" }),
      });
      expect(putWithout.status).toBe(403);

      const put = await fetch(apiUrl(session, "/twins/paystack/webhook-url"), {
        method: "PUT",
        headers: { ...base, "x-ibeji-request": "1", origin },
        body: JSON.stringify({ url: "http://127.0.0.1:3000/hook" }),
      });
      expect(put.status).toBe(200);

      for (const headers of [
        { ...base, origin },
        { ...base, "x-ibeji-request": "1" },
        { ...base, "x-ibeji-request": "1", origin: "http://evil.example:4400" },
      ]) {
        const response = await fetch(apiUrl(session, `/rules/${createdBody.rule.id}`), {
          method: "DELETE",
          headers,
        });
        expect(response.status).toBe(403);
      }

      const deleted = await fetch(apiUrl(session, `/rules/${createdBody.rule.id}`), {
        method: "DELETE",
        headers: { ...base, "x-ibeji-request": "1", origin },
      });
      expect(deleted.status).toBe(200);
    });
  });

  it("T6 checks the Host header on the control server", async () => {
    await withControlSession({}, async ({ session }) => {
      const port = controlPort(session);
      const path = "/_ibeji/api/v1/health";

      for (const host of [
        `127.0.0.1:${port}`,
        `localhost:${port}`,
        `LOCALHOST:${port}`,
        `localhost.:${port}`,
      ]) {
        const result = await rawRequest({ port, path, host });
        expect(result.status).toBe(200);
      }

      for (const host of ["evil.com", `127.0.0.1.evil.com:${port}`, `127.0.0.1:${port + 1}`]) {
        const result = await rawRequest({ port, path, host });
        expect(result.status, `Host: ${host}`).toBe(403);
        expect(JSON.parse(result.body)).toMatchObject({ error: { code: "FORBIDDEN_HOST" } });
        expect(hasCors(result.headers)).toBe(false);
      }

      const emptyHost = await rawEmptyHost(port, path);
      expect(emptyHost.startsWith("HTTP/1.1 403")).toBe(true);
      expect(emptyHost).toContain("FORBIDDEN_HOST");

      const noHost = await rawNoHost(port, path);
      expect(noHost.startsWith("HTTP/1.1 403")).toBe(true);
      expect(noHost).toContain("FORBIDDEN_HOST");
    });
  });

  it("T6 checks the Host header on a twin server", async () => {
    await withControlSession({}, async ({ session }) => {
      const twin = session.twins.get("paystack");
      expect(twin).toBeDefined();
      if (twin === undefined) {
        throw new Error("expected the Paystack twin");
      }
      const port = twin.running.port;
      const path = "/transaction";

      for (const host of [`127.0.0.1:${port}`, `LOCALHOST:${port}`, `localhost.:${port}`]) {
        const result = await rawRequest({ port, path, host });
        expect(result.status).not.toBe(403);
        expect(hasCors(result.headers)).toBe(false);
      }

      for (const host of ["evil.com", `127.0.0.1.evil.com:${port}`, `127.0.0.1:${port + 1}`]) {
        const result = await rawRequest({ port, path, host });
        expect(result.status, `Host: ${host}`).toBe(403);
      }

      const emptyHost = await rawEmptyHost(port, path);
      expect(emptyHost.startsWith("HTTP/1.1 403")).toBe(true);

      const noHost = await rawNoHost(port, path);
      expect(noHost.startsWith("HTTP/1.1 403")).toBe(true);
    });
  });

  it("T6 sends no CORS headers and adds security headers to HTML", async () => {
    await withControlSession({}, async ({ session }) => {
      const page = await fetch(`${session.addresses.control.url}/_ibeji/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<div id="root"></div>');
      expect(page.headers.get("content-security-policy")).toBe(
        "default-src 'self'; frame-ancestors 'none'",
      );
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect(page.headers.get("access-control-allow-origin")).toBeNull();

      const preflight = await fetch(apiUrl(session, "/status"), { method: "OPTIONS" });
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  it("T6 rejects a body over 1 MB with BODY_TOO_LARGE", async () => {
    await withControlSession({}, async ({ session }) => {
      const response = await fetch(apiUrl(session, "/rules"), {
        method: "POST",
        headers: { ...authHeaders(session), "content-type": "application/json" },
        body: "a".repeat(1_048_577),
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "BODY_TOO_LARGE" } });
    });
  });

  it("D44 redirects / to /_ibeji/ and keeps the launch query", async () => {
    await withControlSession({}, async ({ session }) => {
      const root = await fetch(session.addresses.control.url, { redirect: "manual" });
      expect(root.status).toBe(302);
      expect(root.headers.get("location")).toBe("/_ibeji/");

      const withQuery = await fetch(`${session.addresses.control.url}/?launch=example`, {
        redirect: "manual",
      });
      expect(withQuery.status).toBe(302);
      expect(withQuery.headers.get("location")).toBe("/_ibeji/?launch=example");
    });
  });

  it("T6 serves the UI at /_ibeji/ and leaves the launch code for the page", async () => {
    await withControlSession({}, async ({ session }) => {
      const code = session.createLaunchCode();
      const page = await fetch(
        `${session.addresses.control.url}/_ibeji/?launch=${encodeURIComponent(code)}`,
      );
      expect(page.status).toBe(200);
      expect(page.headers.get("set-cookie")).toBeNull();
      expect(await page.text()).toContain('<div id="root"></div>');

      const exchange = await exchangeCode(session, code);
      expect(exchange.status).toBe(200);
      const cookie = cookieFrom(exchange);

      const home = await fetch(`${session.addresses.control.url}/_ibeji/`);
      expect(home.status).toBe(200);
      expect(await home.text()).toContain('<div id="root"></div>');

      const withCookie = await fetch(apiUrl(session, "/status"), { headers: { cookie } });
      expect(withCookie.status).toBe(200);

      const used = await exchangeCode(session, code);
      expect(used.status).toBe(401);
      expect(await used.json()).toMatchObject({ error: { code: "LAUNCH_CODE_INVALID" } });
    });
  });

  it("T6 keeps the launch link and token out of an error response", async () => {
    await withControlSession({}, async ({ session }) => {
      const response = await fetch(
        apiUrl(session, `/twins/${encodeURIComponent(session.token)}/state`),
        {
          headers: authHeaders(session),
        },
      );
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).not.toContain(session.token);
      expect(text).not.toContain(session.launchCode);
    });
  });

  it("T6 a cookie from a stopped session is rejected by a new session", async () => {
    const first = await startControlSession({});
    const cookie = cookieFrom(await exchangeCode(first.session, first.session.createLaunchCode()));
    await first.cleanup();

    const second = await startControlSession({});
    try {
      const response = await fetch(apiUrl(second.session, "/status"), { headers: { cookie } });
      expect(response.status).toBe(401);
    } finally {
      await second.cleanup();
    }
  });
});
