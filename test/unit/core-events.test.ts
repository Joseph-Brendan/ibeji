import { describe, expect, it } from "vitest";

import { FakeClock } from "../../src/core/clock.js";
import { EventLog, IBEJI_SCOPE, type IbejiEvent, MAX_EVENTS } from "../../src/core/events.js";

describe("T1 events", () => {
  it("T1: events have increasing ids, the clock time, a scope, a summary and details", () => {
    const clock = new FakeClock(500);
    const events = new EventLog(clock);

    const first = events.publish({
      type: "request",
      scope: "alpha",
      summary: "A request arrived.",
      details: { path: "/transaction/initialize" },
    });
    const second = events.publish({
      type: "warning",
      scope: IBEJI_SCOPE,
      summary: "A warning.",
    });

    expect(first.id).toBe(1);
    expect(first.time).toBe(500);
    expect(first.details).toEqual({ path: "/transaction/initialize" });
    expect(second.id).toBe(2);
    expect(second.details).toEqual({});
    expect(second.scope).toBe("ibeji");
    expect(events.size).toBe(2);
  });

  it("T1: subscribers receive new events in order, and unsubscribe stops delivery", () => {
    const events = new EventLog(new FakeClock());
    const received: number[] = [];
    const unsubscribe = events.subscribe((event) => received.push(event.id));

    events.publish({ type: "request", scope: "alpha", summary: "One." });
    events.publish({ type: "response", scope: "alpha", summary: "Two." });
    unsubscribe();
    events.publish({ type: "request", scope: "alpha", summary: "Three." });

    expect(received).toEqual([1, 2]);
  });

  it("T1: a scope filter delivers only events for that scope", () => {
    const events = new EventLog(new FakeClock());
    const received: string[] = [];
    events.subscribe((event) => received.push(event.summary), "alpha");

    events.publish({ type: "request", scope: "alpha", summary: "Alpha." });
    events.publish({ type: "request", scope: "beta", summary: "Beta." });
    events.publish({ type: "warning", scope: IBEJI_SCOPE, summary: "Ibeji." });

    expect(received).toEqual(["Alpha."]);
  });

  it("T1: after(id) returns every retained event with a greater id", () => {
    const events = new EventLog(new FakeClock());
    events.publish({ type: "request", scope: "alpha", summary: "One." });
    events.publish({ type: "request", scope: "alpha", summary: "Two." });
    events.publish({ type: "request", scope: "alpha", summary: "Three." });

    expect(events.after(0).map((event) => event.id)).toEqual([1, 2, 3]);
    expect(events.after(1).map((event) => event.id)).toEqual([2, 3]);
    expect(events.after(3)).toEqual([]);
  });

  it("T1: after(id) returns copies that cannot change the log", () => {
    const events = new EventLog(new FakeClock());
    events.publish({
      type: "request",
      scope: "alpha",
      summary: "One.",
      details: { nested: { value: "original" } },
    });

    const copy = events.after(0)[0];
    expect(copy).toBeDefined();
    if (copy === undefined) {
      throw new Error("the event was not returned");
    }
    (copy.details.nested as { value: string }).value = "changed";

    expect(events.after(0)[0]?.details).toEqual({ nested: { value: "original" } });
  });

  it("T1: keeps only the newest 5,000 events", () => {
    const events = new EventLog(new FakeClock());

    for (let index = 0; index < MAX_EVENTS + 1; index += 1) {
      events.publish({ type: "request", scope: "alpha", summary: `Event ${index}.` });
    }

    const retained = events.after(0);
    expect(events.size).toBe(MAX_EVENTS);
    expect(retained).toHaveLength(MAX_EVENTS);
    expect(retained[0]?.id).toBe(2);
    expect(retained[retained.length - 1]?.id).toBe(MAX_EVENTS + 1);
  });

  it("T1: uses the real clock by default", () => {
    const events = new EventLog();
    const before = Date.now();
    const event: IbejiEvent = events.publish({
      type: "request",
      scope: IBEJI_SCOPE,
      summary: "One.",
    });
    const after = Date.now();

    expect(event.time).toBeGreaterThanOrEqual(before);
    expect(event.time).toBeLessThanOrEqual(after);
  });
});
