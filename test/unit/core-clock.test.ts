import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeClock, RealClock, realClock } from "../../src/core/clock.js";

describe("T1 fake clock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T1: timers never fire early and fire in due order when advanced", () => {
    const clock = new FakeClock(1_000);
    const fired: string[] = [];

    clock.setTimeout(() => fired.push("late"), 20);
    clock.setTimeout(() => fired.push("early"), 5);
    clock.setTimeout(() => fired.push("same-time-second"), 5);

    expect(clock.now()).toBe(1_000);

    clock.advanceBy(4);
    expect(fired).toEqual([]);
    expect(clock.now()).toBe(1_004);

    clock.advanceBy(1);
    expect(fired).toEqual(["early", "same-time-second"]);

    clock.advanceBy(15);
    expect(fired).toEqual(["early", "same-time-second", "late"]);
    expect(clock.now()).toBe(1_020);
  });

  it("T1: a cleared timer never fires", () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    const handle = clock.setTimeout(() => fired.push("cancelled"), 1);

    clock.clearTimeout(handle);
    clock.advanceBy(10);

    expect(fired).toEqual([]);
  });

  it("T1: timers created by a callback fire in the same advance when they are due", () => {
    const clock = new FakeClock();
    const fired: string[] = [];

    clock.setTimeout(() => {
      fired.push("first");
      clock.setTimeout(() => fired.push("second"), 0);
    }, 1);

    clock.advanceBy(1);
    expect(fired).toEqual(["first", "second"]);
  });

  it("T1: defaults to time zero and clamps a negative advance", () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(0);

    clock.advanceBy(-10);
    expect(clock.now()).toBe(0);
  });
});

describe("T1 real clock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T1: reports real time and can schedule and clear a timer without waiting", () => {
    vi.useFakeTimers();
    try {
      const clock = new RealClock();
      const before = Date.now();
      const now = clock.now();
      const after = Date.now();
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(after);
      expect(realClock.now()).toBeGreaterThanOrEqual(before);

      const callback = vi.fn();
      const handle = clock.setTimeout(callback, 60_000);
      clock.clearTimeout(handle);
      clock.clearTimeout(handle);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("T1: the real clock runs a timer through the same interface", () => {
    vi.useFakeTimers();
    try {
      const clock = new RealClock();
      const callback = vi.fn();
      const handle = clock.setTimeout(callback, 10);
      expect(handle).toBeGreaterThan(0);

      vi.advanceTimersByTime(10);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
