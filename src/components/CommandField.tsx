"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconFileText,
  IconLink,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import {
  type NoteRecord,
  getAllNotes,
  groundingSources,
  noteConcepts,
  noteText,
} from "@/lib/store";

type Props = {
  open: boolean;
  activeId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onCreate: (title: string) => void;
};

type Row =
  | { kind: "ask" }
  | { kind: "note"; id: string; title: string }
  | { kind: "mention"; id: string; title: string; via: string }
  | { kind: "create"; title: string };

type Answer = {
  loading: boolean;
  text: string;
  cited: string[]; // source/note titles the answer was built from
};

const STOP = new Set([
  "the", "a", "an", "what", "which", "is", "are", "of", "to", "in", "on",
  "for", "and", "or", "that", "this", "with", "how", "does", "do", "by",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\.[a-z0-9]+$/, "").replace(/\s+/g, " ");
}

/**
 * Lightweight semantic seam: token-overlap against body + concept phrases (so
 * "what slows the heart" can reach the beta-blocker note via the graph, not
 * just spelling). Swap for an embedding score later without touching the caller.
 */
function meaningScore(qTokens: string[], hay: string): number {
  if (!qTokens.length) return 0;
  const set = new Set(tokens(hay));
  let hit = 0;
  for (const t of qTokens) {
    if (set.has(t)) hit += 1;
    else if ([...set].some((w) => w.startsWith(t) || t.startsWith(w))) hit += 0.5;
  }
  return hit;
}

function fuzzyTitle(q: string, title: string): boolean {
  return title.toLowerCase().includes(q.toLowerCase());
}

export default function CommandField({
  open,
  activeId,
  onClose,
  onOpen,
  onCreate,
}: Props) {
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const askAbort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setActive(0);
      setAnswer(null);
      return;
    }
    getAllNotes().then(setNotes);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const query = q.trim();
    const out: Row[] = [];
    const seen = new Set<string>();

    // 0) Ask — always offered whenever there's something to ask. No "?"-gating.
    if (query) out.push({ kind: "ask" });

    // 1) Title matches.
    for (const n of notes) {
      if (query && !fuzzyTitle(query, n.title)) continue;
      out.push({ kind: "note", id: n.id, title: n.title });
      seen.add(n.id);
    }

    // 2) Mention matches — by meaning, via concept graph + body text.
    if (query) {
      const qt = tokens(query);
      const scored: { id: string; title: string; via: string; s: number }[] = [];
      for (const n of notes) {
        if (seen.has(n.id)) continue;
        const concepts = noteConcepts(n.doc);
        const cHit = concepts.find((c) => meaningScore(qt, c) > 0);
        const s =
          meaningScore(qt, concepts.join(" ")) * 2 + meaningScore(qt, noteText(n.doc));
        if (s > 0) {
          scored.push({
            id: n.id,
            title: n.title,
            via: cHit || qt.find((t) => noteText(n.doc).toLowerCase().includes(t)) || "",
            s,
          });
        }
      }
      scored.sort((a, b) => b.s - a.s);
      for (const m of scored.slice(0, 6)) {
        out.push({ kind: "mention", id: m.id, title: m.title, via: m.via });
      }
    }

    // 3) Create row — always last, always present.
    out.push({ kind: "create", title: query });
    return out;
  }, [q, notes]);

  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(0, rows.length - 1));
  }, [rows.length, active]);

  if (!open) return null;

  // Map a cited source/note title to an openable note id, if one exists.
  const noteIdForTitle = (title: string): string | null => {
    const t = norm(title);
    const hit = notes.find((n) => norm(n.title) === t);
    return hit ? hit.id : null;
  };

  const runAsk = async () => {
    const query = q.trim();
    if (query.length < 3) return;
    askAbort.current?.abort();
    const ctrl = new AbortController();
    askAbort.current = ctrl;
    setAnswer({ loading: true, text: "", cited: [] });
    try {
      // The corpus for "ask your notes" = the student's OWN notes (their bodies)
      // PLUS any uploaded sources. Notes live only in IndexedDB, so we send the
      // most relevant ones in the request (bounded payload; embeddings later).
      const qt = tokens(query);
      const noteSources = notes
        .map((n) => {
          const body = noteText(n.doc);
          const score =
            meaningScore(qt, n.title) * 3 +
            meaningScore(qt, noteConcepts(n.doc).join(" ")) * 2 +
            meaningScore(qt, body);
          return { title: n.title || "Untitled", markdown: body, score };
        })
        .filter((n) => n.score > 0 && n.markdown.trim().length > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ title, markdown }) => ({ title, markdown, tier: "peer" as const }));

      const sources = [...noteSources, ...(await groundingSources())];
      const res = await fetch("/api/ground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: query, mode: "ask", sources }),
        signal: ctrl.signal,
      });
      const d = (await res.json()) as {
        grounded: boolean;
        text?: string;
        cited?: string[];
      };
      setAnswer({
        loading: false,
        text: d.grounded && d.text ? d.text : "",
        cited: d.cited || [],
      });
    } catch {
      /* aborted — leave prior state */
    }
  };

  const activate = (row: Row) => {
    if (row.kind === "ask") runAsk();
    else if (row.kind === "create") onCreate(q.trim());
    else onOpen(row.id);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="cmd" role="dialog" aria-label="Ask, find, or create a note">
        <div className="cmd-head">
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Ask your notes, or find one…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setAnswer(null); // typing returns to the live list
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (rows[active]) activate(rows[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <button
          className="cmd-close"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          <IconX aria-hidden="true" />
        </button>
      </div>

      {answer ? (
        // ── The answer: plain text on a soft ink bg, then DRAWN FROM ──
        <div className="cmd-answer-wrap">
          {answer.loading ? (
            <div className="cmd-answer">
              <span className="sprite thinking" aria-hidden="true" /> asking your notes…
            </div>
          ) : answer.text ? (
            <>
              <div className="cmd-answer">{answer.text}</div>
              <div className="cmd-from">
                <span className="sprite" aria-hidden="true" />
                from your notes
              </div>
              {answer.cited.length > 0 && (
                <div className="cmd-drawn">
                  <div className="cmd-drawn-label">Drawn from</div>
                  {answer.cited.map((title) => {
                    const id = noteIdForTitle(title);
                    return (
                      <button
                        key={title}
                        className="cmd-row cmd-drawn-row"
                        disabled={!id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => id && onOpen(id)}
                      >
                        <IconFileText className="cmd-ic note" aria-hidden="true" />
                        <span className="cmd-label">{title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="cmd-answer cmd-answer-empty">
              nothing in your notes covers this yet
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="cmd-list">
            {rows.map((row, i) => {
              if (row.kind === "create") return null;
              if (row.kind === "ask") {
                return (
                  <button
                    key="ask"
                    className="cmd-row cmd-ask"
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => activate(row)}
                  >
                    <span className="sprite" aria-hidden="true" />
                    <span className="cmd-label">
                      Ask your notes
                    </span>
                    <span className="cmd-kbd">↵</span>
                  </button>
                );
              }
              return (
                <button
                  key={`${row.kind}-${row.id}`}
                  className="cmd-row"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => activate(row)}
                >
                  {row.kind === "note" ? (
                    <>
                      <IconFileText className="cmd-ic note" aria-hidden="true" />
                      <span className="cmd-label">{row.title || "Untitled"}</span>
                    </>
                  ) : (
                    <>
                      <IconLink className="cmd-ic mention" aria-hidden="true" />
                      <span className="cmd-label">{row.title || "Untitled"}</span>
                      <span className="cmd-meta">
                        {row.via ? `mentions ${row.via}` : "mention"}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {/* Create row — always present, pinned as a sticky footer. */}
          <div className="cmd-footer">
            <button
              className="cmd-row cmd-create"
              data-active={active === rows.length - 1}
              onMouseEnter={() => setActive(rows.length - 1)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCreate(q.trim())}
            >
              <IconPlus className="cmd-ic accent" aria-hidden="true" />
              <span className="cmd-label">
                Create{" "}
                <span className="cmd-strong">
                  {q.trim() ? `"${q.trim()}"` : "a new note"}
                </span>
              </span>
            </button>
          </div>
        </>
      )}
      </div>
    </>
  );
}
