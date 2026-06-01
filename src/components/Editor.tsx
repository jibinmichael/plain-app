"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { Node as PMNode, MarkType } from "@tiptap/pm/model";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { UndoRedo, Gapcursor, Dropcursor, Placeholder } from "@tiptap/extensions";
import { Fragment, Slice } from "@tiptap/pm/model";
import { get, set } from "idb-keyval";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowLeft } from "@tabler/icons-react";

import { Origin } from "@/editor/origin";
import { Highlight } from "@/editor/highlight";
import { VerbTag } from "@/editor/verbTag";
import { Reference } from "@/editor/reference";
import { AutoLink, setTitleIndex } from "@/editor/autoLink";
import { MarkdownSyntax } from "@/editor/markdownSyntax";
import { GhostFill, setGhost, setThinking, clearGhost } from "@/editor/ghostFill";
import { findPhraseSpan } from "@/editor/textmatch";
import {
  Attachment,
  kindOf,
  setAttachmentStatus,
  type AttachKind,
} from "@/editor/attachment";
import {
  type NoteRecord,
  type SourceRecord,
  defaultTier,
  saveSource,
  getSource,
  groundingSources,
  addDismissed,
  clearAll,
  createNote,
  deleteNote,
  deriveTitle,
  docFromSeed,
  docFromText,
  newDoc,
  getActiveNoteId,
  getAllNotes,
  getDismissed,
  getIndex,
  getNote,
  migrateKinds,
  restoreNotes,
  saveNote,
  setActiveNoteId,
  setArchived,
} from "@/lib/store";
import PeekLayer from "./PeekLayer";
import CommandField from "./CommandField";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import Toast, { type ToastState } from "./Toast";
import AttachPeek, { type PeekData } from "./AttachPeek";
import MicroBreakdown from "./MicroBreakdown";

// Near-instant ghost: a short pause (not every keystroke) kicks off the fetch,
// and the "thinking…" cue appears immediately so the pause never feels frozen.
// AbortController cancels stale calls, so firing eagerly is cheap.
const PAUSE_MS = 250;
const SAVE_MS = 500;
const CONCEPT_MS = 1200;
const HIGHLIGHT_MS = 2000; // auto-highlight key points (longest debounce — calm)
const SEED_KEY = "seed-version";
const SEED_VER = "v0.5-ami";
// v2.1 — auto-linking whispers. The very first auto-created page ever earns a
// one-time gentle explainer (persisted, never repeats); after that, terse lines.
const FIRST_CREATE_KEY = "first-autocreate-shown";
const EXPLAINER =
  "plain makes a page for important concepts automatically, so you don't have to. they're yours to edit or remove.";
const WHISPER_MS = 3500; // how long an action whisper lingers before self-dismiss
// Uploads stay in the codebase but dormant behind a flag (default off) until
// the conversion service is hosted. Off → no attach affordance anywhere.
const UPLOADS = process.env.NEXT_PUBLIC_ENABLE_UPLOADS === "true";

const AMI_SEED = `# Acute myocardial infarction

## Presentation
Central crushing chest pain radiating to the left arm or jaw, with sweating and nausea. Lasts more than 20 minutes and is not relieved by rest.

## Investigations
ECG first — ST elevation in II, III and aVF points to an inferior MI, because this territory is supplied by the right coronary artery.
Troponin rises within 3–4 hours and peaks around 24 hours.

## Management
Primary PCI within 90 minutes is first-line, with aspirin given immediately. Do not miss cardiogenic shock, the most dangerous early complication.`;

function norm(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// Atomic note format for an auto-generated page: a title, a one-line definition,
// then the concept's facts as separate bullet lines (one idea per line) — not a
// single prose blob. Falls back to just the summary if no points were returned.
function atomicSeed(phrase: string, summary: string, points: string[]): string {
  const lines = [`# ${phrase}`, ""];
  if (summary) lines.push(summary, "");
  const facts = (points || []).map((p) => p.trim()).filter(Boolean);
  for (const f of facts) lines.push(`- ${f}`);
  // Always leave a trailing blank line so the page invites more atomic notes.
  if (facts.length) lines.push("");
  return lines.join("\n");
}

function extractLinks(editor: TiptapEditor): string[] {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    node.marks.forEach((m) => {
      if (m.type.name === "reference" && m.attrs.noteId) ids.add(m.attrs.noteId);
    });
  });
  return [...ids];
}

/**
 * First whole-word, not-yet-referenced occurrence of `phrase` in the doc.
 * Delegates to the shared matcher (`textmatch.ts`) — whole-word boundaries and
 * position-accurate even across hard breaks / atom nodes (no mid-word/mid-text
 * starts). Thin alias so the call sites below stay unchanged.
 */
function findPhrase(
  doc: PMNode,
  phrase: string,
  refType: MarkType
): { from: number; to: number } | null {
  return findPhraseSpan(doc, phrase, refType);
}

export default function Editor() {
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conceptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const conceptAbort = useRef<AbortController | null>(null);
  const lastConceptText = useRef("");
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightAbort = useRef<AbortController | null>(null);
  const lastHighlightText = useRef("");
  const loading = useRef(true);
  const scrollEl = useRef<HTMLElement | null>(null);
  const activeKind = useRef<NoteRecord["kind"]>("written");

  const activeId = useRef<string | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [activeNoteId, setActiveNoteId_] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRecord[]>([]); // full records → sidebar tree
  const [docked, setDocked] = useState(true);
  const [sideOpen, setSideOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [online, setOnline] = useState(true);
  const dismissed = useRef<Set<string>>(new Set());
  const [peek, setPeek] = useState<PeekData | null>(null);
  const [microNote, setMicroNote] = useState<NoteRecord | null>(null);
  // Page navigation history. A note is a destination, so opening one replaces
  // the view and pushes the previous onto a back-stack. `currentView` tracks
  // what is on screen (the editor's note OR a micro page) so onOpen knows what
  // to push; back-stack drives the single `.nav-back` chip.
  const navStack = useRef<string[]>([]);
  const currentView = useRef<string | null>(null);
  const [canBack, setCanBack] = useState(false);
  // v2.1 auto-linking whisper: one quiet, self-dismissing status line.
  const [whisper, setWhisper] = useState<{
    id: number;
    text: string;
    openId?: string; // when set, the whisper is a tap target that opens this note
  } | null>(null);
  const whisperSeq = useRef(0);
  const whisperTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Graph edges added by uploads (concepts found in a converted source) that
  // aren't visible text in the note. Unioned into `links` on save so the tree
  // can nest the source's concepts under this note — and they survive reload.
  const extraLinks = useRef<Set<string>>(new Set()); // overlay when not docked

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Gapcursor,
      Dropcursor,
      Placeholder.configure({
        // First-run / empty: a single faint line that teaches the one gesture
        // and vanishes on the first keystroke. The caret invites you to write.
        placeholder: "just start writing",
        showOnlyWhenEditable: true,
        includeChildren: false,
      }),
      Origin,
      Highlight, // legacy marks kept in schema (render plain) so old docs load
      VerbTag, // legacy mark kept in schema (renders plain) so old docs load
      Reference,
      AutoLink,
      MarkdownSyntax,
      GhostFill,
      Attachment,
    ],
    content: "",
    editorProps: {
      attributes: {
        autocorrect: "off",
        autocapitalize: "sentences",
        autocomplete: "off",
        spellcheck: "false",
        translate: "no",
        class: "editor-canvas",
        "aria-label": "Markdown note editor",
      },
      transformPasted(slice, view) {
        const origin = view.state.schema.marks.origin;
        if (!origin) return slice;
        const mark = origin.create({ kind: "pasted" });
        const addMark = (fragment: Fragment): Fragment => {
          const out: PMNode[] = [];
          fragment.forEach((node) => {
            out.push(
              node.isText
                ? node.mark(mark.addToSet(node.marks))
                : node.copy(addMark(node.content))
            );
          });
          return Fragment.fromArray(out);
        };
        return new Slice(addMark(slice.content), slice.openStart, slice.openEnd);
      },
    },
  });

  // Keeps the auto-link title index fresh; full records feed the sidebar tree
  // (it memoizes on a signature, so this only rebuilds when titles/links/kinds
  // actually change — never on caret moves).
  const refreshIndex = useCallback(async () => {
    const idx = await getIndex();
    setTitleIndex(idx.filter((n) => n.id !== activeId.current));
    setNotes(await getAllNotes());
  }, []);

  const loadNote = useCallback(
    (rec: NoteRecord) => {
      if (!editor) return;
      loading.current = true;
      lastConceptText.current = "";
      activeId.current = rec.id;
      currentView.current = rec.id;
      activeKind.current = rec.kind ?? "written";
      setActiveNoteId_(rec.id);
      editor.commands.setContent(rec.doc);
      const size = editor.state.doc.content.size;
      editor.commands.setTextSelection(Math.min(Math.max(rec.cursor, 1), size));
      // Recover upload-origin graph edges: links not represented by a mark.
      const markLinks = new Set(extractLinks(editor));
      extraLinks.current = new Set((rec.links || []).filter((id) => !markLinks.has(id)));
      setActiveNoteId(rec.id);
      getIndex().then((idx) => setTitleIndex(idx.filter((n) => n.id !== rec.id)));
      requestAnimationFrame(() => {
        if (scrollEl.current) scrollEl.current.scrollTop = rec.scroll || 0;
        loading.current = false;
      });
    },
    [editor]
  );

  // Boot: migrate legacy kinds, seed the AMI sample once, load active note.
  useEffect(() => {
    if (!editor) return;
    scrollEl.current = document.querySelector(".editor-scroll");
    let cancelled = false;
    (async () => {
      // One-time database wipe: clears every note/source/graph in this browser's
      // IndexedDB, once, on the next load. Bump PURGE_VER to wipe again later.
      const PURGE_VER = "purge-2-test";
      if (localStorage.getItem("plain-purge") !== PURGE_VER) {
        await clearAll();
        localStorage.setItem("plain-purge", PURGE_VER);
      }
      await migrateKinds();
      dismissed.current = new Set(await getDismissed());
      let idx = await getIndex();
      let id = await getActiveNoteId();
      const ver = await get(SEED_KEY);
      const needSeed =
        ver !== SEED_VER || idx.length === 0 || !id || !(await getNote(id));
      if (needSeed) {
        const sample = await createNote(deriveTitle(AMI_SEED), docFromSeed(AMI_SEED));
        await setActiveNoteId(sample.id);
        await set(SEED_KEY, SEED_VER);
        idx = await getIndex();
        id = sample.id;
      }
      const rec = await getNote(id!);
      if (cancelled || !rec) return;
      setTitleIndex(idx.filter((n) => n.id !== rec.id));
      setNotes(await getAllNotes());
      loadNote(rec);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Invisible, absolute autosave (debounced).
  useEffect(() => {
    if (!editor) return;
    const save = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (loading.current || !activeId.current) return;
        const text = editor.getText({ blockSeparator: "\n" });
        const rec: NoteRecord = {
          id: activeId.current,
          title: deriveTitle(text),
          doc: editor.getJSON(),
          cursor: editor.state.selection.from,
          scroll: scrollEl.current?.scrollTop ?? 0,
          links: [...new Set([...extractLinks(editor), ...extraLinks.current])],
          updatedAt: Date.now(),
          kind: activeKind.current, // preserve written/micro across edits
        };
        await saveNote(rec);
        await refreshIndex();
      }, SAVE_MS);
    };
    editor.on("update", save);
    editor.on("selectionUpdate", save);
    const el = scrollEl.current;
    el?.addEventListener("scroll", save, { passive: true });
    return () => {
      editor.off("update", save);
      editor.off("selectionUpdate", save);
      el?.removeEventListener("scroll", save);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editor, refreshIndex]);

  // Pause → grounded ambient line (clause boundaries only; stale calls aborted).
  useEffect(() => {
    if (!editor) return;
    const schedule = () => {
      // Don't wipe an existing ghost on every keystroke — it stays as a faint
      // guide (the big picture) until accepted (Tab/tap), dismissed (Esc), or
      // replaced by the next grounded suggestion on the next pause.
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
      ghostTimer.current = setTimeout(fetchGhost, PAUSE_MS);
    };
    const fetchGhost = async () => {
      if (!navigator.onLine) return; // offline → AI quietly pauses
      const view = editor.view;
      const { selection } = view.state;
      if (!selection.empty) return;
      const $from = selection.$from;
      // NEVER fill the title line. The first textblock is the note's title (a
      // `# ` heading); a ghost there would rewrite the title — guard it out.
      const para = $from.parent.textContent;
      const isHeading = /^\s*#{1,6}\s/.test(para);
      const isFirstBlock = $from.before() === 0;
      if (isHeading || isFirstBlock) return;
      const offset = $from.parentOffset;
      if (offset !== para.length) return;
      const query = para.slice(0, offset);
      if (query.trim().length < 3) return;
      const boundary = /\s$/.test(query) || /[.,;:—-]$/.test(query.trimEnd());
      if (!boundary) return;
      const id = ++reqId.current;
      const from = selection.from;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // Show the pulsing "thinking…" cue at once so the pause reads as "help is
      // coming", not frozen — it sits there until the ghost lands or we bail.
      setThinking(view, from);
      try {
        const res = await fetch("/api/ground", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: query,
            mode: "continue",
            sources: await groundingSources(), // uploaded knowledge too
          }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { grounded: boolean; text?: string };
        if (id !== reqId.current) return;
        const v = editor.view;
        if (v.state.selection.from !== from || !v.state.selection.empty) {
          clearGhost(v);
          return;
        }
        // Grounded-or-ghost: show the suggestion whenever there's text — grounded
        // (cited) or an ungrounded general-knowledge fallback. Both render as the
        // same provisional gradient ghost; neither auto-commits. No text → drop
        // the thinking cue so it never hangs.
        if (data.text) setGhost(v, data.text, from);
        else clearGhost(v);
      } catch {
        // Aborted (stale) → the newer call owns the cue; a real failure → clear
        // ours so "thinking…" never sticks. Only touch state if still current.
        if (id === reqId.current && !ctrl.signal.aborted) clearGhost(editor.view);
      }
    };
    editor.on("update", schedule);
    editor.on("selectionUpdate", schedule);
    return () => {
      editor.off("update", schedule);
      editor.off("selectionUpdate", schedule);
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
    };
  }, [editor]);

  // Settle a phrase into a link without disturbing the cursor.
  const applyRef = useCallback(
    (from: number, to: number, noteId: string, title: string) => {
      if (!editor) return;
      const refType = editor.state.schema.marks.reference;
      if (!refType) return;
      const max = editor.state.doc.content.size;
      if (from < 0 || to > max || from >= to) return;
      if (editor.state.doc.rangeHasMark(from, to, refType)) return;
      const tr = editor.state.tr.addMark(from, to, refType.create({ noteId, title }));
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    },
    [editor]
  );

  // Apply a key-point highlight to a span without disturbing the cursor (mirrors
  // applyRef). Skips ranges already highlighted so re-runs don't stack.
  const applyHighlight = useCallback(
    (from: number, to: number) => {
      if (!editor) return;
      const hl = editor.state.schema.marks.highlight;
      if (!hl) return;
      const max = editor.state.doc.content.size;
      if (from < 0 || to > max || from >= to) return;
      if (editor.state.doc.rangeHasMark(from, to, hl)) return;
      const tr = editor.state.tr.addMark(from, to, hl.create({}));
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    },
    [editor]
  );

  // Show one quiet whisper; it self-dismisses after `ms`. A newer whisper
  // replaces an older one (no stacking). `tappable` makes the line a tap target.
  const showWhisper = useCallback(
    (text: string, ms: number, openId?: string) => {
      const id = ++whisperSeq.current;
      setWhisper({ id, text, openId });
      if (whisperTimer.current) clearTimeout(whisperTimer.current);
      whisperTimer.current = setTimeout(() => {
        setWhisper((w) => (w && w.id === id ? null : w));
      }, ms);
    },
    []
  );

  // The heart of plain: turn concepts in the text into linked micro-notes —
  // and narrate it in a whisper so the student always knows what happened and
  // whether it LINKED to a note they already had vs CREATED a new one.
  const processConcepts = useCallback(async () => {
    if (!editor || loading.current) return;
    // NO CASCADE: a note that was itself auto-generated must never spawn more
    // notes. The chain stops at depth 1 — only user-written notes spawn concepts.
    if (activeKind.current === "micro") return;
    const text = editor.getText({ blockSeparator: "\n" });
    if (text.trim().length < 12) return;
    if (text === lastConceptText.current) return; // only re-run when text changed
    lastConceptText.current = text;

    // HARD PER-NOTE CAP: at most SPAWN_CAP concept notes from a single source
    // note. Count what this note already birthed (its micro links) so repeated
    // debounced passes accumulate toward the cap instead of flooding.
    const SPAWN_CAP = 6;
    const allNotes = await getAllNotes(true);
    const microIds = new Set(
      allNotes.filter((n) => n.kind === "micro").map((n) => n.id)
    );
    const activeRec = activeId.current
      ? allNotes.find((n) => n.id === activeId.current)
      : null;
    let spawnedSoFar = (activeRec?.links || []).filter((l) =>
      microIds.has(l)
    ).length;

    conceptAbort.current?.abort();
    const ctrl = new AbortController();
    conceptAbort.current = ctrl;

    let concepts: { phrase: string; summary: string; points?: string[] }[] = [];
    try {
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      concepts = ((await res.json()).concepts as typeof concepts) || [];
    } catch {
      return;
    }
    if (!editor) return;
    const refType = editor.state.schema.marks.reference;
    if (!refType) return;

    const idx = await getIndex();
    const byTitle = new Map(idx.map((n) => [norm(n.title), n.id]));
    const titleById = new Map(idx.map((n) => [n.id, n.title]));
    // Near-duplicate guard: a slug ignoring punctuation/plurals, so
    // "beta-blockers" reuses an existing "beta blocker" note instead of spawning.
    const slug = (s: string) =>
      norm(s).replace(/[^a-z0-9 ]/g, "").replace(/s\b/g, "").replace(/\s+/g, " ").trim();
    const bySlug = new Map(idx.map((n) => [slug(n.title), n.id]));

    // First resolve every concept to an action: linked-to-existing or new note.
    // (createNote only fires for concepts past the quality floor + not dismissed
    // + not self-link — so "new note created" never lies.)
    type Action = { phrase: string; nid: string; title: string; isNew: boolean };
    const actions: Action[] = [];
    for (const c of concepts) {
      const phrase = (c.phrase || "").trim();
      if (phrase.length < 2) continue;
      if (!findPhrase(editor.state.doc, phrase, refType)) continue;

      const key = norm(phrase);
      if (dismissed.current.has(key)) continue; // user said "not useful"
      let noteId = byTitle.get(key) ?? bySlug.get(slug(phrase));
      if (noteId === activeId.current) continue; // never self-link a note to its own title
      let isNew = false;
      if (!noteId) {
        // Past the hard cap → stop creating new notes (still link existing ones
        // found above). Under-spawn rather than flood.
        if (spawnedSoFar >= SPAWN_CAP) continue;
        // Auto-dedupe: one micro-note per concept; seed it in atomic format.
        const rec = await createNote(
          phrase,
          docFromText(atomicSeed(phrase, c.summary || "", c.points || [])),
          "micro", // auto-spun concept → micro-note (nests under its parent)
          { gist: c.summary || "" }
        );
        noteId = rec.id;
        isNew = true;
        spawnedSoFar += 1;
        byTitle.set(key, noteId);
        bySlug.set(slug(phrase), noteId);
      }
      actions.push({
        phrase,
        nid: noteId,
        title: isNew ? phrase : titleById.get(noteId) ?? phrase,
        isNew,
      });
    }

    if (!actions.length) {
      await refreshIndex(); // idle — total calm, no whisper
      return;
    }

    // The result whisper: distinct messages for linked-vs-created; batch many
    // resolutions into one calm summary; the first-ever creation gets the
    // one-time explainer (then never again).
    const announce = async () => {
      const newCount = actions.filter((a) => a.isNew).length;
      if (newCount > 0 && !(await get(FIRST_CREATE_KEY))) {
        await set(FIRST_CREATE_KEY, true);
        showWhisper(EXPLAINER, 7000);
        return;
      }
      if (actions.length === 1) {
        const a = actions[0];
        if (a.isNew)
          showWhisper("new note created · tap to open", WHISPER_MS, a.nid);
        else showWhisper(`linked to your note ‘${a.title}’`, WHISPER_MS);
      } else {
        showWhisper(`${actions.length} concepts linked`, WHISPER_MS);
      }
    };

    // v3.0: the canvas stays silent — no shimmer, no source dots. Each concept
    // settles directly into a dotted link; one calm whisper confirms the result.
    for (const a of actions) {
      const r = findPhrase(editor.state.doc, a.phrase, refType);
      if (r) applyRef(r.from, r.to, a.nid, a.phrase);
    }
    await refreshIndex();
    await announce();
  }, [editor, applyRef, refreshIndex, showWhisper]);

  useEffect(() => {
    if (!editor) return;
    const run = () => {
      if (conceptTimer.current) clearTimeout(conceptTimer.current);
      conceptTimer.current = setTimeout(() => processConcepts(), CONCEPT_MS);
    };
    editor.on("update", run);
    return () => {
      editor.off("update", run);
      if (conceptTimer.current) clearTimeout(conceptTimer.current);
    };
  }, [editor, processConcepts]);

  // Auto-highlight key points: ask /api/mark for the most important phrases and
  // give each a soft background, so the eye lands on what matters. Link-style
  // pass (addToHistory:false, skips already-marked) — never disturbs typing.
  const processHighlights = useCallback(async () => {
    if (!editor || loading.current) return;
    if (activeKind.current === "micro") return;
    if (!navigator.onLine) return;
    const text = editor.getText({ blockSeparator: "\n" });
    if (text.trim().length < 12) return;
    if (text === lastHighlightText.current) return; // only re-run on real changes
    lastHighlightText.current = text;
    highlightAbort.current?.abort();
    const ctrl = new AbortController();
    highlightAbort.current = ctrl;
    let spans: { text: string }[] = [];
    try {
      const res = await fetch("/api/mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      spans = ((await res.json()).spans as typeof spans) || [];
    } catch {
      return;
    }
    if (!editor) return;
    const hl = editor.state.schema.marks.highlight;
    if (!hl) return;
    for (const s of spans) {
      const phrase = (s.text || "").trim();
      if (phrase.length < 2) continue;
      const r = findPhrase(editor.state.doc, phrase, hl);
      if (r) applyHighlight(r.from, r.to);
    }
  }, [editor, applyHighlight]);

  useEffect(() => {
    if (!editor) return;
    const run = () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => processHighlights(), HIGHLIGHT_MS);
    };
    editor.on("update", run);
    return () => {
      editor.off("update", run);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, [editor, processHighlights]);

  const onOpen = useCallback(
    async (noteId: string, opts?: { back?: boolean }) => {
      const rec = await getNote(noteId);
      if (!rec) return;
      setCmdOpen(false);
      // Record where we are so Back returns here (a note is a destination).
      if (!opts?.back && currentView.current && currentView.current !== noteId) {
        navStack.current.push(currentView.current);
        if (navStack.current.length > 64) navStack.current.shift();
      }
      setCanBack(navStack.current.length > 0);
      currentView.current = rec.id;
      // v3.0: an auto-note (micro/concept) opens as its TYPED TEMPLATE page —
      // editable fields, changeable type, dismissable. A written note loads into
      // the canvas. The editor's note is left untouched under a template page so
      // autosave keeps targeting the written note.
      if (rec.kind === "micro") {
        setActiveNoteId_(rec.id); // sidebar highlight follows the viewed page
        setMicroNote(rec);
      } else {
        setMicroNote(null);
        loadNote(rec);
      }
    },
    [loadNote]
  );

  // Back: pop the previous view and navigate to it without re-pushing. Empty
  // stack (landed straight on a page) → just reveal the editor underneath.
  const goBack = useCallback(async () => {
    const prev = navStack.current.pop();
    setCanBack(navStack.current.length > 0);
    if (!prev) {
      setMicroNote(null);
      return;
    }
    await onOpen(prev, { back: true });
  }, [onOpen]);

  // New note = start typing. No modal: drop into an empty `# ` heading with the
  // cursor already on the title line (seeded with the typed text, if any).
  const onCreate = useCallback(
    async (title: string) => {
      const t = title.trim();
      const rec = await createNote(t, newDoc(t));
      rec.cursor = 3 + t.length; // just past "# {title}"
      await saveNote(rec);
      await refreshIndex();
      loadNote(rec);
      setCmdOpen(false);
    },
    [refreshIndex, loadNote]
  );

  // After removing the active note, open the most-recent remaining one (or a
  // fresh empty note, so the canvas is never left blank).
  const openFallback = useCallback(
    async (excludeId: string) => {
      const all = (await getAllNotes()).filter((n) => n.id !== excludeId);
      const next = all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      loadNote(next ?? (await createNote("", newDoc(""))));
    },
    [loadNote]
  );

  const onDelete = useCallback(
    async (id: string) => {
      const { removed, orphans } = await deleteNote(id);
      if (activeId.current === id) await openFallback(id);
      await refreshIndex();
      setToast({
        message: "note deleted",
        actionLabel: "undo",
        onAction: async () => {
          await restoreNotes([removed, ...orphans]);
          await refreshIndex();
          loadNote(removed);
        },
      });
    },
    [refreshIndex, loadNote, openFallback]
  );

  const onArchive = useCallback(
    async (id: string) => {
      await setArchived(id, true);
      if (activeId.current === id) await openFallback(id);
      await refreshIndex();
      setToast({
        message: "note archived",
        actionLabel: "undo",
        onAction: async () => {
          await setArchived(id, false);
          await refreshIndex();
        },
      });
    },
    [refreshIndex, openFallback]
  );

  const onDismissMicro = useCallback(
    async (id: string) => {
      const rec = await getNote(id);
      if (rec) {
        await addDismissed(rec.title);
        dismissed.current.add(norm(rec.title));
      }
      const { removed, orphans } = await deleteNote(id);
      if (activeId.current === id) await openFallback(id);
      await refreshIndex();
      setToast({
        message: "won't suggest that again",
        actionLabel: "undo",
        onAction: async () => {
          await restoreNotes([removed, ...orphans]);
          dismissed.current.delete(norm(removed.title));
          await refreshIndex();
        },
      });
    },
    [refreshIndex, openFallback]
  );

  // ── Attachments: upload → convert → absorb into the truth layer ──────────
  const pendingFiles = useRef<Map<string, File>>(new Map());

  // Run the v0.5 concept pass over a converted source's markdown, spinning off
  // micro-notes (respecting the quality floor + dismissed set + dedup) and
  // linking them to the current note so they nest in the tree.
  const absorbConcepts = useCallback(
    async (markdown: string) => {
      if (!navigator.onLine) return;
      let concepts: { phrase: string; summary: string; points?: string[] }[] = [];
      try {
        const res = await fetch("/api/concepts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: markdown }),
        });
        concepts = ((await res.json()).concepts as typeof concepts) || [];
      } catch {
        return;
      }
      const idx = await getIndex();
      const byTitle = new Map(idx.map((n) => [norm(n.title), n.id]));
      // Hard cap so an upload can't flood the tree (parity with processConcepts).
      const ABSORB_CAP = 6;
      let spawned = 0;
      for (const c of concepts) {
        const phrase = (c.phrase || "").trim();
        if (phrase.length < 2) continue;
        const key = norm(phrase);
        if (dismissed.current.has(key)) continue;
        let id = byTitle.get(key);
        if (!id) {
          if (spawned >= ABSORB_CAP) continue;
          const rec = await createNote(
            phrase,
            docFromText(atomicSeed(phrase, c.summary || "", c.points || [])),
            "micro",
            { gist: c.summary || "" }
          );
          spawned += 1;
          id = rec.id;
          byTitle.set(key, id);
        }
        extraLinks.current.add(id);
      }
      // Persist the new edges onto the current note so the tree nests them.
      if (activeId.current) {
        const cur = await getNote(activeId.current);
        if (cur) {
          cur.links = [...new Set([...(cur.links || []), ...extraLinks.current])];
          await saveNote(cur);
        }
      }
      await refreshIndex();
    },
    [refreshIndex]
  );

  const convertFile = useCallback(
    async (file: File, attachId: string, kind: AttachKind) => {
      pendingFiles.current.set(attachId, file);
      // Keep the image bytes for the colour-toggle preview (images only).
      let image: string | undefined;
      if (kind === "image") {
        image = await new Promise<string | undefined>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : undefined);
          fr.onerror = () => resolve(undefined);
          fr.readAsDataURL(file);
        });
      }
      try {
        const fd = new FormData();
        fd.append("file", file, file.name);
        const res = await fetch("/api/attach", { method: "POST", body: fd });
        const data = (await res.json()) as {
          markdown?: string;
          meta?: { title?: string };
          error?: string;
        };
        if (!editor) return;
        if (!data.markdown) {
          setAttachmentStatus(editor, attachId, "failed");
          return;
        }
        const src: SourceRecord = {
          id: attachId,
          title: data.meta?.title || file.name,
          markdown: data.markdown,
          tier: defaultTier(kind),
          kind,
          image,
          createdAt: Date.now(),
        };
        await saveSource(src);
        setAttachmentStatus(editor, attachId, "ready");
        await absorbConcepts(data.markdown); // the upload becomes knowledge
      } catch {
        if (editor) setAttachmentStatus(editor, attachId, "failed");
      }
    },
    [editor, absorbConcepts]
  );

  // Insert one pill per file at the cursor; conversion runs async (never blocks
  // typing). `at` positions the pill where a drop landed.
  const handleFiles = useCallback(
    (files: FileList | File[], at?: number) => {
      if (!editor) return;
      for (const file of Array.from(files)) {
        const attachId =
          crypto.randomUUID?.() ?? `a_${Date.now()}_${Math.random().toString(36)}`;
        const kind = kindOf(file.name);
        const chain = editor.chain().focus();
        if (typeof at === "number") chain.setTextSelection(at);
        chain
          .insertAttachment({ attachId, name: file.name, kind, status: "converting" })
          .run();
        void convertFile(file, attachId, kind);
      }
    },
    [editor, convertFile]
  );

  // Drop-onto-canvas and paste-file upload (no editorProps override needed).
  // Behind the uploads flag — when off, no drag-drop/paste-to-attach at all.
  useEffect(() => {
    if (!editor || !UPLOADS) return;
    const dom = editor.view.dom;
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
      handleFiles(e.dataTransfer.files, at);
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (!files?.length) return;
      e.preventDefault();
      handleFiles(files);
    };
    dom.addEventListener("drop", onDrop);
    dom.addEventListener("paste", onPaste);
    return () => {
      dom.removeEventListener("drop", onDrop);
      dom.removeEventListener("paste", onPaste);
    };
  }, [editor, handleFiles]);

  // Pill taps: open the preview peek, or retry a failed conversion.
  useEffect(() => {
    if (!editor) return;
    const onOpenAttach = async (e: Event) => {
      const id = (e as CustomEvent).detail.attachId as string;
      const src = await getSource(id);
      if (src)
        setPeek({ name: src.title, markdown: src.markdown, kind: src.kind, image: src.image });
    };
    const onRetry = (e: Event) => {
      const id = (e as CustomEvent).detail.attachId as string;
      const f = pendingFiles.current.get(id);
      if (f && editor) {
        setAttachmentStatus(editor, id, "converting");
        void convertFile(f, id, kindOf(f.name));
      }
    };
    document.addEventListener("plain:attach-open", onOpenAttach);
    document.addEventListener("plain:attach-retry", onRetry);
    return () => {
      document.removeEventListener("plain:attach-open", onOpenAttach);
      document.removeEventListener("plain:attach-retry", onRetry);
    };
  }, [editor, convertFile]);

  // Cmd/Ctrl-K opens the one command field (ask now lives inside it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dock the sidebar on wide screens; overlay it on iPad/narrow so the writing
  // column is never crushed. `has-sidebar` shifts the canvas only when docked.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const apply = () => setDocked(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("has-sidebar", docked);
    return () => document.documentElement.classList.remove("has-sidebar");
  }, [docked]);

  // Network awareness: writing + local navigation always work (IndexedDB);
  // AI features quietly pause offline and resume automatically when back.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <>
      <Sidebar
        notes={notes}
        activeId={activeNoteId}
        docked={docked}
        open={sideOpen}
        onOpen={(id) => {
          onOpen(id);
          setSideOpen(false);
        }}
        onCreate={() => {
          onCreate("");
          setSideOpen(false);
        }}
        onClose={() => setSideOpen(false)}
        onDelete={onDelete}
        onArchive={onArchive}
        onDismissMicro={onDismissMicro}
      />
      {!docked && (
        <button
          className="side-edge"
          onClick={() => setSideOpen(true)}
          aria-label="Open notes sidebar"
          title="Notes"
        >
          <span className="side-edge-bar" aria-hidden="true" />
        </button>
      )}

      <TopBar
        onOpenCommand={() => setCmdOpen(true)}
        onAttach={() => fileInput.current?.click()}
      />

      <EditorContent editor={editor} className="editor-host" />

      <PeekLayer editor={editor} onOpen={onOpen} />

      <CommandField
        open={cmdOpen}
        activeId={activeId.current}
        onClose={() => setCmdOpen(false)}
        onOpen={onOpen}
        onCreate={onCreate}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* v2.1 — auto-linking whisper: one quiet, inline, self-dismissing line.
          Distinct messages for linked-vs-created; "tap to open" is a real
          target for a freshly created page. Never a popup/banner. */}
      {whisper &&
        (whisper.openId ? (
          <button
            className="whisper"
            onClick={() => onOpen(whisper.openId!)}
            role="status"
          >
            <span className="whisper-tap">{whisper.text}</span>
          </button>
        ) : (
          <div className="whisper" role="status">
            <span>{whisper.text}</span>
          </div>
        ))}

      {/* Source preview peek (uploads only — dormant when the flag is off). */}
      <AttachPeek peek={peek} onClose={() => setPeek(null)} />

      {/* The one back affordance for note pages — a note is a destination. */}
      {canBack && (
        <button className="nav-back" onClick={goBack} aria-label="Back" title="Back">
          <IconArrowLeft aria-hidden="true" />
          <span>back</span>
        </button>
      )}

      <MicroBreakdown
        note={microNote}
        notes={notes}
        onClose={goBack}
        onOpen={onOpen}
        onDismiss={async (id) => {
          await onDismissMicro(id);
          setMicroNote(null);
        }}
      />

      {/* Hidden picker — the pick path for uploads, behind the flag. */}
      {UPLOADS && (
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      )}

      {/* Single calm network state — AI pauses, writing keeps saving. */}
      {!online && (
        <div className="netstate" role="status">
          offline — writing still saved
        </div>
      )}
    </>
  );
}
