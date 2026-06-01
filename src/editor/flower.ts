import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { flowerSVG, highlightSVG, spriteEl } from "./glyphs";

/**
 * The flower prefix — the only per-line entry point. A dormant, near-invisible
 * margin glyph on every line that blooms on hover/focus. Tapping it fans out
 * two bare actions: mark-what-matters (highlight) and ask (the AI square).
 * Actions emit DOM CustomEvents the editor layer handles.
 */
const key = new PluginKey("flower");

function buildFlower(blockStart: number): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "flower";
  wrap.contentEditable = "false";

  const glyph = document.createElement("button");
  glyph.className = "flower-glyph";
  glyph.type = "button";
  glyph.setAttribute("aria-label", "Line actions");
  glyph.innerHTML = flowerSVG;
  glyph.addEventListener("mousedown", (e) => e.preventDefault());
  glyph.addEventListener("click", (e) => {
    e.preventDefault();
    wrap.classList.toggle("open");
  });

  const fan = document.createElement("span");
  fan.className = "flower-fan";

  const mark = document.createElement("button");
  mark.className = "flower-act";
  mark.type = "button";
  mark.setAttribute("aria-label", "Mark what matters");
  mark.innerHTML = highlightSVG;

  const ask = document.createElement("button");
  ask.className = "flower-act";
  ask.type = "button";
  ask.setAttribute("aria-label", "Ask");
  ask.appendChild(spriteEl());

  const emit = (type: string) => (e: Event) => {
    e.preventDefault();
    wrap.classList.remove("open");
    wrap.dispatchEvent(
      new CustomEvent(type, { detail: { pos: blockStart }, bubbles: true })
    );
  };
  mark.addEventListener("mousedown", (e) => e.preventDefault());
  mark.addEventListener("click", emit("plain:mark"));
  ask.addEventListener("mousedown", (e) => e.preventDefault());
  ask.addEventListener("click", emit("plain:ask"));

  fan.appendChild(mark);
  fan.appendChild(ask);
  wrap.appendChild(glyph);
  wrap.appendChild(fan);
  return wrap;
}

export const Flower = Extension.create({
  name: "flower",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (!node.isTextblock) return;
              const blockStart = offset + 1;
              decos.push(
                Decoration.widget(blockStart, () => buildFlower(blockStart), {
                  side: -1,
                  key: `flower-${blockStart}`,
                  ignoreSelection: true,
                })
              );
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
