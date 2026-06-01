// Inline SVGs for DOM built inside ProseMirror plugins (where React icons
// can't be used). Paths lifted from @tabler/icons (MIT).

const wrap = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const flowerSVG = wrap(
  `<path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M12 2a3 3 0 0 1 3 3c0 .562 -.259 1.442 -.776 2.64l-.724 1.36l1.76 -1.893c.499 -.6 .922 -1 1.27 -1.205a2.968 2.968 0 0 1 4.07 1.099a3.011 3.011 0 0 1 -1.09 4.098c-.374 .217 -.99 .396 -1.846 .535l-2.664 .366l2.4 .326c1 .145 1.698 .337 2.11 .576a3.011 3.011 0 0 1 1.09 4.098a2.968 2.968 0 0 1 -4.07 1.098c-.348 -.202 -.771 -.604 -1.27 -1.205l-1.76 -1.893l.724 1.36c.516 1.199 .776 2.079 .776 2.64a3 3 0 0 1 -6 0c0 -.562 .259 -1.442 .776 -2.64l.724 -1.36l-1.76 1.893c-.499 .601 -.922 1 -1.27 1.205a2.968 2.968 0 0 1 -4.07 -1.098a3.011 3.011 0 0 1 1.09 -4.098c.374 -.218 .99 -.396 1.846 -.536l2.664 -.366l-2.4 -.325c-1 -.145 -1.698 -.337 -2.11 -.576a3.011 3.011 0 0 1 -1.09 -4.099a2.968 2.968 0 0 1 4.07 -1.099c.348 .203 .771 .604 1.27 1.205l1.76 1.894c-1 -2.292 -1.5 -3.625 -1.5 -4a3 3 0 0 1 3 -3"/>`
);

export const highlightSVG = wrap(
  `<path d="M3 19h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M12.5 5.5l4 4"/><path d="M4.5 13.5l4 4"/><path d="M21 15v4h-8l4 -4l4 0"/>`
);

/** The one AI sprite — a small square. `thinking` makes it breathe. */
export function spriteEl(thinking = false): HTMLElement {
  const s = document.createElement("span");
  s.className = `sprite${thinking ? " thinking" : ""}`;
  s.setAttribute("aria-hidden", "true");
  return s;
}
