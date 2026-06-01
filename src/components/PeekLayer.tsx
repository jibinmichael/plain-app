"use client";

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";

type Props = { editor: Editor | null; onOpen: (id: string) => void };

/** Links are proper links: tapping/clicking one opens its note. No hover preview. */
export default function PeekLayer({ editor, onOpen }: Props) {
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onClick = (e: Event) => {
      const el = (e.target as HTMLElement).closest(
        ".mark-reference"
      ) as HTMLElement | null;
      if (!el) return;
      const noteId = el.getAttribute("data-note-id");
      if (!noteId) return;
      e.preventDefault();
      onOpen(noteId);
    };
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [editor, onOpen]);

  return null;
}
