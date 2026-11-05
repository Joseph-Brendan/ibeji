import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { TwinSummary } from "../../../src/shared/control.js";
import { type ControlApi, isUnauthorized } from "../api/client";
import { ErrorPanel } from "./ErrorPanel";

type WebhookUrlEditorProps = {
  readonly api: ControlApi;
  readonly twin: TwinSummary;
  readonly url: string;
  readonly disabled: boolean;
  readonly onSaved: (url: string | null) => void;
  readonly onUnauthorized: () => void;
};

export function WebhookUrlEditor(props: WebhookUrlEditorProps): ReactNode {
  const [value, setValue] = useState(props.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (toast === "") {
      return;
    }
    const handle = window.setTimeout(() => setToast(""), 5_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const save = async (url: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await props.api.setWebhookUrl(props.twin.id, url);
      setValue(result.url ?? "");
      props.onSaved(result.url);
      setToast(result.url === null ? "Webhook URL cleared." : "Webhook URL saved.");
    } catch (caught) {
      if (isUnauthorized(caught)) {
        props.onUnauthorized();
        return;
      }
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="webhook-editor"
      data-testid={`webhook-editor-${props.twin.id}`}
      aria-labelledby={`webhook-${props.twin.id}`}
    >
      <div className="webhook-editor-header">
        <h3 id={`webhook-${props.twin.id}`}>{props.twin.displayName} webhook URL</h3>
        <span className="help-text">
          {props.url === "" ? "No webhook URL set." : "Saved address."}
        </span>
      </div>
      <form
        className="webhook-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const submitted = new FormData(event.currentTarget).get("url");
          void save(typeof submitted === "string" ? submitted.trim() : "");
        }}
      >
        <label className="field-label" htmlFor={`webhook-input-${props.twin.id}`}>
          Webhook URL
        </label>
        <input
          id={`webhook-input-${props.twin.id}`}
          name="url"
          className="text-input"
          type="url"
          value={value}
          disabled={props.disabled || busy}
          placeholder="http://127.0.0.1:3000/webhook"
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="webhook-buttons">
          <button type="submit" className="button button-primary" disabled={props.disabled || busy}>
            Save webhook URL
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={props.disabled || busy || value === ""}
            onClick={() => void save("")}
          >
            Clear webhook URL
          </button>
        </div>
      </form>
      <p className="help-text">
        The URL must use http or https. By default Ibeji sends only to this computer. Use
        --allow-private-webhooks for private network addresses, or --allow-public-webhooks for
        public addresses.
      </p>
      {toast === "" ? null : (
        <p className="toast" role="status" aria-live="polite">
          {toast}
        </p>
      )}
      {error === undefined ? null : (
        <ErrorPanel error={error} title="We couldn't save that webhook URL." />
      )}
    </section>
  );
}
