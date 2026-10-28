import { type Clock, realClock } from "./clock.js";

export const MAX_EVENTS = 5000;
export const IBEJI_SCOPE = "ibeji";

export type EventType =
  | "request"
  | "response"
  | "webhook-sent"
  | "webhook-delivered"
  | "webhook-failed"
  | "failure-fired"
  | "rule-added"
  | "rule-removed"
  | "scenario-started"
  | "scenario-step"
  | "scenario-finished"
  | "warning"
  | "state-reset";

export type EventDetails = Readonly<Record<string, unknown>>;

export type IbejiEvent = {
  readonly id: number;
  readonly time: number;
  readonly type: EventType;
  readonly scope: string;
  readonly summary: string;
  readonly details: EventDetails;
};

export type NewEvent = {
  readonly type: EventType;
  readonly scope: string;
  readonly summary: string;
  readonly details?: EventDetails;
};

export type EventListener = (event: IbejiEvent) => void;

type Subscriber = {
  readonly listener: EventListener;
  readonly scope: string | undefined;
};

/**
 * The in-memory event log and bus. Ids never repeat, readers can resume after
 * the last id they saw, and only the newest 5,000 events are kept.
 */
export class EventLog {
  private readonly clock: Clock;
  private readonly events: IbejiEvent[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private nextId = 1;

  constructor(clock: Clock = realClock) {
    this.clock = clock;
  }

  publish(input: NewEvent): IbejiEvent {
    const event: IbejiEvent = Object.freeze({
      id: this.nextId,
      time: this.clock.now(),
      type: input.type,
      scope: input.scope,
      summary: input.summary,
      details: input.details === undefined ? {} : structuredClone(input.details),
    });
    this.nextId += 1;

    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }

    for (const subscriber of [...this.subscribers]) {
      if (subscriber.scope === undefined || subscriber.scope === event.scope) {
        subscriber.listener(event);
      }
    }

    return event;
  }

  subscribe(listener: EventListener, scope?: string): () => void {
    const subscriber: Subscriber = { listener, scope };
    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  after(id: number): readonly IbejiEvent[] {
    return this.events.filter((event) => event.id > id).map((event) => structuredClone(event));
  }

  get size(): number {
    return this.events.length;
  }
}
