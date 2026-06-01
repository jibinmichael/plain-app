import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Tracks where a span of text came from: {typed, pasted, ai}.
 * Unmarked text is the student's own typing (the default). Pasted content and
 * AI-accepted ghost-fill are explicitly marked so they read as "not the
 * student's reasoning" — `ai` renders muted with a dotted underline.
 */
export const Origin = Mark.create({
  name: "origin",
  inclusive: false,

  addAttributes() {
    return {
      kind: {
        default: "typed",
        parseHTML: (el) => el.getAttribute("data-origin") || "typed",
        renderHTML: (attrs) => ({ "data-origin": attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-origin]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes["data-origin"] || "typed";
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: `origin-${kind}` }),
      0,
    ];
  },
});
