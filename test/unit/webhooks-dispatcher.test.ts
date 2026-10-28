import { once } from "node:events";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { IbejiError } from "../../src/core/errors.js";
import { type FailureId, getFailure } from "../../src/core/failures/catalog.js";
import {
  type ActiveRule,
  decideWebhook,
  type WebhookPlan,
} from "../../src/core/failures/engine.js";
import {
  C7_FALLBACK_RETRY_DELAYS_SECONDS,
  type WebhookDelivery,
  WebhookDispatcher,
  webhookPort,
} from "../../src/core/webhooks/dispatcher.js";
import type {
  RawWebhook,
  RetrySchedule,
  TwinCredentials,
  VerificationFailureMethod,
  WebhookSigner,
} from "../../src/core/webhooks/types.js";

type RecordedRequest = {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

type TestServer = {
  readonly url: string;
  readonly requests: RecordedRequest[];
  readonly responses: ServerResponse[];
  readonly waitForRequests: (count: number) => Promise<void>;
  readonly close: () => Promise<void>;
};

type ServerOptions = {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly secure?: boolean;
};

const openServers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.map((server) => server.close()));
  openServers.length = 0;
});

async function startServer(options: ServerOptions = {}): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const responses: ServerResponse[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];

  const notify = (): void => {
    for (const waiter of [...waiters]) {
      if (requests.length >= waiter.count) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      responses.push(response);
      notify();

      if (options.status !== undefined) {
        response.writeHead(options.status, options.headers ?? {});
        response.end(options.body ?? "ok");
      }
    });
  };

  const server = options.secure
    ? createHttpsServer(
        {
          key: await readFile("test/fixtures/tls/key.pem"),
          cert: await readFile("test/fixtures/tls/cert.pem"),
        },
        handler,
      )
    : createServer(handler);

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the test server did not report a TCP address");
  }
  const port = (address as AddressInfo).port;

  const testServer: TestServer = {
    url: `${options.secure ? "https" : "http"}://127.0.0.1:${port}`,
    requests,
    responses,
    waitForRequests: (count) =>
      new Promise((resolve) => {
        if (requests.length >= count) {
          resolve();
        } else {
          waiters.push({ count, resolve });
        }
      }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
  openServers.push(testServer);
  return testServer;
}

function respond(
  server: TestServer,
  index: number,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
  body = "ok",
): void {
  const response = server.responses[index];
  if (response === undefined) {
    throw new Error(`the test server has no response at index ${index}`);
  }
  response.writeHead(status, headers);
  response.end(body);
}

type SignCall = {
  readonly attempt: number;
  readonly failureMethod: VerificationFailureMethod | undefined;
  readonly credentials: TwinCredentials;
};

function signerFor(name: string, calls: SignCall[] = []): WebhookSigner {
  return {
    sign: (_raw, credentials, options) => {
      calls.push({
        attempt: options.attempt,
        failureMethod: options.failureMethod,
        credentials,
      });
      return {
        [`x-${name}-signature`]: `${options.failureMethod ?? "valid"}-${credentials.secret}-${options.attempt}`,
      };
    },
  };
}

function twinFor(
  signer: WebhookSigner,
  webhookUrl: () => string | undefined,
  retry: RetrySchedule = { source: "docs", delaysSeconds: [] },
  credentials: () => TwinCredentials = () => ({ secret: "one" }),
) {
  return {
    signer,
    retry,
    webhookUrl,
    credentials,
  };
}

const fakeDns = async () => [{ address: "127.0.0.1", family: 4 as const }];

function dispatcherFor(
  twins: Record<string, ReturnType<typeof twinFor>>,
  clock: FakeClock,
  randomValue = 0,
): WebhookDispatcher {
  return new WebhookDispatcher({
    clock,
    twins,
    random: { next: () => randomValue },
    dnsResolver: fakeDns,
  });
}

function raw(eventId: string): RawWebhook {
  return {
    body: JSON.stringify({ event: "test.event", id: eventId }),
    contentType: "application/json",
  };
}

function simplePlan(now: number): WebhookPlan {
  return {
    send: true,
    notSentReason: undefined,
    deliveries: [
      {
        index: 0,
        dueAt: now,
        delayMs: 0,
        verificationFailure: undefined,
        holdUntil: undefined,
      },
    ],
    firedSteps: [],
    firedRules: [],
  };
}

type FailureSpec = {
  readonly failureId: FailureId;
  readonly settings?: Readonly<Record<string, unknown>>;
};

function planWith(twinId: string, now: number, specs: readonly FailureSpec[]): WebhookPlan {
  const rules: ActiveRule[] = specs.map((spec, index) => {
    const failure = getFailure(spec.failureId);
    if (failure === undefined) {
      throw new Error(`unknown failure ${spec.failureId}`);
    }
    return {
      id: `plan-rule-${index}`,
      failureId: failure.id,
      settings: failure.failureSettingsSchema.parse(spec.settings ?? {}),
      twinId,
      actionIds: ["refund.create"],
      used: 0,
      limit: null,
      order: index + 1,
    };
  });

  return decideWebhook({
    twinId,
    actionId: "refund.create",
    rules,
    random: { next: () => 0 },
    now,
  });
}

function firstDelivery(deliveries: readonly WebhookDelivery[]): WebhookDelivery {
  const delivery = deliveries[0];
  if (delivery === undefined) {
    throw new Error("the dispatcher created no delivery");
  }
  return delivery;
}

function enqueue(
  dispatcher: WebhookDispatcher,
  twinId: string,
  eventId: string,
  plan: WebhookPlan,
): readonly WebhookDelivery[] {
  return dispatcher.enqueue({
    eventId,
    twinId,
    actionId: "refund.create",
    raw: raw(eventId),
    plan,
  });
}

describe("T5 webhook dispatcher statuses and attempts", () => {
  it("T5 statuses: reaches all eight statuses with the right twin", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer();
    const signer = signerFor("alpha");
    const dispatcher = dispatcherFor(
      {
        alpha: twinFor(signer, () => server.url),
        beta: twinFor(signer, () => server.url),
        gamma: twinFor(signer, () => undefined),
      },
      clock,
    );

    const queued = firstDelivery(enqueue(dispatcher, "alpha", "queued", simplePlan(clock.now())));
    expect(queued.status).toBe("queued");
    expect(queued.twinId).toBe("alpha");

    const scheduled = firstDelivery(
      enqueue(
        dispatcher,
        "alpha",
        "scheduled",
        planWith("alpha", clock.now(), [
          { failureId: "webhook-delayed", settings: { seconds: 3_600 } },
        ]),
      ),
    );
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.twinId).toBe("alpha");

    const running = dispatcher.dispatchDue();
    await server.waitForRequests(1);
    expect(dispatcher.get(queued.id)?.status).toBe("sending");
    respond(server, 0);
    await running;
    expect(dispatcher.get(queued.id)?.status).toBe("delivered");

    const failed = firstDelivery(enqueue(dispatcher, "alpha", "failed", simplePlan(clock.now())));
    const failing = dispatcher.dispatchDue();
    await server.waitForRequests(2);
    respond(server, 1, 500);
    await failing;
    expect(dispatcher.get(failed.id)?.status).toBe("failed");

    const unreachable = firstDelivery(
      enqueue(dispatcher, "alpha", "unreachable", simplePlan(clock.now())),
    );
    const timingOut = dispatcher.dispatchDue();
    await server.waitForRequests(3);
    clock.advanceBy(10_000);
    await timingOut;
    expect(dispatcher.get(unreachable.id)?.status).toBe("unreachable");

    const abandoned = firstDelivery(
      enqueue(
        dispatcher,
        "beta",
        "abandoned",
        planWith("beta", clock.now(), [
          { failureId: "webhook-delayed", settings: { seconds: 3_600 } },
        ]),
      ),
    );
    expect(abandoned.status).toBe("scheduled");
    dispatcher.resetTwin("beta");
    expect(dispatcher.get(abandoned.id)?.status).toBe("abandoned");
    expect(dispatcher.get(abandoned.id)?.twinId).toBe("beta");

    const notSent = firstDelivery(
      enqueue(dispatcher, "gamma", "not-sent", simplePlan(clock.now())),
    );
    expect(notSent.status).toBe("not-sent");
    expect(notSent.reason).toBe("no webhook URL set");
    expect(notSent.twinId).toBe("gamma");

    expect(dispatcher.get(scheduled.id)?.status).toBe("scheduled");
  });

  it("T5 attempts: records attempts immutably and stops after the last retry", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 500 });
    const signer = signerFor("retry");
    const dispatcher = dispatcherFor(
      {
        retry: twinFor(signer, () => server.url, {
          source: "docs",
          delaysSeconds: [1],
        }),
      },
      clock,
    );

    const delivery = firstDelivery(enqueue(dispatcher, "retry", "retry", simplePlan(clock.now())));
    await dispatcher.dispatchDue();
    const first = dispatcher.get(delivery.id)?.attempts[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error("the first attempt was not recorded");
    }
    const snapshot = { ...first };
    expect(Object.isFrozen(first)).toBe(true);
    expect(dispatcher.get(delivery.id)?.status).toBe("scheduled");
    expect(dispatcher.get(delivery.id)?.scheduledAt).toBe(2_000);

    clock.advanceBy(1_000);
    await dispatcher.dispatchDue();
    const after = dispatcher.get(delivery.id);
    expect(after?.status).toBe("failed");
    expect(after?.attempts).toHaveLength(2);
    expect(after?.attempts[0]).toEqual(snapshot);
    expect(after?.attempts[0]?.attempt).toBe(1);
    expect(after?.attempts[1]?.attempt).toBe(2);
  });

  it("T5 response: keeps 4 KB and removes authorization and signature headers", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({
      status: 200,
      headers: {
        Authorization: "Bearer response-secret",
        "x-fake-signature": "response-signature",
        "X-Keep": "kept",
      },
      body: "x".repeat(5_000),
    });
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const delivery = firstDelivery(
      enqueue(dispatcher, "alpha", "response", simplePlan(clock.now())),
    );
    await dispatcher.dispatchDue();
    const attempt = dispatcher.get(delivery.id)?.attempts[0];
    expect(attempt?.responseBody).toHaveLength(4_096);
    expect(attempt?.responseHeaders).toMatchObject({ "x-keep": "kept" });
    expect(attempt?.responseHeaders).not.toHaveProperty("authorization");
    expect(attempt?.responseHeaders).not.toHaveProperty("x-fake-signature");
    expect(attempt?.responseBody).not.toContain("response-secret");
  });
});

describe("T5 webhook failures", () => {
  it("T5 failures: delays the first attempt and uses the fake clock", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const delivery = firstDelivery(
      enqueue(
        dispatcher,
        "alpha",
        "delayed",
        planWith("alpha", clock.now(), [
          { failureId: "webhook-delayed", settings: { seconds: 5, jitterSeconds: 0 } },
        ]),
      ),
    );
    expect(delivery.status).toBe("scheduled");

    await dispatcher.dispatchDue();
    expect(server.requests).toHaveLength(0);
    clock.advanceBy(4_999);
    await dispatcher.dispatchDue();
    expect(server.requests).toHaveLength(0);
    clock.advanceBy(1);
    await dispatcher.dispatchDue();
    expect(server.requests).toHaveLength(1);
    expect(dispatcher.get(delivery.id)?.status).toBe("delivered");
  });

  it("T5 failures: duplicates the webhook with the same body and event id", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const deliveries = enqueue(
      dispatcher,
      "alpha",
      "duplicate",
      planWith("alpha", clock.now(), [
        {
          failureId: "webhook-duplicated",
          settings: { copies: 2, gapSeconds: 3 },
        },
      ]),
    );

    expect(deliveries).toHaveLength(2);
    expect(deliveries[0]?.status).toBe("queued");
    expect(deliveries[1]?.status).toBe("scheduled");
    await dispatcher.dispatchDue();
    expect(server.requests).toHaveLength(1);

    clock.advanceBy(3_000);
    await dispatcher.dispatchDue();
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.body).toBe(server.requests[1]?.body);
    expect(deliveries[0]?.eventId).toBe(deliveries[1]?.eventId);
  });

  it("T5 failures: holds out-of-order webhooks and sends newest first", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer();
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    enqueue(
      dispatcher,
      "alpha",
      "older",
      planWith("alpha", clock.now(), [
        { failureId: "webhook-out-of-order", settings: { windowSeconds: 10 } },
      ]),
    );
    enqueue(
      dispatcher,
      "alpha",
      "newer",
      planWith("alpha", clock.now(), [
        { failureId: "webhook-out-of-order", settings: { windowSeconds: 10 } },
      ]),
    );

    await dispatcher.dispatchDue();
    expect(server.requests).toHaveLength(0);
    clock.advanceBy(10_000);

    const running = dispatcher.dispatchDue();
    await server.waitForRequests(1);
    respond(server, 0);
    await server.waitForRequests(2);
    respond(server, 1);
    await running;

    expect(server.requests.map((request) => JSON.parse(request.body).id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("T5 failures: never-sent records not-sent and calls no signer", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const calls: SignCall[] = [];
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha", calls), () => server.url) },
      clock,
    );

    const delivery = firstDelivery(
      enqueue(
        dispatcher,
        "alpha",
        "never",
        planWith("alpha", clock.now(), [{ failureId: "webhook-never-sent" }]),
      ),
    );

    expect(delivery.status).toBe("not-sent");
    expect(delivery.reason).toBe("webhook-never-sent");
    await dispatcher.dispatchDue();
    expect(server.requests).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("T5 failures: bad signature asks the twin signer for the chosen method", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const calls: SignCall[] = [];
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha", calls), () => server.url) },
      clock,
    );

    const delivery = firstDelivery(
      enqueue(
        dispatcher,
        "alpha",
        "bad-signature",
        planWith("alpha", clock.now(), [
          {
            failureId: "webhook-verification-fails",
            settings: { method: "corrupted" },
          },
        ]),
      ),
    );
    await dispatcher.dispatchDue();

    expect(calls[0]?.failureMethod).toBe("corrupted");
    expect(server.requests[0]?.headers["x-alpha-signature"]).toContain("corrupted");
    expect(dispatcher.get(delivery.id)?.status).toBe("delivered");
  });
});

describe("T5 webhook retries and routing", () => {
  it("T5 retries: follows each fake twin's own schedule and stops after its last retry", async () => {
    const clock = new FakeClock(1_000);
    const serverA = await startServer({ status: 500 });
    const serverB = await startServer({ status: 500 });
    const dispatcher = dispatcherFor(
      {
        alpha: twinFor(signerFor("alpha"), () => serverA.url, {
          source: "docs",
          delaysSeconds: [1],
        }),
        beta: twinFor(signerFor("beta"), () => serverB.url, {
          source: "docs",
          delaysSeconds: [2, 1],
        }),
      },
      clock,
    );

    const alpha = firstDelivery(
      enqueue(dispatcher, "alpha", "alpha-retry", simplePlan(clock.now())),
    );
    const beta = firstDelivery(enqueue(dispatcher, "beta", "beta-retry", simplePlan(clock.now())));

    await dispatcher.dispatchDue();
    expect(dispatcher.get(alpha.id)?.scheduledAt).toBe(2_000);
    expect(dispatcher.get(beta.id)?.scheduledAt).toBe(3_000);

    clock.advanceBy(1_000);
    await dispatcher.dispatchDue();
    expect(dispatcher.get(alpha.id)?.status).toBe("failed");
    expect(dispatcher.get(alpha.id)?.attempts).toHaveLength(2);
    expect(dispatcher.get(beta.id)?.attempts).toHaveLength(1);

    clock.advanceBy(1_000);
    await dispatcher.dispatchDue();
    expect(dispatcher.get(beta.id)?.attempts).toHaveLength(2);
    expect(dispatcher.get(beta.id)?.scheduledAt).toBe(4_000);

    clock.advanceBy(1_000);
    await dispatcher.dispatchDue();
    expect(dispatcher.get(beta.id)?.status).toBe("failed");
    expect(dispatcher.get(beta.id)?.attempts).toHaveLength(3);
  });

  it("T5 retries: an assumed schedule uses C7's fallback and seeded jitter", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 500 });
    const dispatcher = dispatcherFor(
      {
        assumed: twinFor(signerFor("assumed"), () => server.url, {
          source: "assumed",
          delaysSeconds: [1],
        }),
      },
      clock,
      0.5,
    );

    const delivery = firstDelivery(
      enqueue(dispatcher, "assumed", "assumed", simplePlan(clock.now())),
    );
    await dispatcher.dispatchDue();

    expect(C7_FALLBACK_RETRY_DELAYS_SECONDS[0]).toBe(60);
    expect(dispatcher.get(delivery.id)?.status).toBe("scheduled");
    expect(dispatcher.get(delivery.id)?.scheduledAt).toBe(1_000 + 63_000);
  });

  it("T5 routing: each twin's webhooks go only to its own URL", async () => {
    const clock = new FakeClock(1_000);
    const serverA = await startServer({ status: 200 });
    const serverB = await startServer({ status: 200 });
    const dispatcher = dispatcherFor(
      {
        alpha: twinFor(signerFor("alpha"), () => serverA.url),
        beta: twinFor(signerFor("beta"), () => serverB.url),
      },
      clock,
    );

    enqueue(dispatcher, "alpha", "for-alpha", simplePlan(clock.now()));
    enqueue(dispatcher, "beta", "for-beta", simplePlan(clock.now()));
    await dispatcher.dispatchDue();

    expect(serverA.requests).toHaveLength(1);
    expect(serverB.requests).toHaveLength(1);
    expect(JSON.parse(serverA.requests[0]?.body ?? "{}").id).toBe("for-alpha");
    expect(JSON.parse(serverB.requests[0]?.body ?? "{}").id).toBe("for-beta");
    expect(serverA.requests[0]?.headers["x-alpha-signature"]).toBeDefined();
    expect(serverB.requests[0]?.headers["x-beta-signature"]).toBeDefined();
  });

  it("T5 routing: manual resend uses the current URL, current credentials and same body", async () => {
    const clock = new FakeClock(1_000);
    const serverA = await startServer({ status: 200 });
    const serverB = await startServer({ status: 200 });
    let currentUrl = serverA.url;
    let currentSecret = "one";
    const dispatcher = dispatcherFor(
      {
        alpha: twinFor(
          signerFor("alpha"),
          () => currentUrl,
          { source: "docs", delaysSeconds: [] },
          () => ({ secret: currentSecret }),
        ),
      },
      clock,
    );

    const original = firstDelivery(enqueue(dispatcher, "alpha", "resend", simplePlan(clock.now())));
    await dispatcher.dispatchDue();
    const originalBody = serverA.requests[0]?.body;

    currentUrl = serverB.url;
    currentSecret = "two";
    const resent = dispatcher.resend(original.id);

    expect(resent.id).not.toBe(original.id);
    expect(resent.resendOf).toBe(original.id);
    expect(resent.raw.body).toBe(original.raw.body);
    expect(resent.status).toBe("queued");

    await dispatcher.dispatchDue();
    expect(serverA.requests).toHaveLength(1);
    expect(serverB.requests).toHaveLength(1);
    expect(serverB.requests[0]?.body).toBe(originalBody);
    expect(serverB.requests[0]?.headers["x-alpha-signature"]).toBe("valid-two-1");
  });

  it("T5 routing: no redirects are followed", async () => {
    const clock = new FakeClock(1_000);
    const destination = await startServer({ status: 200 });
    const source = await startServer({
      status: 302,
      headers: { Location: destination.url },
    });
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => source.url) },
      clock,
    );

    const delivery = firstDelivery(
      enqueue(dispatcher, "alpha", "redirect", simplePlan(clock.now())),
    );
    await dispatcher.dispatchDue();

    expect(dispatcher.get(delivery.id)?.status).toBe("failed");
    expect(dispatcher.get(delivery.id)?.attempts[0]?.responseStatus).toBe(302);
    expect(destination.requests).toHaveLength(0);
  });
});

describe("T5 webhook timeout and lifecycle", () => {
  it("T5 timeout: a server that never answers is unreachable after ten seconds", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer();
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const delivery = firstDelivery(
      enqueue(dispatcher, "alpha", "timeout", simplePlan(clock.now())),
    );
    const running = dispatcher.dispatchDue();
    await server.waitForRequests(1);
    clock.advanceBy(10_000);
    await running;

    const attempt = dispatcher.get(delivery.id)?.attempts[0];
    expect(dispatcher.get(delivery.id)?.status).toBe("unreachable");
    expect(attempt?.finishedAt).toBe(11_000);
    expect(attempt?.error).toContain("10 seconds");
  });

  it("T5 lifecycle: stopping abandons queued and scheduled deliveries", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const queued = firstDelivery(
      enqueue(dispatcher, "alpha", "queued-stop", simplePlan(clock.now())),
    );
    const scheduled = firstDelivery(
      enqueue(
        dispatcher,
        "alpha",
        "scheduled-stop",
        planWith("alpha", clock.now(), [
          { failureId: "webhook-delayed", settings: { seconds: 3_600 } },
        ]),
      ),
    );

    expect(dispatcher.stop()).toBe(2);
    expect(dispatcher.get(queued.id)?.status).toBe("abandoned");
    expect(dispatcher.get(scheduled.id)?.status).toBe("abandoned");
    expect(() => enqueue(dispatcher, "alpha", "after-stop", simplePlan(clock.now()))).toThrow(
      IbejiError,
    );
  });

  it("T5 lifecycle: a refused address is recorded as unreachable", async () => {
    const clock = new FakeClock(1_000);
    const dispatcher = new WebhookDispatcher({
      clock,
      twins: {
        alpha: twinFor(signerFor("alpha"), () => "http://blocked.example/webhook"),
      },
      random: { next: () => 0 },
      dnsResolver: async () => [{ address: "8.8.8.8", family: 4 }],
    });

    const delivery = firstDelivery(
      enqueue(dispatcher, "alpha", "blocked", simplePlan(clock.now())),
    );
    await dispatcher.dispatchDue();

    expect(dispatcher.get(delivery.id)?.status).toBe("unreachable");
    expect(dispatcher.get(delivery.id)?.attempts[0]?.errorCode).toBe("WEBHOOK_URL_NOT_ALLOWED");
  });

  it("T5 transport: default ports and HTTPS use a checked address", async () => {
    expect(webhookPort(new URL("http://127.0.0.1/webhook"))).toBe(80);
    expect(webhookPort(new URL("https://127.0.0.1/webhook"))).toBe(443);
    expect(webhookPort(new URL("https://127.0.0.1:444/webhook"))).toBe(444);

    const clock = new FakeClock(1_000);
    const secure = await startServer({ secure: true, status: 200 });
    const port = new URL(secure.url).port;
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => `https://localhost:${port}/webhook`) },
      clock,
    );

    const delivery = firstDelivery(enqueue(dispatcher, "alpha", "https", simplePlan(clock.now())));
    await dispatcher.dispatchDue();

    expect(dispatcher.get(delivery.id)?.status).toBe("unreachable");
    expect(dispatcher.get(delivery.id)?.attempts).toHaveLength(1);
  });

  it("T5 transport: omitting the fake resolver still resolves an IP literal locally", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const dispatcher = new WebhookDispatcher({
      clock,
      twins: { alpha: twinFor(signerFor("alpha"), () => server.url) },
      random: { next: () => 0 },
    });

    const delivery = firstDelivery(
      enqueue(dispatcher, "alpha", "default-dns", simplePlan(clock.now())),
    );
    await dispatcher.dispatchDue();
    expect(dispatcher.get(delivery.id)?.status).toBe("delivered");
    expect(dispatcher.get(delivery.id)?.attempts[0]?.remoteAddress).toBe("127.0.0.1");
  });

  it("T5 records: list, get, unknown twins and empty plans", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const delivery = firstDelivery(enqueue(dispatcher, "alpha", "listed", simplePlan(clock.now())));
    expect(dispatcher.list().map((item) => item.id)).toContain(delivery.id);
    expect(dispatcher.get("missing")).toBeUndefined();
    expect(() => enqueue(dispatcher, "unknown", "unknown", simplePlan(clock.now()))).toThrow(
      IbejiError,
    );

    const noReasonPlan: WebhookPlan = {
      send: false,
      notSentReason: undefined,
      deliveries: [],
      firedSteps: [],
      firedRules: [],
    };
    const noReason = firstDelivery(enqueue(dispatcher, "alpha", "no-reason", noReasonPlan));
    expect(noReason.reason).toBe("webhook not sent");

    const emptyPlan: WebhookPlan = {
      send: true,
      notSentReason: undefined,
      deliveries: [],
      firedSteps: [],
      firedRules: [],
    };
    expect(firstDelivery(enqueue(dispatcher, "alpha", "empty", emptyPlan)).status).toBe("queued");
  });

  it("T5 lifecycle: a URL removed before the attempt becomes not-sent", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    let url: string | undefined = server.url;
    const dispatcher = dispatcherFor({ alpha: twinFor(signerFor("alpha"), () => url) }, clock);

    const delivery = firstDelivery(
      enqueue(dispatcher, "alpha", "removed-url", simplePlan(clock.now())),
    );
    url = undefined;
    await dispatcher.dispatchDue();

    expect(dispatcher.get(delivery.id)?.status).toBe("not-sent");
    expect(dispatcher.get(delivery.id)?.reason).toBe("no webhook URL set");
  });

  it("T5 dispatch: concurrent calls share one run and a stopped dispatcher is idle", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer();
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    enqueue(dispatcher, "alpha", "concurrent", simplePlan(clock.now()));
    const first = dispatcher.dispatchDue();
    const second = dispatcher.dispatchDue();
    await server.waitForRequests(1);
    respond(server, 0);
    await first;
    await second;
    expect(server.requests).toHaveLength(1);

    dispatcher.stop();
    await expect(dispatcher.dispatchDue()).resolves.toEqual([]);
    expect(dispatcher.stop()).toBe(0);
  });

  it("T5 lifecycle: stopping abandons an in-flight delivery and the rest", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer();
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const first = firstDelivery(enqueue(dispatcher, "alpha", "in-flight", simplePlan(clock.now())));
    const second = firstDelivery(enqueue(dispatcher, "alpha", "pending", simplePlan(clock.now())));
    const running = dispatcher.dispatchDue();
    await server.waitForRequests(1);

    expect(dispatcher.stop()).toBe(2);
    await running;
    expect(dispatcher.get(first.id)?.status).toBe("abandoned");
    expect(dispatcher.get(second.id)?.status).toBe("abandoned");
    expect(server.requests).toHaveLength(1);
    expect(() => enqueue(dispatcher, "alpha", "after-stop", simplePlan(clock.now()))).toThrow(
      IbejiError,
    );
  });

  it("T5 dispatch: a delivery reset while another sends is skipped", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer();
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    const first = firstDelivery(enqueue(dispatcher, "alpha", "first", simplePlan(clock.now())));
    const second = firstDelivery(enqueue(dispatcher, "alpha", "second", simplePlan(clock.now())));
    const running = dispatcher.dispatchDue();
    await server.waitForRequests(1);
    expect(dispatcher.resetTwin("alpha")).toBe(1);
    respond(server, 0);
    await running;

    expect(dispatcher.get(first.id)?.status).toBe("delivered");
    expect(dispatcher.get(second.id)?.status).toBe("abandoned");
  });

  it("T5 resend: rejects a missing delivery and handles a removed URL", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    let url: string | undefined = server.url;
    const dispatcher = dispatcherFor({ alpha: twinFor(signerFor("alpha"), () => url) }, clock);

    const original = firstDelivery(
      enqueue(dispatcher, "alpha", "original", simplePlan(clock.now())),
    );
    await dispatcher.dispatchDue();
    expect(() => dispatcher.resend("missing")).toThrow(IbejiError);

    url = undefined;
    const resent = dispatcher.resend(original.id);
    expect(resent.status).toBe("not-sent");
    expect(resent.reason).toBe("no webhook URL set");
  });

  it("T5 ordering: due deliveries are sent in scheduled order", async () => {
    const clock = new FakeClock(1_000);
    const server = await startServer({ status: 200 });
    const dispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => server.url) },
      clock,
    );

    enqueue(
      dispatcher,
      "alpha",
      "later",
      planWith("alpha", clock.now(), [
        { failureId: "webhook-delayed", settings: { seconds: 10, jitterSeconds: 0 } },
      ]),
    );
    enqueue(
      dispatcher,
      "alpha",
      "earlier",
      planWith("alpha", clock.now(), [
        { failureId: "webhook-delayed", settings: { seconds: 5, jitterSeconds: 0 } },
      ]),
    );

    clock.advanceBy(10_000);
    await dispatcher.dispatchDue();

    expect(server.requests.map((request) => JSON.parse(request.body).id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("T5 response: truncates a chunked body and records a broken response", async () => {
    const clock = new FakeClock(1_000);
    const chunked = await startServer();
    const chunkedDispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => chunked.url) },
      clock,
    );
    const chunkedDelivery = firstDelivery(
      enqueue(chunkedDispatcher, "alpha", "chunked", simplePlan(clock.now())),
    );
    const chunkedRunning = chunkedDispatcher.dispatchDue();
    await chunked.waitForRequests(1);
    const chunkedResponse = chunked.responses[0];
    if (chunkedResponse === undefined) {
      throw new Error("the chunked response was not created");
    }
    chunkedResponse.setHeader("Set-Cookie", ["a=1", "b=2"]);
    chunkedResponse.writeHead(200);
    chunkedResponse.write("a".repeat(4_096));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    chunkedResponse.write("b".repeat(100));
    chunkedResponse.end();
    await chunkedRunning;
    const chunkedAttempt = chunkedDispatcher.get(chunkedDelivery.id)?.attempts[0];
    expect(chunkedAttempt?.responseBody).toHaveLength(4_096);
    expect(chunkedAttempt?.responseHeaders["set-cookie"]).toBe("a=1, b=2");

    const broken = await startServer();
    const brokenDispatcher = dispatcherFor(
      { alpha: twinFor(signerFor("alpha"), () => broken.url) },
      clock,
    );
    const brokenDelivery = firstDelivery(
      enqueue(brokenDispatcher, "alpha", "broken", simplePlan(clock.now())),
    );
    const brokenRunning = brokenDispatcher.dispatchDue();
    await broken.waitForRequests(1);
    const brokenResponse = broken.responses[0];
    if (brokenResponse === undefined) {
      throw new Error("the broken response was not created");
    }
    brokenResponse.writeHead(200);
    brokenResponse.write("part");
    brokenResponse.destroy();
    await brokenRunning;
    expect(brokenDispatcher.get(brokenDelivery.id)?.status).toBe("unreachable");
  });

  it("T5 signer: a thrown string and an invalid header become unreachable attempts", async () => {
    const clock = new FakeClock(1_000);
    const throwing: WebhookSigner = {
      sign: () => {
        throw "signer exploded";
      },
    };
    const throwingDispatcher = dispatcherFor(
      { alpha: twinFor(throwing, () => "http://127.0.0.1:1/webhook") },
      clock,
    );
    const thrown = firstDelivery(
      enqueue(throwingDispatcher, "alpha", "throw", simplePlan(clock.now())),
    );
    await throwingDispatcher.dispatchDue();
    expect(throwingDispatcher.get(thrown.id)?.attempts[0]?.error).toBe("signer exploded");

    const invalidHeader: WebhookSigner = {
      sign: () => ({ "x-bad": "bad\nvalue" }),
    };
    const server = await startServer({ status: 200 });
    const invalidDispatcher = dispatcherFor(
      { alpha: twinFor(invalidHeader, () => server.url) },
      clock,
    );
    const invalid = firstDelivery(
      enqueue(invalidDispatcher, "alpha", "bad-header", simplePlan(clock.now())),
    );
    await invalidDispatcher.dispatchDue();
    expect(invalidDispatcher.get(invalid.id)?.status).toBe("unreachable");
    expect(invalidDispatcher.get(invalid.id)?.attempts[0]?.error).toContain("Invalid character");
  });
});
