import type { Server } from "node:http";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { fingerprint } from "../../src/core/redact.js";
import type { Scenario } from "../../src/core/scenarios/schema.js";
import {
  apiUrl,
  authHeaders,
  type ControlSessionHarness,
  cookieFrom,
  exchangeCode,
  withControlSession,
} from "../helpers/control.js";

type ApiResult = {
  readonly response: Response;
  readonly body: unknown;
};

async function api(
  session: ControlSessionHarness["session"],
  path: string,
  init: RequestInit = {},
): Promise<ApiResult> {
  const response = await fetch(apiUrl(session, path), {
    ...init,
    headers: {
      ...authHeaders(session),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return {
    response,
    body: text === "" ? undefined : (JSON.parse(text) as unknown),
  };
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

function credentials(session: ControlSessionHarness["session"], twinId: string) {
  const values = session.credentials[twinId];
  if (values === undefined) {
    throw new Error(`expected credentials for ${twinId}`);
  }
  return values;
}

function twinEntry(harness: ControlSessionHarness, twinId: string) {
  const entry = harness.session.twins.get(twinId);
  if (entry === undefined) {
    throw new Error(`expected the ${twinId} twin`);
  }
  return entry;
}

async function createPaystackRecord(
  harness: ControlSessionHarness,
  reference: string,
): Promise<void> {
  const twin = twinEntry(harness, "paystack");
  const initialized = await fetch(`${twin.address.url}/transaction/initialize`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials(harness.session, "paystack").secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: "10000",
      email: "customer.one@example.com",
      currency: "NGN",
      reference,
    }),
  });
  if (initialized.status !== 200) {
    throw new Error(`Paystack initialize failed with ${initialized.status}`);
  }

  const paid = await fetch(`${twin.address.url}/checkout/${encodeURIComponent(reference)}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: twin.address.url,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "outcome=success",
  });
  if (paid.status !== 200 && paid.status !== 303) {
    throw new Error(`Paystack checkout failed with ${paid.status}`);
  }
}

async function createFlutterwaveRecord(
  harness: ControlSessionHarness,
  txRef: string,
): Promise<void> {
  const twin = twinEntry(harness, "flutterwave");
  const created = await fetch(`${twin.address.url}/v3/payments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials(harness.session, "flutterwave").secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: "7500",
      tx_ref: txRef,
      currency: "NGN",
      redirect_url: "https://example.com/ibeji/flutterwave",
      customer: { email: "customer.one@example.com" },
    }),
  });
  if (created.status !== 200) {
    throw new Error(`Flutterwave payment create failed with ${created.status}`);
  }

  const paid = await fetch(`${twin.address.url}/checkout/${encodeURIComponent(txRef)}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: twin.address.url,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "outcome=success",
  });
  if (paid.status !== 200 && paid.status !== 303) {
    throw new Error(`Flutterwave checkout failed with ${paid.status}`);
  }
}

async function startReceiver(): Promise<{
  readonly url: string;
  readonly received: number;
  close: () => Promise<void>;
}> {
  let received = 0;
  const server: Server = createServer((_request, response) => {
    received += 1;
    response.setHeader("authorization", "Bearer receiver-secret");
    response.setHeader("x-test-signature", "receiver-signature");
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    url: `http://127.0.0.1:${address.port}/webhook`,
    get received() {
      return received;
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function recordsIn(collections: unknown): number {
  const list = (collections as { collections: { records: unknown[] }[] }).collections;
  return list.reduce((total, collection) => total + collection.records.length, 0);
}

const scenario: Scenario = {
  id: "slow-day",
  name: "A slow day",
  story: "Every request is slow for a moment.",
  twins: ["paystack", "flutterwave"],
  rules: [{ id: "slow", failureId: "slow-response", settings: { seconds: 1 } }],
  steps: [],
};

describe("C8 control API routes", () => {
  it("C8 GET /status summarises the session", async () => {
    await withControlSession({}, async (harness) => {
      const result = await api(harness.session, "/status");
      expect(result.response.status).toBe(200);
      expect(result.body).toMatchObject({
        version: "0.0.0",
        instance: harness.session.instanceId,
        seed: harness.session.seed,
        startTime: harness.session.startTime,
        scenario: null,
        rules: [],
      });
      const twins = (result.body as { twins: { id: string; running: boolean }[] }).twins;
      expect(twins).toHaveLength(2);
      for (const twin of twins) {
        expect(twin.running).toBe(true);
      }
    });
  });

  it("C8 GET /twins returns metadata for every registered twin", async () => {
    await withControlSession({}, async (harness) => {
      const result = await api(harness.session, "/twins");
      const twins = (
        result.body as {
          twins: {
            id: string;
            displayName: string;
            running: boolean;
            address: string | null;
            actions: unknown[];
            failures: unknown[];
            currencyRules: { zeroDecimal: string[]; fractionDigits: Record<string, number> };
            labelColourToken: string;
          }[];
        }
      ).twins;
      expect(twins).toHaveLength(2);
      const tokens = new Set<string>();

      for (const summary of twins) {
        const entry = twinEntry(harness, summary.id);
        expect(summary.displayName).toBe(entry.definition.displayName);
        expect(summary.running).toBe(true);
        expect(summary.address).toBe(entry.address.url);
        expect(summary.actions).toHaveLength(entry.definition.actions.length);
        expect(summary.failures).toHaveLength(entry.definition.failures.support.length);
        expect(summary.currencyRules.zeroDecimal).toEqual(entry.definition.money.zeroDecimal);
        expect(summary.currencyRules.fractionDigits.USD).toBe(2);
        expect(summary.labelColourToken).toMatch(/^twin-label-/u);
        tokens.add(summary.labelColourToken);
      }
      expect(tokens.size).toBe(2);
    });
  });

  it("C8 GET /twins/:twin/credentials returns every credential with its label", async () => {
    await withControlSession({}, async (harness) => {
      for (const [twinId, entry] of harness.session.twins) {
        const result = await api(harness.session, `/twins/${twinId}/credentials`);
        expect(result.response.status).toBe(200);
        const body = result.body as {
          twin: { id: string; displayName: string };
          credentials: {
            id: string;
            label: string;
            role: string;
            secret: boolean;
            value: string;
          }[];
        };
        expect(body.twin).toEqual({ id: twinId, displayName: entry.definition.displayName });
        expect(body.credentials).toHaveLength(entry.definition.credentials.length);
        for (const credential of body.credentials) {
          const spec = entry.definition.credentials.find((item) => item.id === credential.id);
          expect(spec).toBeDefined();
          expect(credential.label).toBe(spec?.label);
          expect(credential.value).toBe(credentials(harness.session, twinId)[credential.id]);
        }
      }
    });
  });

  it("C8 POST /credentials/rotate replaces one twin or every twin", async () => {
    await withControlSession({}, async (harness) => {
      const beforePaystack = harness.session.credentialsStore.get("paystack");
      const beforeFlutterwave = harness.session.credentialsStore.get("flutterwave");

      const one = await api(harness.session, "/credentials/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twin: "paystack" }),
      });
      expect(one.response.status).toBe(200);
      expect(one.body).toMatchObject({ rotated: ["paystack"] });
      expect(harness.session.credentialsStore.get("paystack")).not.toEqual(beforePaystack);
      expect(harness.session.credentialsStore.get("flutterwave")).toEqual(beforeFlutterwave);

      const all = await api(harness.session, "/credentials/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(all.response.status).toBe(200);
      expect((all.body as { rotated: string[] }).rotated.sort()).toEqual([
        "flutterwave",
        "paystack",
      ]);

      const unknown = await api(harness.session, "/credentials/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twin: "missing" }),
      });
      expect(unknown.response.status).toBe(404);
      expect(errorCode(unknown.body)).toBe("UNKNOWN_TWIN");

      const badBody = await api(harness.session, "/credentials/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twin: 7 }),
      });
      expect(badBody.response.status).toBe(400);
      expect(errorCode(badBody.body)).toBe("BAD_REQUEST");

      const badJson = await api(harness.session, "/credentials/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      expect(badJson.response.status).toBe(400);
      expect(errorCode(badJson.body)).toBe("BAD_REQUEST");
    });
  });

  it("C8 GET and DELETE twin state reset records and abandon queued webhooks", async () => {
    await withControlSession({}, async (harness) => {
      const receiver = await startReceiver();
      try {
        const rule = await api(harness.session, "/rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            failureId: "webhook-delayed",
            twins: ["paystack"],
            actions: "checkout.submit",
            settings: { seconds: 60, jitterSeconds: 0 },
          }),
        });
        expect(rule.response.status).toBe(200);

        const url = await api(harness.session, "/twins/paystack/webhook-url", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: receiver.url }),
        });
        expect(url.response.status).toBe(200);

        await createPaystackRecord(harness, "reset-paystack");
        await createFlutterwaveRecord(harness, "reset-flutterwave");

        const paystackState = await api(harness.session, "/twins/paystack/state");
        expect(recordsIn(paystackState.body)).toBeGreaterThan(0);
        const flutterwaveState = await api(harness.session, "/twins/flutterwave/state");
        expect(recordsIn(flutterwaveState.body)).toBeGreaterThan(0);

        const queued = await api(harness.session, "/webhooks?twin=paystack&status=scheduled");
        expect((queued.body as { deliveries: unknown[] }).deliveries).toHaveLength(1);

        const resetOne = await api(harness.session, "/twins/paystack/state", { method: "DELETE" });
        expect(resetOne.response.status).toBe(200);
        expect((resetOne.body as { abandonedWebhooks: number }).abandonedWebhooks).toBe(1);
        expect(recordsIn((await api(harness.session, "/twins/paystack/state")).body)).toBe(0);
        expect(
          recordsIn((await api(harness.session, "/twins/flutterwave/state")).body),
        ).toBeGreaterThan(0);

        const abandoned = await api(harness.session, "/webhooks?twin=paystack&status=abandoned");
        expect((abandoned.body as { deliveries: unknown[] }).deliveries).toHaveLength(1);

        const rulesAfter = await api(harness.session, "/rules");
        expect((rulesAfter.body as { rules: unknown[] }).rules).toHaveLength(1);
        const urlAfter = await api(harness.session, "/twins/paystack/webhook-url");
        expect((urlAfter.body as { url: string }).url).toBe(receiver.url);

        const resetAll = await api(harness.session, "/state", { method: "DELETE" });
        expect(resetAll.response.status).toBe(200);
        expect((resetAll.body as { twins: string[] }).twins.sort()).toEqual([
          "flutterwave",
          "paystack",
        ]);
        expect(recordsIn((await api(harness.session, "/twins/flutterwave/state")).body)).toBe(0);
      } finally {
        await receiver.close();
      }
    });
  });

  it("C8 GET /failures returns only supported failures with their schema and source", async () => {
    await withControlSession({}, async (harness) => {
      const result = await api(harness.session, "/failures");
      const failures = (
        result.body as {
          failures: {
            id: string;
            name: string;
            realLife: string;
            whatToCheck: string;
            settingsSchema: unknown;
            support: { twin: string; source: string; actions: string[] }[];
          }[];
        }
      ).failures;
      const ids = failures.map((failure) => failure.id);
      expect(ids).toContain("slow-response");
      expect(ids).not.toContain("authentication-required");
      const slow = failures.find((failure) => failure.id === "slow-response");
      expect(slow?.settingsSchema).toBeDefined();
      expect(slow?.realLife.length).toBeGreaterThan(0);
      expect(slow?.support.map((item) => item.twin).sort()).toEqual(["flutterwave", "paystack"]);
      expect(slow?.support[0]?.source).toBeDefined();
      expect(harness.session.rules.list()).toEqual([]);
    });
  });

  it("C8 rules can be added, listed, and removed one or all", async () => {
    await withControlSession({}, async (harness) => {
      const paystack = await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          failureId: "server-error",
          twins: ["paystack"],
          actions: "transaction",
          settings: { times: 2, status: 503 },
        }),
      });
      expect(paystack.response.status).toBe(200);
      const paystackRule = (paystack.body as { rule: { id: string; twins: string[] } }).rule;
      expect(paystackRule.twins).toEqual(["paystack"]);

      const flutterwave = await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          failureId: "payment-declined",
          twins: ["flutterwave"],
          settings: {},
        }),
      });
      expect(flutterwave.response.status).toBe(200);

      const listed = await api(harness.session, "/rules");
      expect((listed.body as { rules: unknown[] }).rules).toHaveLength(2);

      const removedOne = await api(harness.session, `/rules/${paystackRule.id}`, {
        method: "DELETE",
      });
      expect(removedOne.response.status).toBe(200);
      expect((removedOne.body as { rule: { id: string } }).rule.id).toBe(paystackRule.id);

      const removedTwin = await api(harness.session, "/rules?twin=flutterwave", {
        method: "DELETE",
      });
      expect(removedTwin.response.status).toBe(200);
      expect((removedTwin.body as { removed: number }).removed).toBe(1);
      expect((await api(harness.session, "/rules")).body).toMatchObject({ rules: [] });

      const missing = await api(harness.session, "/rules/not-a-rule", { method: "DELETE" });
      expect(missing.response.status).toBe(404);
      expect(errorCode(missing.body)).toBe("NOT_FOUND");

      await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ failureId: "slow-response", twins: ["paystack"], settings: {} }),
      });
      await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ failureId: "slow-response", twins: ["flutterwave"], settings: {} }),
      });
      const removedAll = await api(harness.session, "/rules", { method: "DELETE" });
      expect(removedAll.response.status).toBe(200);
      expect((removedAll.body as { removed: number }).removed).toBe(2);
    });
  });

  it("C8 rejects an unknown failure and an unknown action selector", async () => {
    await withControlSession({}, async (harness) => {
      const failure = await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ failureId: "not-a-failure", twins: ["paystack"] }),
      });
      expect(failure.response.status).toBe(400);
      expect(errorCode(failure.body)).toBe("UNKNOWN_FAILURE");

      const action = await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          failureId: "slow-response",
          twins: ["paystack"],
          actions: "not-an-action",
        }),
      });
      expect(action.response.status).toBe(400);
      expect(errorCode(action.body)).toBe("UNKNOWN_ACTION");
    });
  });

  it("C8 scenarios can be listed, run, and stopped", async () => {
    await withControlSession({ scenarios: [scenario] }, async (harness) => {
      const listed = await api(harness.session, "/scenarios");
      expect(listed.response.status).toBe(200);
      expect(listed.body).toMatchObject({
        active: null,
        scenarios: [{ id: "slow-day", name: "A slow day", running: false }],
      });

      const run = await api(harness.session, "/scenarios/slow-day/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twins: ["paystack"] }),
      });
      expect(run.response.status).toBe(200);
      expect(run.body).toMatchObject({ ok: true, scenario: "slow-day", twins: ["paystack"] });

      expect((await api(harness.session, "/status")).body).toMatchObject({ scenario: "slow-day" });
      expect((await api(harness.session, "/scenarios")).body).toMatchObject({
        active: "slow-day",
        scenarios: [{ id: "slow-day", running: true }],
      });

      const stop = await api(harness.session, "/scenarios/stop", { method: "POST" });
      expect(stop.response.status).toBe(200);
      expect(stop.body).toMatchObject({ ok: true, stopped: "slow-day" });
      expect((await api(harness.session, "/status")).body).toMatchObject({ scenario: null });

      const runFlutterwave = await api(harness.session, "/scenarios/slow-day/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twins: ["flutterwave"] }),
      });
      expect(runFlutterwave.response.status).toBe(200);
      expect(runFlutterwave.body).toMatchObject({ twins: ["flutterwave"] });
      const stoppedAgain = await api(harness.session, "/scenarios/stop", { method: "POST" });
      expect(stoppedAgain.body).toMatchObject({ stopped: "slow-day" });

      const noBody = await api(harness.session, "/scenarios/slow-day/run", { method: "POST" });
      expect(noBody.response.status).toBe(200);
      expect((noBody.body as { twins: string[] }).twins.sort()).toEqual([
        "flutterwave",
        "paystack",
      ]);
      await api(harness.session, "/scenarios/stop", { method: "POST" });

      const badBody = await api(harness.session, "/scenarios/slow-day/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twins: "paystack" }),
      });
      expect(badBody.response.status).toBe(400);
      expect(errorCode(badBody.body)).toBe("BAD_REQUEST");

      const unknown = await api(harness.session, "/scenarios/not-a-scenario/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(unknown.response.status).toBe(404);
      expect(errorCode(unknown.body)).toBe("UNKNOWN_SCENARIO");
    });
  });

  it("C8 GET and PUT /twins/:twin/webhook-url read, set and remove the URL", async () => {
    await withControlSession({}, async (harness) => {
      for (const twinId of harness.session.twins.keys()) {
        const empty = await api(harness.session, `/twins/${twinId}/webhook-url`);
        expect(empty.response.status).toBe(200);
        expect(empty.body).toEqual({ twin: twinId, url: null });

        const set = await api(harness.session, `/twins/${twinId}/webhook-url`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "http://127.0.0.1:3000/hook" }),
        });
        expect(set.response.status).toBe(200);
        expect((set.body as { url: string }).url).toBe("http://127.0.0.1:3000/hook");

        const got = await api(harness.session, `/twins/${twinId}/webhook-url`);
        expect((got.body as { url: string }).url).toBe("http://127.0.0.1:3000/hook");

        const removed = await api(harness.session, `/twins/${twinId}/webhook-url`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "" }),
        });
        expect(removed.body).toEqual({ twin: twinId, url: null });
      }

      const refused = await api(harness.session, "/twins/paystack/webhook-url", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://0.0.0.0:3000/hook" }),
      });
      expect(refused.response.status).toBe(400);
      expect(errorCode(refused.body)).toBe("WEBHOOK_URL_NOT_ALLOWED");
    });
  });

  it("C8 GET /webhooks lists deliveries and POST /webhooks/:id/resend sends another", async () => {
    await withControlSession({}, async (harness) => {
      const receiver = await startReceiver();
      try {
        await api(harness.session, "/twins/paystack/webhook-url", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: receiver.url }),
        });
        await createPaystackRecord(harness, "webhook-route");

        const queued = await api(harness.session, "/webhooks");
        const deliveries = (queued.body as { deliveries: { id: string; status: string }[] })
          .deliveries;
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]?.status).toBe("queued");
        const id = deliveries[0]?.id;
        if (id === undefined) {
          throw new Error("expected a delivery id");
        }

        await harness.session.dispatcher.dispatchDue();
        expect(receiver.received).toBe(1);
        const delivered = await api(harness.session, "/webhooks?twin=paystack&status=delivered");
        const deliveredList = (
          delivered.body as {
            deliveries: { id: string; attempts: { responseHeaders: Record<string, string> }[] }[];
          }
        ).deliveries;
        expect(deliveredList).toHaveLength(1);
        expect(deliveredList[0]?.attempts).toHaveLength(1);
        expect(deliveredList[0]?.attempts[0]?.responseHeaders.authorization).toBeUndefined();
        expect(deliveredList[0]?.attempts[0]?.responseHeaders["x-test-signature"]).toBeUndefined();

        const resent = await api(harness.session, `/webhooks/${id}/resend`, { method: "POST" });
        expect(resent.response.status).toBe(200);
        const resentDelivery = (
          resent.body as { delivery: { id: string; resendOf: string; status: string } }
        ).delivery;
        expect(resentDelivery.id).not.toBe(id);
        expect(resentDelivery.resendOf).toBe(id);
        expect(resentDelivery.status).toBe("queued");

        await harness.session.dispatcher.dispatchDue();
        expect(receiver.received).toBe(2);

        await api(harness.session, "/twins/flutterwave/webhook-url", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: receiver.url }),
        });
        await createFlutterwaveRecord(harness, "webhook-route-flutterwave");
        await harness.session.dispatcher.dispatchDue();
        const flutterwaveDeliveries = await api(
          harness.session,
          "/webhooks?twin=flutterwave&status=delivered",
        );
        expect((flutterwaveDeliveries.body as { deliveries: unknown[] }).deliveries).toHaveLength(
          1,
        );

        const exported = await api(harness.session, "/export");
        const exportedText = JSON.stringify(exported.body);
        expect(exportedText).not.toContain("receiver-secret");
        expect(exportedText).not.toContain("receiver-signature");

        const missing = await api(harness.session, "/webhooks/not-a-delivery/resend", {
          method: "POST",
        });
        expect(missing.response.status).toBe(404);
        expect(errorCode(missing.body)).toBe("NOT_FOUND");
      } finally {
        await receiver.close();
      }
    });
  });

  it("C8 the session loop dispatches due webhooks without a control request", async () => {
    await withControlSession({}, async (harness) => {
      const receiver = await startReceiver();
      try {
        await api(harness.session, "/twins/paystack/webhook-url", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: receiver.url }),
        });
        await createPaystackRecord(harness, "webhook-loop");

        harness.clock.advanceBy(250);
        for (let attempt = 0; attempt < 200 && receiver.received === 0; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(receiver.received).toBe(1);
      } finally {
        await receiver.close();
      }
    });
  });

  it("C8 GET /events filters by scope, type, after and limit", async () => {
    await withControlSession({}, async (harness) => {
      await createPaystackRecord(harness, "events-route");
      const all = await api(harness.session, "/events?scope=paystack");
      const events = (all.body as { events: { id: number; type: string; scope: string }[] }).events;
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.scope === "paystack")).toBe(true);

      const requests = await api(harness.session, "/events?scope=paystack&type=request&limit=1");
      const requestEvents = (requests.body as { events: { type: string }[] }).events;
      expect(requestEvents).toHaveLength(1);
      expect(requestEvents[0]?.type).toBe("request");

      const firstId = events[0]?.id;
      if (firstId === undefined) {
        throw new Error("expected an event id");
      }
      const after = await api(harness.session, `/events?after=${firstId}`);
      const afterEvents = (after.body as { events: { id: number }[] }).events;
      expect(afterEvents.every((event) => event.id > firstId)).toBe(true);

      const empty = await api(harness.session, "/events?after=999999");
      expect((empty.body as { events: unknown[] }).events).toEqual([]);

      const badType = await api(harness.session, "/events?type=not-a-type");
      expect(badType.response.status).toBe(400);
      expect(errorCode(badType.body)).toBe("BAD_REQUEST");

      const badLimit = await api(harness.session, "/events?limit=501");
      expect(badLimit.response.status).toBe(400);
      expect(errorCode(badLimit.body)).toBe("BAD_REQUEST");

      await createFlutterwaveRecord(harness, "events-flutterwave");
      const flutterwave = await api(harness.session, "/events?scope=flutterwave&type=request");
      expect((flutterwave.body as { events: { scope: string }[] }).events.length).toBeGreaterThan(
        0,
      );
      expect(
        (flutterwave.body as { events: { scope: string }[] }).events.every(
          (event) => event.scope === "flutterwave",
        ),
      ).toBe(true);
    });
  });

  it("C8 GET /export includes the session and never a token or full credential", async () => {
    await withControlSession({}, async (harness) => {
      const cookie = cookieFrom(
        await exchangeCode(harness.session, harness.session.createLaunchCode()),
      );
      await api(harness.session, "/twins/paystack/webhook-url", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1:9/hook" }),
      });
      await createPaystackRecord(harness, "export-route");
      await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ failureId: "slow-response", settings: { seconds: 1 } }),
      });

      const exported = await api(harness.session, "/export");
      expect(exported.response.status).toBe(200);
      expect(exported.body).toMatchObject({
        version: "0.0.0",
        seed: harness.session.seed,
        scenario: null,
        ports: { control: harness.session.addresses.control.port },
      });
      const body = exported.body as {
        rules: unknown[];
        events: unknown[];
        state: Record<string, unknown>;
        credentials: Record<string, Record<string, string>>;
        deliveries: unknown[];
      };
      expect(body.rules).toHaveLength(1);
      expect(body.events.length).toBeGreaterThan(0);
      expect(Object.keys(body.state).sort()).toEqual(["flutterwave", "paystack"]);
      expect(body.credentials.paystack?.secret).toHaveLength(8);

      const serialised = JSON.stringify(exported.body);
      expect(serialised).not.toContain(harness.session.token);
      expect(serialised).not.toContain(harness.session.launchCode);
      expect(serialised).not.toContain(cookie.slice("ibeji_ui=".length));
      for (const values of Object.values(harness.session.credentials)) {
        for (const value of Object.values(values)) {
          expect(serialised).not.toContain(value);
        }
      }
      const paystackSecret = credentials(harness.session, "paystack").secret;
      if (paystackSecret === undefined) {
        throw new Error("expected a Paystack secret");
      }
      expect(serialised).toContain(fingerprint(paystackSecret));
    });
  });

  it("C8 unknown API paths return NOT_FOUND", async () => {
    await withControlSession({}, async (harness) => {
      const result = await api(harness.session, "/not-a-route");
      expect(result.response.status).toBe(404);
      expect(errorCode(result.body)).toBe("NOT_FOUND");
    });
  });
});

describe("C8 twin names and partial sessions", () => {
  it("C8 unknown twin ids give UNKNOWN_TWIN on every twin route", async () => {
    await withControlSession({}, async (harness) => {
      const routes: { method: string; path: string; body?: unknown }[] = [
        { method: "GET", path: "/twins/missing/credentials" },
        { method: "GET", path: "/twins/missing/state" },
        { method: "DELETE", path: "/twins/missing/state" },
        { method: "GET", path: "/twins/missing/webhook-url" },
        {
          method: "PUT",
          path: "/twins/missing/webhook-url",
          body: { url: "http://127.0.0.1:3000/hook" },
        },
        { method: "POST", path: "/credentials/rotate", body: { twin: "missing" } },
        {
          method: "POST",
          path: "/rules",
          body: { failureId: "slow-response", twins: ["missing"], settings: {} },
        },
        { method: "DELETE", path: "/rules?twin=missing" },
        { method: "GET", path: "/webhooks?twin=missing" },
        { method: "GET", path: "/events?scope=missing" },
      ];

      for (const route of routes) {
        const result = await api(harness.session, route.path, {
          method: route.method,
          ...(route.body === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(route.body),
              }),
        });
        expect(result.response.status, `${route.method} ${route.path}`).toBe(404);
        expect(errorCode(result.body)).toBe("UNKNOWN_TWIN");
      }
    });
  });

  it("C8 a registered but stopped twin is TWIN_NOT_RUNNING except for credentials and webhook URLs", async () => {
    await withControlSession({ twins: ["paystack"], scenarios: [scenario] }, async (harness) => {
      const stopped = "flutterwave";
      const running = await api(harness.session, "/twins");
      const flutterwave = (
        running.body as { twins: { id: string; running: boolean; address: string | null }[] }
      ).twins.find((twin) => twin.id === stopped);
      expect(flutterwave).toMatchObject({ running: false, address: null });

      const refused: { method: string; path: string; body?: unknown }[] = [
        { method: "GET", path: `/twins/${stopped}/state` },
        { method: "DELETE", path: `/twins/${stopped}/state` },
        {
          method: "POST",
          path: "/rules",
          body: { failureId: "slow-response", twins: [stopped], settings: {} },
        },
        {
          method: "POST",
          path: "/scenarios/slow-day/run",
          body: { twins: [stopped] },
        },
        { method: "GET", path: `/webhooks?twin=${stopped}` },
        { method: "GET", path: `/events?scope=${stopped}` },
        { method: "DELETE", path: `/rules?twin=${stopped}` },
      ];

      for (const route of refused) {
        const result = await api(harness.session, route.path, {
          method: route.method,
          ...(route.body === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(route.body),
              }),
        });
        expect(result.response.status, `${route.method} ${route.path}`).toBe(409);
        expect(errorCode(result.body)).toBe("TWIN_NOT_RUNNING");
      }

      const credentialsRoute = await api(harness.session, `/twins/${stopped}/credentials`);
      expect(credentialsRoute.response.status).toBe(200);

      const rotate = await api(harness.session, "/credentials/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twin: stopped }),
      });
      expect(rotate.response.status).toBe(200);

      const webhook = await api(harness.session, `/twins/${stopped}/webhook-url`);
      expect(webhook.response.status).toBe(200);
      const setWebhook = await api(harness.session, `/twins/${stopped}/webhook-url`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1:3000/hook" }),
      });
      expect(setWebhook.response.status).toBe(200);
    });
  });

  it("C8 no token, UI token, launch code or credential appears in a log, event or export", async () => {
    await withControlSession({}, async (harness) => {
      const cookie = cookieFrom(
        await exchangeCode(harness.session, harness.session.createLaunchCode()),
      );
      const uiToken = cookie.slice("ibeji_ui=".length);
      await createPaystackRecord(harness, "secrets-route");
      await api(harness.session, "/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ failureId: "slow-response", settings: { seconds: 1 } }),
      });
      const exported = await api(harness.session, "/export");

      const logs = harness.logs.join("\n");
      const events = JSON.stringify(harness.session.events.after(0));
      const exportText = JSON.stringify(exported.body);
      const secrets = [
        harness.session.token,
        harness.session.launchCode,
        uiToken,
        ...Object.values(harness.session.credentials).flatMap((values) => Object.values(values)),
      ];

      for (const secret of secrets) {
        expect(logs).not.toContain(secret);
        expect(events).not.toContain(secret);
        expect(exportText).not.toContain(secret);
      }
    });
  });
});
