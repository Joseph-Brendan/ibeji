import { type ReactNode, useState } from "react";
import { hrefFor } from "../use-url";

export type LiveKeyWarning = {
  readonly eventId: number;
  readonly twinId: string;
  readonly displayName: string;
  readonly message: string;
  readonly fingerprint: string;
};

type LiveKeyBannersProps = {
  readonly warnings: readonly LiveKeyWarning[];
};

export function LiveKeyBanners(props: LiveKeyBannersProps): ReactNode {
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const visible = props.warnings.filter((warning) => !dismissed.has(warning.eventId));

  if (visible.length === 0) {
    return null;
  }

  return (
    <section className="live-key-banners" aria-label="Live key warning">
      {visible.map((warning) => (
        <div className="live-key-banner" role="alert" key={warning.eventId}>
          <div className="live-key-message">
            <strong>{warning.message}</strong>
            <p>
              Key fingerprint only: <code>{warning.fingerprint}</code>
            </p>
          </div>
          <div className="live-key-actions">
            <a href={hrefFor("/connect#safety")} className="live-key-link">
              Read the safety guidance
            </a>
            <button
              type="button"
              className="live-key-dismiss"
              aria-label={`Dismiss live-key warning for ${warning.displayName}`}
              onClick={() => {
                setDismissed((current) => new Set([...current, warning.eventId]));
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
