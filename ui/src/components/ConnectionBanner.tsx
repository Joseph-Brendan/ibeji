import { type ReactNode, useEffect, useState } from "react";
import type { StreamState } from "../api/sse";

const LONG_OUTAGE_MS = 30_000;

type ConnectionBannerProps = {
  readonly state: StreamState;
};

export function ConnectionBanner(props: ConnectionBannerProps): ReactNode {
  const [longOutage, setLongOutage] = useState(false);

  useEffect(() => {
    if (props.state !== "disconnected") {
      setLongOutage(false);
      return;
    }
    const handle = window.setTimeout(() => setLongOutage(true), LONG_OUTAGE_MS);
    return () => window.clearTimeout(handle);
  }, [props.state]);

  if (props.state !== "disconnected") {
    return null;
  }

  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <h2 className="connection-banner-title">
        {longOutage ? "Ibeji is still not answering." : "Ibeji is not answering."}
      </h2>
      <p>
        {longOutage
          ? "Start Ibeji again with ibeji start."
          : "The local process may have stopped. Ibeji will try again on its own."}
      </p>
    </div>
  );
}
