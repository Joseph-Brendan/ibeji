import type { Clock } from "../core/clock.js";
import type { EventLog, IbejiEvent } from "../core/events.js";

export const SSE_HEARTBEAT_MS = 15_000;

export type EventStreamOptions = {
  readonly events: EventLog;
  readonly clock: Clock;
  readonly scope: string | undefined;
  readonly lastEventId: number | undefined;
  readonly signal: AbortSignal;
  readonly sanitize?: (text: string) => string;
};

/**
 * One Server-Sent Events response. Events are written in log order with their
 * id, the optional scope filter is applied, Last-Event-ID catches up, and a
 * heartbeat is written every 15 seconds on the same injected clock.
 */
export function eventStreamResponse(options: EventStreamOptions): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeatHandle: number | undefined;
  let unsubscribe = (): void => {};

  const cleanup = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    if (heartbeatHandle !== undefined) {
      options.clock.clearTimeout(heartbeatHandle);
      heartbeatHandle = undefined;
    }
    unsubscribe();
    options.signal.removeEventListener("abort", cleanup);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string): void => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      const sent = new Set<number>();
      const writeEvent = (event: IbejiEvent): void => {
        if (closed || sent.has(event.id)) {
          return;
        }
        if (options.scope !== undefined && event.scope !== options.scope) {
          return;
        }
        if (options.lastEventId !== undefined && event.id <= options.lastEventId) {
          return;
        }
        sent.add(event.id);
        const data =
          options.sanitize === undefined
            ? JSON.stringify(event)
            : options.sanitize(JSON.stringify(event));
        write(`id: ${event.id}\ndata: ${data}\n\n`);
      };

      const heartbeat = (): void => {
        if (closed) {
          return;
        }
        write(": heartbeat\n\n");
        if (!closed) {
          heartbeatHandle = options.clock.setTimeout(heartbeat, SSE_HEARTBEAT_MS);
        }
      };

      if (options.signal.aborted) {
        cleanup();
        controller.close();
        return;
      }

      unsubscribe = options.events.subscribe(writeEvent, options.scope);
      options.signal.addEventListener("abort", cleanup, { once: true });

      if (options.lastEventId !== undefined) {
        for (const event of options.events.after(options.lastEventId)) {
          writeEvent(event);
        }
      }

      heartbeatHandle = options.clock.setTimeout(heartbeat, SSE_HEARTBEAT_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
