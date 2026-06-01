import { get, set, del, clear } from "idb-keyval";
import type { JSONContent } from "@tiptap/core";
import type { GenPref } from "./genPref";
import type { FlowSpec } from "./flow";

/**
 * Document model + connection graph, persisted in IndexedDB (survives refresh,
 * offline-first, handles real size). localStorage holds only prefs.
 * Last-write-wins; no server sync yet.
 */

/** A note is either student-written or an auto-spun micro-note (a concept). */
export type NoteKind = "written" | "micro";

export type NoteMeta = {
  id: string;
  title: string;
  updatedAt: number;
  kind?: NoteKind; // undefined = legacy = "written"
  archived?: boolean; // hidden from the tree, not deleted
};

/**
 * A grounded ELI5 breakdown of a micro-note concept — generated lazily on first
 * open and cached here so subsequent opens are instant. `grounded:false` means
 * the notes/sources don't cover the concept (we say so, never invent).
 */
/**
 * A generated atomic note (v3.4) — real markdown content (prose/checkboxes/
 * tables/lists), rendered as live TipTap. `grounded` true → drawn from the
 * user's sources (cited); false → a provisional general-knowledge note (ghost).
 */
// A real web source backing a cited claim (numbered, named, tappable).
export type WebSource = { n: number; name: string; domain: string; url: string };

export type NoteBreakdown = {
  grounded: boolean;
  markdown: string; // the generated note body, as markdown
  sources: string[]; // cited note/source titles ("from your notes · …")
  webSources?: WebSource[]; // real web citations (numbered SOURCES list)
  flow?: FlowSpec; // v3.6: when the concept is a process → an editable flowchart
  generatedAt: number;
};

export type NoteRecord = {
  id: string;
  title: string;
  doc: JSONContent; // ProseMirror JSON — carries origin/highlight/reference marks
  cursor: number;
  scroll: number;
  links: string[]; // note ids this note references (the connection graph)
  updatedAt: number;
  createdAt?: number; // when the note was first made (powers the activity strip)
  kind?: NoteKind; // undefined = legacy = "written"
  gist?: string; // one-line summary stored on spawn (breakdown is lazy)
  archived?: boolean;
  breakdown?: NoteBreakdown; // legacy single cached breakdown (kept for migration)
  // v3.6: one cached breakdown PER (level, style) combo (keyed by comboKey) so
  // switching depth/style is instant after first generation.
  breakdowns?: Record<string, NoteBreakdown>;
  gen?: GenPref; // this note's per-note level/style override (beats the global default)
};

const NOTE = (id: string) => `note:${id}`;
const INDEX = "note-index";
const ACTIVE = "active-note";
const TREE_EXPAND = "tree-expand"; // { [nodeId]: boolean }
const TREE_LABELS = "tree-labels"; // { [clusterKey]: label }
const DISMISSED = "dismissed-phrases"; // normalized phrases never to re-spawn
const SOURCE = (id: string) => `source:${id}`;
const SOURCE_INDEX = "source-index";

// ── Sources (the truth layer) ─────────────────────────────────────────────
// An uploaded document, converted to Markdown, becomes a source — exactly like
// the static `/sources/*.md` files, but persisted client-side and sent to the
// grounding route in the request body so uploaded knowledge is groundable too.
export type SourceTier = "peer" | "lecture" | "textbook" | "guideline";

export type SourceRecord = {
  id: string;
  title: string;
  markdown: string;
  tier: SourceTier;
  kind: string; // pill kind: pdf | slides | image | audio | doc
  image?: string; // data URL (images only) — powers the colour toggle in peek
  createdAt: number;
};

export type SourceMeta = {
  id: string;
  title: string;
  tier: SourceTier;
  kind: string;
};

/** Sensible default authority tier by document type (Gap 3 backend reads it). */
export function defaultTier(kind: string): SourceTier {
  if (kind === "slides") return "lecture";
  if (kind === "pdf" || kind === "doc") return "textbook";
  return "peer"; // images, audio, loose notes
}

export async function saveSource(rec: SourceRecord): Promise<void> {
  await set(SOURCE(rec.id), rec);
  const idx = await getSourceIndex();
  const meta: SourceMeta = {
    id: rec.id,
    title: rec.title,
    tier: rec.tier,
    kind: rec.kind,
  };
  const i = idx.findIndex((s) => s.id === rec.id);
  if (i >= 0) idx[i] = meta;
  else idx.push(meta);
  await set(SOURCE_INDEX, idx);
}

export async function getSourceIndex(): Promise<SourceMeta[]> {
  return (await get<SourceMeta[]>(SOURCE_INDEX)) ?? [];
}

export async function getSource(id: string): Promise<SourceRecord | undefined> {
  return await get<SourceRecord>(SOURCE(id));
}

export async function getAllSources(): Promise<SourceRecord[]> {
  const idx = await getSourceIndex();
  const recs = await Promise.all(idx.map((m) => getSource(m.id)));
  return recs.filter((r): r is SourceRecord => !!r);
}

export async function deleteSource(id: string): Promise<void> {
  await del(SOURCE(id));
  const idx = (await getSourceIndex()).filter((s) => s.id !== id);
  await set(SOURCE_INDEX, idx);
}

/** Compact payload sent to /api/ground so uploaded sources are groundable. */
export async function groundingSources(): Promise<
  { title: string; markdown: string; tier: SourceTier }[]
> {
  return (await getAllSources()).map((s) => ({
    title: s.title,
    markdown: s.markdown,
    tier: s.tier,
  }));
}

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `n_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyDoc(title: string): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: `# ${title}` }] },
      { type: "paragraph" },
    ],
  };
}

/**
 * A brand-new note: just an empty `# ` heading line — no ceremony. Start
 * typing on the title. (Trailing space so the cursor lands after the marker.)
 */
export function newDoc(seedTitle = ""): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: `# ${seedTitle}` }] },
      { type: "paragraph" },
    ],
  };
}

/** Build a ProseMirror doc (plain paragraphs) from raw markdown text. */
export function docFromText(text: string): JSONContent {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" }
    ),
  };
}

/**
 * Build a doc from seed markdown where `[verb: text]` denotes a verb-tag
 * highlight. The brackets are stripped; the verb is stored as a mark attribute.
 */
export function docFromSeed(text: string): JSONContent {
  const VERB = /\[(find|do|avoid|because):\s*([^\]]+)\]/g;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => {
      if (!line) return { type: "paragraph" };
      const nodes: JSONContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      VERB.lastIndex = 0;
      while ((m = VERB.exec(line)) !== null) {
        if (m.index > last) nodes.push({ type: "text", text: line.slice(last, m.index) });
        nodes.push({
          type: "text",
          text: m[2],
          marks: [{ type: "verbtag", attrs: { verb: m[1] } }],
        });
        last = m.index + m[0].length;
      }
      if (last < line.length) nodes.push({ type: "text", text: line.slice(last) });
      return nodes.length ? { type: "paragraph", content: nodes } : { type: "paragraph" };
    }),
  };
}

/** Title = first non-empty line, leading #/spaces stripped. */
export function deriveTitle(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.replace(/^#{1,6}\s*/, "").trim();
    if (t) return t;
  }
  return "Untitled";
}

/** Wipe the entire local database — every note, source, graph edge, and tree
 * state. There is no server DB; all docs live in this browser's IndexedDB. */
export async function clearAll(): Promise<void> {
  await clear();
}

export async function getIndex(): Promise<NoteMeta[]> {
  return (await get<NoteMeta[]>(INDEX)) ?? [];
}

export async function getNote(id: string): Promise<NoteRecord | undefined> {
  return await get<NoteRecord>(NOTE(id));
}

/** Cache a generated breakdown on a note (lazy generation → instant re-open). */
export async function setBreakdown(
  id: string,
  breakdown: NoteBreakdown
): Promise<void> {
  const rec = await getNote(id);
  if (!rec) return;
  rec.breakdown = breakdown;
  await saveNote(rec);
}

/** v3.6: cache a breakdown for a specific (level, style) combo so switching
 *  depth/style is instant after first generation. */
export async function setBreakdownFor(
  id: string,
  key: string,
  breakdown: NoteBreakdown
): Promise<void> {
  const rec = await getNote(id);
  if (!rec) return;
  rec.breakdowns = { ...(rec.breakdowns || {}), [key]: breakdown };
  rec.breakdown = breakdown; // keep the legacy field pointing at the latest
  await saveNote(rec);
}

/** v3.6: persist a note's per-note level/style override (beats the global default). */
export async function setNoteGen(id: string, gen: GenPref): Promise<void> {
  const rec = await getNote(id);
  if (!rec) return;
  rec.gen = gen;
  await saveNote(rec);
}

export async function getActiveNoteId(): Promise<string | undefined> {
  return await get<string>(ACTIVE);
}

export async function setActiveNoteId(id: string): Promise<void> {
  await set(ACTIVE, id);
}

export async function saveNote(rec: NoteRecord): Promise<void> {
  rec.updatedAt = Date.now();
  await set(NOTE(rec.id), rec);
  const idx = await getIndex();
  const meta: NoteMeta = {
    id: rec.id,
    title: rec.title,
    updatedAt: rec.updatedAt,
    kind: rec.kind ?? "written",
    archived: rec.archived ?? false,
  };
  const i = idx.findIndex((n) => n.id === rec.id);
  if (i >= 0) idx[i] = meta;
  else idx.push(meta);
  await set(INDEX, idx);
}

export async function createNote(
  title: string,
  doc?: JSONContent,
  kind: NoteKind = "written",
  meta?: { gist?: string }
): Promise<NoteRecord> {
  const rec: NoteRecord = {
    id: genId(),
    title,
    doc: doc ?? emptyDoc(title),
    cursor: 1,
    scroll: 0,
    links: [],
    updatedAt: Date.now(),
    createdAt: Date.now(),
    kind,
    gist: meta?.gist,
  };
  await saveNote(rec);
  return rec;
}

/** How many OTHER notes link to this one. */
export async function linkedInCount(targetId: string): Promise<number> {
  const idx = await getIndex();
  let n = 0;
  for (const m of idx) {
    if (m.id === targetId) continue;
    const rec = await getNote(m.id);
    if (rec?.links?.includes(targetId)) n++;
  }
  return n;
}

/** All full note records (notes are small; N is modest). Archived hidden by default. */
export async function getAllNotes(includeArchived = false): Promise<NoteRecord[]> {
  const idx = await getIndex();
  const recs = await Promise.all(idx.map((m) => getNote(m.id)));
  return recs.filter(
    (r): r is NoteRecord => !!r && (includeArchived || !r.archived)
  );
}

// ── Deletion & archive ────────────────────────────────────────────────────
// Removing a note must never leave a dangling link: we strip every `reference`
// mark (and graph edge) pointing at it from all other notes.

function stripRefMarks(node: JSONContent, targetId: string): JSONContent {
  const marks = node.marks?.filter(
    (m) => !(m.type === "reference" && m.attrs?.noteId === targetId)
  );
  const out: JSONContent = { ...node };
  if (node.marks) out.marks = marks;
  if (node.content) out.content = node.content.map((c) => stripRefMarks(c, targetId));
  return out;
}

async function detachLinksTo(targetId: string): Promise<void> {
  const notes = await getAllNotes(true);
  for (const n of notes) {
    if (n.id === targetId) continue;
    const had = (n.links || []).includes(targetId);
    const before = JSON.stringify(n.doc);
    const doc = stripRefMarks(n.doc, targetId);
    const changed = had || JSON.stringify(doc) !== before;
    if (!changed) continue;
    n.doc = doc;
    n.links = (n.links || []).filter((id) => id !== targetId);
    await saveNote(n);
  }
}

/**
 * Delete ONLY the selected note. Its links to other notes are detached so no
 * dangling reference marks remain, but no other note (including micro-notes it
 * birthed) is removed — deleting one note never takes its tree with it.
 * Returns the removed record so the caller can offer undo. `orphans` is kept in
 * the return shape (always empty now) so callers/undo stay unchanged.
 */
export async function deleteNote(
  id: string
): Promise<{ removed: NoteRecord; orphans: NoteRecord[] }> {
  const removed = await getNote(id);
  if (!removed) throw new Error("note not found");

  await detachLinksTo(id);
  await hardRemove(id);
  return { removed, orphans: [] };
}

async function hardRemove(id: string): Promise<void> {
  await del(NOTE(id));
  const idx = (await getIndex()).filter((m) => m.id !== id);
  await set(INDEX, idx);
}

/** Re-insert a deleted note (and its orphaned micros) — powers undo. */
export async function restoreNotes(recs: NoteRecord[]): Promise<void> {
  for (const r of recs) await saveNote(r);
}

/** Archive / unarchive: hide from the tree without deleting. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  const rec = await getNote(id);
  if (!rec) return;
  rec.archived = archived;
  await saveNote(rec);
}

// ── Dismissed concept phrases (Gap 2) ─────────────────────────────────────
export async function getDismissed(): Promise<string[]> {
  return (await get<string[]>(DISMISSED)) ?? [];
}
export async function addDismissed(phrase: string): Promise<void> {
  const norm = phrase.toLowerCase().trim().replace(/\s+/g, " ");
  const cur = await getDismissed();
  if (!cur.includes(norm)) await set(DISMISSED, [...cur, norm]);
}

/**
 * One-time migration for notes saved before `kind` existed: an auto micro-note
 * is one that other notes reference but that links to nothing itself. Runs once
 * (guarded by a flag) so legacy concepts render as micro-notes, not documents.
 */
export async function migrateKinds(): Promise<void> {
  const FLAG = "kind-migrated-v1";
  if (await get(FLAG)) return;
  const notes = await getAllNotes();
  const referenced = new Set<string>();
  notes.forEach((n) => (n.links || []).forEach((id) => referenced.add(id)));
  for (const n of notes) {
    if (n.kind) continue;
    const kind: NoteKind =
      referenced.has(n.id) && (n.links?.length ?? 0) === 0 ? "micro" : "written";
    n.kind = kind;
    await saveNote(n);
  }
  await set(FLAG, true);
}

// ── Sidebar tree state (persisted so it's stable across reloads) ──────────
export async function getTreeExpand(): Promise<Record<string, boolean>> {
  return (await get<Record<string, boolean>>(TREE_EXPAND)) ?? {};
}
export async function setTreeExpand(map: Record<string, boolean>): Promise<void> {
  await set(TREE_EXPAND, map);
}
export async function getClusterLabels(): Promise<Record<string, string>> {
  return (await get<Record<string, string>>(TREE_LABELS)) ?? {};
}
export async function setClusterLabels(map: Record<string, string>): Promise<void> {
  await set(TREE_LABELS, map);
}

/** Plain text body of a note's doc (for "mentions" matching). */
export function noteText(doc: JSONContent): string {
  const parts: string[] = [];
  const walk = (n: JSONContent | undefined) => {
    if (!n) return;
    if (typeof n.text === "string") parts.push(n.text);
    n.content?.forEach(walk);
  };
  walk(doc);
  return parts.join(" ");
}

/** The concept phrases this note links to — the graph edges, as words. */
export function noteConcepts(doc: JSONContent): string[] {
  const out = new Set<string>();
  const walk = (n: JSONContent | undefined) => {
    if (!n) return;
    n.marks?.forEach((mk) => {
      if (mk.type === "reference" && typeof mk.attrs?.title === "string") {
        out.add(mk.attrs.title);
      }
    });
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...out];
}
