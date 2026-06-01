"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import {
  type NoteRecord,
  type NoteBreakdown,
  groundingSources,
  noteConcepts,
  noteText,
  setBreakdown,
} from "@/lib/store";
import { buildOrbit } from "@/lib/orbit";
import MicroNoteBody from "./MicroNoteBody";

type Props = {
  note: NoteRecord | null; // the auto-note being opened (null = closed)
  notes: NoteRecord[]; // full set — for CONNECTS TO + the grounding corpus
  onClose: () => void;
  onOpen: (id: string) => void; // jump to a connected note
  onDismiss: (id: string) => void | Promise<void>; // won't respawn
};

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are",
]);
function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
function score(qt: string[], hay: string): number {
  if (!qt.length) return 0;
  const set = new Set(tokens(hay));
  let n = 0;
  for (const t of qt) if (set.has(t)) n += 1;
  return n;
}

/**
 * v3.4 — the opened auto-note as a full PAGE: a real, well-structured ATOMIC
 * note (markdown → live TipTap: prose / checkboxes / tables / lists, editable).
 * Grounded-or-ghost: drawn from the user's sources where possible (cited), else
 * a provisional general-knowledge note rendered grey. Generated lazily on first
 * open and cached; editable; dismissable. CONNECTS TO = graph neighbours.
 */
export default function MicroBreakdown({
  note,
  notes,
  onClose,
  onOpen,
  onDismiss,
}: Props) {
  const [data, setData] = useState<NoteBreakdown | null>(null);
  const [loading, setLoading] = useState(false);

  const gist =
    note?.gist ||
    (note ? noteText(note.doc).replace(/^#{1,6}\s*[^\n]*\n*/, "").trim() : "");

  // CONNECTS TO = the concept's direct neighbours in the existing graph.
  const connects = note ? buildOrbit(notes, note.id).neighbors : [];

  const generate = useCallback(
    async (concept: string, noteId: string) => {
      setLoading(true);
      try {
        const qt = tokens(concept);
        const noteSources = notes
          .map((n) => {
            const body = noteText(n.doc);
            const s =
              (n.id === noteId ? 100 : 0) +
              score(qt, n.title) * 3 +
              score(qt, noteConcepts(n.doc).join(" ")) * 2 +
              score(qt, body);
            return { title: n.title || "note", markdown: body, score: s };
          })
          .filter((n) => n.score > 0 && n.markdown.trim().length > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map(({ title, markdown }) => ({ title, markdown, tier: "peer" as const }));

        const sources = [...noteSources, ...(await groundingSources())];
        const res = await fetch("/api/breakdown", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ concept, sources }),
        });
        const d = (await res.json()) as {
          grounded?: boolean;
          markdown?: string;
          sources?: string[];
        };
        let markdown = d.markdown || "";

        // Part 4: find a relevant image online and embed it INLINE (downscaled,
        // persisted as a data URL). Best-effort + silent — if search/embed/key
        // is unavailable, the note simply ships without an image. Only embed
        // when there's actually a note to attach it to and no image already.
        if (markdown && !markdown.includes("![")) {
          try {
            const imgRes = await fetch("/api/image-search", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ concept }),
            });
            const hits = ((await imgRes.json()).images || []) as {
              url: string;
              thumbnail: string;
              sourceName: string;
            }[];
            const hit = hits.find((h) => h.thumbnail || h.url);
            if (hit) {
              const emRes = await fetch("/api/image-embed", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: hit.thumbnail || hit.url }),
              });
              const { dataUrl } = (await emRes.json()) as { dataUrl?: string | null };
              if (dataUrl) {
                const alt = concept.replace(/[[\]()]/g, "");
                // Prepend the image so the note opens with the visual.
                markdown = `![${alt}](${dataUrl})\n\n${markdown}`;
              }
            }
          } catch {
            /* no image — ship the note as-is */
          }
        }

        const bd: NoteBreakdown = {
          grounded: !!d.grounded,
          markdown,
          sources: d.sources || [],
          generatedAt: Date.now(),
        };
        setData(bd);
        await setBreakdown(noteId, bd);
      } catch {
        setData({ grounded: false, markdown: "", sources: [], generatedAt: Date.now() });
      } finally {
        setLoading(false);
      }
    },
    [notes]
  );

  // On open: use the cached breakdown if present, else generate once.
  // Migrate legacy cached breakdowns (old {fields} shape) by regenerating.
  useEffect(() => {
    if (!note) {
      setData(null);
      return;
    }
    const cached = note.breakdown as NoteBreakdown | undefined;
    if (cached && typeof cached.markdown === "string" && cached.markdown) {
      setData(cached);
      return;
    }
    void generate(note.title, note.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // A page is not a popup: never dismiss on outside tap. Esc closes (back).
  useEffect(() => {
    if (!note) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, onClose]);

  const refresh = () => {
    if (note) void generate(note.title, note.id);
  };

  // Persist edits to the note body (debounced-ish via the editor's own updates).
  const dataRef = useRef(data);
  dataRef.current = data;
  const editBody = useCallback(
    async (markdown: string) => {
      const cur = dataRef.current;
      if (!note || !cur) return;
      const next = { ...cur, markdown };
      dataRef.current = next;
      setData(next);
      await setBreakdown(note.id, next);
    },
    [note]
  );

  if (!note) return null;

  const hasBody = !!data && !!data.markdown;

  return (
    <div className="micro-page-layer">
      <div className="micro-page" role="dialog" aria-label={`${note.title}`}>
        <div className="micro-head">
          <div className="micro-titlewrap">
            <div className="micro-title">{note.title || "Untitled"}</div>
            {gist && <div className="micro-gist">{gist}</div>}
          </div>
          <div className="micro-actions">
            <button
              className="micro-refresh"
              onMouseDown={(e) => e.preventDefault()}
              onClick={refresh}
              aria-label="Regenerate"
              title="Regenerate"
            >
              <IconRefresh aria-hidden="true" />
            </button>
            <button
              className="micro-refresh"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onDismiss(note.id)}
              aria-label="Dismiss this note (won't suggest again)"
              title="Dismiss (won't suggest again)"
            >
              <IconTrash aria-hidden="true" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="micro-loading">writing this note…</div>
        ) : (
          <>
            {hasBody && (
              <>
                <MicroNoteBody
                  key={data!.generatedAt}
                  markdown={data!.markdown}
                  ghost={!data!.grounded}
                  onChange={editBody}
                />
                <div className="micro-foot">
                  {data!.grounded
                    ? `from your notes${
                        data!.sources.length > 0 ? ` · ${data!.sources.join(", ")}` : ""
                      }`
                    : "draft · provisional — edit or keep"}
                </div>
              </>
            )}

            {connects.length > 0 && (
              <section className="micro-section">
                <div className="micro-label">Connects to</div>
                <div className="micro-connects">
                  {connects.map((c) => (
                    <button
                      key={c.id}
                      className="micro-link"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onOpen(c.id)}
                    >
                      <span>{c.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
