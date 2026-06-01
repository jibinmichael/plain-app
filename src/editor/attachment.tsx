import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import {
  IconFileTypePdf,
  IconPresentation,
  IconPhoto,
  IconMicrophone2,
  IconFileText,
} from "@tabler/icons-react";

export type AttachKind = "pdf" | "slides" | "image" | "audio" | "doc";
export type AttachStatus = "converting" | "ready" | "failed";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachment: {
      insertAttachment: (attrs: {
        attachId: string;
        name: string;
        kind: AttachKind;
        status?: AttachStatus;
      }) => ReturnType;
    };
  }
}

/** Map a filename to one of the five pill glyphs. */
export function kindOf(name: string): AttachKind {
  const e = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (e === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(e)) return "slides";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff"].includes(e)) return "image";
  if (["mp3", "wav", "m4a", "ogg", "flac"].includes(e)) return "audio";
  return "doc";
}

const GLYPH = {
  pdf: IconFileTypePdf,
  slides: IconPresentation,
  image: IconPhoto,
  audio: IconMicrophone2,
  doc: IconFileText,
} as const;

function Pill({ node }: NodeViewProps) {
  const { attachId, name, kind, status } = node.attrs as {
    attachId: string;
    name: string;
    kind: AttachKind;
    status: AttachStatus;
  };
  const Glyph = GLYPH[kind] ?? IconFileText;

  const emit = (type: string) =>
    document.dispatchEvent(new CustomEvent(type, { detail: { attachId } }));

  return (
    <NodeViewWrapper
      as="span"
      className={`pill pill-${status}`}
      data-attach-id={attachId}
      contentEditable={false}
      draggable={false}
      onClick={() => emit(status === "failed" ? "plain:attach-retry" : "plain:attach-open")}
      title={status === "failed" ? "conversion failed — tap to retry" : name}
    >
      <Glyph className="pill-glyph" aria-hidden="true" />
      <span className="pill-name">{name}</span>
      {/* The ink AI square — pulses while converting, solid when in the
          truth layer, hidden when failed. */}
      {status !== "failed" && (
        <span className={`sprite${status === "converting" ? " thinking" : ""}`} aria-hidden="true" />
      )}
    </NodeViewWrapper>
  );
}

export const Attachment = Node.create({
  name: "attachment",
  group: "inline",
  inline: true,
  atom: true, // one indivisible glyph; test caret stepping around it on iOS
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      attachId: { default: "" },
      name: { default: "" },
      kind: { default: "doc" },
      status: { default: "converting" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-attach-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-attach-id": HTMLAttributes.attachId,
        class: "pill",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(Pill);
  },

  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { status: "converting", ...attrs },
          }),
    };
  },
});

/** Update a pill's status by attachId, anywhere in the doc (no history entry). */
export function setAttachmentStatus(
  editor: Editor,
  attachId: string,
  status: AttachStatus
): void {
  const { state } = editor;
  let pos = -1;
  state.doc.descendants((node, p) => {
    if (node.type.name === "attachment" && node.attrs.attachId === attachId) {
      pos = p;
      return false;
    }
    return undefined;
  });
  if (pos < 0) return;
  const tr = state.tr.setNodeAttribute(pos, "status", status);
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}
