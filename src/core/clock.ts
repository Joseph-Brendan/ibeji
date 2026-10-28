export type TimerCallback = () => void;

export interface Clock {
  now(): number;
  setTimeout(callback: TimerCallback, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export class RealClock implements Clock {
  private nextHandle = 1;
  private readonly timers = new Map<number, ReturnType<typeof globalThis.setTimeout>>();

  now(): number {
    return Date.now();
  }

  setTimeout(callback: TimerCallback, delayMs: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(
      handle,
      globalThis.setTimeout(() => {
        this.timers.delete(handle);
        callback();
      }, delayMs),
    );
    return handle;
  }

  clearTimeout(handle: number): void {
    const timer = this.timers.get(handle);
    if (timer === undefined) {
      return;
    }
    globalThis.clearTimeout(timer);
    this.timers.delete(handle);
  }
}

export type FakeTimer = {
  readonly id: number;
  readonly due: number;
  readonly callback: TimerCallback;
};

/**
 * A clock for tests. Time only moves when advanceBy is called, so a timer can
 * never fire early. Timers due at the same moment fire in the order they were
 * created.
 */
export class FakeClock implements Clock {
  private currentTime: number;
  private nextHandle = 1;
  private timers: FakeTimer[] = [];

  constructor(startTime = 0) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: TimerCallback, delayMs: number): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.push({
      id: handle,
      due: this.currentTime + Math.max(0, delayMs),
      callback,
    });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  advanceBy(milliseconds: number): void {
    const target = this.currentTime + Math.max(0, milliseconds);

    for (;;) {
      const next = this.timers
        .filter((timer) => timer.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id)[0];

      if (next === undefined) {
        break;
      }

      this.timers = this.timers.filter((timer) => timer.id !== next.id);
      this.currentTime = next.due;
      next.callback();
    }

    this.currentTime = target;
  }
}

export const realClock: Clock = new RealClock();
