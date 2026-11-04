import type { EventItem } from "../../../src/shared/control.js";

export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export type StreamState = "connecting" | "connected" | "disconnected";

export type StreamClock = {
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
};

export type SseClientOptions = {
  readonly url: string;
  readonly fetchImpl?: typeof fetch;
  readonly clock?: StreamClock;
  readonly onEvent: (event: EventItem) => void;
  readonly onState: (state: StreamState) => void;
  readonly onUnauthorized: () => void;
  readonly initialLastEventId?: number;
};

const realClock: StreamClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export class SseClient {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: StreamClock;
  private readonly onEvent: (event: EventItem) => void;
  private readonly onState: (state: StreamState) => void;
  private readonly onUnauthorized: () => void;
  private lastEventId: number | undefined;
  private stopped = true;
  private attempt = 0;
  private controller: AbortController | undefined;
  private reconnectHandle: number | undefined;

  constructor(options: SseClientOptions) {
    this.url = options.url;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.clock = options.clock ?? realClock;
    this.onEvent = options.onEvent;
    this.onState = options.onState;
    this.onUnauthorized = options.onUnauthorized;
    this.lastEventId = options.initialLastEventId;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    this.controller = undefined;
    if (this.reconnectHandle !== undefined) {
      this.clock.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
  }

  get lastSeenEventId(): number | undefined {
    return this.lastEventId;
  }

  private state(state: StreamState): void {
    if (!this.stopped) {
      this.onState(state);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    const index = Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[index] as number;
    this.attempt += 1;
    this.state("disconnected");
    this.reconnectHandle = this.clock.setTimeout(() => {
      this.reconnectHandle = undefined;
      void this.connect();
    }, delay);
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.state("connecting");
    const controller = new AbortController();
    this.controller = controller;
    const headers = new Headers({ accept: "text/event-stream" });
    if (this.lastEventId !== undefined) {
      headers.set("Last-Event-ID", String(this.lastEventId));
    }

    try {
      const response = await this.fetchImpl(this.url, {
        headers,
        credentials: "same-origin",
        signal: controller.signal,
      });

      if (response.status === 401) {
        this.stopped = true;
        this.controller = undefined;
        this.onUnauthorized();
        return;
      }

      if (!response.ok || response.body === null) {
        throw new Error(`The event stream answered with HTTP ${response.status}.`);
      }

      this.attempt = 0;
      this.state("connected");
      await this.readStream(response.body);
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    } catch {
      if (!this.stopped && !controller.signal.aborted) {
        this.scheduleReconnect();
      }
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          break;
        }
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        this.handleBlock(block);
      }
    }
  }

  private handleBlock(block: string): void {
    let id: number | undefined;
    const data: string[] = [];

    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) {
        const value = Number(line.slice("id: ".length));
        if (Number.isInteger(value) && value >= 0) {
          id = value;
        }
      } else if (line.startsWith("data: ")) {
        data.push(line.slice("data: ".length));
      }
    }

    if (data.length === 0) {
      return;
    }

    let event: EventItem;
    try {
      event = JSON.parse(data.join("\n")) as EventItem;
    } catch {
      return;
    }

    if (id !== undefined) {
      this.lastEventId = id;
    }
    this.onEvent(event);
  }
}
