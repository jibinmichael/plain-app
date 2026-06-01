import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    reference: {
      setReference: (attrs: { noteId: string; title: string }) => ReturnType;
      unsetReference: () => ReturnType;
    };
  }
}

/**
 * A link to another note. The mark IS the markup — no `[[brackets]]` are ever
 * inserted into the text. Applied explicitly via the link picker, and
 * automatically when a span matches an existing note title.
 */
export const Reference = Mark.create({
  name: "reference",
  inclusive: false, // typing after a link doesn't extend it

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-note-id"),
        renderHTML: (attrs) => (attrs.noteId ? { "data-note-id": attrs.noteId } : {}),
      },
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-title") || "",
        renderHTML: (attrs) => ({ "data-title": attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-note-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "mark-reference" }),
      0,
    ];
  },

  addCommands() {
    return {
      setReference:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetReference:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
