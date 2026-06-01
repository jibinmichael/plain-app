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

/**
 * The editable body of a generated atomic note (v3.4 Part 3). Renders the note's
 * markdown as live TipTap content — checkboxes are checkable, tables editable,
 * lists/prose/images real nodes. On change it serializes back to markdown via
 * `onChange` so edits persist. A separate, lighter editor than the main canvas
 * (no ghost/concept/title machinery — this is a generated note's content).
 */
export default function MicroNoteBody({
  markdown,
  ghost,
  onChange,
}: {
  markdown: string;
  ghost?: boolean; // ungrounded → render provisional/grey
  onChange: (md: string) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
