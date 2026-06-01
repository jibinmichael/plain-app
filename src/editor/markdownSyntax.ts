import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Title-first display layer (v1.5). The document STAYS markdown — the first line
 * is still a `# ` heading in storage (deriveTitle / grounding / export all read
 * it unchanged). We only change how it RENDERS:
 *
 *  - Heading markers (`#`/`##`…) and their trailing space are hidden entirely
 *    (Notion-style — never visible, even with the caret on that line). The
 *    heading text renders as a styled title / subheading with no symbol.
 *  - Every empty line shows a quiet placeholder so there's never a blank void:
 *    an empty heading → its title/subheading placeholder; an empty body line →
 *    "Start writing…".
 *  - Inline emphasis keeps its calm styling; the literal `*`/`-` markers stay
 *    dimmed (this slice is specifically about hiding heading syntax).
 */
const key = new PluginKey("markdown-syntax");

const HR = /^\s*(---|\*\*\*|___)\s*$/;
const HEADING = /^(\s*)(#{1,6})(\s.*)?$/;
const BULLET = /^(\s*)([-*+])(\s)/;
const EMPHASIS = /(\*\*?)([^*\n]+?)\1/g;

function emph(from: number, to: number, active: boolean) {
  return Decoration.inline(from, to, {
    class: `md-mark emph${active ? " is-active" : ""}`,
  });
}

function buildDecorations(doc: PMNode, cursor: number): DecorationSet {
  const decorations: Decoration[] = [];
  let blockIndex = 0;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const idx = blockIndex++;
    const text = node.textContent;
    const cStart = pos + 1; // first content position
    const active = cursor >= pos && cursor <= pos + node.nodeSize;

    // ── Headings: hide the marker, style the text, placeholder when empty ──
    const h = text.match(HEADING);
    if (h) {
      const lead = h[1].length;
      const hashes = h[2].length;
      const afterHashes = lead + hashes;
      const ws = text.slice(afterHashes).match(/^\s*/)![0].length;
      const markerEnd = afterHashes + ws; // end of "#…# " (hashes + spaces)
      const restLen = text.length - markerEnd;

      // Hide the marker entirely (from line start through the trailing space).
      if (markerEnd > 0) {
        decorations.push(
          Decoration.inline(cStart, cStart + markerEnd, { class: "md-hide" })
        );
      }
      const level = Math.min(hashes, 6);
      if (restLen > 0) {
        // Size the WHOLE line at the block level (head1/head2) so the heading
        // has no 15px base substrate under it — the typed title never renders at
        // a smaller size before the inline run catches up, and the line-height
        // is consistent (no "forced" feel). The inline class only carries
        // weight/colour (font-size:1em) so it never double-scales the block.
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: level === 1 ? "head1" : "head2",
          })
        );
        decorations.push(
          Decoration.inline(cStart + markerEnd, cStart + text.length, {
            class: level === 1 ? "tok-title" : "tok-subheading",
          })
        );
      } else {
        // Empty heading → title / subheading placeholder.
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: level === 1 ? "ph ph-title" : "ph ph-sub",
          })
        );
      }
      return;
    }

    // ── Empty body line → "Start writing…" placeholder, but ONLY on the line
    //    the caret is on (one prompt, where the next text goes — no redundant
    //    prompt on every blank line). ──
    if (!text) {
      if (active) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, { class: "ph ph-body" })
        );
      }
      void idx;
      return;
    }

    // ── Body: horizontal rule, bullets, inline emphasis (markers dimmed) ──
    const hr = text.match(HR);
    if (hr) {
      const at = text.indexOf(hr[1]);
      decorations.push(emph(cStart + at, cStart + at + hr[1].length, active));
      return;
    }

    const b = text.match(BULLET);
    if (b) {
      const at = b[1].length;
      decorations.push(emph(cStart + at, cStart + at + 1, active));
    }

    let m: RegExpExecArray | null;
    EMPHASIS.lastIndex = 0;
    while ((m = EMPHASIS.exec(text)) !== null) {
      const start = m.index;
      const mlen = m[1].length;
      const end = start + m[0].length;
      decorations.push(emph(cStart + start, cStart + start + mlen, active));
      decorations.push(
        Decoration.inline(cStart + start + mlen, cStart + end - mlen, {
          class: "tok-emphasis",
        })
      );
      decorations.push(emph(cStart + end - mlen, cStart + end, active));
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const MarkdownSyntax = Extension.create({
  name: "markdownSyntax",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => buildDecorations(state.doc, state.selection.from),
          apply(tr, old, _oldState, newState) {
            if (tr.docChanged || tr.selectionSet) {
              return buildDecorations(newState.doc, newState.selection.from);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});
