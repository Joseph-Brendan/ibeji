import { type ReactNode, useEffect, useId, useRef } from "react";

type ConfirmDialogProps = {
  readonly open: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const reference = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const dialog = reference.current;
    if (dialog === null) {
      return;
    }
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
      opener?.focus();
    };
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  return (
    <dialog
      ref={reference}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
    >
      <h2 id={titleId}>{props.title}</h2>
      <p id={bodyId}>{props.body}</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={props.onCancel}
          disabled={props.busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={props.onConfirm}
          disabled={props.busy}
        >
          {props.busy ? "Working..." : props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
