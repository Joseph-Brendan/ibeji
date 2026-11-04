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
  const heading = props.title ?? "Ibeji could not do that.";
  const what = isApi ? error.what : "Ibeji could not do that.";
  const why = isApi ? error.why : "An unexpected problem happened in the browser.";
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
        <dt>Why</dt>
        <dd>{why}</dd>
        <dt>Fix</dt>
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
