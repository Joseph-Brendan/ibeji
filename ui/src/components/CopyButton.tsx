import { type ReactNode, useEffect, useState } from "react";

type CopyButtonProps = {
  readonly value: string;
  readonly label: string;
  readonly className?: string;
};

type CopyState = "idle" | "copied" | "failed";

export function CopyButton(props: CopyButtonProps): ReactNode {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") {
      return;
    }
    const handle = window.setTimeout(() => setState("idle"), 2_000);
    return () => window.clearTimeout(handle);
  }, [state]);

  const text = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";

  return (
    <span className="copy-control">
      <button
        type="button"
        className={`button button-small ${props.className ?? ""}`}
        aria-label={`Copy ${props.label}`}
        onClick={() => {
          if (navigator.clipboard === undefined) {
            setState("failed");
            return;
          }
          void navigator.clipboard
            .writeText(props.value)
            .then(() => setState("copied"))
            .catch(() => setState("failed"));
        }}
      >
        {text}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? `${props.label} copied.` : ""}
        {state === "failed" ? `${props.label} could not be copied.` : ""}
      </span>
    </span>
  );
}
