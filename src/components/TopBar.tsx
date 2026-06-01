"use client";

import { useEffect, useState } from "react";
import { IconSearch, IconPaperclip } from "@tabler/icons-react";
import {
  type GenPref,
  DEFAULT_GEN,
  LEVELS,
  STYLES,
  OPTION_COLOR,
  getGlobalGen,
  setGlobalGen,
} from "@/lib/genPref";

// Uploads are behind a feature flag (default off) until the conversion service
// is hosted. When off, the attach affordance is not rendered at all.
const UPLOADS = process.env.NEXT_PUBLIC_ENABLE_UPLOADS === "true";

type Props = { onOpenCommand: () => void; onAttach: () => void };

/** Header: the GLOBAL default depth/style as small, always-visible, checkable
 *  options laid out horizontally (no popover) — the selected one is shown in its
 *  colour; tapping another sets the new default for generated notes. Plus
 *  (optionally) attach, and find/create. */
export default function TopBar({ onOpenCommand, onAttach }: Props) {
  const [pref, setPref] = useState<GenPref>(DEFAULT_GEN);

  // Read the persisted global default on mount (localStorage is client-only).
  useEffect(() => {
    setPref(getGlobalGen());
  }, []);

  const update = (next: GenPref) => {
    setPref(next);
    setGlobalGen(next); // persist + notify open notes (without an override)
  };

  return (
    <div className="topbar-cluster">
      <div className="gen-bar" role="group" aria-label="Default format for generated notes">
        <span className="gen-bar-label">Default</span>
        {LEVELS.map((l) => (
          <button
            key={l.key}
            className={`gen-bar-opt${pref.level === l.key ? " on" : ""}`}
            style={pref.level === l.key ? { color: OPTION_COLOR[l.key] } : undefined}
            aria-pressed={pref.level === l.key}
            onClick={() => update({ ...pref, level: l.key })}
          >
            {l.label}
          </button>
        ))}
        <span className="gen-bar-sep" aria-hidden="true">·</span>
        {STYLES.map((s) => (
          <button
            key={s.key}
            className={`gen-bar-opt${pref.style === s.key ? " on" : ""}`}
            style={pref.style === s.key ? { color: OPTION_COLOR[s.key] } : undefined}
            aria-pressed={pref.style === s.key}
            onClick={() => update({ ...pref, style: s.key })}
          >
            {s.label}
          </button>
        ))}
      </div>

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
