"use client";

import { IconSearch, IconPaperclip } from "@tabler/icons-react";

// Uploads are behind a feature flag (default off) until the conversion service
// is hosted. When off, the attach affordance is not rendered at all.
const UPLOADS = process.env.NEXT_PUBLIC_ENABLE_UPLOADS === "true";

type Props = { onOpenCommand: () => void; onAttach: () => void };

/** Top-right glyphs: (optionally) attach a document, and find/create a note. */
export default function TopBar({ onOpenCommand, onAttach }: Props) {
  return (
    <div className="topbar-cluster">
      {UPLOADS && (
        <button
          className="glyph"
          onClick={onAttach}
          aria-label="Attach a document"
          title="Attach"
        >
          <IconPaperclip aria-hidden="true" />
        </button>
      )}
      <button
        className="glyph"
        onClick={onOpenCommand}
        aria-label="Find or create a note"
        title="Find (⌘K)"
      >
        <IconSearch aria-hidden="true" />
      </button>
    </div>
  );
}
