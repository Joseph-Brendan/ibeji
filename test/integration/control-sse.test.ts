import { describe, expect, it } from "vitest";

import {
  apiUrl,
  authHeaders,
  type ControlSessionHarness,
  cookieFrom,
  exchangeCode,
  withControlSession,
} from "../helpers/control.js";

type SseReader = {
  readonly response: Response;
  next: () => Promise<string>;
  close: () => Promise<void>;
};

async function openStream(
  harness: ControlSessionHarness,
  options: {
    readonly scope?: string;
    readonly headers?: Record<string, string>;
  } = {},
): Promise<SseReader> {
  const controller = new AbortController();
  const query = options.scope === undefined ? "" : `?scope=${encodeURIComponent(options.scope)}`;
  const response = await fetch(apiUrl(harness.session, `/events/stream${query}`), {
    headers: { ...authHeaders(harness.session), ...options.headers },
    signal: controller.signal,
  });
  if (response.body === null) {
    throw new Error("expected an event stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const next = async (): Promise<string> => {
    for (;;) {
      const marker = buffer.indexOf("\n\n");
      if (marker !== -1) {
        const frame = buffer.slice(0, marker);
        buffer = buffer.slice(marker + 2);
        return frame;
      }
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("the event stream ended");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };

  return {
    response,
    next,
    close: async () => {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    },
  };
}

async function waitForSubscribers(harness: ControlSessionHarness, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (harness.session.events.subscriberCount === count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`expected ${count} event subscribers`);
}

function parseFrame(frame: string): { id: string | undefined; data: unknown } {
  let id: string | undefined;
  const data: unknown[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("id: ")) {
      id = line.slice(4);
    } else if (line.startsWith("data: ")) {
      data.push(JSON.parse(line.slice(6)) as unknown);
    }
  }
  return { id, data: data[0] };
}

describe("T6 SSE event stream", () => {
  it("T6 streams events in order with their id and no CORS header", async () => {
    await withControlSession({}, async (harness) => {
      const stream = await openStream(harness);
      try {
        expect(stream.response.status).toBe(200);
        expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
        expect(stream.response.headers.get("access-control-allow-origin")).toBeNull();
        await waitForSubscribers(harness, 1);

        const first = harness.session.events.publish({
          type: "request",
          scope: "paystack",
          summary: "First request.",
        });
        const second = harness.session.events.publish({
          type: "response",
          scope: "paystack",
          summary: "Second event.",
        });
        const third = harness.session.events.publish({
          type: "warning",
          scope: "ibeji",
          summary: "Third event.",
        });

        const frameOne = parseFrame(await stream.next());
        const frameTwo = parseFrame(await stream.next());
        const frameThree = parseFrame(await stream.next());

        expect(frameOne.id).toBe(String(first.id));
        expect(frameTwo.id).toBe(String(second.id));
        expect(frameThree.id).toBe(String(third.id));
        expect((frameOne.data as { summary: string }).summary).toBe("First request.");
        expect((frameTwo.data as { summary: string }).summary).toBe("Second event.");
        expect((frameThree.data as { summary: string }).summary).toBe("Third event.");
      } finally {
        await stream.close();
      }
    });
  });

  it("T6 applies the SSE scope filter", async () => {
    await withControlSession({}, async (harness) => {
      const stream = await openStream(harness, { scope: "paystack" });
      try {
        await waitForSubscribers(harness, 1);
        harness.session.events.publish({
          type: "request",
          scope: "paystack",
          summary: "Paystack one.",
        });
        harness.session.events.publish({
          type: "request",
          scope: "flutterwave",
          summary: "Flutterwave.",
        });
        harness.session.events.publish({
          type: "request",
          scope: "paystack",
          summary: "Paystack two.",
        });
        harness.session.events.publish({
          type: "warning",
          scope: "ibeji",
          summary: "Ibeji.",
        });

        expect((parseFrame(await stream.next()).data as { summary: string }).summary).toBe(
          "Paystack one.",
        );
        expect((parseFrame(await stream.next()).data as { summary: string }).summary).toBe(
          "Paystack two.",
        );
      } finally {
        await stream.close();
      }
    });
  });

  it("T6 sends a heartbeat every 15 seconds on the injected clock", async () => {
    await withControlSession({}, async (harness) => {
      const stream = await openStream(harness);
      try {
        await waitForSubscribers(harness, 1);
        harness.clock.advanceBy(15_000);
        expect(await stream.next()).toBe(": heartbeat");
        harness.clock.advanceBy(15_000);
        expect(await stream.next()).toBe(": heartbeat");
      } finally {
        await stream.close();
      }
    });
  });

  it("T6 catches up from Last-Event-ID", async () => {
    await withControlSession({}, async (harness) => {
      const first = harness.session.events.publish({
        type: "request",
        scope: "paystack",
        summary: "One.",
      });
      const second = harness.session.events.publish({
        type: "request",
        scope: "paystack",
        summary: "Two.",
      });
      const third = harness.session.events.publish({
        type: "request",
        scope: "paystack",
        summary: "Three.",
      });

      const stream = await openStream(harness, {
        headers: { "last-event-id": String(first.id) },
      });
      try {
        const frameOne = parseFrame(await stream.next());
        const frameTwo = parseFrame(await stream.next());
        expect(frameOne.id).toBe(String(second.id));
        expect(frameTwo.id).toBe(String(third.id));
        expect((frameOne.data as { summary: string }).summary).toBe("Two.");
      } finally {
        await stream.close();
      }
    });
  });

  it("T6 accepts the UI cookie for SSE", async () => {
    await withControlSession({}, async (harness) => {
      const cookie = cookieFrom(
        await exchangeCode(harness.session, harness.session.createLaunchCode()),
      );
      const stream = await openStream(harness, { headers: { cookie } });
      try {
        await waitForSubscribers(harness, 1);
        harness.session.events.publish({
          type: "warning",
          scope: "ibeji",
          summary: "Cookie event.",
        });
        expect((parseFrame(await stream.next()).data as { summary: string }).summary).toBe(
          "Cookie event.",
        );
      } finally {
        await stream.close();
      }
    });
  });

  it("T6 removes the subscriber when the client disconnects", async () => {
    await withControlSession({}, async (harness) => {
      const stream = await openStream(harness);
      await waitForSubscribers(harness, 1);
      await stream.close();
      await waitForSubscribers(harness, 0);
    });
  });

  it("T6 rejects SSE without sign-in", async () => {
    await withControlSession({}, async (harness) => {
      const response = await fetch(apiUrl(harness.session, "/events/stream"));
      expect(response.status).toBe(401);
    });
  });

  it("T6 rejects an invalid Last-Event-ID and an unknown scope", async () => {
    await withControlSession({}, async (harness) => {
      const invalid = await fetch(apiUrl(harness.session, "/events/stream"), {
        headers: { ...authHeaders(harness.session), "last-event-id": "not-a-number" },
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });

      const unknown = await fetch(apiUrl(harness.session, "/events/stream?scope=missing"), {
        headers: authHeaders(harness.session),
      });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ error: { code: "UNKNOWN_TWIN" } });
    });
  });
});
