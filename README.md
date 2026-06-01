# plain

An iA-Writer-style grounded markdown note editor for medical students. You just
write; plain quietly grounds factual continuations in your sources, spins key
concepts into linked micro-notes, and organises everything into a derived tree.

## Run locally

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local   # server-side only
npm run dev          # http://localhost:3000
```

Without a key the editor, notes, sidebar, command field, persistence, and
offline all work — only the AI features (grounding, concepts) stay silent.

## Environment variables

| Var | Where | Required | Purpose |
|-----|-------|----------|---------|
| `ANTHROPIC_API_KEY` | server only | for AI features | Grounding (`/api/ground`), concepts (`/api/concepts`), verb-mark (`/api/mark`). Read only in Node API routes; never shipped to the client. |

No `NEXT_PUBLIC_*` keys exist — nothing secret reaches the browser bundle.

## Architecture (one deployable unit)

- **Next.js 16 (App Router)** app — the editor + three server API routes
  (`runtime = "nodejs"`) that call the Anthropic API. Everything is one app.
- **Persistence** is client-side **IndexedDB** (`idb-keyval`) — notes, the
  concept graph, tree state, dismissed phrases. No database, no server state.
- **Sources / truth layer**: plain `.md` files in [`/sources`](./sources),
  read server-side by `/api/ground`. Each may declare an **authority tier**
  via frontmatter (`tier: guideline|textbook|lecture|peer`) or a
  `name.<tier>.md` suffix; grounding weights higher tiers first and surfaces
  conflicts instead of silently choosing.

## PWA / offline

- `manifest.webmanifest` + icons + an `apple-touch-icon` → installable.
- A minimal service worker (`public/sw.js`, registered in **production only**)
  caches the app shell so it loads offline. Writing and local navigation work
  fully offline (IndexedDB); AI features pause calmly and resume when back.

## Deploy

**Web app → Vercel** (or any Next.js host):

```bash
npm run build    # must be clean
# set ANTHROPIC_API_KEY in the host's env (Production + Preview)
```

That's the whole deploy — a single Next.js unit. There is **no separate
conversion / attachments service** in this build (attachments were never
implemented), so nothing else needs hosting. If attachments (e.g. a MarkItDown
conversion service) are added later, they'd deploy as a separate container with
their own size/type/rate limits; that work is not present today.

## Not yet built (known gaps)

- **Attachments / file conversion** — no `/api/attach`, no conversion service.
- **Per-source tier override UI** — tiers are set via the source files
  themselves; there is no in-app source manager yet.
