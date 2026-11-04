import { type ReactNode, useEffect, useId, useRef, useState } from "react";

const TERMS = [
  ["Base URL", "The address your app sends payment requests to."],
  ["Test key", "A fake key that works only with Ibeji. It cannot move real money."],
  ["Public key", "The test key that is safe to use in browser test code."],
  ["Secret key", "The private test key. Keep it on your server."],
  ["Webhook", "A message Ibeji sends to your app when something happens."],
  ["Webhook URL", "The address in your app that receives webhook messages."],
  ["Signature", "A code that proves a message came from the sender."],
  ["Failure", "A realistic problem Ibeji can create."],
  ["Rule", "One failure switched on for one or more twins, with settings."],
  ["Scenario", "A ready-made set of failure rules."],
  ["Event", "Something that happened in Ibeji."],
  ["Seed", "A number that makes random choices repeatable."],
  ["Record", "One payment, refund, transfer, recipient or bank row."],
  [
    "Reset",
    "Deletes records and stops waiting webhooks. It does not delete rules, scenarios, webhook URLs, keys or events.",
  ],
  ["Twin", "A local copy of one payment service."],
  ["API", "The set of web addresses and rules an app uses to talk to a payment service."],
  ["JSON", "A text format for data."],
  ["HTTP status", "The number a server sends to say what happened. 200 means success."],
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
