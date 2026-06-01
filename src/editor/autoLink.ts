import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { eachPhraseSpan } from "./textmatch";

/**
 * Auto-link: as the document changes, spans whose text matches an existing
 * note title (case-insensitive, on word boundaries) get the `reference` mark
 * automatically. No `[[brackets]]` are ever inserted — the mark is the markup.
 *
 * The title index is a module-level registry the editor keeps in sync with the
 * note store; the current note's own title is excluded by the editor.
 */
export type TitleEntry = { id: string; title: string };

let titleIndex: TitleEntry[] = [];
export function setTitleIndex(entries: TitleEntry[]) {
  // Longest titles first so "heart failure" wins over "heart".
  titleIndex = [...entries]
    .filter((e) => e.title.trim().length >= 3)
    .sort((a, b) => b.title.length - a.title.length);
}

const AUTOLINK_META = "autolink";
const key = new PluginKey("auto-link");

export const AutoLink = Extension.create({
  name: "autoLink",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        appendTransaction(trs, _oldState, newState) {
          if (!trs.some((t) => t.docChanged)) return null;
          if (trs.some((t) => t.getMeta(AUTOLINK_META))) return null;
          const entries = titleIndex; // longest titles first (see setTitleIndex)
          if (!entries.length) return null;

          const refType = newState.schema.marks.reference;
          if (!refType) return null;

          const tr = newState.tr;
          let modified = false;

          // Longest-first; `eachPhraseSpan` skips spans already marked, so a
          // shorter title nested in an already-linked longer one is left alone
          // (prefer-longest, no overlap). Whole-word + position-accurate.
          for (const { id, title } of entries) {
            eachPhraseSpan(newState.doc, title, refType, ({ from, to }) => {
              // Re-check against the in-progress transaction's marks so two
              // titles added in the same pass can't overlap.
              if (tr.doc.rangeHasMark(from, to, refType)) return;
              tr.addMark(from, to, refType.create({ noteId: id, title }));
              modified = true;
            });
          }

          if (!modified) return null;
          tr.setMeta(AUTOLINK_META, true);
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
