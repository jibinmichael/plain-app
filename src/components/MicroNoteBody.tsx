"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Heading } from "@tiptap/extension-heading";
import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { Code } from "@tiptap/extension-code";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { BulletList, OrderedList, ListItem, TaskList, TaskItem } from "@tiptap/extension-list";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import { mdToDoc, docToMd } from "@/lib/markdownDoc";
import { Citation } from "@/editor/citation";
import { Highlight } from "@/editor/highlight";
import { Reference } from "@/editor/reference";
import { AutoLink } from "@/editor/autoLink";

/**
 * The editable body of a generated atomic note (v3.4 Part 3). Renders the note's
 * markdown as live TipTap content — checkboxes are checkable, tables editable,
 * lists/prose/images real nodes. On change it serializes back to markdown via
 * `onChange` so edits persist.
 *
 * v3.7: AI-generated notes now join the linked web like user-written ones — the
 * Reference mark + AutoLink auto-link any text matching an existing note's title
 * (the same shared title index the editor maintains). Links are existing-note
 * only (no new notes are spawned here → no cascade), re-derived on each load,
 * and tappable to open the linked note.
 */
export default function MicroNoteBody({
  markdown,
  ghost,
  onChange,
  onOpen,
}: {
  markdown: string;
  ghost?: boolean; // ungrounded → render provisional/grey
  onChange: (md: string) => void;
  onOpen?: (id: string) => void; // open a linked note
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      Heading.configure({ levels: [2, 3] }),
      Bold,
      Italic,
      Code,
      Citation,
      Highlight, // ==key point== → clipped background highlight
      Reference, // schema mark for note links (rendered .mark-reference)
      AutoLink, // auto-link spans matching existing note titles
      HorizontalRule,
      BulletList,
      OrderedList,
      ListItem,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image,
    ],
    content: mdToDoc(markdown) as JSONContent,
    editorProps: {
      attributes: {
        class: `micro-note-body${ghost ? " ghost" : ""}`,
        spellcheck: "false",
      },
      // Tap an auto-link to open that note; normal clicks just place the caret.
      handleClick: (_view, _pos, event) => {
        const el = (event.target as HTMLElement | null)?.closest?.("[data-note-id]");
        const id = el?.getAttribute("data-note-id");
        if (id && onOpenRef.current) {
          onOpenRef.current(id);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(docToMd(editor.getJSON()));
    },
  });

  // Re-load when the markdown source changes (regenerate / open a different note).
  useEffect(() => {
    if (!editor) return;
    const current = docToMd(editor.getJSON());
    if (current.trim() !== markdown.trim()) {
      editor.commands.setContent(mdToDoc(markdown) as JSONContent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, editor]);

  return <EditorContent editor={editor} />;
}
