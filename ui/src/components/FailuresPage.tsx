import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type { FailureInfo, Rule, ScenarioInfo, TwinSummary } from "../../../src/shared/control.js";
import { type ControlApi, isUnauthorized } from "../api/client";
import type { StreamState } from "../api/sse";
import {
  defaultSettingsValues,
  parseSettingsSchema,
  type SettingsField,
  settingsFromValues,
  settingsValuesFromRule,
  validateSettings,
} from "../failure-settings";
import { twinLabelClass } from "../twin-label";
import { withTwin } from "../use-url";
import { AppLink } from "./AppLink";
import { ConfirmDialog } from "./ConfirmDialog";
import { ErrorPanel } from "./ErrorPanel";
import { StatusPill } from "./StatusPill";

type FailuresPageProps = {
  readonly api: ControlApi;
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly events: readonly { readonly id: number; readonly type: string }[];
  readonly connection: StreamState;
  readonly onUnauthorized: () => void;
};

type Data = {
  readonly failures: readonly FailureInfo[];
  readonly rules: readonly Rule[];
  readonly scenarios: readonly ScenarioInfo[];
  readonly active: string | null;
};

type ClearTarget = { readonly kind: "all" } | { readonly kind: "twin"; readonly twin: TwinSummary };

const RELEVANT_EVENTS = new Set([
  "rule-added",
  "rule-removed",
  "failure-fired",
  "scenario-started",
  "scenario-step",
  "scenario-finished",
]);

function sourceLabel(source: "docs" | "real-story" | "assumed"): string {
  switch (source) {
    case "docs":
      return "From the service docs";
    case "real-story":
      return "From a real story";
    case "assumed":
      return "Assumed: not confirmed by the service's documentation.";
  }
}

function sourceShort(source: "docs" | "real-story" | "assumed"): string {
  switch (source) {
    case "docs":
      return "service docs";
    case "real-story":
      return "real story";
    case "assumed":
      return "assumed";
  }
}

function failureSource(failure: FailureInfo): {
  readonly assumed: boolean;
  readonly label: string;
} {
  const assumed = failure.support.some((item) => item.source === "assumed");
  const real = failure.support.some((item) => item.source === "real-story");
  const label = assumed
    ? sourceLabel("assumed")
    : real
      ? sourceLabel("real-story")
      : sourceLabel("docs");
  return { assumed, label };
}

function actionLabel(twin: TwinSummary | undefined, actionId: string): string {
  return twin?.actions.find((action) => action.id === actionId)?.summary ?? actionId;
}

function SettingsInput(props: {
  readonly failureId: string;
  readonly field: SettingsField;
  readonly value: string;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const id = `failure-${props.failureId}-${props.field.key}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = props.error === undefined ? helpId : `${helpId} ${errorId}`;

  if (props.field.kind === "select") {
    return (
      <div className="settings-field">
        <label className="field-label" htmlFor={id}>
          {props.field.label}
          {props.field.required ? (
            <span className="required-mark" aria-hidden="true">
              {" "}
              *
            </span>
          ) : null}
        </label>
        <select
          id={id}
          className="select"
          value={props.value}
          disabled={props.disabled}
          aria-invalid={props.error !== undefined}
          aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p id={helpId} className="field-help">
          {props.field.help}
        </p>
        {props.error === undefined ? null : (
          <p id={errorId} className="field-error">
            {props.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="settings-field">
      <label className="field-label" htmlFor={id}>
        {props.field.label}
        {props.field.required ? <span className="required-mark"> *</span> : null}
      </label>
      <input
        id={id}
        className="text-input"
        type={props.field.kind === "number" ? "number" : "text"}
        inputMode={props.field.kind === "number" ? "numeric" : undefined}
        min={props.field.min}
        max={props.field.max}
        step={props.field.kind === "number" ? 1 : undefined}
        value={props.value}
        disabled={props.disabled}
        aria-invalid={props.error !== undefined}
        aria-describedby={describedBy}
        placeholder={
          props.field.nullable
            ? props.field.key === "times"
              ? "Every time while on"
              : "Until switched off"
            : undefined
        }
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p id={helpId} className="field-help">
        {props.field.help}
      </p>
      {props.error === undefined ? null : (
        <p id={errorId} className="field-error">
          {props.error}
        </p>
      )}
    </div>
  );
}

type FailureCardProps = {
  readonly api: ControlApi;
  readonly failure: FailureInfo;
  readonly twins: readonly TwinSummary[];
  readonly rules: readonly Rule[];
  readonly selectedTwinId: string | undefined;
  readonly activeScenarioName: string | undefined;
  readonly disabled: boolean;
  readonly onUnauthorized: () => void;
  readonly onChanged: (message: string) => void;
};

function FailureCard(props: FailureCardProps): ReactNode {
  const baseId = useId();
  const supportByTwin = useMemo(
    () => new Map(props.failure.support.map((item) => [item.twin, item])),
    [props.failure.support],
  );
  const manualRules = useMemo(
    () =>
      props.rules.filter(
        (rule) => rule.failureId === props.failure.id && rule.scenarioId === undefined,
      ),
    [props.failure.id, props.rules],
  );
  const scenarioRules = useMemo(
    () =>
      props.rules.filter(
        (rule) => rule.failureId === props.failure.id && rule.scenarioId !== undefined,
      ),
    [props.failure.id, props.rules],
  );
  const manualTwins = useMemo(
    () => new Set(manualRules.flatMap((rule) => rule.twins)),
    [manualRules],
  );
  const scenarioTwins = useMemo(
    () => new Set(scenarioRules.flatMap((rule) => rule.twins)),
    [scenarioRules],
  );
  const activeTwins = useMemo(
    () => [...new Set([...manualTwins, ...scenarioTwins])],
    [manualTwins, scenarioTwins],
  );
  const supportedRunning = props.twins
    .filter((twin) => supportByTwin.has(twin.id) && twin.running)
    .map((twin) => twin.id);
  const [selectedTwins, setSelectedTwins] = useState<readonly string[]>(() => {
    if (props.selectedTwinId !== undefined && supportByTwin.has(props.selectedTwinId)) {
      return props.twins.some((twin) => twin.id === props.selectedTwinId && twin.running)
        ? [props.selectedTwinId]
        : [];
    }
    return manualTwins.size === 0 ? supportedRunning : [...manualTwins];
  });
  const fields = useMemo(
    () => parseSettingsSchema(props.failure.settingsSchema, props.failure.id),
    [props.failure.id, props.failure.settingsSchema],
  );
  const firstManualRule = manualRules[0];
  const [values, setValues] = useState<Readonly<Record<string, string>>>(() =>
    firstManualRule === undefined
      ? defaultSettingsValues(fields)
      : settingsValuesFromRule(fields, firstManualRule.settings),
  );
  const [action, setAction] = useState(firstManualRule?.actions ?? "");
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const actionOptions = useMemo(() => {
    const supported = selectedTwins
      .map((twinId) => supportByTwin.get(twinId)?.actions)
      .filter((actions): actions is readonly string[] => actions !== undefined);
    const first = supported[0];
    if (first === undefined) {
      return [];
    }
    return first.filter((actionId) => supported.every((actions) => actions.includes(actionId)));
  }, [selectedTwins, supportByTwin]);

  useEffect(() => {
    if (action !== "" && !actionOptions.includes(action)) {
      setAction("");
    }
  }, [action, actionOptions]);

  const source = failureSource(props.failure);
  const allSelectedManual =
    selectedTwins.length > 0 && selectedTwins.every((twinId) => manualTwins.has(twinId));
  const someSelectedManual = selectedTwins.some((twinId) => manualTwins.has(twinId));
  const scenarioSelected = selectedTwins.some((twinId) => scenarioTwins.has(twinId));
  const selectedNames = selectedTwins.map(
    (twinId) => props.twins.find((twin) => twin.id === twinId)?.displayName ?? twinId,
  );
  const switchLabel = scenarioSelected
    ? "Managed by scenario"
    : selectedTwins.length === 0
      ? "Switch on"
      : `${allSelectedManual ? "Switch off" : "Switch on"} ${
          selectedTwins.length === 1 ? selectedNames[0] : `for ${selectedTwins.length} twins`
        }`;
  const controlsDisabled = props.disabled || busy || selectedTwins.length === 0;
  const switchDisabled = controlsDisabled || scenarioSelected;
  const usedUp = (twinId: string): boolean => {
    const rule = manualRules.find((item) => item.twins.includes(twinId));
    if (rule === undefined) {
      return false;
    }
    const limit = rule.settings.times;
    return (
      (rule.failureId === "server-error" || rule.failureId === "rate-limited") &&
      typeof limit === "number" &&
      (rule.counters[twinId] ?? 0) >= limit
    );
  };

  const validate = (): boolean => {
    const errors = validateSettings(fields, values);
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const removeManualRulesForSelected = async (): Promise<void> => {
    const selected = new Set(selectedTwins);
    for (const rule of manualRules) {
      const remaining = rule.twins.filter((twinId) => !selected.has(twinId));
      if (remaining.length === rule.twins.length) {
        continue;
      }
      if (remaining.length > 0) {
        await props.api.addRule({
          failureId: rule.failureId,
          twins: remaining,
          settings: rule.settings,
          ...(rule.actions === undefined ? {} : { actions: rule.actions }),
        });
      }
      await props.api.deleteRule(rule.id);
    }
  };

  const handleError = (caught: unknown): void => {
    if (isUnauthorized(caught)) {
      props.onUnauthorized();
      return;
    }
    setError(caught);
  };

  const addRuleForTwin = async (twinId: string): Promise<void> => {
    await props.api.addRule({
      failureId: props.failure.id,
      twins: [twinId],
      settings: settingsFromValues(fields, values),
      ...(action === "" ? {} : { actions: action }),
    });
  };

  const toggle = async (): Promise<void> => {
    if (!validate()) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (allSelectedManual) {
        await removeManualRulesForSelected();
        props.onChanged(`${props.failure.name} switched off.`);
      } else {
        const existing = new Set(manualTwins);
        for (const twinId of selectedTwins.filter((id) => !existing.has(id))) {
          await addRuleForTwin(twinId);
        }
        props.onChanged(`${props.failure.name} switched on.`);
      }
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = async (): Promise<void> => {
    if (!validate()) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      for (const twinId of selectedTwins) {
        await addRuleForTwin(twinId);
      }
      await removeManualRulesForSelected();
      props.onChanged(`${props.failure.name} settings saved.`);
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={`failure-card${activeTwins.length > 0 ? " failure-card-active" : ""}`}
      data-testid={`failure-${props.failure.id}`}
    >
      <div className="failure-card-header">
        <div>
          <h2>{props.failure.name}</h2>
          <p className={`source-label${source.assumed ? " source-assumed" : ""}`}>{source.label}</p>
          <p className="source-detail">
            {props.failure.support
              .map(
                (item) =>
                  `${
                    props.twins.find((twin) => twin.id === item.twin)?.displayName ?? item.twin
                  }: ${sourceShort(item.source)}`,
              )
              .join(" · ")}
          </p>
        </div>
        <StatusPill tone={activeTwins.length > 0 ? "running" : "off"}>
          {activeTwins.length > 0 ? "On" : "Off"}
        </StatusPill>
      </div>

      <p className="failure-real-life">{props.failure.realLife}</p>

      <details className="check-disclosure">
        <summary>What to check in your app</summary>
        <p>{props.failure.whatToCheck}</p>
      </details>

      {activeTwins.length === 0 ? null : (
        <ul className="active-twin-list" aria-label="Active on">
          {activeTwins.map((twinId) => {
            const twin = props.twins.find((item) => item.id === twinId);
            return (
              <li key={twinId} className="active-twin">
                <span
                  className={`twin-badge ${twinLabelClass(twin?.labelColourToken ?? "unknown")}`}
                >
                  {twin?.displayName ?? twinId}
                </span>
                <span>On</span>
                {usedUp(twinId) ? <span className="used-up">Used up</span> : null}
                {scenarioTwins.has(twinId) ? (
                  <span className="scenario-owned">
                    From scenario: {props.activeScenarioName ?? "running scenario"}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="failure-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
        }}
      >
        <fieldset className="form-group" disabled={props.disabled || busy}>
          <legend>Settings</legend>
          <div className="settings-grid">
            {fields.map((field) => (
              <SettingsInput
                key={`${baseId}-${field.key}`}
                failureId={props.failure.id}
                field={field}
                value={values[field.key] ?? ""}
                error={fieldErrors[field.key]}
                disabled={props.disabled || busy}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [field.key]: value }));
                  setFieldErrors((current) => {
                    const next = { ...current };
                    delete next[field.key];
                    return next;
                  });
                }}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="form-group" disabled={props.disabled || busy}>
          <legend>Twins</legend>
          <div className="twin-choice-list">
            {props.twins.map((twin) => {
              const support = supportByTwin.get(twin.id);
              const unsupported = support === undefined;
              const off = support !== undefined && !twin.running;
              const checked = selectedTwins.includes(twin.id);
              const reason = unsupported
                ? `${twin.displayName} does not support this failure.`
                : off
                  ? `Start ${twin.displayName} with ibeji start --twins ${twin.id} to use it.`
                  : undefined;
              return (
                <div key={twin.id} className="twin-choice" title={reason}>
                  <label className="choice-label">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={unsupported || off || props.disabled || busy}
                      onChange={(event) => {
                        setSelectedTwins((current) =>
                          event.target.checked
                            ? [...current, twin.id]
                            : current.filter((id) => id !== twin.id),
                        );
                        setAction("");
                      }}
                    />
                    <span>{twin.displayName}</span>
                  </label>
                  {unsupported ? (
                    <p className="choice-help">{twin.displayName} does not support this failure.</p>
                  ) : off ? (
                    <p className="choice-help">
                      Start {twin.displayName} with ibeji start --twins {twin.id} to use it.
                    </p>
                  ) : (
                    <p className="choice-help">{sourceShort(support.source)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="action-field">
          <label className="field-label" htmlFor={`${baseId}-actions`}>
            Actions
          </label>
          <select
            id={`${baseId}-actions`}
            className="select"
            value={action}
            disabled={props.disabled || busy || actionOptions.length === 0}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="">All supported actions</option>
            {actionOptions.map((actionId) => (
              <option key={actionId} value={actionId}>
                {actionLabel(
                  props.twins.find((twin) => twin.id === selectedTwins[0]),
                  actionId,
                )}
              </option>
            ))}
          </select>
          <p className="field-help">
            {selectedTwins.length === 0
              ? "Choose a twin first."
              : "Leave it on all supported actions, or choose one action."}
          </p>
        </div>

        <div className="failure-actions">
          <button
            type="button"
            role="switch"
            aria-checked={allSelectedManual}
            className={`switch${allSelectedManual ? " switch-on" : ""}`}
            disabled={switchDisabled}
            onClick={() => {
              void toggle();
            }}
          >
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            <span>{busy ? "Please wait..." : switchLabel}</span>
          </button>
          {allSelectedManual && !scenarioSelected ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={controlsDisabled}
              onClick={() => {
                void saveChanges();
              }}
            >
              Save changes
            </button>
          ) : null}
          {someSelectedManual && !allSelectedManual ? (
            <span className="field-help">
              Switch on adds the selected twins that are not on yet.
            </span>
          ) : null}
        </div>

        {scenarioSelected ? (
          <p className="field-help">
            A running scenario owns this failure for the selected twin. Stop it on Scenarios to
            change it.
          </p>
        ) : null}
      </form>

      {error === undefined ? null : (
        <ErrorPanel error={error} title="We couldn't save this failure." />
      )}
    </article>
  );
}

function LoadingCards(): ReactNode {
  return (
    <div className="failure-skeleton" aria-busy="true">
      <span className="sr-only">Loading Failures.</span>
      {[1, 2, 3].map((card) => (
        <div key={card} className="skeleton skeleton-failure" />
      ))}
    </div>
  );
}

export function FailuresPage(props: FailuresPageProps): ReactNode {
  const [data, setData] = useState<Data | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const [clearTarget, setClearTarget] = useState<ClearTarget | undefined>(undefined);
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(
    async (initial: boolean): Promise<void> => {
      if (initial) {
        setLoading(true);
      }
      setError(undefined);
      try {
        const [failureList, ruleList, scenarioList] = await Promise.all([
          props.api.getFailures(),
          props.api.getRules(),
          props.api.getScenarios(),
        ]);
        setData({
          failures: failureList.failures,
          rules: ruleList.rules,
          scenarios: scenarioList.scenarios,
          active: scenarioList.active,
        });
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

  const activeScenario = data?.scenarios.find((scenario) => scenario.id === data.active);
  const activeScenarioName = activeScenario?.name;
  const activeScenarioTwinNames = [
    ...new Set(
      (data?.rules ?? [])
        .filter((rule) => data?.active !== null && rule.scenarioId === data?.active)
        .flatMap((rule) => rule.twins),
    ),
  ].map((twinId) => props.twins.find((twin) => twin.id === twinId)?.displayName ?? twinId);
  const manualFailures = new Set(
    (data?.rules ?? [])
      .filter((rule) => rule.scenarioId === undefined)
      .map((rule) => rule.failureId),
  ).size;
  const visibleFailures = (data?.failures ?? []).filter(
    (failure) =>
      props.selectedTwinId === undefined ||
      failure.support.some((item) => item.twin === props.selectedTwinId),
  );
  const rulesRevision = useMemo(
    () =>
      JSON.stringify(
        (data?.rules ?? []).map((rule) => [
          rule.id,
          rule.failureId,
          rule.twins,
          rule.settings,
          rule.actions,
          rule.scenarioId,
        ]),
      ),
    [data?.rules],
  );

  const clear = async (): Promise<void> => {
    if (clearTarget === undefined) {
      return;
    }
    setClearing(true);
    try {
      await props.api.clearRules(clearTarget.kind === "twin" ? clearTarget.twin.id : undefined);
      setClearTarget(undefined);
      setToast(
        clearTarget.kind === "twin"
          ? `${clearTarget.twin.displayName} failures cleared.`
          : "All failures cleared.",
      );
      await load(false);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        props.onUnauthorized();
        return;
      }
      setError(caught);
      setClearTarget(undefined);
    } finally {
      setClearing(false);
    }
  };

  const confirmation =
    clearTarget === undefined
      ? undefined
      : clearTarget.kind === "all"
        ? {
            title: "Clear all failures?",
            body: "This removes every failure rule and stops the running scenario. Records, webhook addresses, test keys and events stay.",
            confirmLabel: "Clear all failures",
          }
        : {
            title: `Clear ${clearTarget.twin.displayName} failures?`,
            body: `This removes every failure rule for ${clearTarget.twin.displayName}, including any scenario rule for this twin. Other twins keep their rules. Records, webhook addresses, test keys and events stay.`,
            confirmLabel: `Clear ${clearTarget.twin.displayName} failures`,
          };

  return (
    <div className="failures-page" data-testid="failures-page">
      <p className="page-help">Switch on a realistic failure and set how it behaves.</p>

      {activeScenarioName === undefined ? null : (
        <div className="scenario-banner" role="status">
          <p>
            <strong>{activeScenarioName}</strong> is running
            {activeScenarioTwinNames.length === 0
              ? ""
              : ` on ${activeScenarioTwinNames.join(" and ")}`}
            . This scenario owns some failures. Stop it on Scenarios to change them.
          </p>
          <AppLink href={withTwin("/scenarios", props.selectedTwinId)} className="text-link">
            Open Scenarios
          </AppLink>
        </div>
      )}

      {props.connection === "disconnected" ? (
        <p className="page-warning">Ibeji is not answering. Changes are paused until it returns.</p>
      ) : null}

      {data === undefined ? null : (
        <>
          <p className="summary-line">
            {manualFailures === 0
              ? "No manual failures are on."
              : `${manualFailures} manual failure${manualFailures === 1 ? "" : "s"} ${
                  manualFailures === 1 ? "is" : "are"
                } on.`}
          </p>
          {manualFailures === 0 ? (
            <p className="help-text">Choose a card below to switch one on.</p>
          ) : null}
        </>
      )}

      {toast === "" ? null : (
        <p className="toast" role="status" aria-live="polite">
          {toast}
        </p>
      )}

      {error === undefined || data !== undefined ? null : (
        <ErrorPanel
          error={error}
          title="We couldn't load failures."
          onRetry={() => {
            void load(true);
          }}
        />
      )}

      {loading && data === undefined ? (
        <LoadingCards />
      ) : data === undefined ? null : (
        <>
          {visibleFailures.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">No failures match this twin.</p>
              <p className="help-text">Choose All twins to see every failure.</p>
            </div>
          ) : (
            visibleFailures.map((failure) => (
              <FailureCard
                key={`${failure.id}-${props.selectedTwinId ?? "all"}-${rulesRevision}`}
                api={props.api}
                failure={failure}
                twins={props.twins}
                rules={data.rules}
                selectedTwinId={props.selectedTwinId}
                activeScenarioName={activeScenarioName}
                disabled={props.connection === "disconnected"}
                onUnauthorized={props.onUnauthorized}
                onChanged={(message) => {
                  setToast(message);
                  void load(false);
                }}
              />
            ))
          )}

          <section className="clear-panel" aria-labelledby="clear-failures-heading">
            <div>
              <h2 id="clear-failures-heading">Clear failures</h2>
              <p className="help-text">
                Clearing removes rules only. Records, webhook addresses, test keys and events stay.
              </p>
            </div>
            <div className="clear-actions">
              {props.twins
                .filter((twin) => twin.running)
                .map((twin) => (
                  <button
                    key={twin.id}
                    type="button"
                    className="button button-secondary destructive"
                    disabled={props.connection === "disconnected" || clearing}
                    onClick={() => setClearTarget({ kind: "twin", twin })}
                  >
                    Clear {twin.displayName} failures
                  </button>
                ))}
              <button
                type="button"
                className="button button-secondary destructive"
                disabled={props.connection === "disconnected" || clearing}
                onClick={() => setClearTarget({ kind: "all" })}
              >
                Clear all failures
              </button>
            </div>
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmation !== undefined}
        title={confirmation?.title ?? ""}
        body={confirmation?.body ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "Clear failures"}
        busy={clearing}
        onConfirm={() => {
          void clear();
        }}
        onCancel={() => setClearTarget(undefined)}
      />
    </div>
  );
}
