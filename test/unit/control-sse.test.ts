import { describe, expect, it } from "vitest";
import { eventStreamResponse, SSE_HEARTBEAT_MS } from "../../src/control/sse.js";
import { FakeClock } from "../../src/core/clock.js";
import { EventLog } from "../../src/core/events.js";

describe("T6 SSE response", () => {
  it("T6 cleans up immediately when the signal is already aborted", async () => {
    const clock = new FakeClock();
    const events = new EventLog(clock);
    const controller = new AbortController();
    controller.abort();

    const response = eventStreamResponse({
      events,
      clock,
      scope: undefined,
      lastEventId: undefined,
      signal: controller.signal,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events.subscriberCount).toBe(0);
    if (response.body === null) {
      throw new Error("expected an event stream body");
    }
    const reader = response.body.getReader();
    expect((await reader.read()).done).toBe(true);
  });

  it("T6 removes the subscriber when the stream is cancelled", async () => {
    const clock = new FakeClock();
    const events = new EventLog(clock);
    const controller = new AbortController();

    const response = eventStreamResponse({
      events,
      clock,
      scope: "ibeji",
      lastEventId: undefined,
      signal: controller.signal,
    });
    expect(events.subscriberCount).toBe(1);
    if (response.body === null) {
      throw new Error("expected an event stream body");
    }

    const reader = response.body.getReader();
    await reader.cancel();
    expect(events.subscriberCount).toBe(0);

    clock.advanceBy(SSE_HEARTBEAT_MS);
    expect(events.subscriberCount).toBe(0);
  });

  it("T6 writes an abort cleanup once and does not keep a subscriber", async () => {
    const clock = new FakeClock();
    const events = new EventLog(clock);
    const controller = new AbortController();
    const response = eventStreamResponse({
      events,
      clock,
      scope: undefined,
      lastEventId: 0,
      signal: controller.signal,
    });
    expect(events.subscriberCount).toBe(1);
    controller.abort();
    expect(events.subscriberCount).toBe(0);
    if (response.body === null) {
      throw new Error("expected an event stream body");
    }
    await response.body.cancel();
    expect(events.subscriberCount).toBe(0);
  });
});
