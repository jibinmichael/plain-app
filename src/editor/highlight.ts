import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: (color: string) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

/** Muted highlight, colour carried on the mark (persisted with the document). */
export const Highlight = Mark.create({
  name: "highlight",

  addAttributes() {
    return {
      color: {
        default: "#8e8e93",
        parseHTML: (el) => el.getAttribute("data-color") || "#8e8e93",
        renderHTML: (attrs) => ({ "data-color": attrs.color }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark[data-color]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // v3.7: key-point highlight — a soft, clipped background (Notion-style) via
    // the .mark-highlight class, so the reader's eye lands on what matters.
    return ["mark", mergeAttributes(HTMLAttributes, { class: "mark-highlight" }), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (color: string) =>
        ({ chain, state }) => {
          // Same colour again → toggle it off.
          const active = state.schema.marks.highlight;
          const has =
            active &&
            state.doc.rangeHasMark(
              state.selection.from,
              state.selection.to,
              active
            );
          const current = active && this.editor?.getAttributes("highlight").color;
          if (has && current === color) {
            return chain().unsetMark(this.name).run();
          }
          return chain().setMark(this.name, { color }).run();
        },
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
