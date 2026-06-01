"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconExternalLink,
  IconChevronDown,
  IconCheck,
} from "@tabler/icons-react";
import {
  type NoteRecord,
  type NoteBreakdown,
  type WebSource,
  groundingSources,
  noteConcepts,
  noteText,
  setBreakdownFor,
  setNoteGen,
} from "@/lib/store";
import {
  type GenPref,
  type Level,
  type Style,
  DEFAULT_GEN,
  LEVELS,
  STYLES,
  OPTION_COLOR,
  comboKey,
  getGlobalGen,
  GEN_PREF_EVENT,
} from "@/lib/genPref";
import { buildOrbit } from "@/lib/orbit";
import type { FlowSpec } from "@/lib/flow";
import MicroNoteBody from "./MicroNoteBody";
import FlowChart from "./FlowChart";

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
}: Props) {
  const [data, setData] = useState<NoteBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  // This note's current depth/style. Per-note override (note.gen) beats the
  // global default; the control changes it without touching the global default.
  const [gen, setGen] = useState<GenPref>(DEFAULT_GEN);
  // In-session cache of generated breakdowns keyed by comboKey(level,style) so
  // switching is instant (the `note` prop's `breakdowns` can be stale mid-session).
  const cacheRef = useRef<Record<string, NoteBreakdown>>({});
  // The depth/style dropdown's open state (BUG2: one clear labeled control).
  const [menuOpen, setMenuOpen] = useState(false);

  const gist =
    note?.gist ||
    (note ? noteText(note.doc).replace(/^#{1,6}\s*[^\n]*\n*/, "").trim() : "");

  // CONNECTS TO = the concept's direct neighbours in the existing graph.
  const connects = note ? buildOrbit(notes, note.id).neighbors : [];

  const generate = useCallback(
    async (concept: string, noteId: string, level: Level, style: Style) => {
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

        // v3.6 Part B: is this concept a process/protocol? If so the note becomes
        // an editable FLOWCHART (grounded-or-ghost, provisional) instead of prose.
        try {
          const fRes = await fetch("/api/flow", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ concept, sources }),
          });
          const f = (await fRes.json()) as {
            process?: boolean;
            spec?: FlowSpec;
            grounded?: boolean;
          };
          if (f.process && f.spec) {
            const bd: NoteBreakdown = {
              grounded: !!f.grounded,
              markdown: "",
              sources: [],
              flow: f.spec,
              generatedAt: Date.now(),
            };
            const key = comboKey(level, style);
            cacheRef.current[key] = bd;
            setData(bd);
            await setBreakdownFor(noteId, key, bd);
            return; // flowchart, not prose — done
          }
        } catch {
          /* detection failed → fall through to a normal note */
        }

        const res = await fetch("/api/breakdown", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ concept, sources, level, style }),
        });
        const d = (await res.json()) as {
          grounded?: boolean;
          markdown?: string;
          sources?: string[];
        };
        let markdown = d.markdown || "";
        let grounded = !!d.grounded;
        let webSources: WebSource[] = [];

        // Grounded-or-ghost: the user's own notes/sources are cited as before
        // (grounded === "from your notes"). When nothing local grounds it, reach
        // for real web sources rather than leaving a bare provisional ghost — web
        // facts come back with their own numbered citations. If the web finds
        // nothing reputable, we keep the provisional draft (never a fake source).
        if (!grounded) {
          try {
            const rRes = await fetch("/api/research", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ concept }),
            });
            const r = (await rRes.json()) as {
              grounded?: boolean;
              markdown?: string;
              sources?: WebSource[];
            };
            if (r.grounded && r.markdown && r.sources?.length) {
              markdown = r.markdown;
              webSources = r.sources;
            }
          } catch {
            /* web research unavailable → keep the provisional draft */
          }
        }

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
          grounded,
          markdown,
          sources: d.sources || [],
          webSources,
          generatedAt: Date.now(),
        };
        const key = comboKey(level, style);
        cacheRef.current[key] = bd; // instant within the session
        setData(bd);
        await setBreakdownFor(noteId, key, bd); // persists per combo
      } catch {
        setData({ grounded: false, markdown: "", sources: [], generatedAt: Date.now() });
      } finally {
        setLoading(false);
      }
    },
    [notes]
  );

  // Show the breakdown for a given (level, style): cached → instant; else
  // generate it. Grounded-or-ghost + caching unchanged — only the FORM varies.
  const load = useCallback(
    async (n: NoteRecord, g: GenPref) => {
      const key = comboKey(g.level, g.style);
      const cached = cacheRef.current[key];
      if (cached && typeof cached.markdown === "string" && cached.markdown) {
        setData(cached);
        return;
      }
      // Legacy single breakdown (pre-v3.6) → show it instantly on first open so
      // there's no blank flash; switching combos generates the proper new form.
      const legacy = n.breakdown;
      if (
        legacy &&
        typeof legacy.markdown === "string" &&
        legacy.markdown &&
        Object.keys(cacheRef.current).length === 0
      ) {
        cacheRef.current[key] = legacy;
        setData(legacy);
        return;
      }
      await generate(n.title, n.id, g.level, g.style);
    },
    [generate]
  );

  // On open: seed the session cache from the note, pick its level/style
  // (per-note override → else global default), and load that combo.
  useEffect(() => {
    if (!note) {
      setData(null);
      cacheRef.current = {};
      return;
    }
    cacheRef.current = { ...(note.breakdowns || {}) };
    const g = note.gen ?? getGlobalGen();
    setGen(g);
    setMenuOpen(false);
    void load(note, g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // User flips the per-note control: persist it as this note's override (beats
  // global), and show that combo (cached → instant, else generate).
  const changeGen = useCallback(
    (g: GenPref) => {
      if (!note) return;
      setGen(g);
      void setNoteGen(note.id, g);
      void load(note, g);
    },
    [note, load]
  );

  // If the global default changes while a note WITHOUT an override is open,
  // follow it live.
  useEffect(() => {
    const onPref = () => {
      if (!note || note.gen) return; // an explicit per-note override wins
      const g = getGlobalGen();
      setGen(g);
      void load(note, g);
    };
    window.addEventListener(GEN_PREF_EVENT, onPref);
    return () => window.removeEventListener(GEN_PREF_EVENT, onPref);
  }, [note, load]);

  // A page is not a popup: never dismiss on outside tap. Esc closes (back).
  useEffect(() => {
    if (!note) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, onClose]);

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
      const key = comboKey(gen.level, gen.style);
      cacheRef.current[key] = next;
      await setBreakdownFor(note.id, key, next); // persist the edit to this combo
    },
    [note, gen.level, gen.style]
  );

  // Persist flowchart edits (label/drag/connect/delete/re-layout). We do NOT
  // setData here — that would remount the live React Flow editor and reset it on
  // every nudge; FlowChart owns its state, we only persist the spec.
  const editFlow = useCallback(
    async (flow: FlowSpec) => {
      const cur = dataRef.current;
      if (!note || !cur) return;
      const next = { ...cur, flow };
      dataRef.current = next;
      const key = comboKey(gen.level, gen.style);
      cacheRef.current[key] = next;
      await setBreakdownFor(note.id, key, next);
    },
    [note, gen.level, gen.style]
  );

  if (!note) return null;

  const hasBody = !!data && !!data.markdown;
  const isFlow = !!data && !!data.flow; // a process → flowchart, not prose
  // Current depth/style labels for the dropdown trigger ("Student · Prose").
  const levelLabel = LEVELS.find((l) => l.key === gen.level)?.label ?? gen.level;
  const styleLabel = STYLES.find((s) => s.key === gen.style)?.label ?? gen.style;

  return (
    <div className="micro-page-layer">
      <div className="micro-page" role="dialog" aria-label={`${note.title}`}>
        <div className="micro-head">
          <div className="micro-titlewrap">
            <div className="micro-title">{note.title || "Untitled"}</div>
            {gist && <div className="micro-gist">{gist}</div>}
          </div>
          {/* Delete lives only in the sidebar now — removed from the page. */}
        </div>

        {/* BUG2 fix: ONE clear, labeled dropdown reading the current state
            ("Student · Prose ⌄"). Tapping reveals plain-labelled Depth + Style
            options; changing one visibly regenerates the note below (cause→effect).
            Override beats the global default for THIS note. Hidden for a flowchart
            (a process's form is the chart, not prose depth/style). */}
        {!isFlow && (
          <div className="gen-control">
            <span className="gen-control-label">This note</span>
            <button
              className="gen-trigger"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Change depth & style"
            >
              <span className="gen-trigger-text">
                <span style={{ color: OPTION_COLOR[gen.level] }}>{levelLabel}</span>
                {" · "}
                <span style={{ color: OPTION_COLOR[gen.style] }}>{styleLabel}</span>
              </span>
              <IconChevronDown className="gen-caret" aria-hidden="true" />
            </button>
            {menuOpen && (
              <>
                <div
                  className="gen-menu-scrim"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="gen-menu" role="menu" aria-label="Depth and style">
                  <div className="gen-menu-group">
                    <div className="gen-menu-label">Depth</div>
                    {LEVELS.map((l) => (
                      <button
                        key={l.key}
                        role="menuitemradio"
                        aria-checked={gen.level === l.key}
                        className={`gen-menu-opt${gen.level === l.key ? " on" : ""}`}
                        onClick={() => changeGen({ ...gen, level: l.key })}
                      >
                        <span className="gen-menu-mark" aria-hidden="true">
                          {gen.level === l.key && <IconCheck />}
                        </span>
                        <span style={{ color: OPTION_COLOR[l.key] }}>{l.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="gen-menu-group">
                    <div className="gen-menu-label">Style</div>
                    {STYLES.map((s) => (
                      <button
                        key={s.key}
                        role="menuitemradio"
                        aria-checked={gen.style === s.key}
                        className={`gen-menu-opt${gen.style === s.key ? " on" : ""}`}
                        onClick={() => changeGen({ ...gen, style: s.key })}
                      >
                        <span className="gen-menu-mark" aria-hidden="true">
                          {gen.style === s.key && <IconCheck />}
                        </span>
                        <span style={{ color: OPTION_COLOR[s.key] }}>{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="micro-loading">writing this note…</div>
        ) : (
          <>
            {isFlow ? (
              <>
                <FlowChart key={data!.generatedAt} spec={data!.flow!} onChange={editFlow} />
                <div className="micro-foot">
                  provisional flowchart — edit a label, drag, connect, or re-tidy
                </div>
              </>
            ) : (
            hasBody && (
              <>
                <MicroNoteBody
                  key={data!.generatedAt}
                  markdown={data!.markdown}
                  onOpen={onOpen}
                  // Web-cited content is trustworthy (real sources) → render as
                  // real ink, not the faded provisional ghost. Only a draft with
                  // neither local nor web grounding stays grey.
                  ghost={!data!.grounded && !(data!.webSources?.length)}
                  onChange={editBody}
                />
                <div className="micro-foot">
                  {data!.grounded
                    ? `from your notes${
                        data!.sources.length > 0 ? ` · ${data!.sources.join(", ")}` : ""
                      }`
                    : data!.webSources?.length
                    ? "from the web"
                    : "draft · provisional — edit or keep"}
                </div>

                {/* Real, named, popular web sources — number · name · domain,
                    each tappable to open the source in a new tab. */}
                {!!data!.webSources?.length && (
                  <section className="micro-section">
                    <div className="micro-label">Sources</div>
                    <ol className="sources-list">
                      {data!.webSources!.map((s) => (
                        <li key={s.n} className="source-item">
                          <a
                            className="source-link"
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span className="source-n">{s.n}</span>
                            <span className="source-name">{s.name}</span>
                            <span className="source-domain">{s.domain}</span>
                            <IconExternalLink className="source-ext" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )
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
