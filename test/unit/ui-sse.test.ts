import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { RECONNECT_DELAYS_MS, SseClient } from "../../ui/src/api/sse.js";

type Call = {
  readonly headers: Headers;
};

function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function openResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start() {
      return;
    },
  });
  return new Response(stream, { status: 200 });
}

function fakeFetch(
  handler: (call: Call) => Response | Promise<Response>,
  calls: Call[],
): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const call = { headers: new Headers(init?.headers) };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("T8 UI live stream", () => {
  it("T8: reconnects with backoff and catches up with Last-Event-ID", async () => {
    const clock = new FakeClock(1_000);
    const calls: Call[] = [];
    const events: number[] = [];
    const states: string[] = [];
    let count = 0;

    const client = new SseClient({
      url: "/events/stream",
      clock,
      onEvent: (event) => events.push(event.id),
      onState: (state) => states.push(state),
      onUnauthorized: () => undefined,
      fetchImpl: fakeFetch((_call) => {
        count += 1;
        if (count === 1) {
          throw new Error("offline");
        }
        if (count === 2) {
          return sseResponse(
            'id: 7\ndata: {"id":7,"time":1000,"type":"request","scope":"alpha","summary":"One.","details":{}}\n\n',
          );
        }
        return openResponse();
      }, calls),
    });

    client.start();
    await flush();
    expect(states).toContain("disconnected");
    expect(calls).toHaveLength(1);

    clock.advanceBy(RECONNECT_DELAYS_MS[0]);
    await flush();
    expect(calls).toHaveLength(2);
    expect(events).toEqual([7]);
    expect(client.lastSeenEventId).toBe(7);
    expect(states).toContain("connected");

    clock.advanceBy(RECONNECT_DELAYS_MS[0]);
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2]?.headers.get("Last-Event-ID")).toBe("7");

    client.stop();
  });

  it("T8: backoff grows when every attempt fails", async () => {
    const clock = new FakeClock(0);
    const calls: Call[] = [];
    const client = new SseClient({
      url: "/events/stream",
      clock,
      onEvent: () => undefined,
      onState: () => undefined,
      onUnauthorized: () => undefined,
      fetchImpl: fakeFetch(() => {
        throw new Error("offline");
      }, calls),
    });

    client.start();
    await flush();
    expect(calls).toHaveLength(1);

    clock.advanceBy(RECONNECT_DELAYS_MS[0]);
    await flush();
    expect(calls).toHaveLength(2);

    clock.advanceBy(RECONNECT_DELAYS_MS[1] - 1);
    await flush();
    expect(calls).toHaveLength(2);
    clock.advanceBy(1);
    await flush();
    expect(calls).toHaveLength(3);

    clock.advanceBy(RECONNECT_DELAYS_MS[2]);
    await flush();
    expect(calls).toHaveLength(4);

    client.stop();
  });

  it("T8: a 401 stops the stream and calls the sign-in handler", async () => {
    const clock = new FakeClock(0);
    const calls: Call[] = [];
    let unauthorized = 0;
    const client = new SseClient({
      url: "/events/stream",
      clock,
      onEvent: () => undefined,
      onState: () => undefined,
      onUnauthorized: () => {
        unauthorized += 1;
      },
      fetchImpl: fakeFetch(
        () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }),
        calls,
      ),
    });

    client.start();
    await flush();
    expect(unauthorized).toBe(1);
    clock.advanceBy(RECONNECT_DELAYS_MS[0]);
    await flush();
    expect(calls).toHaveLength(1);
  });
});
