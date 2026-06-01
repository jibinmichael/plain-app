import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * A citation marker — a small blue, tappable superscript number on a cited
 * claim (e.g. "…reducing platelet aggregation¹"). It carries the real source
 * URL so the marker opens the source in a new tab; the matching numbered entry
 * lives in the SOURCES list below the note. Markers come from `/api/research`
 * as `[[cite:N:url]]` tokens (see markdownDoc.ts) and round-trip back to them.
 */
export const Citation = Mark.create({
  name: "citation",
  inclusive: false, // typing after a marker doesn't extend it
  excludes: "_", // a citation never combines with bold/italic/code

  addAttributes() {
    return {
      n: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute("data-cite")) || null,
        renderHTML: (attrs) =>
          attrs.n != null ? { "data-cite": String(attrs.n) } : {},
      },
      href: {
        default: "",
        parseHTML: (el) => el.getAttribute("href") || "",
        renderHTML: (attrs) =>
          attrs.href
            ? { href: attrs.href, target: "_blank", rel: "noopener noreferrer" }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-cite]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // <sup class="cite-marker"><a data-cite href target rel>N</a></sup>
    return ["sup", { class: "cite-marker" }, ["a", mergeAttributes(HTMLAttributes), 0]];
  },
});
