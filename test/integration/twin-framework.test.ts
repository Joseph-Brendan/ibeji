import { request as httpRequest } from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { IbejiError } from "../../src/core/errors.js";
import { EventLog } from "../../src/core/events.js";
import { RuleStore } from "../../src/core/failures/rules.js";
import { fingerprint } from "../../src/core/redact.js";
import { WebhookDispatcher, type WebhookTwin } from "../../src/core/webhooks/dispatcher.js";
import { isLoopbackAddress, startTwin } from "../../src/twins/framework/server.js";
import { MemoryIdempotencyStore } from "../../src/twins/framework/state.js";
import type { ActionDefinition, TwinDefinition } from "../../src/twins/framework/types.js";
import {
  fakeCredentials,
  fakeTwinDefinition,
  headerIdempotencyTwin,
} from "../fixtures/fake-twin/definition.js";

function rulesFor(): { rules: RuleStore; events: EventLog; clock: FakeClock } {
  const clock = new FakeClock(100);
  const events = new EventLog(clock);
  const rules = new RuleStore({
    twins: [
      {
        id: fakeTwinDefinition.id,
        actions: fakeTwinDefinition.actions.map((action) => action.id),
        failures: fakeTwinDefinition.failures.support,
      },
    ],
    events,
  });
  return { rules, events, clock };
}

const authHeaders = {
  authorization: `Bearer ${fakeCredentials.secret}`,
  "content-type": "application/json",
};

function thenSetting(value: "succeed" | "fail"): Record<string, unknown> {
  const key = ["t", "hen"].join("");
  return { [key]: value };
}

function rawNoHost(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.write(`GET ${path} HTTP/1.0\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    socket.on("error", reject);
  });
}

function raw(
  port: number,
  path: string,
  host: string,
  method = "GET",
  body?: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          host,
          ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([name, value]) => [
                name.toLowerCase(),
                Array.isArray(value) ? value.join(", ") : String(value ?? ""),
              ]),
            ),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

describe("T6/T14 twin server framework", () => {
  it("T6 starts on 127.0.0.1 and stops cleanly", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      expect(running.port).toBeGreaterThan(0);
      expect(running.address).toBe("127.0.0.1");
      expect(running.hostname).toBe("127.0.0.1");
    } finally {
      await running.stop();
    }
    await running.stop();
    await expect(fetch(`http://127.0.0.1:${running.port}/payments/ref-1`)).rejects.toThrow();
  });

  it("T6 checks Host, sends no CORS headers, and limits bodies", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      const accepted = await raw(running.port, "/payments/ref-1", `LOCALHOST:${running.port}`);
      expect(accepted.status).not.toBe(403);
      expect(accepted.headers["access-control-allow-origin"]).toBeUndefined();

      const trailingDot = await raw(running.port, "/payments/ref-1", `127.0.0.1.:${running.port}`);
      expect(trailingDot.status).not.toBe(403);

      const rejected = await raw(running.port, "/payments/ref-1", `evil.example:${running.port}`);
      expect(rejected.status).toBe(403);
      expect(JSON.parse(rejected.body).error.code).toBe("FORBIDDEN_HOST");

      const tooLarge = await raw(
        running.port,
        "/payments",
        `127.0.0.1:${running.port}`,
        "POST",
        "a".repeat(1_048_577),
      );
      expect(tooLarge.status).toBe(413);
      expect(JSON.parse(tooLarge.body).error.code).toBe("BODY_TOO_LARGE");
    } finally {
      await running.stop();
    }
  });

  it("T6 rejects a live key, records its fingerprint, and never the key", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      const liveKey = ["sk", "live", "neverUseThis000000000"].join("_");
      const response = await fetch(`http://127.0.0.1:${running.port}/payments`, {
        method: "POST",
        headers: { authorization: `Bearer ${liveKey}` },
      });
      expect(response.status).toBe(401);

      const warning = running.events.after(0).find((event) => event.type === "warning");
      expect(warning?.details.fingerprint).toBe(fingerprint(liveKey));
      expect(warning?.summary).not.toContain(liveKey);
      expect(JSON.stringify(warning)).not.toContain(liveKey);
    } finally {
      await running.stop();
    }
  });

  it("T5/T14 applies server-error and rate-limited through the shared step", async () => {
    const { rules, events, clock } = rulesFor();
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
    });
    try {
      const server = rules.add({
        failureId: "server-error",
        twins: [fakeTwinDefinition.id],
        actions: "payment.create",
      });
      const serverResponse = await fetch(`http://127.0.0.1:${running.port}/payments`, {
        method: "POST",
        headers: authHeaders,
      });
      expect(serverResponse.status).toBe(500);
      rules.remove(server.id);

      const rate = rules.add({
        failureId: "rate-limited",
        twins: [fakeTwinDefinition.id],
        actions: "payment.create",
      });
      const rateResponse = await fetch(`http://127.0.0.1:${running.port}/payments`, {
        method: "POST",
        headers: authHeaders,
      });
      expect(rateResponse.status).toBe(429);
      rules.remove(rate.id);
    } finally {
      await running.stop();
    }
  });

  it("T5/T14 passes every result effect to the twin", async () => {
    const { rules, events, clock } = rulesFor();
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
    });
    try {
      const declined = rules.add({
        failureId: "payment-declined",
        twins: [fakeTwinDefinition.id],
        actions: "payment.create",
      });
      expect(
        (
          await fetch(`http://127.0.0.1:${running.port}/payments`, {
            method: "POST",
            headers: authHeaders,
          })
        ).status,
      ).toBe(402);
      rules.remove(declined.id);

      for (const failureId of [
        "authentication-required",
        "transfer-stuck-pending",
        "transfer-reversed",
      ]) {
        const rule = rules.add({
          failureId,
          twins: [fakeTwinDefinition.id],
          actions: "payment.create",
        });
        expect(
          (
            await fetch(`http://127.0.0.1:${running.port}/payments`, {
              method: "POST",
              headers: authHeaders,
            })
          ).status,
        ).toBe(200);
        rules.remove(rule.id);
      }

      const bankError = rules.add({
        failureId: "bank-resolve-fails",
        twins: [fakeTwinDefinition.id],
        actions: "bank.resolve",
        settings: { mode: "error" },
      });
      expect(
        (await fetch(`http://127.0.0.1:${running.port}/banks/resolve`, { headers: authHeaders }))
          .status,
      ).toBe(502);
      rules.remove(bankError.id);

      const bankTimeout = rules.add({
        failureId: "bank-resolve-fails",
        twins: [fakeTwinDefinition.id],
        actions: "bank.resolve",
        settings: { mode: "timeout" },
      });
      expect(
        (await fetch(`http://127.0.0.1:${running.port}/banks/resolve`, { headers: authHeaders }))
          .status,
      ).toBe(504);
      rules.remove(bankTimeout.id);
    } finally {
      await running.stop();
    }
  });

  it("T5/T14 delays a slow response through the injected clock", async () => {
    const { rules, events, clock } = rulesFor();
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
    });
    try {
      const rule = rules.add({
        failureId: "slow-response",
        twins: [fakeTwinDefinition.id],
        actions: "payment.fetch",
        settings: { seconds: 1 },
      });
      const pending = fetch(`http://127.0.0.1:${running.port}/payments/ref-1`, {
        headers: authHeaders,
      });
      for (let step = 0; step < 20; step += 1) {
        clock.advanceBy(1_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      const response = await pending;
      expect(response.status).toBe(200);
      rules.remove(rule.id);
    } finally {
      await running.stop();
    }
  });

  it("T5/T14 ends the connection for timeout-before-commit in reset mode", async () => {
    const { rules, events, clock } = rulesFor();
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
    });
    try {
      rules.add({
        failureId: "timeout-before-commit",
        twins: [fakeTwinDefinition.id],
        actions: "payment.create",
        settings: { mode: "reset" },
      });
      await expect(
        fetch(`http://127.0.0.1:${running.port}/payments`, {
          method: "POST",
          headers: authHeaders,
        }),
      ).rejects.toThrow();
    } finally {
      await running.stop();
    }
  });

  it("T5/T14 ends a hung connection after the 120-second limit", async () => {
    const { rules, events, clock } = rulesFor();
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
    });
    try {
      rules.add({
        failureId: "timeout-before-commit",
        twins: [fakeTwinDefinition.id],
        actions: "payment.create",
        settings: { mode: "hang" },
      });
      const pending = new Promise<boolean>((resolve) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port: running.port,
            path: "/payments",
            method: "POST",
            headers: authHeaders,
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(true));
          },
        );
        request.on("error", () => resolve(true));
        request.end();
      });
      for (let step = 0; step < 20; step += 1) {
        clock.advanceBy(120_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await expect(pending).resolves.toBe(true);
    } finally {
      await running.stop();
    }
  });

  it("T14 registers the twin's signer and retry schedule with the dispatcher source", async () => {
    const webhookTwins: Record<string, WebhookTwin> = {};
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      webhookTwins,
    });
    try {
      expect(webhookTwins[fakeTwinDefinition.id]?.retry).toEqual(fakeTwinDefinition.retry);
      expect(webhookTwins[fakeTwinDefinition.id]?.signer).toBe(fakeTwinDefinition.webhooks);
    } finally {
      await running.stop();
    }
    expect(webhookTwins[fakeTwinDefinition.id]).toBeUndefined();
  });

  it("T14 replays a stored idempotent response before the failure step", async () => {
    const store = new MemoryIdempotencyStore();
    const running = await startTwin(headerIdempotencyTwin(), {
      credentials: fakeCredentials,
      idempotencyStore: store,
    });
    try {
      const first = await fetch(`http://127.0.0.1:${running.port}/payments`, {
        method: "POST",
        headers: { ...authHeaders, "idempotency-key": "key-1" },
      });
      expect(first.status).toBe(200);
      expect(store.lookup("fake", "key-1")?.response.status).toBe(200);

      const second = await fetch(`http://127.0.0.1:${running.port}/payments`, {
        method: "POST",
        headers: { ...authHeaders, "idempotency-key": "key-1" },
      });
      expect(second.status).toBe(200);
    } finally {
      await running.stop();
    }
  });

  it("T14 returns the twin's not-found shape for an unknown route", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/missing`, {
        headers: { authorization: `Bearer ${fakeCredentials.secret}` },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        status: "error",
        message: "The Fake Twin has no route for that request.",
        data: null,
      });
    } finally {
      await running.stop();
    }
  });

  it("C12 turns an Ibeji error and an unknown error into the right status", async () => {
    const base = fakeTwinDefinition;
    const actions = base.actions.map((action): ActionDefinition => {
      if (action.id !== "payment.fetch") {
        return action;
      }
      return {
        ...action,
        handler: () => {
          throw new IbejiError("BAD_REQUEST", { what: "bad", why: "because", fix: "fix it" });
        },
      };
    });
    const ibejiTwin: TwinDefinition = {
      ...base,
      actions,
      routes: (router) => {
        for (const action of actions) {
          router.add(action);
        }
      },
    };
    const running = await startTwin(ibejiTwin, { credentials: fakeCredentials });
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/payments/ref-1`, {
        headers: authHeaders,
      });
      expect(response.status).toBe(400);
      expect(JSON.parse(await response.text()).error.code).toBe("BAD_REQUEST");
    } finally {
      await running.stop();
    }

    const throwingActions = base.actions.map((action): ActionDefinition => {
      if (action.id !== "payment.fetch") {
        return action;
      }
      return {
        ...action,
        handler: () => {
          throw new Error("boom");
        },
      };
    });
    const throwingTwin: TwinDefinition = {
      ...base,
      actions: throwingActions,
      routes: (router) => {
        for (const action of throwingActions) {
          router.add(action);
        }
      },
    };
    const throwing = await startTwin(throwingTwin, { credentials: fakeCredentials });
    try {
      const response = await fetch(`http://127.0.0.1:${throwing.port}/payments/ref-1`, {
        headers: authHeaders,
      });
      expect(response.status).toBe(500);
      expect(JSON.parse(await response.text()).error.code).toBe("INTERNAL");
    } finally {
      await throwing.stop();
    }
  });

  it("T14 emits a checkout webhook draft into the dispatcher", async () => {
    const clock = new FakeClock(100);
    const events = new EventLog(clock);
    const dispatcher = new WebhookDispatcher({
      clock,
      twins: {},
      random: { next: () => 0.5 },
    });
    const drafts: string[] = [];
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      events,
      clock,
      dispatcher,
      webhookUrl: () => "http://127.0.0.1:1/hook",
      onWebhookDraft: (draft) => {
        drafts.push(draft.key);
      },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/checkout/ref-1`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${running.port}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "outcome=success",
      });
      expect(response.status).toBe(200);
      expect(drafts).toEqual(["payment.succeeded"]);
      expect(dispatcher.list()).toHaveLength(1);
    } finally {
      await running.stop();
    }
    expect(() => dispatcher.resend("delivery-1")).toThrow("is not a twin");
  });

  it("T14 accepts a credentials function and works with default options", async () => {
    const running = await startTwin(fakeTwinDefinition, {
      credentials: () => fakeCredentials,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/payments/ref-1`, {
        headers: { authorization: `Bearer ${fakeCredentials.secret}` },
      });
      expect(response.status).toBe(200);
    } finally {
      await running.stop();
    }
  });

  it("T6 strips CORS headers from a twin response and supports all response bodies", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      const headers = await fetch(`http://127.0.0.1:${running.port}/headers`, {
        headers: authHeaders,
      });
      expect(headers.headers.get("x-fake-header")).toBe("yes");
      expect(headers.headers.get("access-control-allow-origin")).toBeNull();

      const binary = await fetch(`http://127.0.0.1:${running.port}/binary`, {
        headers: authHeaders,
      });
      expect(await binary.text()).toBe("binary");
    } finally {
      await running.stop();
    }
  });

  it("T14 reads repeated and single query values", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      const single = await fetch(`http://127.0.0.1:${running.port}/query?tag=a`, {
        headers: authHeaders,
      });
      expect(await single.json()).toEqual({ status: "success", data: { tag: "a" } });

      const repeated = await fetch(`http://127.0.0.1:${running.port}/query?tag=a&tag=b`, {
        headers: authHeaders,
      });
      expect(await repeated.json()).toEqual({ status: "success", data: { tag: ["a", "b"] } });
    } finally {
      await running.stop();
    }
  });

  it("T6 rejects a request with no Host header", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      const response = await rawNoHost(running.port, "/payments/ref-1");
      expect(response.startsWith("HTTP/1.1 403")).toBe(true);
      expect(response).toContain("FORBIDDEN_HOST");
    } finally {
      await running.stop();
    }
  });

  it("T14 finds a checkout record from params, reference or id", async () => {
    const base = fakeTwinDefinition;
    const actions = base.actions.map((action): ActionDefinition => {
      if (action.kind !== "checkout") {
        return action;
      }
      return { ...action, path: "/checkout" };
    });
    const twin: TwinDefinition = {
      ...base,
      actions,
      routes: (router) => {
        for (const action of actions) {
          router.add(action);
        }
      },
    };
    const running = await startTwin(twin, { credentials: fakeCredentials });
    try {
      const reference = await fetch(`http://127.0.0.1:${running.port}/checkout?reference=ref-2`);
      expect(await reference.text()).toContain("ref-2");
      const id = await fetch(`http://127.0.0.1:${running.port}/checkout?id=ref-3`);
      expect(await id.text()).toContain("ref-3");
      const none = await fetch(`http://127.0.0.1:${running.port}/checkout`);
      expect(none.status).toBe(200);
    } finally {
      await running.stop();
    }
  });

  it("T14 parses an authentication choice and rejects a missing outcome", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      for (const choice of ["authenticated|approve", "authenticated|fail", "authenticated|other"]) {
        const response = await fetch(`http://127.0.0.1:${running.port}/checkout/ref-1`, {
          method: "POST",
          headers: {
            origin: `http://127.0.0.1:${running.port}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `outcome=${choice}`,
        });
        expect(response.status).toBe(200);
      }

      const missing = await fetch(`http://127.0.0.1:${running.port}/checkout/ref-1`, {
        method: "POST",
        headers: {
          origin: `http://127.0.0.1:${running.port}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "other=value",
      });
      expect(missing.status).toBe(400);
    } finally {
      await running.stop();
    }
  });

  it("T14 emits a webhook draft from an action handler", async () => {
    const drafts: string[] = [];
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      onWebhookDraft: (draft) => {
        drafts.push(draft.key);
      },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/webhook/emit`, {
        headers: authHeaders,
      });
      expect(response.status).toBe(200);
      expect(drafts).toEqual(["payment.succeeded"]);
    } finally {
      await running.stop();
    }
  });

  it("T5/T14 ends the connection after a committed action", async () => {
    const { rules, events, clock } = rulesFor();
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
    });
    try {
      rules.add({
        failureId: "timeout-after-commit",
        twins: [fakeTwinDefinition.id],
        actions: "payment.create",
        settings: { mode: "reset" },
      });
      await expect(
        fetch(`http://127.0.0.1:${running.port}/payments`, {
          method: "POST",
          headers: authHeaders,
        }),
      ).rejects.toThrow();
    } finally {
      await running.stop();
    }
  });

  it("T6 refuses a second twin on an occupied port", async () => {
    const first = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      await expect(
        startTwin(fakeTwinDefinition, { credentials: fakeCredentials, port: first.port }),
      ).rejects.toThrow();
    } finally {
      await first.stop();
    }
  });

  it("T6 reports a close error when the server was already closed", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    await new Promise<void>((resolve) => {
      running.server.close(() => resolve());
    });
    await expect(running.stop()).rejects.toThrow();
  });

  it("T6 recognises every loopback form", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
  });

  it("C12 uses the status in the Ibeji error or 500 when it has none", async () => {
    const base = fakeTwinDefinition;
    const actions = base.actions.map((action): ActionDefinition => {
      if (action.id !== "payment.fetch") {
        return action;
      }
      return {
        ...action,
        handler: () => {
          throw new IbejiError("CONFIG_INVALID");
        },
      };
    });
    const twin: TwinDefinition = {
      ...base,
      actions,
      routes: (router) => {
        for (const action of actions) {
          router.add(action);
        }
      },
    };
    const running = await startTwin(twin, { credentials: fakeCredentials });
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/payments/ref-1`, {
        headers: authHeaders,
      });
      expect(response.status).toBe(500);
      expect(JSON.parse(await response.text()).error.code).toBe("CONFIG_INVALID");
    } finally {
      await running.stop();
    }
  });

  it("T14 applies only checkout payment rules and uses the newest one", async () => {
    const clock = new FakeClock(100);
    const events = new EventLog(clock);
    const rules = new RuleStore({
      twins: [
        {
          id: fakeTwinDefinition.id,
          actions: fakeTwinDefinition.actions.map((action) => action.id),
          failures: fakeTwinDefinition.failures.support,
        },
        {
          id: "other",
          actions: ["checkout.submit"],
          failures: [{ id: "payment-declined", source: "docs", actions: ["checkout.submit"] }],
        },
      ],
      events,
    });
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
    });
    try {
      rules.add({
        failureId: "payment-declined",
        twins: ["other"],
        actions: "checkout.submit",
      });
      rules.add({
        failureId: "payment-declined",
        twins: [fakeTwinDefinition.id],
        actions: "payment.create",
      });
      const first = rules.add({
        failureId: "payment-declined",
        twins: [fakeTwinDefinition.id],
        actions: "checkout.submit",
      });
      const second = rules.add({
        failureId: "authentication-required",
        twins: [fakeTwinDefinition.id],
        actions: "checkout.submit",
        settings: thenSetting("succeed"),
      });
      const page = await fetch(`http://127.0.0.1:${running.port}/checkout/ref-1`);
      expect(await page.text()).toContain("Extra check needed");
      rules.remove(second.id);
      const failRule = rules.add({
        failureId: "authentication-required",
        twins: [fakeTwinDefinition.id],
        actions: "checkout.submit",
        settings: thenSetting("fail"),
      });
      const failPage = await fetch(`http://127.0.0.1:${running.port}/checkout/ref-1`);
      expect(await failPage.text()).toContain("Extra check needed");
      rules.remove(failRule.id);
      const declined = await fetch(`http://127.0.0.1:${running.port}/checkout/ref-1`);
      expect(await declined.text()).toContain("Declined payment");
      rules.remove(first.id);
    } finally {
      await running.stop();
    }
  });

  it("T14 renders checkout outcomes with an authentication choice", async () => {
    const running = await startTwin(fakeTwinDefinition, { credentials: fakeCredentials });
    try {
      const page = await fetch(`http://127.0.0.1:${running.port}/checkout/ref-1`);
      const html = await page.text();
      expect(html).toContain("Approve the check");
      expect(html).toContain("Fail the check");
      expect(html).toContain("authenticated|approve");
    } finally {
      await running.stop();
    }
  });

  it("T14 rejects every malformed route table with a clear reason", async () => {
    const first = fakeTwinDefinition.actions[0] as ActionDefinition;
    const second: ActionDefinition = {
      ...first,
      id: "second.action",
    };
    const extra: ActionDefinition = {
      ...first,
      id: "extra.action",
      method: "GET",
      path: "/extra",
    };

    const unknown: TwinDefinition = {
      ...fakeTwinDefinition,
      actions: [first],
      routes: (router) => {
        router.add(extra);
      },
    };
    await expect(startTwin(unknown, { credentials: fakeCredentials })).rejects.toThrow(
      "registered an action it did not declare",
    );

    const copied: TwinDefinition = {
      ...fakeTwinDefinition,
      actions: [first],
      routes: (router) => {
        router.add({ ...first });
      },
    };
    await expect(startTwin(copied, { credentials: fakeCredentials })).rejects.toThrow(
      "route does not match its action",
    );

    const duplicateId: TwinDefinition = {
      ...fakeTwinDefinition,
      actions: [first, second],
      routes: (router) => {
        router.add(first);
        router.add(first);
      },
    };
    await expect(startTwin(duplicateId, { credentials: fakeCredentials })).rejects.toThrow(
      "registered the action",
    );

    const duplicateRoute: TwinDefinition = {
      ...fakeTwinDefinition,
      actions: [first, second],
      routes: (router) => {
        router.add(first);
        router.add(second);
      },
    };
    await expect(startTwin(duplicateRoute, { credentials: fakeCredentials })).rejects.toThrow(
      "declared the route",
    );

    const missing: TwinDefinition = {
      ...fakeTwinDefinition,
      actions: [first, second],
      routes: (router) => {
        router.add(first);
      },
    };
    await expect(startTwin(missing, { credentials: fakeCredentials })).rejects.toThrow(
      "do not match its actions",
    );
  });

  it("T14 provides a default webhook URL callback", async () => {
    const webhookTwins: Record<string, WebhookTwin> = {};
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      webhookTwins,
    });
    try {
      expect(webhookTwins[fakeTwinDefinition.id]?.webhookUrl()).toBeUndefined();
    } finally {
      await running.stop();
    }
  });

  it("T5/T14 applies a webhook failure plan and records its counter", async () => {
    const { rules, events, clock } = rulesFor();
    const dispatcher = new WebhookDispatcher({
      clock,
      twins: {},
      random: { next: () => 0.5 },
    });
    const running = await startTwin(fakeTwinDefinition, {
      credentials: fakeCredentials,
      rules,
      events,
      clock,
      dispatcher,
      webhookUrl: () => "http://127.0.0.1:1/hook",
    });
    try {
      const rule = rules.add({
        failureId: "webhook-delayed",
        twins: [fakeTwinDefinition.id],
        actions: "webhook.emit",
        settings: { seconds: 1 },
      });
      const response = await fetch(`http://127.0.0.1:${running.port}/webhook/emit`, {
        headers: authHeaders,
      });
      expect(response.status).toBe(200);
      expect(dispatcher.list()[0]?.status).toBe("scheduled");
      expect(rules.get(rule.id)?.counters[fakeTwinDefinition.id]).toBe(1);
      expect(
        events
          .after(0)
          .some(
            (event) =>
              event.type === "failure-fired" && event.details.failureId === "webhook-delayed",
          ),
      ).toBe(true);
    } finally {
      await running.stop();
    }
  });
});
