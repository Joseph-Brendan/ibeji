import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventItem, StatusResponse, TwinSummary } from "../../src/shared/control.js";
import { announceActivity, createActivityAnnouncement } from "./activity-announcer";
import { API_PREFIX, ApiError, ConnectionError, ControlApi, isUnauthorized } from "./api/client";
import { SseClient, type StreamState } from "./api/sse";
import { AppLink } from "./components/AppLink";
import { AppShell } from "./components/AppShell";
import { ConnectPage } from "./components/ConnectPage";
import { DataPage } from "./components/DataPage";
import { ErrorPanel } from "./components/ErrorPanel";
import { FailuresPage } from "./components/FailuresPage";
import { HomePage } from "./components/HomePage";
import type { LiveKeyWarning } from "./components/LiveKeyBanners";
import { LivePage } from "./components/LivePage";
import { ScenariosPage } from "./components/ScenariosPage";
import { SignInPage, type SignInState } from "./components/SignInPage";
import { WebhooksPage } from "./components/WebhooksPage";
import { eventSummary } from "./event-label";
import { formatLastUpdated } from "./format-time";
import { twinFromUrl, useUrl, withTwin } from "./use-url";

type AuthState =
  | "checking"
  | "signed-in"
  | "invalid"
  | "restarted"
  | "no-cookie"
  | "offline"
  | "error";

const MAX_UI_EVENTS = 5_000;

function mergeEvents(
  current: readonly EventItem[],
  incoming: readonly EventItem[],
): readonly EventItem[] {
  const byId = new Map<number, EventItem>();
  for (const event of [...current, ...incoming]) {
    byId.set(event.id, event);
  }
  return [...byId.values()].sort((left, right) => right.id - left.id).slice(0, MAX_UI_EVENTS);
}

function liveKeyWarning(event: EventItem): LiveKeyWarning | undefined {
  if (event.type !== "warning") {
    return undefined;
  }
  const fingerprint = event.details.fingerprint;
  if (typeof fingerprint !== "string") {
    return undefined;
  }
  return {
    eventId: event.id,
    twinId: event.scope,
    displayName: event.scope,
    message: event.summary,
    fingerprint,
  };
}

function mergeLiveKeyWarnings(
  current: readonly LiveKeyWarning[],
  incoming: readonly LiveKeyWarning[],
): readonly LiveKeyWarning[] {
  const byTwin = new Map(current.map((warning) => [warning.twinId, warning]));
  for (const warning of incoming) {
    const existing = byTwin.get(warning.twinId);
    if (existing === undefined || warning.eventId > existing.eventId) {
      byTwin.set(warning.twinId, warning);
    }
  }
  return [...byTwin.values()];
}

function unauthorizedState(error: unknown): AuthState {
  return error instanceof ApiError && error.staleSession ? "restarted" : "no-cookie";
}

const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/": "Home",
  "/connect": "Connect your app",
  "/activity": "Live activity",
  "/failures": "Failures",
  "/scenarios": "Scenarios",
  "/webhooks": "Webhooks",
  "/data": "Data",
};

function pageTitle(pathname: string): string {
  return PAGE_TITLES[pathname] ?? "We can't find that page";
}

function removeLaunchCode(pathname: string): void {
  window.history.replaceState(null, "", pathname);
}

let pendingLaunchCode: string | undefined;
let pendingLaunchExchange: Promise<StatusResponse> | undefined;

function exchangeLaunchOnce(api: ControlApi, code: string): Promise<StatusResponse> {
  if (pendingLaunchCode === code && pendingLaunchExchange !== undefined) {
    return pendingLaunchExchange;
  }
  pendingLaunchCode = code;
  pendingLaunchExchange = api.exchangeLaunchCode(code).then(() => api.getStatus());
  return pendingLaunchExchange;
}

export function App(): ReactNode {
  const api = useMemo(() => new ControlApi(), []);
  const url = useUrl();
  const pathname = url.split("?")[0] ?? "/";
  const [auth, setAuth] = useState<AuthState>("checking");
  const [authError, setAuthError] = useState<unknown>(undefined);
  const [status, setStatus] = useState<StatusResponse | undefined>(undefined);
  const [twins, setTwins] = useState<readonly TwinSummary[]>([]);
  const [events, setEvents] = useState<readonly EventItem[]>([]);
  const [liveKeyWarnings, setLiveKeyWarnings] = useState<readonly LiveKeyWarning[]>([]);
  const [connection, setConnection] = useState<StreamState>("connecting");
  const [loadError, setLoadError] = useState<unknown>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | undefined>(undefined);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const activityAnnouncement = useRef(createActivityAnnouncement());
  const previousConnection = useRef<StreamState>("connecting");
  const lastEventId = useRef<number | undefined>(undefined);
  const seenEventIds = useRef(new Set<number>());
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    let cancelled = false;
    const launch = new URL(window.location.href).searchParams.get("launch");

    if (launch !== null) {
      void exchangeLaunchOnce(api, launch)
        .then((session) => {
          removeLaunchCode(window.location.pathname);
          if (cancelled) {
            return;
          }
          setStatus(session);
          setLastUpdated(new Date());
          setAuth("signed-in");
        })
        .catch((error: unknown) => {
          removeLaunchCode(window.location.pathname);
          if (cancelled) {
            return;
          }
          if (error instanceof ConnectionError) {
            setAuth("offline");
            return;
          }
          if (error instanceof Error && "code" in error && error.code === "LAUNCH_CODE_INVALID") {
            setAuth("invalid");
            return;
          }
          if (isUnauthorized(error)) {
            setAuth("restarted");
            return;
          }
          setAuthError(error);
          setAuth("error");
        });
    } else {
      void api
        .getStatus()
        .then((session) => {
          if (!cancelled) {
            setStatus(session);
            setLastUpdated(new Date());
            setAuth("signed-in");
          }
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          if (isUnauthorized(error)) {
            setAuth(unauthorizedState(error));
            return;
          }
          if (error instanceof ConnectionError) {
            setAuth("offline");
            return;
          }
          setAuthError(error);
          setAuth("error");
        });
    }

    return () => {
      cancelled = true;
    };
  }, [api]);

  const onUnauthorized = useCallback(() => {
    setAuth("restarted");
  }, []);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const namedLiveKeyWarnings = useMemo(
    () =>
      liveKeyWarnings.map((warning) => ({
        ...warning,
        displayName:
          twins.find((twin) => twin.id === warning.twinId)?.displayName ?? warning.displayName,
      })),
    [liveKeyWarnings, twins],
  );

  useEffect(() => {
    if (auth !== "signed-in") {
      return;
    }
    let cancelled = false;
    let stream: SseClient | undefined;
    // Reading the retry token makes this effect restart when the user retries.
    void reloadKey;
    setEventsLoaded(false);
    setLoadError(undefined);

    const handleEvent = (event: EventItem): void => {
      if (seenEventIds.current.has(event.id)) {
        return;
      }
      seenEventIds.current.add(event.id);
      const warning = liveKeyWarning(event);
      if (warning !== undefined) {
        setLiveKeyWarnings((current) => mergeLiveKeyWarnings(current, [warning]));
      }
      setEvents((current) => [event, ...current].slice(0, MAX_UI_EVENTS));
      lastEventId.current = Math.max(lastEventId.current ?? 0, event.id);
      setLastUpdated(new Date());

      if (pathnameRef.current !== "/activity") {
        const result = announceActivity(
          activityAnnouncement.current,
          1,
          Date.now(),
          eventSummary(event),
          false,
        );
        activityAnnouncement.current = result.state;
        if (result.text !== undefined) {
          setAnnouncement(result.text);
        }
      }
    };

    void Promise.all([api.getTwins(), api.getEvents({ limit: 500 })])
      .then(([twinList, eventList]) => {
        if (cancelled) {
          return;
        }
        setTwins(twinList.twins);
        const initialWarnings = eventList.events
          .map(liveKeyWarning)
          .filter((warning): warning is LiveKeyWarning => warning !== undefined);
        setLiveKeyWarnings((current) => mergeLiveKeyWarnings(current, initialWarnings));
        setEvents([...eventList.events].reverse());
        seenEventIds.current = new Set(eventList.events.map((event) => event.id));
        lastEventId.current = eventList.events.at(-1)?.id;
        setEventsLoaded(true);
        setLastUpdated(new Date());
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (isUnauthorized(error)) {
          setAuth("restarted");
          return;
        }
        setLoadError(error);
        setEventsLoaded(true);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        stream = new SseClient({
          url: `${API_PREFIX}/events/stream`,
          ...(lastEventId.current === undefined ? {} : { initialLastEventId: lastEventId.current }),
          onEvent: handleEvent,
          onState: setConnection,
          onUnauthorized,
        });
        stream.start();
      });

    return () => {
      cancelled = true;
      stream?.stop();
    };
  }, [api, auth, onUnauthorized, reloadKey]);

  useEffect(() => {
    if (connection === "connected" && previousConnection.current === "disconnected") {
      setAnnouncement("Connected again. Live updates have resumed.");
      const after = lastEventId.current;
      void api
        .getEvents({ ...(after === undefined ? {} : { after }), limit: 500 })
        .then((list) => {
          for (const event of list.events) {
            seenEventIds.current.add(event.id);
          }
          const caughtUpWarnings = list.events
            .map(liveKeyWarning)
            .filter((warning): warning is LiveKeyWarning => warning !== undefined);
          setLiveKeyWarnings((current) => mergeLiveKeyWarnings(current, caughtUpWarnings));
          setEvents((current) => mergeEvents(current, list.events));
          setLastUpdated(new Date());
        })
        .catch((error: unknown) => {
          if (isUnauthorized(error)) {
            onUnauthorized();
            return;
          }
          setLoadError(error);
        });
    }
    previousConnection.current = connection;
  }, [api, connection, onUnauthorized]);

  useEffect(() => {
    if (!announcement.startsWith("Connected again.")) {
      return;
    }
    const handle = window.setTimeout(() => setAnnouncement(""), 5_000);
    return () => window.clearTimeout(handle);
  }, [announcement]);

  if (auth !== "signed-in") {
    const signInState: SignInState =
      auth === "invalid" || auth === "restarted" || auth === "no-cookie" || auth === "offline"
        ? auth
        : "checking";
    if (auth === "error") {
      return (
        <main className="sign-in-page">
          <div className="sign-in-card">
            <span className="wordmark">Ibeji</span>
            <ErrorPanel
              error={authError}
              title="We couldn't open the dashboard."
              onRetry={() => window.location.reload()}
            />
          </div>
        </main>
      );
    }
    return <SignInPage state={signInState} />;
  }

  const selectedTwinId = twinFromUrl(url);
  const title = pageTitle(pathname);

  return (
    <AppShell
      title={title}
      twins={twins}
      selectedTwinId={selectedTwinId}
      pathname={pathname}
      connection={connection}
      liveKeyWarnings={namedLiveKeyWarnings}
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {connection === "disconnected" && lastUpdated !== undefined ? (
        <p className="last-updated">Last updated at {formatLastUpdated(lastUpdated)}.</p>
      ) : null}
      {loadError === undefined || pathname === "/activity" || pathname === "/data" ? null : (
        <ErrorPanel error={loadError} title="We couldn't load your test session." />
      )}
      {pathname === "/" ? (
        <HomePage
          api={api}
          status={status}
          twins={twins}
          events={events}
          selectedTwinId={selectedTwinId}
          onUnauthorized={onUnauthorized}
        />
      ) : pathname === "/activity" ? (
        <LivePage
          events={events}
          twins={twins}
          selectedTwinId={selectedTwinId}
          connection={connection}
          loading={!eventsLoaded}
          error={loadError}
          onRetry={() => setReloadKey((value) => value + 1)}
        />
      ) : pathname === "/data" ? (
        <DataPage
          api={api}
          twins={twins}
          selectedTwinId={selectedTwinId}
          connection={connection}
          onUnauthorized={onUnauthorized}
        />
      ) : pathname === "/connect" ? (
        <ConnectPage
          api={api}
          twins={twins}
          selectedTwinId={selectedTwinId}
          events={events}
          connection={connection}
          onRefresh={() => setReloadKey((value) => value + 1)}
          onUnauthorized={onUnauthorized}
        />
      ) : pathname === "/webhooks" ? (
        <WebhooksPage
          api={api}
          twins={twins}
          selectedTwinId={selectedTwinId}
          connection={connection}
          onUnauthorized={onUnauthorized}
        />
      ) : pathname === "/failures" ? (
        <FailuresPage
          api={api}
          twins={twins}
          selectedTwinId={selectedTwinId}
          events={events}
          connection={connection}
          onUnauthorized={onUnauthorized}
        />
      ) : pathname === "/scenarios" ? (
        <ScenariosPage
          api={api}
          twins={twins}
          selectedTwinId={selectedTwinId}
          events={events}
          connection={connection}
          onUnauthorized={onUnauthorized}
        />
      ) : (
        <section className="panel empty-page">
          <p className="empty-title">
            {pathname === "/connect"
              ? "The step-by-step guide is coming next."
              : "This page is coming next."}
          </p>
          <p className="help-text">
            {pathname === "/connect"
              ? "For now, copy each twin's app address and test keys from Home."
              : "Home has your test details and latest activity for now."}
          </p>
          <AppLink href={withTwin("/", selectedTwinId)} className="button button-secondary">
            Back to Home
          </AppLink>
        </section>
      )}
    </AppShell>
  );
}
