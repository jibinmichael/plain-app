import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

/**
 * The shimmer — the only animation that matters here. A soft accent-tinted
 * light sweep over a phrase's glyphs while plain turns it into a micro-note.
 * Decorations are mapped through edits so the range stays correct while the
 * student keeps typing; when the work settles, the shimmer is removed and a
 * `reference` mark takes its place.
 */
export const shimmerKey = new PluginKey<DecorationSet>("shimmer");

let counter = 0;

type ShimmerMeta =
  | { type: "add"; id: string; from: number; to: number }
  | { type: "remove"; id: string };

export function addShimmer(view: EditorView, from: number, to: number): string {
  const id = `sh${++counter}`;
  view.dispatch(
    view.state.tr.setMeta(shimmerKey, { type: "add", id, from, to } satisfies ShimmerMeta)
  );
  return id;
}

export function removeShimmer(view: EditorView, id: string): void {
  view.dispatch(
    view.state.tr.setMeta(shimmerKey, { type: "remove", id } satisfies ShimmerMeta)
  );
}

/** Current (mapped) range of a live shimmer, or null if it's gone. */
export function shimmerRange(
  view: EditorView,
  id: string
): { from: number; to: number } | null {
  const set = shimmerKey.getState(view.state);
  if (!set) return null;
  const found = set.find().find((d) => d.spec?.id === id);
  return found ? { from: found.from, to: found.to } : null;
}

export const Shimmer = Extension.create({
  name: "shimmer",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: shimmerKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(shimmerKey) as ShimmerMeta | undefined;
            if (meta?.type === "add") {
              next = next.add(tr.doc, [
                Decoration.inline(
                  meta.from,
                  meta.to,
                  { class: "shimmer" },
                  { id: meta.id }
                ),
              ]);
            } else if (meta?.type === "remove") {
              const gone = next.find().filter((d) => d.spec?.id === meta.id);
              if (gone.length) next = next.remove(gone);
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return shimmerKey.getState(state);
          },
        },
      }),
    ];
  },
});
