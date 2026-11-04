import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConnectionGuideInfo,
  CredentialView,
  EventItem,
  TwinSummary,
} from "../../../src/shared/control.js";
import { type ControlApi, isUnauthorized } from "../api/client";
import type { StreamState } from "../api/sse";
import { credentialHelp } from "../credential-help";
import { formatLastUpdated } from "../format-time";
import { twinLabelClass } from "../twin-label";
import { withTwin } from "../use-url";
import { AppLink } from "./AppLink";
import { CopyButton } from "./CopyButton";
import { ErrorPanel } from "./ErrorPanel";
import { StatusPill } from "./StatusPill";
import { WebhookUrlEditor } from "./WebhookUrlEditor";

type ConnectPageProps = {
  readonly api: ControlApi;
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly events: readonly EventItem[];
  readonly connection: StreamState;
  readonly onRefresh: () => void;
  readonly onUnauthorized: () => void;
};

type GuideData = {
  readonly credentials: readonly CredentialView[];
  readonly webhookUrl: string | null;
};

const WARNING = "Never put a live key in test settings. Live keys must never be used with Ibeji.";

function joinNames(names: readonly string[]): string {
  if (names.length === 0) {
    return "the services this copy imitates";
  }
  if (names.length === 1) {
    return names[0] ?? "the service this copy imitates";
  }
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}`;
}

function detailString(details: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" ? value : undefined;
}

function detailNumber(details: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = details[key];
  return typeof value === "number" ? value : undefined;
}

function fallbackGuide(twin: TwinSummary): ConnectionGuideInfo {
  const address = twin.address ?? "the twin address shown by Ibeji";
  return {
    summary: `Point your app at the local ${twin.displayName} twin. Use the Ibeji test keys below. No real money moves.`,
    baseUrlNote: "Use this base URL for every API call to this twin.",
    keysNote:
      "Copy the public key into browser test code. Copy the secret key into your server's test settings. These keys are fake and only work with Ibeji.",
    steps: [
      {
        title: "Send requests to the twin",
        body: `Send your ${twin.displayName} API calls to ${address}. Do not use the real service address.`,
      },
      {
        title: "Use the test keys",
        body: "Use the public key in browser test code and the secret key on your server. Never put a live key in test settings.",
      },
    ],
    webhookNote:
      "Set the twin's webhook URL to your app's endpoint and verify the message with the twin's credential before you trust it.",
    agentInstruction: `You are connecting this app to the local Ibeji ${twin.displayName} twin.

Read these values from environment variables:
IBEJI_${twin.id.toUpperCase()}_BASE_URL
IBEJI_${twin.id.toUpperCase()}_PUBLIC_KEY
IBEJI_${twin.id.toUpperCase()}_SECRET_KEY

Never write a key in source code, a committed file, or a browser bundle. Use the secret key only on the server.

Send requests to IBEJI_${twin.id.toUpperCase()}_BASE_URL. Do not hard-code the port.

Never put a live key in test settings. Live keys must never be used with Ibeji.`,
  };
}

function connectionText(
  twin: TwinSummary,
  events: readonly EventItem[],
  connection: StreamState,
): string {
  if (connection === "disconnected") {
    return "The control connection is lost. This panel will update when Ibeji answers.";
  }
  const cutoff = Date.now() - 5 * 60 * 1_000;
  const request = events.find(
    (event) => event.scope === twin.id && event.type === "request" && event.time >= cutoff,
  );
  if (request === undefined) {
    return `No requests have reached ${twin.displayName} in the last 5 minutes.`;
  }
  const method = detailString(request.details, "method") ?? "A request";
  const path = detailString(request.details, "path") ?? "";
  const actionId = detailString(request.details, "actionId");
  let response: EventItem | undefined;
  for (const event of events) {
    if (event.scope !== twin.id || event.type !== "response" || event.id <= request.id) {
      continue;
    }
    const matches =
      actionId === undefined
        ? detailString(event.details, "method") === method &&
          detailString(event.details, "path") === path
        : detailString(event.details, "actionId") === actionId;
    if (matches && (response === undefined || event.id < response.id)) {
      response = event;
    }
  }
  const time = formatLastUpdated(new Date(request.time));
  const status = response === undefined ? undefined : detailNumber(response.details, "status");
  if (status === undefined) {
    return `Last request: ${method} ${path} at ${time}. No response is recorded yet.`;
  }
  const outcome =
    status >= 200 && status < 300
      ? "success"
      : status >= 400
        ? "the app got an error"
        : "a response";
  return `Last request: ${method} ${path} at ${time}. Ibeji answered with HTTP ${status} (${outcome}).`;
}

function Guide(props: {
  readonly twin: TwinSummary;
  readonly guide: ConnectionGuideInfo;
  readonly data: GuideData | undefined;
  readonly events: readonly EventItem[];
  readonly connection: StreamState;
  readonly api: ControlApi;
  readonly onRefresh: () => void;
  readonly onWebhookSaved: (url: string | null) => void;
  readonly onUnauthorized: () => void;
}): ReactNode {
  const address = props.twin.address;
  const base = address ?? "http://127.0.0.1:<port>";
  const instruction = props.guide.agentInstruction;
  return (
    <div className="connect-guide" data-testid={`connect-guide-${props.twin.id}`}>
      <div className="connect-guide-header">
        <span className={`twin-badge ${twinLabelClass(props.twin.labelColourToken)}`}>
          {props.twin.displayName}
        </span>
        <StatusPill tone={props.twin.running ? "running" : "off"}>
          {props.twin.running ? "Running" : "Off"}
        </StatusPill>
        <h2>Connect {props.twin.displayName}</h2>
      </div>
      <p className="page-help">{props.guide.summary}</p>

      {props.twin.running ? null : (
        <div className="off-text">
          {props.twin.displayName} is off. Start it with ibeji start --twins {props.twin.id}. You
          can still copy its saved test keys and webhook URL.
        </div>
      )}

      <section className="guide-block" aria-labelledby="connect-base-url">
        <h3 id="connect-base-url">Base URL</h3>
        {address === null ? (
          <p className="help-text">Base URL is not available while this twin is off.</p>
        ) : (
          <div className="copy-row">
            <code>{address}</code>
            <CopyButton value={address} label={`base URL for ${props.twin.displayName}`} />
          </div>
        )}
        <p className="help-text">{props.guide.baseUrlNote}</p>
      </section>

      <section className="guide-block" aria-labelledby="connect-keys">
        <h3 id="connect-keys">Test keys</h3>
        {props.data === undefined ? (
          <p className="help-text">Loading test keys...</p>
        ) : (
          <ul className="credential-list">
            {props.data.credentials.map((credential) => (
              <li key={credential.id} className="credential-row">
                <span className="credential-label">{credential.label}</span>
                <span className="credential-help">{credentialHelp(credential.role)}</span>
                <code>{credential.value}</code>
                <CopyButton
                  value={credential.value}
                  label={`${credential.label} for ${props.twin.displayName}`}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="help-text">{props.guide.keysNote}</p>
      </section>

      <section className="guide-block" aria-label="Webhook URL">
        <WebhookUrlEditor
          key={props.twin.id}
          api={props.api}
          twin={props.twin}
          url={props.data?.webhookUrl ?? ""}
          disabled={props.connection === "disconnected"}
          onSaved={props.onWebhookSaved}
          onUnauthorized={props.onUnauthorized}
        />
        <p className="help-text">{props.guide.webhookNote}</p>
      </section>

      <section className="guide-block" aria-labelledby="connect-steps">
        <h3 id="connect-steps">What to change in your app</h3>
        <ol className="guide-steps">
          {props.guide.steps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <p>{step.body.replaceAll("{base}", base)}</p>
              {step.code === undefined ? null : (
                <pre className="guide-code">
                  <code>{step.code.replaceAll("{base}", base)}</code>
                </pre>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-block connection-check" aria-labelledby="connection-check-heading">
        <h3 id="connection-check-heading">Check my connection</h3>
        <p className="help-text">
          This panel only reads Ibeji's own event log. It never contacts your app.
        </p>
        <p className="connection-result" role="status">
          {connectionText(props.twin, props.events, props.connection)}
        </p>
        <button type="button" className="button button-secondary" onClick={props.onRefresh}>
          Check again
        </button>
      </section>

      <section className="guide-block" aria-labelledby="agent-instruction-heading">
        <h3 id="agent-instruction-heading">For your coding agent</h3>
        <p className="help-text">Paste this into the agent that is helping you change the app.</p>
        <pre className="agent-instruction">{instruction}</pre>
        <CopyButton value={instruction} label={`instruction for ${props.twin.displayName}`} />
      </section>
    </div>
  );
}

function LoadingGuide(): ReactNode {
  return (
    <div className="connect-skeleton" aria-busy="true">
      <span className="sr-only">Loading Connect your app.</span>
      <div className="skeleton skeleton-panel" />
      <div className="skeleton skeleton-panel" />
    </div>
  );
}

export function ConnectPage(props: ConnectPageProps): ReactNode {
  const selectedTwin =
    props.selectedTwinId === undefined
      ? undefined
      : props.twins.find((twin) => twin.id === props.selectedTwinId);
  const selectedTwinId = selectedTwin?.id;
  const [data, setData] = useState<GuideData | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const load = useCallback(async (): Promise<void> => {
    if (selectedTwinId === undefined) {
      setData(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    setData(undefined);
    try {
      const [credentials, webhook] = await Promise.all([
        props.api.getCredentials(selectedTwinId),
        props.api.getWebhookUrl(selectedTwinId),
      ]);
      setData({ credentials: credentials.credentials, webhookUrl: webhook.url });
    } catch (caught) {
      if (isUnauthorized(caught)) {
        props.onUnauthorized();
        return;
      }
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [props.api, props.onUnauthorized, selectedTwinId]);

  useEffect(() => {
    void load();
  }, [load]);

  const guide = useMemo(
    () =>
      selectedTwin === undefined
        ? undefined
        : (selectedTwin.connectionGuide ?? fallbackGuide(selectedTwin)),
    [selectedTwin],
  );

  const affiliation = joinNames(props.twins.map((twin) => twin.displayName));

  return (
    <div className="connect-page" data-testid="connect-page">
      <p className="page-help">
        Point your app at one twin. Copy the base URL and test keys below.
      </p>

      {selectedTwin === undefined ? (
        <div className="twin-picker">
          <p className="empty-title">Choose a twin to connect.</p>
          <p className="help-text">
            Make your first test request after you copy the base URL and keys.
          </p>
          <div className="twin-picker-grid">
            {props.twins.map((twin) => (
              <AppLink
                key={twin.id}
                href={withTwin("/connect", twin.id)}
                className="guide-card"
                testId={`guide-card-${twin.id}`}
              >
                <span className={`twin-badge ${twinLabelClass(twin.labelColourToken)}`}>
                  {twin.displayName}
                </span>
                <span>{twin.running ? "Running" : "Off"}</span>
                <span className="help-text">
                  {(twin.connectionGuide ?? fallbackGuide(twin)).summary}
                </span>
                <span className="text-link">Open guide</span>
              </AppLink>
            ))}
          </div>
        </div>
      ) : error !== undefined ? (
        <ErrorPanel
          error={error}
          title="We couldn't load this guide."
          onRetry={() => {
            void load();
          }}
        />
      ) : loading && data === undefined ? (
        <LoadingGuide />
      ) : guide === undefined ? null : (
        <Guide
          twin={selectedTwin}
          guide={guide}
          data={data}
          events={props.events}
          connection={props.connection}
          api={props.api}
          onRefresh={props.onRefresh}
          onWebhookSaved={(url) => {
            setData((current) =>
              current === undefined ? current : { ...current, webhookUrl: url },
            );
          }}
          onUnauthorized={props.onUnauthorized}
        />
      )}

      <section id="safety" className="safety-block" aria-labelledby="safety-heading">
        <h3 id="safety-heading">Safety first</h3>
        <p>{WARNING}</p>
        <p className="help-text">
          Ibeji only accepts its own fake test keys. If a live key reaches a twin, Ibeji refuses it,
          records only a fingerprint, and shows a warning. Remove the key from the app's test
          settings immediately.
        </p>
      </section>

      <p className="affiliation-note">
        Ibeji is a local test tool. No real money moves. Ibeji is not affiliated with {affiliation}.
      </p>
    </div>
  );
}
