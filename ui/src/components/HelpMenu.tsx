import { type ReactNode, useEffect, useId, useRef, useState } from "react";

const TERMS = [
  ["App address", "The address your app uses to reach this twin."],
  ["Test key", "A practice key that works only with Ibeji. It cannot move real money."],
  ["Public key", "The test key that is safe to use in browser test code."],
  ["Secret key", "The test key that should stay on your server."],
  ["Webhook", "A message Ibeji sends to your app when a payment changes."],
  ["Webhook address", "The address in your app that receives those messages."],
  ["Signature", "A code that helps your app check a message really came from Ibeji."],
  ["Failure", "A realistic payment problem that Ibeji can recreate."],
  ["Rule", "One failure turned on for one or more twins."],
  ["Scenario", "A ready-made set of failures that runs in order."],
  ["Event", "Something that happened in Ibeji."],
  ["Repeatable run", "A number that makes random test results repeat."],
  ["Record", "One payment, refund, transfer, recipient or bank row."],
  [
    "Reset",
    "Deletes test records and stops waiting messages. It keeps your keys, addresses, failures and events.",
  ],
  ["Twin", "A local copy of one payment service. It runs only on your computer."],
  ["API", "The addresses and rules your app uses to talk to a payment service."],
  ["JSON", "A text format for data."],
  ["HTTP status", "The number a server sends to say what happened. 200 means it worked."],
] as const;

export function HelpMenu(): ReactNode {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (panel.current?.contains(target) === true || button.current?.contains(target) === true) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="help-menu">
      <button
        ref={button}
        type="button"
        className="help-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Help
      </button>
      {open ? (
        <section ref={panel} id={panelId} className="help-popover" aria-label="Help">
          <p className="help-intro">Plain words for the terms used here.</p>
          <dl className="help-terms">
            {TERMS.map(([term, explanation]) => (
              <div key={term} className="help-term">
                <dt>{term}</dt>
                <dd>{explanation}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
