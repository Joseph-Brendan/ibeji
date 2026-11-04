import type { MouseEvent, ReactNode } from "react";
import { navigate } from "../use-url";

type AppLinkProps = {
  readonly href: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly ariaCurrent?: "page" | "true" | undefined;
  readonly onNavigate?: () => void;
};

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function AppLink(props: AppLinkProps): ReactNode {
  return (
    <a
      href={props.href}
      className={props.className}
      aria-current={props.ariaCurrent}
      onClick={(event) => {
        if (!isPlainClick(event)) {
          return;
        }
        event.preventDefault();
        navigate(props.href);
        props.onNavigate?.();
      }}
    >
      {props.children}
    </a>
  );
}
