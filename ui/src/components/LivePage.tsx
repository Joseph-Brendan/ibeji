import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventItem, TwinSummary } from "../../../src/shared/control.js";
import { announceActivity, createActivityAnnouncement } from "../activity-announcer.js";
import type { StreamState } from "../api/sse";
import { eventSummary, eventTypeLabel } from "../event-label";
import { formatTimestamp } from "../format-time";
import { twinLabelClass } from "../twin-label";
import { navigate, withTwin } from "../use-url";
import { ErrorPanel } from "./ErrorPanel";

type TypeFilter =
  | "all"
  | "request"
  | "response"
  | "webhooks"
  | "failures"
  | "warnings"
  | "rules"
  | "scenarios";

const TYPE_FILTERS: readonly { readonly value: TypeFilter; readonly label: string }[] = [
  { value: "all", label: "All types" },
  { value: "request", label: "Requests" },
  { value: "response", label: "Responses" },
  { value: "webhooks", label: "Webhooks" },
  { value: "failures", label: "Failures" },
  { value: "warnings", label: "Warnings" },
  { value: "rules", label: "Rules" },
  { value: "scenarios", label: "Scenarios" },
];

type LivePageProps = {
  readonly events: readonly EventItem[];
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly connection: StreamState;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
};

function matchesType(type: string, filter: TypeFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "request":
      return type === "request";
    case "response":
      return type === "response";
    case "webhooks":
      return type === "webhook-sent" || type === "webhook-delivered" || type === "webhook-failed";
    case "failures":
      return type === "failure-fired";
    case "warnings":
      return type === "warning";
    case "rules":
      return type === "rule-added" || type === "rule-removed";
    case "scenarios":
      return (
        type === "scenario-started" || type === "scenario-step" || type === "scenario-finished"
      );
  }
}

function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .trim()
    .toLowerCase();
  return words.length === 0 ? key : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function detailText(value: unknown): string {
  if (value === null) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value === undefined) {
    return "None";
  }
  return JSON.stringify(value, null, 2) ?? "None";
}

type EventRowProps = {
  readonly event: EventItem;
  readonly twin: TwinSummary | undefined;
  readonly expanded: boolean;
  readonly onToggle: (id: number) => void;
};

const EventRow = memo(function EventRow(props: EventRowProps): ReactNode {
  const name = props.twin?.displayName ?? props.event.scope;
  const labelToken = props.twin?.labelColourToken ?? "unknown";
  const details = Object.entries(props.event.details);
  const panelId = `event-details-${props.event.id}`;

  return (
    <li className="activity-row" data-testid="event-row">
      <div className="activity-row-main">
        <time className="activity-time" dateTime={new Date(props.event.time).toISOString()}>
          {formatTimestamp(props.event.time)}
        </time>
        <span className={`twin-badge ${twinLabelClass(labelToken)}`}>{name}</span>
        <span className="activity-type">{eventTypeLabel(props.event.type)}</span>
        <span className="activity-summary">{eventSummary(props.event)}</span>
        <button
          type="button"
          className="button button-small activity-details-toggle"
          aria-expanded={props.expanded}
          aria-controls={panelId}
          onClick={() => props.onToggle(props.event.id)}
        >
          {props.expanded ? "Hide details" : "Details"}
        </button>
      </div>

      {props.expanded ? (
        <div id={panelId} className="activity-details">
          <table className="details-table">
            <caption className="sr-only">Event details</caption>
            <tbody>
              <tr>
                <th scope="row">Event ID</th>
                <td>
                  <code>{props.event.id}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">Twin</th>
                <td>{name}</td>
              </tr>
              {details.length === 0 ? (
                <tr>
                  <th scope="row">Details</th>
                  <td>No extra details.</td>
                </tr>
              ) : (
                details.map(([key, value]) => (
                  <tr key={key}>
                    <th scope="row">{humanizeKey(key)}</th>
                    <td>{detailText(value)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
});

function LoadingRows(): ReactNode {
  return (
    <div className="activity-skeleton" aria-busy="true">
      <span className="sr-only">Loading Live activity.</span>
      {[1, 2, 3, 4, 5, 6].map((row) => (
        <div key={row} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function LivePage(props: LivePageProps): ReactNode {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<number | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const [newWhileScrolled, setNewWhileScrolled] = useState(0);
  const announcer = useRef(createActivityAnnouncement());
  const lastSeenId = useRef<number | undefined>(undefined);
  const initialised = useRef(false);

  const selectedTwin =
    props.selectedTwinId === undefined
      ? undefined
      : props.twins.find((twin) => twin.id === props.selectedTwinId);
  const twinById = useMemo(
    () => new Map(props.twins.map((twin) => [twin.id, twin])),
    [props.twins],
  );
  const newestEvent = props.events[0];

  const matchesFilters = useCallback(
    (event: EventItem): boolean =>
      (props.selectedTwinId === undefined || event.scope === props.selectedTwinId) &&
      matchesType(event.type, typeFilter),
    [props.selectedTwinId, typeFilter],
  );

  const filteredEvents = useMemo(() => {
    const events =
      paused && pausedAt !== undefined
        ? props.events.filter((event) => event.id <= pausedAt)
        : props.events;
    return events.filter(matchesFilters);
  }, [matchesFilters, paused, pausedAt, props.events]);

  const waitingCount = useMemo(() => {
    if (!paused || pausedAt === undefined) {
      return 0;
    }
    return props.events.filter((event) => event.id > pausedAt && matchesFilters(event)).length;
  }, [matchesFilters, paused, pausedAt, props.events]);

  useEffect(() => {
    if (initialised.current || props.loading) {
      return;
    }
    initialised.current = true;
    lastSeenId.current = props.events[0]?.id;
  }, [props.events, props.loading]);

  useEffect(() => {
    if (newestEvent === undefined || !initialised.current) {
      return;
    }

    const previous = lastSeenId.current ?? 0;
    const newEvents = props.events.filter((event) => event.id > previous);
    if (newEvents.length === 0) {
      return;
    }
    lastSeenId.current = newestEvent.id;

    if (window.scrollY > 200 && !paused) {
      setNewWhileScrolled((count) => count + newEvents.length);
    }

    const result = announceActivity(
      announcer.current,
      newEvents.length,
      Date.now(),
      eventSummary(newestEvent),
      paused,
    );
    announcer.current = result.state;
    if (result.text !== undefined) {
      setAnnouncement(result.text);
    }
  }, [newestEvent, paused, props.events]);

  useEffect(() => {
    const onScroll = (): void => {
      if (window.scrollY <= 200) {
        setNewWhileScrolled(0);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleDetails = useCallback((id: number): void => {
    setExpandedId((current) => (current === id ? undefined : id));
  }, []);

  const pause = (): void => {
    setPaused(true);
    setPausedAt(props.events[0]?.id ?? 0);
    setExpandedId(undefined);
  };

  const resume = (): void => {
    setPaused(false);
    setPausedAt(undefined);
    setNewWhileScrolled(0);
  };

  const clearFilters = (): void => {
    setTypeFilter("all");
    navigate(withTwin("/activity", undefined));
  };

  const statusText = paused
    ? `Paused. ${waitingCount} new ${waitingCount === 1 ? "event" : "events"} arrived.`
    : props.connection === "disconnected"
      ? "Reconnecting."
      : "Live";

  const twinOff = selectedTwin !== undefined && !selectedTwin.running;
  const hasFilters = typeFilter !== "all" || props.selectedTwinId !== undefined;
  const filteredEmpty = filteredEvents.length === 0;
  const emptyReplacedByError =
    filteredEmpty && props.error !== undefined && props.events.length === 0;

  return (
    <div className="live-page" data-testid="live-page">
      <p className="page-help">
        Every request, response, webhook and failure appears here as it happens.
      </p>

      <section className="activity-toolbar" aria-label="Activity controls">
        <div className="activity-controls">
          <label className="field-label" htmlFor="event-type">
            Event type
          </label>
          <select
            id="event-type"
            className="select"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
          >
            {TYPE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={paused ? "button button-primary" : "button button-secondary"}
            onClick={paused ? resume : pause}
          >
            {paused ? "Resume" : "Pause activity"}
          </button>
        </div>
        <p className="help-text">
          Pause freezes this list. Ibeji keeps the connection open and counts new events.
        </p>
      </section>

      <div className="activity-status">
        <span
          className={`activity-status-dot activity-status-dot-${props.connection}`}
          aria-hidden="true"
        />
        {statusText}
      </div>

      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      {props.error === undefined ? null : (
        <ErrorPanel
          error={props.error}
          title="We couldn't load activity."
          onRetry={props.onRetry}
        />
      )}

      {props.loading && props.events.length === 0 ? (
        <LoadingRows />
      ) : twinOff ? (
        <div className="empty-state" data-testid="activity-twin-off">
          <p className="empty-title">{selectedTwin.displayName} is off.</p>
          <p className="help-text">
            Start it to see new activity for this twin. Choose All twins to see other twins.
          </p>
        </div>
      ) : emptyReplacedByError ? null : filteredEmpty ? (
        <div className="empty-state" data-testid="activity-empty">
          <p className="empty-title">
            {hasFilters && props.events.length > 0
              ? "No events match this filter."
              : "No activity yet."}
          </p>
          <p className="help-text">
            {hasFilters && props.events.length > 0
              ? "Choose another twin or event type to see more."
              : "Make a test request, or run a practice scenario."}
          </p>
          {hasFilters ? (
            <button
              type="button"
              className="button button-secondary empty-action"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <ol className="activity-list" aria-label="Activity timeline">
          {filteredEvents.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              twin={twinById.get(event.scope)}
              expanded={expandedId === event.id}
              onToggle={toggleDetails}
            />
          ))}
        </ol>
      )}

      {!paused && newWhileScrolled > 0 && props.connection !== "disconnected" ? (
        <button
          type="button"
          className="jump-latest"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
            setNewWhileScrolled(0);
          }}
        >
          Jump to latest ({newWhileScrolled} new)
        </button>
      ) : null}
    </div>
  );
}
