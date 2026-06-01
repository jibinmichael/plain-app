import type { JSONContent } from "@tiptap/core";

/**
 * A focused Markdown ↔ ProseMirror-JSON bridge for AUTO-NOTES (v3.4 Part 3).
 *
 * Auto-notes are generated as markdown so the model can write a real, well-
 * structured atomic note — prose, checklists, tables, lists, images — and we
 * render it as live TipTap content (checkboxes checkable, tables editable). It
 * round-trips: edits serialize back to markdown for storage.
 *
 * Scope is deliberately small (the subset auto-notes emit): headings, paragraphs,
 * bullet / ordered / task lists, GFM tables, images, hr, and inline bold/italic/
 * code. Not a general CommonMark engine.
 */

type Inline = JSONContent;

// ── Inline: [[cite:N:url]], **bold**, *italic*/_italic_, `code` → text nodes ──
// `[[cite:N:url]]` (emitted by /api/research) becomes a "citation"-marked text
// node whose text is the number N and whose mark carries the real source URL —
// rendered as a blue, tappable superscript marker.
function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  // Tokenize on the inline markers, longest-first so ** beats * and cite wins.
  const re =
    /(\[\[cite:(\d+):([^\]]+)\]\]|==([^=]+)==|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    const citeN = m[2];
    const citeUrl = m[3];
    const highlight = m[4]; // ==key point== → highlight mark
    const bold = m[5] ?? m[6];
    const italic = m[7] ?? m[8];
    const code = m[9];
    if (citeN != null)
      out.push({
        type: "text",
        text: citeN,
        marks: [{ type: "citation", attrs: { n: Number(citeN), href: citeUrl } }],
      });
    else if (highlight != null)
      out.push({ type: "text", text: highlight, marks: [{ type: "highlight" }] });
    else if (bold != null)
      out.push({ type: "text", text: bold, marks: [{ type: "bold" }] });
    else if (italic != null)
      out.push({ type: "text", text: italic, marks: [{ type: "italic" }] });
    else if (code != null)
      out.push({ type: "text", text: code, marks: [{ type: "code" }] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.length ? out : [{ type: "text", text }];
}

function para(text: string): JSONContent {
  const t = text.trim();
  return t ? { type: "paragraph", content: parseInline(t) } : { type: "paragraph" };
}

const isTableSep = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");
const splitRow = (l: string) =>
  l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** Markdown → ProseMirror doc JSON. */
export function mdToDoc(md: string): JSONContent {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const content: JSONContent[] = [];
  let i = 0;

  const listItems = (
    test: (l: string) => RegExpMatchArray | null,
    strip: (l: string) => string
  ): JSONContent[] => {
    const items: JSONContent[] = [];
    while (i < lines.length) {
      const mt = test(lines[i]);
      if (!mt) break;
      items.push({
        type: "listItem",
        content: [para(strip(lines[i]))],
      });
      i++;
    }
    return items;
  };

  while (i < lines.length) {
    const line = lines[i];

    // blank
    if (!line.trim()) { i++; continue; }

    // image: ![alt](url)  → standalone image node (+ caption from alt)
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      content.push({ type: "image", attrs: { src: img[2], alt: img[1] || null } });
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      content.push({
        type: "heading",
        attrs: { level: Math.min(h[1].length, 6) },
        content: parseInline(h[2].trim()),
      });
      i++;
      continue;
    }

    // hr
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // task list: - [ ] / - [x]
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+/);
    if (task) {
      const items: JSONContent[] = [];
      while (i < lines.length) {
        const t = lines[i].match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (!t) break;
        items.push({
          type: "taskItem",
          attrs: { checked: t[1].toLowerCase() === "x" },
          content: [para(t[2])],
        });
        i++;
      }
      content.push({ type: "taskList", content: items });
      continue;
    }

    // table: header row + separator
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(lines[i]);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const headerRow: JSONContent = {
        type: "tableRow",
        content: header.map((c) => ({
          type: "tableHeader",
          content: [para(c)],
        })),
      };
      const bodyRows: JSONContent[] = rows.map((r) => ({
        type: "tableRow",
        content: header.map((_, ci) => ({
          type: "tableCell",
          content: [para(r[ci] ?? "")],
        })),
      }));
      content.push({ type: "table", content: [headerRow, ...bodyRows] });
      continue;
    }

    // ordered list: 1.  2.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = listItems(
        (l) => l.match(/^\s*\d+\.\s+/),
        (l) => l.replace(/^\s*\d+\.\s+/, "")
      );
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // bullet list: - / *  (not a task, handled above)
    if (/^\s*[-*]\s+/.test(line)) {
      const items = listItems(
        (l) => (/\s*[-*]\s+\[[ xX]\]/.test(l) ? null : l.match(/^\s*[-*]\s+/)),
        (l) => l.replace(/^\s*[-*]\s+/, "")
      );
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // paragraph: gather consecutive non-blank, non-block lines
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|!\[|\s*(---|\*\*\*|___)\s*$)/.test(lines[i]) &&
      !lines[i].includes("|")
    ) {
      buf.push(lines[i]);
      i++;
    }
    content.push(para(buf.join(" ")));
  }

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ── ProseMirror doc JSON → Markdown (for storage / round-trip) ──
function inlineToMd(nodes: JSONContent[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type !== "text") return "";
      let t = n.text ?? "";
      for (const mark of n.marks || []) {
        // A citation serializes from its attrs (the visible text is just N).
        if (mark.type === "citation")
          return `[[cite:${mark.attrs?.n ?? t}:${mark.attrs?.href ?? ""}]]`;
        if (mark.type === "highlight") t = `==${t}==`;
        else if (mark.type === "bold") t = `**${t}**`;
        else if (mark.type === "italic") t = `*${t}*`;
        else if (mark.type === "code") t = `\`${t}\``;
      }
      return t;
    })
    .join("");
}

export function docToMd(doc: JSONContent): string {
  const blocks: string[] = [];
  const cellText = (cell: JSONContent) =>
    inlineToMd(cell.content?.[0]?.content).replace(/\|/g, "\\|");

  for (const node of doc.content || []) {
    switch (node.type) {
      case "heading":
        blocks.push(`${"#".repeat(node.attrs?.level || 1)} ${inlineToMd(node.content)}`);
        break;
      case "paragraph":
        blocks.push(inlineToMd(node.content));
        break;
      case "horizontalRule":
        blocks.push("---");
        break;
      case "image":
        blocks.push(`![${node.attrs?.alt || ""}](${node.attrs?.src || ""})`);
        break;
      case "bulletList":
        blocks.push(
          (node.content || [])
            .map((li) => `- ${inlineToMd(li.content?.[0]?.content)}`)
            .join("\n")
        );
        break;
      case "orderedList":
        blocks.push(
          (node.content || [])
            .map((li, n) => `${n + 1}. ${inlineToMd(li.content?.[0]?.content)}`)
            .join("\n")
        );
        break;
      case "taskList":
        blocks.push(
          (node.content || [])
            .map(
              (ti) =>
                `- [${ti.attrs?.checked ? "x" : " "}] ${inlineToMd(
                  ti.content?.[0]?.content
                )}`
            )
            .join("\n")
        );
        break;
      case "table": {
        const rows = node.content || [];
        if (!rows.length) break;
        const header = (rows[0].content || []).map(cellText);
        const sep = header.map(() => "---");
        const body = rows
          .slice(1)
          .map((r) => `| ${(r.content || []).map(cellText).join(" | ")} |`);
        blocks.push(
          [`| ${header.join(" | ")} |`, `| ${sep.join(" | ")} |`, ...body].join("\n")
        );
        break;
      }
      default:
        if (node.content) blocks.push(inlineToMd(node.content));
    }
  }
  return blocks.join("\n\n").trim();
}
