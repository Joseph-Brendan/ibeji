import type { ReactNode } from "react";

export type SignInState = "checking" | "invalid" | "restarted" | "no-cookie" | "offline";

type SignInPageProps = {
  readonly state: SignInState;
};

type SignInCopy = {
  readonly heading: string;
  readonly body: string;
  readonly help: string;
  readonly smallHelp: string;
  readonly button: string;
};

function content(state: SignInState): SignInCopy {
  switch (state) {
    case "invalid":
      return {
        heading: "This sign-in link has expired.",
        body: "It may have been used already, or it may be more than two minutes old.",
        help: "Run ibeji open to get a new link.",
        smallHelp: "If Ibeji is not running, start it with ibeji start.",
        button: "Try again",
      };
    case "restarted":
      return {
        heading: "Ibeji was restarted.",
        body: "Run ibeji open to get a new link.",
        help: "",
        smallHelp: "",
        button: "Try again",
      };
    case "no-cookie":
      return {
        heading: "Start Ibeji from your terminal.",
        body: "Run ibeji start to begin, or ibeji open to get a dashboard link.",
        help: "",
        smallHelp: "",
        button: "Try again",
      };
    case "offline":
      return {
        heading: "Ibeji is not answering.",
        body: "It may have stopped on your computer. Start it again with ibeji start.",
        help: "",
        smallHelp: "",
        button: "Check again",
      };
    case "checking":
      return {
        heading: "Opening Ibeji...",
        body: "Checking your sign-in.",
        help: "",
        smallHelp: "",
        button: "",
      };
  }
}

export function SignInPage(props: SignInPageProps): ReactNode {
  const copy = content(props.state);

  return (
    <main className="sign-in-page">
      <div className="sign-in-card">
        <span className="wordmark">Ibeji</span>
        <h1>{copy.heading}</h1>
        <p>{copy.body}</p>
        {copy.help === "" ? null : <p className="help-text">{copy.help}</p>}
        {copy.smallHelp === "" ? null : <p className="small-help">{copy.smallHelp}</p>}
        {copy.button === "" ? (
          <div className="loading-line" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={() => window.location.reload()}
          >
            {copy.button}
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {copy.heading} {copy.body}
        </span>
      </div>
    </main>
  );
}
