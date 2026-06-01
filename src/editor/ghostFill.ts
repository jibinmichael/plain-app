import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Ghost-fill — a NON-COMMITTED suggestion that just STAYS A GHOST.
 *
 * Two transient states live in plugin state:
 *   - "thinking": a faint pulsing italic "thinking…" cue at the caret, shown the
 *     instant we kick off a fetch so a pause never feels frozen / broken.
 *   - "ghost": the suggestion itself, rendered as a SOFT GRADIENT-FILLED run at
 *     the caret (clearly the assistant's words, not yours — like iA's coloured
 *     AI text). It is NOT in the document and NEVER auto-commits — not on
 *     arrival, timer, blur, Enter, or any event. There is NO visible
 *     accept/dismiss chrome: it's just coloured text. The user types past/over
 *     it to dismiss it naturally. Tab (or a tap) accepts silently — the kept
 *     text turns real --ink black. It's "grounded-or-ghost": the suggestion may
 *     be grounded (cited) or from general knowledge — either way it's
 *     provisional until kept, so the app always helps and is never a dead end.
 */
export const ghostKey = new PluginKey<GhostState>("ghost-fill");

type GhostState =
  | { kind: "thinking"; from: number }
  | { kind: "ghost"; text: string; from: number }
  | null;

type GhostMeta =
  | { type: "thinking"; from: number }
  | { type: "set"; text: string; from: number }
  | { type: "clear" };

/** Show the pulsing "thinking…" cue at `from` while a fetch is in flight. */
export function setThinking(view: EditorView, from: number) {
  view.dispatch(
    view.state.tr.setMeta(ghostKey, { type: "thinking", from } satisfies GhostMeta)
  );
}

/** Push a suggestion (preview only — meta, no doc change). */
export function setGhost(view: EditorView, text: string, from: number) {
  const tr = view.state.tr.setMeta(ghostKey, {
    type: "set",
    text,
    from,
  } satisfies GhostMeta);
  view.dispatch(tr);
}

export function clearGhost(view: EditorView) {
  if (!ghostKey.getState(view.state)) return;
  view.dispatch(view.state.tr.setMeta(ghostKey, { type: "clear" } satisfies GhostMeta));
}

/** Commit the active suggestion into the document, tagged origin="ai". */
export function acceptGhost(view: EditorView): boolean {
  const g = ghostKey.getState(view.state);
  if (!g || g.kind !== "ghost" || !g.text) return false;

  const { schema } = view.state;
  const tr = view.state.tr.insertText(g.text, g.from);
  const origin = schema.marks.origin;
  if (origin) {
    tr.addMark(g.from, g.from + g.text.length, origin.create({ kind: "ai" }));
    tr.removeStoredMark(origin);
  }
  tr.setSelection(TextSelection.create(tr.doc, g.from + g.text.length));
  tr.setMeta(ghostKey, { type: "clear" } satisfies GhostMeta);
  view.dispatch(tr);
  view.focus();
  return true;
}

export const GhostFill = Extension.create({
  name: "ghostFill",
  addProseMirrorPlugins() {
    return [
      new Plugin<GhostState>({
        key: ghostKey,
        state: {
          init: () => null,
          apply(tr, prev): GhostState {
            const meta = tr.getMeta(ghostKey) as GhostMeta | undefined;
            if (meta) {
              if (meta.type === "clear") return null;
              if (meta.type === "thinking")
                return { kind: "thinking", from: meta.from };
              return { kind: "ghost", text: meta.text, from: meta.from };
            }
            // The cue/ghost STAYS as a faint guide while the student keeps
            // writing — it does NOT auto-commit (the only commit path is
            // acceptGhost via Tab/tap). Its anchor position is mapped through
            // edits so it keeps tracking the right spot. Esc, accept, or a new
            // fetch clears it.
            if (!prev) return prev;
            return { ...prev, from: tr.mapping.map(prev.from) };
          },
        },
        props: {
          decorations(state) {
            const g = ghostKey.getState(state);
            if (!g) return null;
            if (g.kind === "thinking") {
              return DecorationSet.create(state.doc, [thinkingWidget(g.from)]);
            }
            if (g.kind === "ghost" && g.text) {
              return DecorationSet.create(state.doc, [ghostWidget(g.text, g.from)]);
            }
            return null;
          },
          handleKeyDown(view, event) {
            const g = ghostKey.getState(view.state);
            if (!g) return false;
            // Tab is the ONLY accept key, and only for a real ghost. Enter is
            // NOT an accept — it just dismisses (via the resulting doc change)
            // and inserts a newline as normal.
            if (event.key === "Tab" && g.kind === "ghost") {
              event.preventDefault();
              return acceptGhost(view);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              clearGhost(view);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** The pulsing "thinking…" cue — faint, italic, at the caret. */
function thinkingWidget(from: number): Decoration {
  return Decoration.widget(
    from,
    () => {
      const cue = document.createElement("span");
      cue.className = "ghost-thinking";
      cue.setAttribute("contenteditable", "false");
      cue.textContent = "thinking…";
      return cue;
    },
    { side: 1, key: "ghost-thinking", ignoreSelection: true }
  );
}

/** The gradient-filled ghost text. No affordance, no chrome — it simply sits
 *  there. Tapping it silently accepts (power-user convenience; nothing is
 *  labelled). */
function ghostWidget(text: string, from: number): Decoration {
  return Decoration.widget(
    from,
    (view) => {
      const ghost = document.createElement("span");
      ghost.className = "ghost-text"; // gradient fill — the assistant's words
      ghost.setAttribute("contenteditable", "false");
      ghost.textContent = text;
      const accept = (e: Event) => {
        e.preventDefault();
        acceptGhost(view);
      };
      ghost.addEventListener("mousedown", accept);
      ghost.addEventListener("touchend", accept); // tap-to-keep, unlabelled
      return ghost;
    },
    { side: 1, key: `ghost-${from}-${text}`, ignoreSelection: true }
  );
}
