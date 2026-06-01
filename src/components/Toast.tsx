"use client";

import { useEffect } from "react";

export type ToastState = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
} | null;

type Props = { toast: ToastState; onDismiss: () => void };

/** A single quiet toast (e.g. "note deleted · undo"). Auto-dismisses. */
export default function Toast({ toast, onDismiss }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="toast" role="status">
      <span className="toast-msg">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <>
          <span className="toast-sep">·</span>
          <button
            className="toast-action"
            onClick={() => {
              toast.onAction!();
              onDismiss();
            }}
          >
            {toast.actionLabel}
          </button>
        </>
      )}
    </div>
  );
}
