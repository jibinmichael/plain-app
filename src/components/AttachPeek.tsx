"use client";

import { useEffect, useState } from "react";

export type PeekData = {
  name: string;
  markdown: string;
  kind: string;
  image?: string; // data URL, images only — enables the colour toggle
};

type Props = { peek: PeekData | null; onClose: () => void };

/**
 * A quiet framed preview, summoned by tapping a pill and receding on outside
 * tap. Shows the converted markdown (or the image). Monochrome by default with
 * a "show colour" toggle for images where colour carries meaning.
 */
export default function AttachPeek({ peek, onClose }: Props) {
  const [colour, setColour] = useState(false);

  useEffect(() => {
    setColour(false);
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".attach-peek")) onClose();
    };
    window.addEventListener("keydown", onKey);
    // defer so the opening tap doesn't immediately close it
    const t = setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      clearTimeout(t);
    };
  }, [peek, onClose]);

  if (!peek) return null;
  const isImage = peek.kind === "image" && !!peek.image;

  return (
    <div className="attach-peek-layer">
      <div className="attach-peek" role="dialog" aria-label={`Preview: ${peek.name}`}>
        <div className="attach-peek-body">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={peek.image}
              alt={peek.name}
              className={`attach-img${colour ? "" : " mono"}`}
            />
          ) : (
            <pre className="attach-md">{peek.markdown || "no readable text"}</pre>
          )}
        </div>
        <div className="attach-peek-foot">
          <span className="attach-cap">{peek.name}</span>
          {isImage && (
            <button className="attach-toggle" onClick={() => setColour((c) => !c)}>
              {colour ? "monochrome" : "show colour"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
