import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
  StateCollection,
  StateRecord,
  StateResponse,
  TwinSummary,
} from "../../../src/shared/control.js";
import { type ControlApi, isUnauthorized } from "../api/client";
import type { StreamState } from "../api/sse";
import { formatMinorUnits } from "../money";
import { twinLabelClass } from "../twin-label";
import { ConfirmDialog } from "./ConfirmDialog";
import { CopyButton } from "./CopyButton";
import { ErrorPanel } from "./ErrorPanel";
import { StatusPill } from "./StatusPill";

type DataPageProps = {
  readonly api: ControlApi;
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly connection: StreamState;
  readonly onUnauthorized: () => void;
};

type ResetTarget = { readonly kind: "twin"; readonly twin: TwinSummary } | { readonly kind: "all" };

const TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return displayValue(value);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateFormatter.format(date);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value, null, 2) ?? "None";
}

function isIdentifierKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower === "id" || lower.endsWith("id") || lower.includes("reference") || lower.endsWith("code")
  );
}

function collectionCurrency(collection: StateCollection, record: StateRecord): string {
  const currencyColumn = collection.columns.find(
    (column) => column.key.toLowerCase() === "currency",
  );
  const value = currencyColumn === undefined ? record.currency : record[currencyColumn.key];
  return typeof value === "string" ? value : "";
}

function Cell(props: {
  readonly twin: TwinSummary;
  readonly collection: StateCollection;
  readonly column: StateCollection["columns"][number];
  readonly record: StateRecord;
}): ReactNode {
  const value = props.record[props.column.key];
  if (props.column.kind === "money") {
    if (typeof value !== "number" && typeof value !== "bigint") {
      return <>{displayValue(value)}</>;
    }
    const display = formatMinorUnits(
      value,
      collectionCurrency(props.collection, props.record),
      props.twin.currencyRules,
    );
    return (
      <span className="money-cell">
        <span className="money-value">{display.text}</span>
        {display.known ? null : (
          <span className="money-help">Ibeji does not know this currency's decimal places.</span>
        )}
      </span>
    );
  }
  if (props.column.kind === "date") {
    return <>{formatDate(value)}</>;
  }
  if (
    isIdentifierKey(props.column.key) &&
    (typeof value === "string" || typeof value === "number")
  ) {
    const text = String(value);
    return (
      <span className="id-cell">
        <code>{text}</code>
        <CopyButton value={text} label={`${props.column.label} for ${props.twin.displayName}`} />
      </span>
    );
  }
  return <>{displayValue(value)}</>;
}

function RecordsTable(props: {
  readonly twin: TwinSummary;
  readonly collection: StateCollection;
}): ReactNode {
  const { collection, twin } = props;
  return (
    <section
      className="record-table-block"
      aria-labelledby={`collection-${twin.id}-${collection.id}`}
    >
      <div className="record-table-heading">
        <h4 id={`collection-${twin.id}-${collection.id}`}>{collection.label}</h4>
        <span className="record-count">
          {collection.records.length} {collection.records.length === 1 ? "record" : "records"}
        </span>
      </div>
      <p className="table-note">Times shown in {TIME_ZONE}.</p>
      <section className="table-scroll" aria-label={`${collection.label} table`}>
        <table className="records-table">
          <caption className="sr-only">{collection.label}</caption>
          <thead>
            <tr>
              {collection.columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {collection.records.length === 0 ? (
              <tr>
                <td className="empty-cell" colSpan={collection.columns.length}>
                  <p className="empty-title">No records yet.</p>
                  <p className="help-text">Make a test request to see records here.</p>
                </td>
              </tr>
            ) : (
              collection.records.map((record, index) => (
                <tr key={String(record.id ?? index)}>
                  {collection.columns.map((column) => (
                    <td key={column.key}>
                      <Cell twin={twin} collection={collection} column={column} record={record} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function LoadingTables(): ReactNode {
  return (
    <div className="data-skeleton" aria-busy="true">
      <span className="sr-only">Loading Data.</span>
      <div className="skeleton skeleton-table" />
      <div className="skeleton skeleton-table" />
    </div>
  );
}

export function DataPage(props: DataPageProps): ReactNode {
  const selectedTwin = useMemo(
    () =>
      props.selectedTwinId === undefined
        ? undefined
        : props.twins.find((twin) => twin.id === props.selectedTwinId),
    [props.selectedTwinId, props.twins],
  );
  const targetTwins = useMemo(() => {
    if (props.selectedTwinId !== undefined) {
      return selectedTwin?.running === true ? [selectedTwin] : [];
    }
    return props.twins.filter((twin) => twin.running);
  }, [props.selectedTwinId, props.twins, selectedTwin]);

  const [states, setStates] = useState<Readonly<Record<string, StateResponse>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const [resetTarget, setResetTarget] = useState<ResetTarget | undefined>(undefined);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState("");

  const load = useCallback(async (): Promise<void> => {
    if (targetTwins.length === 0) {
      setStates({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const responses = await Promise.all(
        targetTwins.map(async (twin) => [twin.id, await props.api.getState(twin.id)] as const),
      );
      setStates(Object.fromEntries(responses));
    } catch (loadError) {
      if (isUnauthorized(loadError)) {
        props.onUnauthorized();
        return;
      }
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [props.api, props.onUnauthorized, targetTwins]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (toast === "") {
      return;
    }
    const handle = window.setTimeout(() => setToast(""), 5_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const reset = async (): Promise<void> => {
    if (resetTarget === undefined) {
      return;
    }
    setResetting(true);
    try {
      await props.api.resetState(resetTarget.kind === "twin" ? resetTarget.twin.id : undefined);
      setResetTarget(undefined);
      setToast("Records reset. Queued webhooks were marked abandoned.");
      void load();
    } catch (resetError) {
      if (isUnauthorized(resetError)) {
        props.onUnauthorized();
        return;
      }
      setError(resetError);
      setResetTarget(undefined);
    } finally {
      setResetting(false);
    }
  };

  const confirmation =
    resetTarget === undefined
      ? undefined
      : resetTarget.kind === "twin"
        ? {
            title: `Reset ${resetTarget.twin.displayName} records?`,
            body: `This deletes every payment, refund, transfer, recipient and bank record for ${resetTarget.twin.displayName}. It cancels queued and scheduled webhooks and marks them abandoned. It keeps failure rules, scenarios, webhook addresses, test keys and events. This cannot be undone.`,
            confirmLabel: "Reset records",
          }
        : {
            title: "Reset all twin records?",
            body: "This deletes every record for every running twin. It cancels queued and scheduled webhooks and marks them abandoned. It keeps failure rules, scenarios, webhook addresses, test keys and events. This cannot be undone.",
            confirmLabel: "Reset all records",
          };

  const resetDisabled = resetting || props.connection === "disconnected";

  return (
    <div className="data-page" data-testid="data-page">
      <p className="page-help">This page shows the records each twin has created.</p>

      {targetTwins.length > 0 ? (
        <section className="reset-bar" aria-label="Reset records">
          <div>
            <p className="reset-title">
              {props.selectedTwinId === undefined
                ? "Reset all records"
                : `Reset ${selectedTwin?.displayName ?? "this twin"} records`}
            </p>
            <p className="help-text">
              Deletes test records and stops waiting webhooks. Keys, failures, addresses and events
              stay.
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary destructive"
            disabled={resetDisabled}
            onClick={() =>
              setResetTarget(
                props.selectedTwinId === undefined
                  ? { kind: "all" }
                  : selectedTwin === undefined
                    ? undefined
                    : { kind: "twin", twin: selectedTwin },
              )
            }
          >
            {props.selectedTwinId === undefined
              ? "Reset all records"
              : `Reset ${selectedTwin?.displayName ?? "records"}`}
          </button>
        </section>
      ) : null}

      {toast === "" ? null : (
        <p className="toast" role="status" aria-live="polite">
          {toast}
        </p>
      )}

      {props.connection === "disconnected" ? (
        <p className="data-warning">Ibeji is not answering. Records may be out of date.</p>
      ) : null}

      {error === undefined ? null : (
        <ErrorPanel
          error={error}
          title="We couldn't load those records."
          onRetry={() => {
            void load();
          }}
        />
      )}

      {loading && targetTwins.length > 0 && Object.keys(states).length === 0 ? (
        <LoadingTables />
      ) : error !== undefined && Object.keys(states).length === 0 ? null : selectedTwin !==
          undefined && !selectedTwin.running ? (
        <div className="empty-state" data-testid="data-twin-off">
          <p className="empty-title">{selectedTwin.displayName} is off.</p>
          <p className="help-text">Start it to see its records.</p>
          <p className="help-text">Run ibeji start --twins {selectedTwin.id} to turn it on.</p>
        </div>
      ) : targetTwins.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No twins are running.</p>
          <p className="help-text">Start Ibeji with ibeji start to turn them on.</p>
        </div>
      ) : (
        targetTwins.map((twin) => {
          const state = states[twin.id];
          return (
            <section key={twin.id} className="data-twin" data-testid={`data-twin-${twin.id}`}>
              <div className="data-twin-header">
                <span className={`twin-badge ${twinLabelClass(twin.labelColourToken)}`}>
                  {twin.displayName}
                </span>
                <StatusPill tone="running">Running</StatusPill>
                {props.selectedTwinId === undefined ? (
                  <button
                    type="button"
                    className="button button-small destructive"
                    disabled={resetDisabled}
                    onClick={() => setResetTarget({ kind: "twin", twin })}
                  >
                    Reset {twin.displayName} records
                  </button>
                ) : null}
              </div>

              {state === undefined ? (
                <p className="help-text">Loading records...</p>
              ) : (
                state.collections.map((collection) => (
                  <RecordsTable key={collection.id} twin={twin} collection={collection} />
                ))
              )}
            </section>
          );
        })
      )}

      <ConfirmDialog
        open={confirmation !== undefined}
        title={confirmation?.title ?? ""}
        body={confirmation?.body ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "Reset records"}
        busy={resetting}
        onConfirm={() => {
          void reset();
        }}
        onCancel={() => setResetTarget(undefined)}
      />
    </div>
  );
}
