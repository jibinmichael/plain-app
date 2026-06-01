"use client";

import { IconCircleCheck, IconArrowDownLeft, IconX } from "@tabler/icons-react";

export type AskState = {
  pos: number;
  top: number;
  loading: boolean;
  text: string;
  source: string;
};

type Props = {
  state: AskState;
  onKeep: () => void;
  onDismiss: () => void;
};

/** A quiet answer that surfaces INTO the page — no modal, no chat panel. */
export default function AskBlock({ state, onKeep, onDismiss }: Props) {
  const keep = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
  return (
    <div className="ask-block" style={{ top: state.top }}>
      {state.loading ? (
        <div className="ask-answer ask-thinking">
          <span className="sprite thinking" aria-hidden="true" />
          grounding…
        </div>
      ) : state.text ? (
        <>
          <div className="ask-answer">{state.text}</div>
          <div className="ask-foot">
            <span className="ask-chip">
              <IconCircleCheck aria-hidden="true" />
              <span className="fname">{state.source || "sources"}</span>
            </span>
            <span className="ask-actions">
              <button className="cir" {...keep} onClick={onKeep} aria-label="Keep" title="Keep">
                <IconArrowDownLeft aria-hidden="true" />
              </button>
              <button className="cir" {...keep} onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
                <IconX aria-hidden="true" />
              </button>
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="ask-answer">Nothing in your sources covers this.</div>
          <div className="ask-foot">
            <span className="ask-chip" />
            <span className="ask-actions">
              <button className="cir" {...keep} onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
                <IconX aria-hidden="true" />
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
