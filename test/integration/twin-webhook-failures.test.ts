import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { EventLog } from "../../src/core/events.js";
import { decideWebhook } from "../../src/core/failures/engine.js";
import { RuleStore } from "../../src/core/failures/rules.js";
import { SeededRandom } from "../../src/core/random.js";
import { type WebhookDelivery, WebhookDispatcher } from "../../src/core/webhooks/dispatcher.js";
import type { RawWebhook } from "../../src/core/webhooks/types.js";
import { flutterwaveTwin } from "../../src/twins/flutterwave/definition.js";
import type {
  TwinCredentials,
  TwinDefinition,
  TwinWebhookDraft,
} from "../../src/twins/framework/types.js";
import { paystackTwin } from "../../src/twins/paystack/definition.js";
import { FLUTTERWAVE_TEST_CREDENTIALS } from "../helpers/flutterwave.js";
import { PAYSTACK_TEST_CREDENTIALS } from "../helpers/paystack.js";

type ReceivedWebhook = {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
};

function parsedBody(body: string): unknown {
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

function eventName(body: string): unknown {
  const parsed = parsedBody(body);
  return typeof parsed === "object" && parsed !== null && "event" in parsed
    ? parsed.event
    : undefined;
}

function dataId(body: string): unknown {
  const parsed = parsedBody(body);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("data" in parsed) ||
    typeof parsed.data !== "object" ||
    parsed.data === null ||
    !("id" in parsed.data)
  ) {
    return undefined;
  }
  return parsed.data.id;
}

type TwinDescriptor = {
  readonly definition: TwinDefinition;
  readonly credentials: TwinCredentials;
  readonly eventKey: string;
  readonly draft: (id: number, resourceId: string) => TwinWebhookDraft;
};

type WebhookHarness = {
  readonly clock: FakeClock;
  readonly dispatcher: WebhookDispatcher;
  readonly rules: RuleStore;
  readonly received: ReceivedWebhook[];
  readonly enqueue: (draft: TwinWebhookDraft, eventId: string) => readonly WebhookDelivery[];
};

const twins: readonly TwinDescriptor[] = [
  {
    definition: paystackTwin,
    credentials: PAYSTACK_TEST_CREDENTIALS,
    eventKey: "charge.success",
    draft: (id, resourceId) => ({
      key: "charge.success",
      actionId: "checkout.submit",
      resourceId,
      occurredAt: 1_000,
      data: {
        id,
        reference: resourceId,
        amount: 500_000,
        currency: "NGN",
      },
    }),
  },
  {
    definition: flutterwaveTwin,
    credentials: FLUTTERWAVE_TEST_CREDENTIALS,
    eventKey: "charge.completed",
    draft: (id, resourceId) => ({
      key: "charge.completed",
      actionId: "checkout.submit",
      resourceId,
      occurredAt: 1_000,
      data: {
        id,
        tx_ref: resourceId,
        status: "successful",
        amount: 7_500,
        currency: "NGN",
      },
    }),
  },
];

async function withReceiver(
  run: (url: string, received: ReceivedWebhook[]) => Promise<void>,
): Promise<void> {
  const received: ReceivedWebhook[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : (value ?? "");
      }
      received.push({
        body: Buffer.concat(chunks).toString("utf8"),
        headers,
      });
      response.end("ok");
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  try {
    await run(`http://127.0.0.1:${address.port}/webhook`, received);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

async function withWebhookHarness(
  twin: TwinDescriptor,
  run: (harness: WebhookHarness) => Promise<void>,
): Promise<void> {
  await withReceiver(async (url, received) => {
    const clock = new FakeClock(1_000);
    const events = new EventLog(clock);
    const rules = new RuleStore({
      twins: [
        {
          id: twin.definition.id,
          actions: twin.definition.actions.map((action) => action.id),
          failures: twin.definition.failures.support,
        },
      ],
      events,
    });
    const dispatcher = new WebhookDispatcher({
      clock,
      random: new SeededRandom(1),
      twins: {},
    });
    dispatcher.registerTwin(twin.definition.id, {
      signer: twin.definition.webhooks,
      retry: twin.definition.retry,
      webhookUrl: () => url,
      credentials: () => twin.credentials,
    });

    const enqueue = (draft: TwinWebhookDraft, eventId: string): readonly WebhookDelivery[] => {
      const plan = decideWebhook({
        twinId: twin.definition.id,
        actionId: draft.actionId,
        rules: rules.activeRules(),
        random: new SeededRandom(1),
        now: clock.now(),
      });
      const raw: RawWebhook = twin.definition.webhooks.build(
        draft,
        twin.definition.state.initial(),
      );
      return dispatcher.enqueue({
        eventId,
        twinId: twin.definition.id,
        actionId: draft.actionId,
        raw,
        plan,
      });
    };

    try {
      await run({ clock, dispatcher, rules, received, enqueue });
    } finally {
      dispatcher.stop();
    }
  });
}

function addWebhookRule(
  harness: WebhookHarness,
  twin: TwinDescriptor,
  failureId: string,
  settings?: Record<string, unknown>,
): void {
  harness.rules.add({
    failureId,
    twins: [twin.definition.id],
    actions: "checkout.submit",
    ...(settings === undefined ? {} : { settings }),
  });
}

describe("T4 webhook failures for both twins", () => {
  it("T4 webhook-delayed holds and then delivers for Paystack and Flutterwave", async () => {
    for (const twin of twins) {
      await withWebhookHarness(twin, async (harness) => {
        addWebhookRule(harness, twin, "webhook-delayed", {
          seconds: 5,
          jitterSeconds: 0,
        });
        const deliveries = harness.enqueue(twin.draft(1, "event-1"), "delayed-1");
        expect(deliveries[0]?.status).toBe("scheduled");
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(0);

        harness.clock.advanceBy(5_000);
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(1);
        expect(eventName(harness.received[0]?.body ?? "{}")).toBe(twin.eventKey);
      });
    }
  });

  it("T4 webhook-duplicated sends copies with the same body for Paystack and Flutterwave", async () => {
    for (const twin of twins) {
      await withWebhookHarness(twin, async (harness) => {
        addWebhookRule(harness, twin, "webhook-duplicated", {
          copies: 2,
          gapSeconds: 1,
        });
        const deliveries = harness.enqueue(twin.draft(1, "event-1"), "duplicate-1");
        expect(deliveries).toHaveLength(2);
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(1);

        harness.clock.advanceBy(1_000);
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(2);
        expect(harness.received[0]?.body).toBe(harness.received[1]?.body);
        expect(deliveries[0]?.eventId).toBe(deliveries[1]?.eventId);
      });
    }
  });

  it("T4 webhook-out-of-order releases newest first for Paystack and Flutterwave", async () => {
    for (const twin of twins) {
      await withWebhookHarness(twin, async (harness) => {
        addWebhookRule(harness, twin, "webhook-out-of-order", {
          windowSeconds: 5,
        });
        harness.enqueue(twin.draft(1, "older"), "older");
        harness.enqueue(twin.draft(2, "newer"), "newer");
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(0);

        harness.clock.advanceBy(5_000);
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(2);
        expect(harness.received.map((item) => dataId(item.body))).toEqual([2, 1]);
      });
    }
  });

  it("T4 webhook-never-sent records not-sent for Paystack and Flutterwave", async () => {
    for (const twin of twins) {
      await withWebhookHarness(twin, async (harness) => {
        addWebhookRule(harness, twin, "webhook-never-sent");
        const deliveries = harness.enqueue(twin.draft(1, "event-1"), "never-1");
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]?.status).toBe("not-sent");
        expect(deliveries[0]?.reason).toBe("webhook-never-sent");
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(0);
      });
    }
  });

  it("T4 webhook-verification-fails sends a signature the twin rejects", async () => {
    for (const twin of twins) {
      await withWebhookHarness(twin, async (harness) => {
        addWebhookRule(harness, twin, "webhook-verification-fails", {
          method: "wrong-secret",
        });
        const deliveries = harness.enqueue(twin.draft(1, "event-1"), "forged-1");
        expect(deliveries[0]?.failureMethod).toBe("wrong-secret");
        await harness.dispatcher.dispatchDue();
        expect(harness.received).toHaveLength(1);

        const received = harness.received[0];
        if (received === undefined) {
          throw new Error("expected a forged webhook delivery");
        }
        const raw: RawWebhook = {
          body: received.body,
          contentType: "application/json",
        };
        expect(
          twin.definition.webhooks.verify(raw, received.headers, twin.credentials, new Date(0)),
        ).toBe(false);
      });
    }
  });
});
