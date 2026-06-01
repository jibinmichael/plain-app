import { Mark, mergeAttributes } from "@tiptap/core";

export const VERBS = ["find", "do", "avoid", "because"] as const;
export type Verb = (typeof VERBS)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    verbtag: {
      setVerb: (verb: Verb) => ReturnType;
      unsetVerb: () => ReturnType;
    };
  }
}

/**
 * AI-applied "smart highlight": a span tagged with a plain-language verb that
 * IS its meaning. The verb word renders inline before the span (via CSS
 * ::before), coloured by verb; the marked content keeps the primary text
 * colour with a 1.5px coloured underline. No legend, ever.
 */
export const VerbTag = Mark.create({
  name: "verbtag",
  inclusive: false,

  addAttributes() {
    return {
      verb: {
        default: "find",
        parseHTML: (el) => el.getAttribute("data-verb") || "find",
        renderHTML: (attrs) => ({ "data-verb": attrs.verb }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-verb]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // v3.0: rendering removed — a legacy verbtag mark renders as plain text
    // (kept in schema only so older docs still load). No class, no ornament.
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setVerb:
        (verb: Verb) =>
        ({ commands }) =>
          commands.setMark(this.name, { verb }),
      unsetVerb:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
