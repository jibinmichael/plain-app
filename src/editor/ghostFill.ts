import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Ghost-fill — a NON-COMMITTED suggestion that just STAYS A GHOST.
 *
 * A suggestion lives only in plugin state as `{ text, from }` and renders as
 * faint grey ghost text at the caret. It is NOT in the document and NEVER
 * auto-commits — not on arrival, timer, blur, Enter, or any event. There is NO
 * visible accept/dismiss chrome: it's just grey text. The user types past/over
 * it to dismiss it naturally. Tab MAY still accept silently for power users
 * (nothing is shown about it). It's "grounded-or-ghost": the suggestion may be
 * grounded (cited) or from general knowledge — either way it's provisional grey
 * until kept, so the app always helps and is never a dead end.
 */
export const ghostKey = new PluginKey<GhostState>("ghost-fill");

type GhostState = { text: string; from: number } | null;

type GhostMeta = { type: "set"; text: string; from: number } | { type: "clear" };

/** Push a grounded suggestion (preview only — meta, no doc change). */
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
  if (!g || !g.text) return false;

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
              return meta.type === "set"
                ? { text: meta.text, from: meta.from }
                : null;
            }
            // The ghost STAYS as a faint guide while the student keeps writing —
            // it does NOT auto-commit (the only commit path is acceptGhost via
            // Tab/tap). Its anchor position is mapped through edits so it keeps
            // tracking the right spot. Esc, accept, or a new fetch clears it.
            if (!prev) return prev;
            return { text: prev.text, from: tr.mapping.map(prev.from) };
          },
        },
        props: {
          decorations(state) {
            const g = ghostKey.getState(state);
            // Active suggestion → the grey ghost guide. No standing hint.
            if (g && g.text) {
              return DecorationSet.create(state.doc, [ghostWidget(g.text, g.from)]);
            }
            return null;
          },
          handleKeyDown(view, event) {
            const g = ghostKey.getState(view.state);
            if (!g) return false;
            // Tab is the ONLY accept key. Enter is NOT — it just dismisses
            // (via the resulting doc change) and inserts a newline as normal.
            if (event.key === "Tab") {
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

/** Just the grey ghost text. No affordance, no chrome — it simply sits there.
 *  Tapping it silently accepts (power-user convenience; nothing is labelled). */
function ghostWidget(text: string, from: number): Decoration {
  return Decoration.widget(
    from,
    (view) => {
      const ghost = document.createElement("span");
      ghost.className = "ghost-text"; // faint grey — provisional, not yours yet
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
