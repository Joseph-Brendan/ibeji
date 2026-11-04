import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
  EventItem,
  FailureInfo,
  Rule,
  ScenarioInfo,
  ScenarioRule,
  TwinSummary,
} from "../../../src/shared/control.js";
import { type ControlApi, isUnauthorized } from "../api/client";
import type { StreamState } from "../api/sse";
import { parseSettingsSchema } from "../failure-settings";
import { twinLabelClass } from "../twin-label";
import { withTwin } from "../use-url";
import { AppLink } from "./AppLink";
import { ConfirmDialog } from "./ConfirmDialog";
import { ErrorPanel } from "./ErrorPanel";
import { StatusPill } from "./StatusPill";

type ScenariosPageProps = {
  readonly api: ControlApi;
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly events: readonly EventItem[];
  readonly connection: StreamState;
  readonly onUnauthorized: () => void;
};

type PendingRun = {
  readonly scenario: ScenarioInfo;
  readonly twins: readonly string[];
};

const RELEVANT_EVENTS = new Set([
  "scenario-started",
  "scenario-step",
  "scenario-finished",
  "rule-added",
  "rule-removed",
]);

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  if (whole < 60) {
    return `${whole} second${whole === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(whole / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function eventScenarioId(event: EventItem): string | undefined {
  const value = event.details.scenarioId;
  return typeof value === "string" ? value : undefined;
}

function eventTwins(event: EventItem): readonly string[] {
  const value = event.details.twins;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function eventAfterSeconds(event: EventItem): number | undefined {
  const value = event.details.afterSeconds;
  return typeof value === "number" ? value : undefined;
}

function ruleDescription(rule: ScenarioRule, failures: readonly FailureInfo[]): string {
  const failure = failures.find((item) => item.id === rule.failureId);
  const fields =
    failure === undefined ? [] : parseSettingsSchema(failure.settingsSchema, failure.id);
  const settings = fields
    .filter((field) => {
      const value = rule.settings[field.key];
      return value !== undefined && value !== null && value !== "";
    })
    .map((field) => {
      const value = rule.settings[field.key];
      const option = field.options.find((item) => item.value === String(value));
      return `${field.label}: ${option?.label ?? String(value)}`;
    });
  const name = failure?.name ?? rule.failureId;
  return `${name}${settings.length === 0 ? "" : ` (${settings.join(", ")})`}`;
}

function LoadingCards(): ReactNode {
  return (
    <div className="scenario-skeleton" aria-busy="true">
      <span className="sr-only">Loading Scenarios.</span>
      {[1, 2, 3].map((card) => (
        <div key={card} className="skeleton skeleton-failure" />
      ))}
    </div>
  );
}

export function ScenariosPage(props: ScenariosPageProps): ReactNode {
  const [data, setData] = useState<readonly ScenarioInfo[] | undefined>(undefined);
  const [failures, setFailures] = useState<readonly FailureInfo[]>([]);
  const [rules, setRules] = useState<readonly Rule[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const [pendingRun, setPendingRun] = useState<PendingRun | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (initial: boolean): Promise<void> => {
      if (initial) {
        setLoading(true);
      }
      setError(undefined);
      try {
        const [scenarioList, failureList, ruleList] = await Promise.all([
          props.api.getScenarios(),
          props.api.getFailures(),
          props.api.getRules(),
        ]);
        setData(scenarioList.scenarios);
        setActiveId(scenarioList.active);
        setFailures(failureList.failures);
        setRules(ruleList.rules);
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
    [props.api, props.onUnauthorized],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const latestRelevantEventId = useMemo(
    () => props.events.find((event) => RELEVANT_EVENTS.has(event.type))?.id,
    [props.events],
  );
  useEffect(() => {
    if (latestRelevantEventId !== undefined) {
      void load(false);
    }
  }, [latestRelevantEventId, load]);

  useEffect(() => {
    if (toast === "") {
      return;
    }
    const handle = window.setTimeout(() => setToast(""), 5_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const activeScenario = data?.find((scenario) => scenario.id === activeId);
  const startEvent = useMemo(
    () =>
      activeId === null
        ? undefined
        : props.events.find(
            (event) => event.type === "scenario-started" && eventScenarioId(event) === activeId,
          ),
    [activeId, props.events],
  );
  const activeTwinsFromRules = useMemo(
    () =>
      activeId === null
        ? []
        : [
            ...new Set(
              rules.filter((rule) => rule.scenarioId === activeId).flatMap((rule) => rule.twins),
            ),
          ],
    [activeId, rules],
  );
  const activeTwins =
    startEvent === undefined || eventTwins(startEvent).length === 0
      ? activeTwinsFromRules
      : eventTwins(startEvent);
  const activeTwinNames = activeTwins.map(
    (twinId) => props.twins.find((twin) => twin.id === twinId)?.displayName ?? twinId,
  );
  const startEventId = startEvent?.id;
  const stepEvents = useMemo(() => {
    if (activeId === null) {
      return [];
    }
    return props.events.filter(
      (event) =>
        event.type === "scenario-step" &&
        eventScenarioId(event) === activeId &&
        (startEventId === undefined || event.id > startEventId),
    );
  }, [activeId, props.events, startEventId]);
  const hasTimedSteps = activeScenario !== undefined && activeScenario.steps.length > 0;

  useEffect(() => {
    // Restart the progress clock when the active scenario changes.
    void activeId;
    if (!hasTimedSteps) {
      return;
    }
    setNow(Date.now());
    const handle = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(handle);
  }, [hasTimedSteps, activeId]);

  const runScenario = async (scenario: ScenarioInfo, twins: readonly string[]): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await props.api.runScenario(scenario.id, twins);
      setPendingRun(undefined);
      setToast(`${scenario.name} started.`);
      await load(false);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        props.onUnauthorized();
        return;
      }
      setError(caught);
      setPendingRun(undefined);
    } finally {
      setBusy(false);
    }
  };

  const requestRun = (scenario: ScenarioInfo, twins: readonly string[]): void => {
    if (activeId !== null && activeId !== scenario.id) {
      setPendingRun({ scenario, twins });
      return;
    }
    void runScenario(scenario, twins);
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await props.api.stopScenario();
      setToast("Scenario stopped.");
      await load(false);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        props.onUnauthorized();
        return;
      }
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const controlsDisabled = props.connection === "disconnected" || busy;

  return (
    <div className="scenarios-page" data-testid="scenarios-page">
      <p className="page-help">A scenario switches on several failures at once.</p>

      {loading && data === undefined ? null : error !== undefined &&
        data === undefined ? null : activeScenario === undefined ? (
        <div className="empty-state">
          <p className="empty-title">No scenario is running.</p>
          <p className="help-text">Choose a story below.</p>
        </div>
      ) : (
        <section className="active-scenario" aria-labelledby="active-scenario-heading">
          <div className="active-scenario-header">
            <div>
              <div className="section-title-group">
                <StatusPill tone="running">Running</StatusPill>
                <h2 id="active-scenario-heading">{activeScenario.name}</h2>
              </div>
              <p className="help-text">
                Running on{" "}
                {activeTwinNames.length === 0
                  ? "the selected twins"
                  : activeTwinNames.join(" and ")}
                .
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary destructive"
              disabled={controlsDisabled}
              onClick={() => {
                void stop();
              }}
            >
              Stop scenario
            </button>
          </div>

          <div className="progress-block">
            {activeScenario.steps.length === 0 ? (
              <p className="help-text">This scenario has no timed steps.</p>
            ) : (
              <>
                <p className="help-text">
                  {stepEvents.length === 0
                    ? "Waiting for the first timed step."
                    : `${Math.min(stepEvents.length, activeScenario.steps.length)} of ${activeScenario.steps.length} timed steps done.`}
                </p>
                <ol className="progress-list">
                  {activeScenario.steps.map((step, index) => {
                    const completed = stepEvents.some(
                      (event) => eventAfterSeconds(event) === step.afterSeconds,
                    );
                    const rule = activeScenario.rules.find((item) => item.id === step.removeRule);
                    const failure = failures.find((item) => item.id === rule?.failureId);
                    const elapsed =
                      startEvent === undefined ? undefined : (now - startEvent.time) / 1_000;
                    const remaining =
                      elapsed === undefined ? undefined : Math.max(0, step.afterSeconds - elapsed);
                    return (
                      <li key={`${step.removeRule}-${step.afterSeconds}`} className="progress-step">
                        <span>
                          Step {index + 1} of {activeScenario.steps.length}:{" "}
                          {completed
                            ? "done."
                            : `remove the ${failure?.name ?? rule?.failureId ?? step.removeRule} failure after ${formatDuration(step.afterSeconds)}.`}
                        </span>
                        {completed ? (
                          <span className="progress-state done">Done</span>
                        ) : remaining === undefined ? (
                          <span className="progress-state">Waiting</span>
                        ) : (
                          <span className="progress-state">
                            {remaining <= 1 ? "Running now" : `in ${formatDuration(remaining)}`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            <AppLink href={withTwin("/failures", props.selectedTwinId)} className="text-link">
              See failures turned on
            </AppLink>
          </div>
        </section>
      )}

      {props.connection === "disconnected" ? (
        <p className="page-warning">Ibeji is not answering. Scenario controls are paused.</p>
      ) : null}

      {toast === "" ? null : (
        <p className="toast" role="status" aria-live="polite">
          {toast}
        </p>
      )}

      {error === undefined ? null : (
        <ErrorPanel
          error={error}
          title="We couldn't run that scenario."
          onRetry={() => {
            void load(false);
          }}
        />
      )}

      {loading && data === undefined ? (
        <LoadingCards />
      ) : data === undefined ? null : (
        data
          .filter(
            (scenario) =>
              props.selectedTwinId === undefined || scenario.twins.includes(props.selectedTwinId),
          )
          .map((scenario) => (
            <ScenarioCard
              key={`${scenario.id}-${props.selectedTwinId ?? "all"}`}
              scenario={scenario}
              twins={props.twins}
              failures={failures}
              selectedTwinId={props.selectedTwinId}
              active={scenario.id === activeId}
              busy={busy}
              disabled={controlsDisabled}
              onRun={requestRun}
            />
          ))
      )}

      <ConfirmDialog
        open={pendingRun !== undefined}
        title={`Run ${pendingRun?.scenario.name ?? "this scenario"}?`}
        body="This stops the running scenario first. Its rules are removed."
        confirmLabel="Run scenario"
        busy={busy}
        onConfirm={() => {
          if (pendingRun !== undefined) {
            void runScenario(pendingRun.scenario, pendingRun.twins);
          }
        }}
        onCancel={() => setPendingRun(undefined)}
      />
    </div>
  );
}

function ScenarioCard(props: {
  readonly scenario: ScenarioInfo;
  readonly twins: readonly TwinSummary[];
  readonly failures: readonly FailureInfo[];
  readonly selectedTwinId: string | undefined;
  readonly active: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onRun: (scenario: ScenarioInfo, twins: readonly string[]) => void;
}): ReactNode {
  const supported = props.scenario.twins
    .map((twinId) => props.twins.find((twin) => twin.id === twinId))
    .filter((twin): twin is TwinSummary => twin !== undefined);
  const [selected, setSelected] = useState<readonly string[]>(() => {
    if (
      props.selectedTwinId !== undefined &&
      supported.some((twin) => twin.id === props.selectedTwinId)
    ) {
      return supported.some((twin) => twin.id === props.selectedTwinId && twin.running)
        ? [props.selectedTwinId]
        : [];
    }
    return supported.filter((twin) => twin.running).map((twin) => twin.id);
  });

  return (
    <article
      className={`scenario-card${props.active ? " scenario-card-active" : ""}`}
      data-testid={`scenario-${props.scenario.id}`}
    >
      <div className="scenario-card-header">
        <div>
          <h2>{props.scenario.name}</h2>
          <p className="scenario-supported">
            Supported twins: {supported.map((twin) => twin.displayName).join(", ") || "none"}
          </p>
        </div>
        {props.active ? <StatusPill tone="running">Running</StatusPill> : null}
      </div>

      <p className="scenario-story">{props.scenario.story}</p>

      <div className="scenario-rules">
        <h3>What it switches on</h3>
        <ul>
          {props.scenario.rules.map((rule) => (
            <li key={rule.id}>{ruleDescription(rule, props.failures)}</li>
          ))}
        </ul>
      </div>

      <fieldset className="form-group" disabled={props.disabled || props.busy || props.active}>
        <legend>Twins for this run</legend>
        <div className="twin-choice-list">
          {supported.map((twin) => (
            <div
              key={twin.id}
              className="twin-choice"
              title={
                twin.running
                  ? undefined
                  : `${twin.displayName} is off. Start it with ibeji start --twins ${twin.id} to run this scenario on ${twin.displayName}.`
              }
            >
              <label className="choice-label">
                <input
                  type="checkbox"
                  checked={selected.includes(twin.id)}
                  disabled={!twin.running || props.disabled || props.busy || props.active}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, twin.id]
                        : current.filter((id) => id !== twin.id),
                    );
                  }}
                />
                <span className={`twin-badge ${twinLabelClass(twin.labelColourToken)}`}>
                  {twin.displayName}
                </span>
              </label>
              {twin.running ? null : (
                <p className="choice-help">
                  {twin.displayName} is off. Start it with ibeji start --twins {twin.id} to run this
                  scenario on {twin.displayName}.
                </p>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      <div className="scenario-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={props.disabled || props.busy || props.active || selected.length === 0}
          onClick={() => props.onRun(props.scenario, selected)}
        >
          {props.active ? "Running" : props.busy ? "Please wait..." : "Run scenario"}
        </button>
        {selected.length === 0 ? (
          <p className="field-help">Choose at least one running twin.</p>
        ) : null}
      </div>
    </article>
  );
}
