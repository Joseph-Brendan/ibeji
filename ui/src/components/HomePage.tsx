import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
  CredentialView,
  EventItem,
  StatusResponse,
  TwinSummary,
} from "../../../src/shared/control.js";
import { type ControlApi, isUnauthorized } from "../api/client";
import { eventTypeLabel } from "../event-label";
import { formatStarted, formatTimestamp } from "../format-time";
import { twinLabelClass } from "../twin-label";
import { withTwin } from "../use-url";
import { AppLink } from "./AppLink";
import { ConfirmDialog } from "./ConfirmDialog";
import { CopyButton } from "./CopyButton";
import { ErrorPanel } from "./ErrorPanel";
import { StatusPill } from "./StatusPill";

type TwinHomeData = {
  readonly credentials: readonly CredentialView[];
  readonly webhookUrl: string | null;
};

type HomePageProps = {
  readonly api: ControlApi;
  readonly status: StatusResponse | undefined;
  readonly twins: readonly TwinSummary[];
  readonly events: readonly EventItem[];
  readonly selectedTwinId: string | undefined;
  readonly onUnauthorized: () => void;
};

function twinName(scope: string, twins: readonly TwinSummary[]): string {
  if (scope === "ibeji") {
    return "Ibeji";
  }
  return twins.find((twin) => twin.id === scope)?.displayName ?? scope;
}

function HomeSkeleton(): ReactNode {
  return (
    <div className="home-skeleton" aria-busy="true">
      <span className="sr-only">Loading Home.</span>
      <div className="skeleton skeleton-strip" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-panel" />
    </div>
  );
}

export function HomePage(props: HomePageProps): ReactNode {
  const targetTwins = useMemo(() => {
    if (props.selectedTwinId !== undefined) {
      return props.twins.filter((twin) => twin.id === props.selectedTwinId);
    }
    return props.twins.filter((twin) => twin.running);
  }, [props.twins, props.selectedTwinId]);

  const [data, setData] = useState<Readonly<Record<string, TwinHomeData>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const [rotateTwin, setRotateTwin] = useState<TwinSummary | undefined>(undefined);
  const [rotating, setRotating] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const results = await Promise.all(
        targetTwins.map(async (twin) => {
          const [credentials, webhook] = await Promise.all([
            props.api.getCredentials(twin.id),
            props.api.getWebhookUrl(twin.id),
          ]);
          return [
            twin.id,
            { credentials: credentials.credentials, webhookUrl: webhook.url },
          ] as const;
        }),
      );
      setData(Object.fromEntries(results));
    } catch (loadError) {
      if (isUnauthorized(loadError)) {
        props.onUnauthorized();
        return;
      }
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [props.api, targetTwins, props.onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (toast === "") {
      return;
    }
    const handle = window.setTimeout(() => setToast(""), 3_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const selectedTwin =
    props.selectedTwinId === undefined
      ? undefined
      : props.twins.find((twin) => twin.id === props.selectedTwinId);

  const rotate = async (): Promise<void> => {
    if (rotateTwin === undefined) {
      return;
    }
    setRotating(true);
    try {
      await props.api.rotateCredentials(rotateTwin.id);
      setRotateTwin(undefined);
      setToast(`${rotateTwin.displayName} test keys rotated.`);
      void load();
    } catch (rotateError) {
      if (isUnauthorized(rotateError)) {
        props.onUnauthorized();
        return;
      }
      setError(rotateError);
      setRotateTwin(undefined);
    } finally {
      setRotating(false);
    }
  };

  if (props.status === undefined || (loading && Object.keys(data).length === 0)) {
    return <HomeSkeleton />;
  }

  if (props.selectedTwinId !== undefined && selectedTwin === undefined) {
    return (
      <ErrorPanel
        error={undefined}
        title="That twin is not known."
        onRetry={() => {
          void load();
        }}
      />
    );
  }

  const ruleCount = props.status.rules.filter(
    (rule) => props.selectedTwinId === undefined || rule.twins.includes(props.selectedTwinId),
  ).length;
  const recentEvents = props.events
    .filter(
      (event) =>
        props.selectedTwinId === undefined ||
        event.scope === props.selectedTwinId ||
        event.scope === "ibeji",
    )
    .slice(0, 10);
  const emptyFirstRun = recentEvents.length === 0 && ruleCount === 0;

  return (
    <div className="home-page" data-testid="home-page">
      <p className="page-help">This page shows the session, the twins and the newest activity.</p>

      <section className="session-strip" aria-label="Session">
        <div className="strip-item">
          <span className="strip-label">Version</span>
          <span className="strip-value">{props.status.version}</span>
        </div>
        <div className="strip-item">
          <span className="strip-label">Seed</span>
          <span className="strip-value" data-testid="seed-value">
            {props.status.seed}
          </span>
        </div>
        <div className="strip-item">
          <span className="strip-label">Started</span>
          <span className="strip-value">{formatStarted(props.status.startTime)}</span>
        </div>
        <div className="strip-item">
          <span className="strip-label">Scenario:</span>
          <span className="strip-value">{props.status.scenario ?? "none"}</span>
        </div>
      </section>

      {error === undefined ? null : (
        <ErrorPanel
          error={error}
          title="Ibeji could not load this page."
          onRetry={() => {
            void load();
          }}
        />
      )}

      <section className="panel" aria-labelledby="now-heading">
        <div className="section-heading-row">
          <div className="section-title-group">
            <span className="live-dot" aria-hidden="true" />
            <h2 id="now-heading">What is happening now</h2>
            <span className="sr-only">Live updates</span>
          </div>
          <AppLink href="/activity" className="text-link">
            Open Live activity
          </AppLink>
        </div>
        {recentEvents.length === 0 ? (
          <div className="empty-state">
            <p>Nothing has happened yet.</p>
            <p className="help-text">Make a test request, or run a scenario.</p>
          </div>
        ) : (
          <ol className="event-list">
            {recentEvents.map((event) => (
              <li key={event.id} className="event-row">
                <span className="event-time">{formatTimestamp(event.time)}</span>
                <span className="event-twin">{twinName(event.scope, props.twins)}</span>
                <span className="event-type">{eventTypeLabel(event.type)}</span>
                <span className="event-summary">{event.summary}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel guide-panel" aria-labelledby="guide-heading">
        <h2 id="guide-heading">First time here?</h2>
        {emptyFirstRun ? <p className="guide-lead">Start with Connect your app.</p> : null}
        <ol className="guide-list">
          <li>Open Connect your app.</li>
          <li>Copy the base URL and test keys into your app.</li>
          <li>Make a test payment.</li>
          <li>Watch it appear on Live activity.</li>
        </ol>
        <AppLink
          href={withTwin("/connect", props.selectedTwinId)}
          className="button button-secondary"
        >
          Open Connect your app
        </AppLink>
      </section>

      <section className="twin-section" aria-labelledby="twins-heading">
        <h2 id="twins-heading">{props.selectedTwinId === undefined ? "Running twins" : "Twin"}</h2>
        {targetTwins.length === 0 ? (
          <div className="empty-state">
            <p>No twins are running.</p>
            <p className="help-text">Start Ibeji with ibeji start.</p>
          </div>
        ) : (
          <div className="twin-grid">
            {targetTwins.map((twin) => {
              const twinData = data[twin.id];
              const credentialsUnavailable =
                !loading && twinData === undefined && error !== undefined;
              return (
                <article key={twin.id} className="twin-card" data-testid={`twin-card-${twin.id}`}>
                  <div className="twin-card-header">
                    <span className={`twin-badge ${twinLabelClass(twin.labelColourToken)}`}>
                      {twin.displayName}
                    </span>
                    <StatusPill tone={twin.running ? "running" : "off"}>
                      {twin.running ? "Running" : "Off"}
                    </StatusPill>
                  </div>

                  {twin.running ? null : (
                    <p className="off-text">
                      {twin.displayName} is off. Start it with ibeji start --twins {twin.id}.
                    </p>
                  )}

                  {twin.address === null ? (
                    <p className="card-row">Base URL: not available while this twin is off.</p>
                  ) : (
                    <div className="card-row">
                      <span className="card-label">Base URL</span>
                      <span className="code-row">
                        <code>{twin.address}</code>
                        <CopyButton
                          value={twin.address}
                          label={`base URL for ${twin.displayName}`}
                        />
                      </span>
                    </div>
                  )}

                  <div className="card-block">
                    <span className="card-label">Test keys</span>
                    {credentialsUnavailable ? (
                      <p className="card-value">Test keys could not be loaded.</p>
                    ) : twinData === undefined || twinData.credentials.length === 0 ? (
                      <p className="card-value">Loading test keys...</p>
                    ) : (
                      <ul className="credential-list">
                        {twinData.credentials.map((credential) => (
                          <li key={credential.id} className="credential-row">
                            <span className="credential-label">{credential.label}</span>
                            <code>{credential.value}</code>
                            <CopyButton
                              value={credential.value}
                              label={`${credential.label} for ${twin.displayName}`}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="help-text">
                      These are fake test keys. They only work with Ibeji.
                    </p>
                  </div>

                  <div className="card-row">
                    <span className="card-label">Webhook URL</span>
                    <span className="card-value">
                      {twinData === undefined
                        ? credentialsUnavailable
                          ? "Could not be loaded."
                          : "Loading..."
                        : (twinData.webhookUrl ?? "Not set.")}
                    </span>
                    <AppLink href={withTwin("/webhooks", twin.id)} className="text-link">
                      Change
                    </AppLink>
                  </div>

                  <div className="card-actions">
                    <AppLink
                      href={withTwin("/connect", twin.id)}
                      className="button button-secondary"
                    >
                      Open Connect your app
                    </AppLink>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setRotateTwin(twin)}
                    >
                      Rotate test keys
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="rules-heading">
        <div className="section-heading-row">
          <h2 id="rules-heading">Active rules</h2>
          <AppLink href={withTwin("/failures", props.selectedTwinId)} className="text-link">
            Open Failures
          </AppLink>
        </div>
        <p>
          {ruleCount === 0
            ? "No failures are on."
            : `${ruleCount} failure rule${ruleCount === 1 ? "" : "s"} ${ruleCount === 1 ? "is" : "are"} on.`}
        </p>
        {props.status.scenario === null ? null : (
          <p className="help-text">Scenario: {props.status.scenario}</p>
        )}
      </section>

      <span className="sr-only" role="status" aria-live="polite">
        {toast}
      </span>

      <ConfirmDialog
        open={rotateTwin !== undefined}
        title={`Rotate ${rotateTwin?.displayName ?? "this twin"} test keys?`}
        body="The old keys stop working. Update your app with the new keys. This cannot be undone."
        confirmLabel="Rotate keys"
        busy={rotating}
        onConfirm={() => {
          void rotate();
        }}
        onCancel={() => setRotateTwin(undefined)}
      />
    </div>
  );
}
