import type { ReactNode } from "react";
import type { TwinSummary } from "../../../src/shared/control.js";
import type { StreamState } from "../api/sse";
import { withTwin } from "../use-url";
import { AppLink } from "./AppLink";
import { ConnectionBanner } from "./ConnectionBanner";
import { HelpMenu } from "./HelpMenu";
import { TwinSwitcher } from "./TwinSwitcher";

const PAGES = [
  { path: "/", label: "Home" },
  { path: "/connect", label: "Connect your app" },
  { path: "/activity", label: "Live activity" },
  { path: "/failures", label: "Failures" },
  { path: "/scenarios", label: "Scenarios" },
  { path: "/webhooks", label: "Webhooks" },
  { path: "/data", label: "Data" },
] as const;

type AppShellProps = {
  readonly title: string;
  readonly twins: readonly TwinSummary[];
  readonly selectedTwinId: string | undefined;
  readonly pathname: string;
  readonly seed: number | undefined;
  readonly connection: StreamState;
  readonly children: ReactNode;
};

function connectionText(state: StreamState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "disconnected":
      return "Ibeji is not answering.";
  }
}

export function AppShell(props: AppShellProps): ReactNode {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="top-bar">
        <span className="wordmark">Ibeji</span>
        <span className="top-bar-status">{connectionText(props.connection)}</span>
        {props.seed === undefined ? null : <span className="top-bar-seed">Seed {props.seed}</span>}
        <HelpMenu />
      </header>

      <TwinSwitcher
        twins={props.twins}
        selectedTwinId={props.selectedTwinId}
        pathname={props.pathname}
      />
      <ConnectionBanner state={props.connection} />

      <div className="shell-body">
        <nav className="side-nav" aria-label="Pages">
          {PAGES.map((page) => {
            const href = withTwin(page.path, props.selectedTwinId);
            const current =
              page.path === "/" ? props.pathname === "/" : props.pathname.startsWith(page.path);
            return (
              <AppLink
                key={page.path}
                href={href}
                className="nav-link"
                ariaCurrent={current ? "page" : undefined}
              >
                {page.label}
              </AppLink>
            );
          })}
        </nav>

        <main id="main-content" className="main-content" tabIndex={-1}>
          <h1 className={props.pathname === "/" ? "page-title page-title-display" : "page-title"}>
            {props.title}
          </h1>
          {props.children}
        </main>
      </div>
    </div>
  );
}
