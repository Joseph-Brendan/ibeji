import type { ReactNode } from "react";
import { ApiError } from "../api/client";

type ErrorPanelProps = {
  readonly error: unknown;
  readonly title?: string;
  readonly onRetry?: () => void;
};

export function ErrorPanel(props: ErrorPanelProps): ReactNode {
  const error = props.error;
  const isApi = error instanceof ApiError;
  const heading = props.title ?? "Something went wrong.";
  const what = isApi ? error.what : "The dashboard could not finish that action.";
  const why = isApi ? error.why : "It ran into a problem it did not expect.";
  const fix = isApi
    ? error.fix
    : "Try again. If the problem continues, restart Ibeji with ibeji start.";

  return (
    <section className="error-panel" role="alert" aria-labelledby="error-panel-heading">
      <h2 id="error-panel-heading" className="section-title">
        {heading}
      </h2>
      <dl className="error-details">
        <dt>What happened</dt>
        <dd>{what}</dd>
        <dt>Why it happened</dt>
        <dd>{why}</dd>
        <dt>What to do next</dt>
        <dd>{fix}</dd>
      </dl>
      {props.onRetry === undefined ? null : (
        <button type="button" className="button button-secondary" onClick={props.onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}
