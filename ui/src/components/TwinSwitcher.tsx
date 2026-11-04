import type { ReactNode } from "react";
import type { TwinSummary } from "../../../src/shared/control.js";
import { twinLabelClass } from "../twin-label";
import { withTwin } from "../use-url";
import { AppLink } from "./AppLink";
import { StatusPill } from "./StatusPill";

type TwinSwitcherProps = {
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly pathname: string;
};

export function TwinSwitcher(props: TwinSwitcherProps): ReactNode {
  const runningCount = props.twins.filter((twin) => twin.running).length;
  const stoppedTwin = props.twins.find((twin) => !twin.running);

  return (
    <nav className="twin-switcher" aria-label="Twin">
      <div className="switcher-row">
        <AppLink
          href={withTwin(props.pathname, undefined)}
          className="switcher-item switcher-all"
          ariaCurrent={props.selectedTwinId === undefined ? "true" : undefined}
        >
          <span className="switcher-name">All</span>
          <span className="switcher-count" aria-hidden="true">
            {runningCount} running
          </span>
          <span className="sr-only">, {runningCount} running</span>
        </AppLink>

        {props.twins.map((twin) => (
          <AppLink
            key={twin.id}
            href={withTwin(props.pathname, twin.id)}
            className="switcher-item"
            ariaCurrent={props.selectedTwinId === twin.id ? "true" : undefined}
          >
            <span className={`twin-badge ${twinLabelClass(twin.labelColourToken)}`}>
              {twin.displayName}
            </span>
            <span aria-hidden="true">
              <StatusPill tone={twin.running ? "running" : "off"}>
                {twin.running ? "Running" : "Off"}
              </StatusPill>
            </span>
            <span className="sr-only">, {twin.running ? "running" : "off"}</span>
          </AppLink>
        ))}
      </div>

      {stoppedTwin === undefined ? null : (
        <p className="switcher-help">
          Off twins stay visible. Start one with <code>ibeji start --twins {stoppedTwin.id}</code>.
        </p>
      )}
    </nav>
  );
}
