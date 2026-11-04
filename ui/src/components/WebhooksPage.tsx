import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
  TwinSummary,
  WebhookAttempt,
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "../../../src/shared/control.js";
import { type ControlApi, isUnauthorized } from "../api/client";
import type { StreamState } from "../api/sse";
import { formatTimestamp } from "../format-time";
import { twinLabelClass } from "../twin-label";
import { ErrorPanel } from "./ErrorPanel";
import { StatusPill, type StatusTone } from "./StatusPill";
import { WebhookUrlEditor } from "./WebhookUrlEditor";

type WebhooksPageProps = {
  readonly api: ControlApi;
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly connection: StreamState;
  readonly onUnauthorized: () => void;
};

const STATUS_WORDS: Readonly<Record<WebhookDeliveryStatus, string>> = {
  queued: "Waiting to send",
  scheduled: "Waiting for retry",
  sending: "Sending",
  delivered: "Delivered",
  failed: "App said no",
  unreachable: "No answer",
  "not-sent": "Not sent",
  abandoned: "Stopped",
};

const STATUS_OPTIONS: readonly WebhookDeliveryStatus[] = [
  "queued",
  "scheduled",
  "sending",
  "delivered",
  "failed",
  "unreachable",
  "not-sent",
  "abandoned",
];

const ATTEMPT_WORDS: Readonly<Record<WebhookAttempt["outcome"], string>> = {
  delivered: "Delivered",
  failed: "App said no",
  unreachable: "No answer",
};

function statusTone(status: WebhookDeliveryStatus): StatusTone {
  switch (status) {
    case "delivered":
      return "running";
    case "failed":
    case "unreachable":
      return "failed";
    case "not-sent":
    case "abandoned":
      return "off";
    default:
      return "pending";
  }
}

function humanize(value: string): string {
  const words = value.replaceAll(".", " ").replaceAll("_", " ").replaceAll("-", " ").trim();
  return words.length === 0 ? value : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function eventName(delivery: WebhookDelivery, twin: TwinSummary | undefined): string {
  try {
    const body = JSON.parse(delivery.raw.body) as unknown;
    if (typeof body === "object" && body !== null) {
      if ("event" in body && typeof body.event === "string" && body.event.trim() !== "") {
        return humanize(body.event);
      }
      if (
        "event.type" in body &&
        typeof body["event.type"] === "string" &&
        body["event.type"].trim() !== ""
      ) {
        return humanize(body["event.type"]);
      }
    }
  } catch {
    // The raw body is not JSON. Fall through to the action summary.
  }
  const action = twin?.actions.find((item) => item.id === delivery.actionId);
  return action?.summary ?? humanize(delivery.actionId);
}

function notSentReason(reason: string | undefined): string {
  switch (reason) {
    case "no webhook URL set":
      return "Not sent because no webhook URL was set.";
    case "webhook-never-sent":
      return "Not sent because the webhook-never-sent failure fired.";
    case "the twin was reset":
      return "Stopped because the twin's records were reset.";
    case "the session stopped":
      return "Stopped because the session ended.";
    default:
      return "Not sent.";
  }
}

function AttemptRow(props: { readonly attempt: WebhookAttempt }): ReactNode {
  const attempt = props.attempt;
  return (
    <li className="attempt-row">
      <div className="attempt-summary">
        <strong>Attempt {attempt.attempt}</strong>
        <span>
          {ATTEMPT_WORDS[attempt.outcome]} at {formatTimestamp(attempt.finishedAt)}.
        </span>
        <span>
          {attempt.responseStatus === undefined
            ? "No HTTP response."
            : `HTTP ${attempt.responseStatus}.`}
        </span>
      </div>
      <dl className="attempt-facts">
        <dt>Started</dt>
        <dd>{formatTimestamp(attempt.startedAt)}</dd>
        <dt>Finished</dt>
        <dd>{formatTimestamp(attempt.finishedAt)}</dd>
        <dt>Took</dt>
        <dd>{Math.max(0, attempt.finishedAt - attempt.startedAt)} ms</dd>
        <dt>Request URL</dt>
        <dd className="reference">{attempt.requestUrl}</dd>
        <dt>Remote address</dt>
        <dd>{attempt.remoteAddress ?? "Not recorded."}</dd>
        <dt>Error code</dt>
        <dd>{attempt.errorCode ?? "None."}</dd>
        <dt>Error</dt>
        <dd>{attempt.error ?? "None."}</dd>
      </dl>
      <p className="field-label">First 4 KB of the response</p>
      {attempt.responseBody === "" ? (
        <p className="help-text">The app returned an empty body.</p>
      ) : (
        <pre className="response-body">{attempt.responseBody}</pre>
      )}
    </li>
  );
}

function DeliveryCard(props: {
  readonly delivery: WebhookDelivery;
  readonly twin: TwinSummary | undefined;
  readonly disabled: boolean;
  readonly resending: boolean;
  readonly onResend: (id: string) => void;
}): ReactNode {
  const delivery = props.delivery;
  return (
    <article className="delivery-card" data-testid={`delivery-${delivery.id}`}>
      <div className="delivery-header">
        <div className="delivery-title">
          <StatusPill tone={statusTone(delivery.status)}>
            {STATUS_WORDS[delivery.status]}
          </StatusPill>
          <span
            className={`twin-badge ${twinLabelClass(props.twin?.labelColourToken ?? "unknown")}`}
          >
            {props.twin?.displayName ?? delivery.twinId}
          </span>
          <strong>{eventName(delivery, props.twin)}</strong>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={props.disabled || props.resending}
          onClick={() => props.onResend(delivery.id)}
        >
          {props.resending ? "Resending..." : "Resend"}
        </button>
      </div>
      <p className="delivery-meta">
        {formatTimestamp(delivery.createdAt)} · {delivery.attempts.length}{" "}
        {delivery.attempts.length === 1 ? "attempt" : "attempts"} ·{" "}
        <span className="reference">{delivery.eventId}</span>
      </p>
      <p className="delivery-destination">Destination: {delivery.url ?? "No webhook URL set."}</p>
      {delivery.status === "not-sent" ? (
        <p className="notice-line">{notSentReason(delivery.reason)}</p>
      ) : null}
      <details className="delivery-details">
        <summary>{delivery.attempts.length === 0 ? "Attempts" : "Show attempts"}</summary>
        {delivery.attempts.length === 0 ? (
          <p className="help-text">No attempts yet. This delivery is waiting to send.</p>
        ) : (
          <ol className="attempt-list">
            {delivery.attempts.map((attempt) => (
              <AttemptRow key={`${delivery.id}-${attempt.attempt}`} attempt={attempt} />
            ))}
          </ol>
        )}
      </details>
    </article>
  );
}

function LoadingRows(): ReactNode {
  return (
    <div className="webhook-skeleton" aria-busy="true">
      <span className="sr-only">Loading Webhooks.</span>
      {[1, 2, 3].map((row) => (
        <div key={row} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function WebhooksPage(props: WebhooksPageProps): ReactNode {
  const [deliveries, setDeliveries] = useState<readonly WebhookDelivery[] | undefined>(undefined);
  const [urls, setUrls] = useState<Readonly<Record<string, string | null>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const [statusFilter, setStatusFilter] = useState<"all" | WebhookDeliveryStatus>("all");
  const [resendingId, setResendingId] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState("");

  const selectedTwin =
    props.selectedTwinId === undefined
      ? undefined
      : props.twins.find((twin) => twin.id === props.selectedTwinId);
  const twinOff = selectedTwin !== undefined && !selectedTwin.running;

  const load = useCallback(
    async (initial: boolean): Promise<void> => {
      if (initial) {
        setLoading(true);
      }
      setError(undefined);
      try {
        const urlResults = await Promise.all(
          props.twins.map(async (twin) => {
            const result = await props.api.getWebhookUrl(twin.id);
            return [twin.id, result.url] as const;
          }),
        );
        setUrls(Object.fromEntries(urlResults));

        if (twinOff) {
          setDeliveries([]);
        } else {
          const result = await props.api.getWebhooks(
            props.selectedTwinId === undefined ? {} : { twin: props.selectedTwinId },
          );
          setDeliveries(result.deliveries);
        }
      } catch (caught) {
        if (isUnauthorized(caught)) {
          props.onUnauthorized();
          return;
        }
        setError(caught);
      } finally {
        setLoading(false);
      }
    },
    [props.api, props.onUnauthorized, props.selectedTwinId, props.twins, twinOff],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (toast === "") {
      return;
    }
    const handle = window.setTimeout(() => setToast(""), 5_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const visibleDeliveries = useMemo(
    () =>
      (deliveries ?? []).filter(
        (delivery) => statusFilter === "all" || delivery.status === statusFilter,
      ),
    [deliveries, statusFilter],
  );

  const resend = async (id: string): Promise<void> => {
    setResendingId(id);
    try {
      await props.api.resendWebhook(id);
      setToast("Delivery queued again.");
      await load(false);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        props.onUnauthorized();
        return;
      }
      setError(caught);
    } finally {
      setResendingId(undefined);
    }
  };

  const editors =
    props.selectedTwinId === undefined
      ? props.twins
      : props.twins.filter((twin) => twin.id === props.selectedTwinId);

  return (
    <div className="webhooks-page" data-testid="webhooks-page">
      <p className="page-help">
        A webhook is a message Ibeji sends to your app. This page shows every delivery.
      </p>

      {props.connection === "disconnected" ? (
        <p className="page-warning">
          Ibeji is not answering. Resend and URL changes are paused until it returns.
        </p>
      ) : null}

      {toast === "" ? null : (
        <p className="toast" role="status" aria-live="polite">
          {toast}
        </p>
      )}

      {loading && deliveries === undefined ? (
        <LoadingRows />
      ) : error !== undefined && deliveries === undefined ? (
        <ErrorPanel
          error={error}
          title="We couldn't load webhooks."
          onRetry={() => {
            void load(true);
          }}
        />
      ) : (
        <>
          <section className="webhook-editors" aria-label="Webhook addresses">
            {editors.map((twin) => (
              <WebhookUrlEditor
                key={twin.id}
                api={props.api}
                twin={twin}
                url={urls[twin.id] ?? ""}
                disabled={props.connection === "disconnected"}
                onSaved={(url) => {
                  setUrls((current) => ({ ...current, [twin.id]: url }));
                }}
                onUnauthorized={props.onUnauthorized}
              />
            ))}
          </section>

          {twinOff && selectedTwin !== undefined ? (
            <div className="empty-state">
              <p className="empty-title">{selectedTwin.displayName} is off.</p>
              <p className="help-text">
                You can still set its webhook URL. Deliveries appear when it runs.
              </p>
            </div>
          ) : (
            <section className="delivery-section" aria-labelledby="deliveries-heading">
              <div className="section-heading-row">
                <h2 id="deliveries-heading">Deliveries</h2>
                <div className="filter-row">
                  <label className="field-label" htmlFor="delivery-status">
                    Status
                  </label>
                  <select
                    id="delivery-status"
                    className="select"
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as "all" | WebhookDeliveryStatus)
                    }
                  >
                    <option value="all">All statuses</option>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_WORDS[status]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {visibleDeliveries.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-title">
                    {deliveries?.length === 0
                      ? "No webhooks yet."
                      : "No deliveries match this status."}
                  </p>
                  <p className="help-text">
                    {deliveries?.length === 0
                      ? "Set a webhook URL, then make a test payment."
                      : "Choose another status to see more deliveries."}
                  </p>
                </div>
              ) : (
                <div className="delivery-list">
                  {visibleDeliveries.map((delivery) => (
                    <DeliveryCard
                      key={delivery.id}
                      delivery={delivery}
                      twin={props.twins.find((twin) => twin.id === delivery.twinId)}
                      disabled={props.connection === "disconnected" || twinOff}
                      resending={resendingId === delivery.id}
                      onResend={(id) => {
                        void resend(id);
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {error !== undefined && deliveries !== undefined ? (
        <ErrorPanel
          error={error}
          title="We couldn't update webhooks."
          onRetry={() => {
            void load(false);
          }}
        />
      ) : null}
    </div>
  );
}
