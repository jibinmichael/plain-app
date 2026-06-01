"use client";

import { useMemo } from "react";
import type { NoteRecord } from "@/lib/store";

// Posting intensity for the CURRENT month: one square per day of this month,
// intensity = how many notes were created that day. The number of squares
// always equals the number of days in the present month.
function monthActivity(notes: NoteRecord[]): number[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const counts = new Array(daysInMonth).fill(0);
  for (const n of notes) {
    const t = new Date(n.createdAt ?? n.updatedAt);
    if (t.getFullYear() === year && t.getMonth() === month) {
      counts[t.getDate() - 1] += 1;
    }
  }
  return counts;
}

// 0 → faint, then four intensity steps (git-style).
function tier(c: number): 0 | 1 | 2 | 3 | 4 {
  if (c <= 0) return 0;
  if (c === 1) return 1;
  if (c === 2) return 2;
  if (c <= 4) return 3;
  return 4;
}

type Props = {
  notes: NoteRecord[];
  activeId: string | null;
  onOpen: (id: string) => void;
};

/**
 * CONNECTED — a compact posting-intensity strip: one square per day of the
 * current month, ink intensity by notes added that day. No graph/map view.
 */
export default function Orbit({ notes }: Props) {
  // Memoized on creation times so it never recomputes on a keystroke (notes
  // state changes only on save).
  const sig = useMemo(
    () => notes.map((n) => n.createdAt ?? n.updatedAt).sort().join(","),
    [notes]
  );
  const activity = useMemo(
    () => monthActivity(notes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig]
  );
  const total = useMemo(() => activity.reduce((a, b) => a + b, 0), [activity]);

  return (
    <div className="orbit-dock">
      <div className="orbit-head">
        <span className="orbit-title">Connected</span>
      </div>

      {/* Activity strip — one square per day of the current month, ink intensity
          by notes added that day. Left-aligned, compact. */}
      <div
        className="act-strip"
        title={`${total} note${total === 1 ? "" : "s"} added this month`}
      >
        {activity.map((c, i) => (
          <span key={i} className={`act-cell lvl${tier(c)}`} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
