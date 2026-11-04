import type { ReactNode } from "react";

export type StatusTone = "running" | "off" | "failed" | "pending";

type StatusPillProps = {
  readonly tone: StatusTone;
  readonly children: ReactNode;
};

export function StatusPill(props: StatusPillProps): ReactNode {
  return <span className={`status-pill status-pill-${props.tone}`}>{props.children}</span>;
}
