# Build prompt — grounded markdown notes (spine v0.1)

Paste this whole file into Claude Code as the task.

## What this is
A focused, iA-Writer-style markdown note editor for medical students. The student writes in their own words. An AI assistant only ever completes text that is **grounded in the student's own `.md` source files**, and stays silent otherwise. The AI never writes the student's reasoning — only look-up facts that already exist in the sources.

## Build only this slice (the spine)
1. A single-page markdown editor in the iA dark/light aesthetic below.
2. A `/sources` folder of `.md` files = the truth layer.
3. Pause → grounded ghost-fill: when the writer stops typing for ~1s, ask Claude to continue the sentence using only the source `.md` files. If the continuation is backed by a citation, show it as muted ghost text; `Tab` accepts it. If nothing is grounded, show nothing.
4. A minimal, subtle dark/light theme switcher.
5. Fully responsive, mobile-first (works at 360px → desktop).

Do NOT build yet: vector DB, embeddings, auth, accounts, spaced repetition, multiplayer. None of it is needed for the spine.

## Stack
- Next.js (App Router) + React + TypeScript + Tailwind.
- Editor: TipTap (ProseMirror). Keep raw markdown **visible** — do not render it away. `#`, `##`, `---` stay on screen, styled (see tokens). Use ProseMirror decorations for the syntax styling.
- AI: Anthropic SDK, server-side only (keys never reach the client). Model `claude-opus-4-8`. Use the **Citations API** — docs: https://docs.claude.com/en/build-with-claude/citations

## How grounding works (no database)
Because sources are `.md` and small, skip retrieval/vector search entirely for now:
- Read the `.md` files from `/sources` on the server.
- Pass them to the Messages API as `document` content blocks with citations enabled (media type text/plain).
- Send the student's current paragraph as the query, with an instruction like: "Continue this sentence ONLY if the continuation is directly supported by the documents. If it is not supported, return nothing."
- The response includes citations pointing at the exact source sentences.
- **Decision rule:** response contains a citation → grounded → render ghost text. No citation (or empty) → silence.

This citation-or-nothing check is the entire product logic. Keep it strict — do not soften it into "best guess."

## Interaction states
- **Grounded (ghost):** a muted continuation appears inline after a ~1s pause. `Tab` inserts it and tags the inserted span `origin="ai"`. Any other keystroke dismisses it.
- **Silent:** ungrounded → nothing appears. This is intentional, not an error. Optionally show a single very-low-contrast hint line; never anything louder.
- Track origin per span with a TipTap mark `origin` in {typed, pasted, ai}. New typing defaults to `typed`. `ai` spans render in the muted dotted "fetched" style and stay marked as not-the-student's.

## Design spec — match this exactly (it is the point)
Monospace everywhere in the writing canvas. One accent colour only: teal. Heavy restraint — no shadows, no gradients, no playful flourishes.

Theme via CSS custom properties on `:root`, flipped by a `data-theme` attribute on `<html>`.

**Dark theme**
- canvas bg `#1c1c1e`, text `#c7c7cb`, secondary text `#7e7e83`, faded `#46464b`
- accent (markdown `#`, caret) `#5dcaa5`
- ghost suggestion `#5e5e63`; accepted ai/fetched text `#6e6e73` with a dotted underline
- borders `rgba(255,255,255,0.08)`

**Light theme**
- canvas bg `#ffffff`, text `#1c1c1e`, secondary `#73726c`, faded `#b4b2a9`
- accent `#1d9e75`
- ghost suggestion `#b4b2a9`; accepted ai/fetched text `#888780` with a dotted underline
- borders `rgba(0,0,0,0.08)`

**Type**
- canvas font: `ui-monospace, "SF Mono", "JetBrains Mono", monospace` (swap in a licensed mono like iA Writer Mono later). 13–15px, line-height ~1.95.
- markdown stays visible: `#` / `##` in the accent colour, `---` as a dim separator, never hidden.

**Layout / responsive**
- centered reading column, max-width ~720px.
- generous padding that scales: ~32px desktop down to ~20px on small widths.
- fluid, not just breakpoints: must look right at any width from 320px (iPad Split View / phone) upward — never assume only phone-or-desktop. caret, ghost text, and hints reflow without breaking.
- touch targets ≥44px.
- the editor container fills the screen with `dvh` so it tracks the on-screen keyboard; use `svh` for other full-height surfaces to avoid jumpy layout shifts.

**Theme switcher**
- one small, subtle icon button (sun / moon) in a top corner.
- toggles `data-theme` on `<html>`, persists the choice to `localStorage`, and defaults to `prefers-color-scheme` on first load.
- set the theme before first paint so there is no flash.

## iPad & iOS — make it feel native (most students are on iPad)
Treat iPad Safari as a first-class target, not an afterthought.

**Viewport & height**
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, and honour `env(safe-area-inset-*)` so nothing sits under the rounded corners / home indicator.
- Use `dvh` / `svh` (Safari 15.4+) instead of `100vh` — `100vh` overflows on iOS. `dvh` for the keyboard-aware editor, `svh` for everything else.
- Prevent focus-zoom: iOS auto-zooms when the focused field's font is under 16px. Set the editor's effective font-size to **16px on touch / coarse-pointer** (keep 13–15px on desktop). Do NOT disable pinch-zoom to fix this — that's an accessibility regression.
- `-webkit-text-size-adjust: 100%` to stop text inflation; `overscroll-behavior: contain` to kill pull-to-refresh and rubber-banding inside the editor.

**Touch (there is no Tab key)**
- The on-screen keyboard has no Tab, so ghost-fill needs a touch accept: **tap the ghost text to keep it**, plus a small always-visible "keep" chip beside it. Keep `Tab` working for the many students on a Magic Keyboard.
- No hover on touch: the theme toggle and all controls must work on tap and be visible without hover. Gate hover-only flourishes behind `@media (hover: hover)`. Set `-webkit-tap-highlight-color: transparent`.

**TipTap on iOS (known gotchas)**
- `immediatelyRender: false` (Next.js SSR — avoids a hydration mismatch).
- `translate="no"` on the editor: don't let Safari auto-translate medical terms, and it steadies the inline source-pill nodes.
- Set input attributes deliberately — `autocapitalize`, `spellcheck`, and especially `autocorrect="off"`: iOS autocorrect mangles drug names and abbreviations.
- Inline non-editable nodes (the `/source/…` pills) have caret/backspace glitches on iOS Safari — make them proper atom nodes and test caret movement before and after them.

**Installable (the native feel)**
- Ship a `manifest.webmanifest` (`display: "standalone"`, `start_url`, `theme_color`, `background_color`, 192 + 512 icons) so "Add to Home Screen" launches full-screen with no browser chrome.
- Add an `apple-touch-icon` (180×180 PNG) in `<head>` — iOS doesn't fully use the manifest icons. Add `apple-mobile-web-app-capable` and a status-bar-style meta. Real installability needs HTTPS + a service worker.
- iPadOS runs PWAs in Stage Manager / Split View with external keyboards — another reason layout must stay fluid at any width.

**Delight (free)**
- Apple Pencil Scribble writes straight into web text fields on iPadOS — it works in the editor automatically; just don't intercept it.

## Done when
- I can write a markdown note in the iA aesthetic, in both dark and light, on phone and desktop.
- Pausing on a fact that exists in `/sources` shows a muted ghost completion I can `Tab` to accept.
- Pausing on something not in the sources shows nothing.
- My theme choice persists and respects the system default on first load.
- On iPad: added to the home screen it runs full-screen, the keyboard never covers the line I'm typing, ghost-fill accepts on tap as well as `Tab`, and it looks right in Split View and both orientations.
