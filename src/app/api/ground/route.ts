import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/ratelimit";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const SOURCES_DIR = path.join(process.cwd(), "sources");

// Authority tiers (Gap 3): higher number = more authoritative. Grounding weights
// higher tiers first and surfaces conflicts rather than silently picking one.
const TIER_RANK: Record<string, number> = {
  peer: 1,
  lecture: 2,
  textbook: 3,
  guideline: 4,
};
type Tier = keyof typeof TIER_RANK;

type Doc = { title: string; data: string; tier: Tier };

let cachedDocs: Doc[] | null = null;

// A source declares its tier via optional frontmatter `tier: guideline`, or by
// a `.<tier>.md` suffix; otherwise it defaults to "peer" (least authoritative).
function readTier(filename: string, body: string): Tier {
  const fm = body.match(/^---\s*[\s\S]*?\btier:\s*(\w+)[\s\S]*?---/);
  const fromFm = fm?.[1]?.toLowerCase();
  if (fromFm && fromFm in TIER_RANK) return fromFm as Tier;
  const suffix = filename.toLowerCase().match(/\.(peer|lecture|textbook|guideline)\.md$/);
  if (suffix) return suffix[1] as Tier;
  return "peer";
}

async function loadSources(): Promise<Doc[]> {
  if (cachedDocs) return cachedDocs;
  let files: string[] = [];
  try {
    files = (await readdir(SOURCES_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const docs = await Promise.all(
    files.sort().map(async (f) => {
      const data = await readFile(path.join(SOURCES_DIR, f), "utf8");
      return { title: f, data, tier: readTier(f, data) };
    })
  );
  // Highest authority first so the model sees the strongest sources earliest.
  cachedDocs = docs
    .filter((d) => d.data.trim().length > 0)
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  return cachedDocs;
}

const CONTINUE_INSTRUCTION = `You are an inline note-completion engine for a student's markdown notes. The student has paused mid-thought. Continue their note with a genuinely useful continuation that reads like THEIR OWN note carrying on — a few coherent sentences (NOT a timid half-line, NOT a runaway essay).

Prefer facts supported by the provided source documents (those get cited). Where the sources support it, ground your continuation in them.

Hard rules:
- Continue seamlessly from where the text stops, as if finishing their thought. Do not repeat what they already wrote.
- Write a substantial, useful completion: roughly 2–4 sentences of real note content — concrete, specific, the kind of thing they'd actually want written down. Never a single clause; never a wall of text.
- Plain prose only (this is an inline completion, not a structured page). No headings, no lists, no preamble like "Here is…".
- Write it from where their sentence/line is going; finish the current sentence first if mid-sentence, then add a sentence or two more.

The text the student has written so far is below. Continue it.`;

// When nothing is grounded we STILL help (grounded-or-ghost): the model writes a
// useful continuation from general knowledge. The client shows it as a provisional
// grey ghost (never asserted as committed fact), so the app is never a dead end.
const CONTINUE_FALLBACK = `You are an inline note-completion engine for a student's markdown notes. The student has paused mid-thought. Continue their note with a genuinely useful, accurate continuation from your general knowledge — a few coherent sentences that read like THEIR OWN note carrying on.

Hard rules:
- Continue seamlessly from where the text stops; do not repeat what they already wrote.
- Roughly 2–4 sentences of real, specific note content. Never a single clause; never a wall of text.
- Plain prose only. No headings, lists, or preamble.
- Be accurate and concrete; this is a provisional suggestion the student will review.

The text the student has written so far is below. Continue it.`;

const ASK_INSTRUCTION = `You are answering a medical student's question about their highlighted text, using ONLY the provided source documents.

Hard rules:
- Answer ONLY with facts directly supported by the sources, with citations.
- Sources are ordered most-authoritative first (guideline > textbook > lecture > peer). Prefer the higher-authority source.
- If two sources genuinely CONFLICT on the answer, do not silently pick one: state both briefly and note that they disagree, citing each.
- If the sources do not support an answer, output NOTHING at all (an empty response).
- Be concise — one or two sentences.

The student's selection / question is below.`;

export async function POST(req: NextRequest) {
  // Per-IP rate limit so a shared link can't run up unbounded Anthropic cost.
  // Calm response (200, grounded:false) — the editor already treats that as
  // "no suggestion", so a limited caller just sees silence, never an error.
  if (rateLimited(req, "ground")) {
    return NextResponse.json(
      { grounded: false, error: "rate limited — slow down a moment" },
      { status: 200 }
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { grounded: false, error: "ANTHROPIC_API_KEY is not set." },
      { status: 200 }
    );
  }

  const { text, mode, sources } = (await req.json().catch(() => ({}))) as {
    text?: string;
    mode?: "continue" | "ask";
    // Uploaded sources live in the client's IndexedDB, so they're sent along
    // with the query to join the filesystem sources in the truth layer.
    sources?: { title: string; markdown: string; tier?: Tier }[];
  };
  const query = (text ?? "").trim();
  if (query.length < 3) return NextResponse.json({ grounded: false });
  const isAsk = mode === "ask";
  const instruction = isAsk ? ASK_INSTRUCTION : CONTINUE_INSTRUCTION;

  const uploaded: Doc[] = (sources ?? [])
    .filter((s) => s && typeof s.markdown === "string" && s.markdown.trim())
    .map((s) => ({
      title: s.title || "uploaded",
      data: s.markdown,
      tier: s.tier && s.tier in TIER_RANK ? s.tier : "peer",
    }));

  // Merge filesystem + uploaded sources, most-authoritative first.
  const docs = [...(await loadSources()), ...uploaded].sort(
    (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]
  );
  if (docs.length === 0) return NextResponse.json({ grounded: false });

  const client = new Anthropic();

  const content: Anthropic.ContentBlockParam[] = docs.map((d, i) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: d.data },
    title: d.title,
    // Tell the model each source's authority tier (used for weighting/conflict).
    context: `authority tier: ${d.tier}`,
    citations: { enabled: true },
    // Documents are stable across requests — cache the prefix.
    ...(i === docs.length - 1
      ? { cache_control: { type: "ephemeral" as const } }
      : {}),
  }));
  content.push({ type: "text", text: `${instruction}\n\n"""\n${query}\n"""` });

  try {
    const message = await client.messages.create({
      // Ghost-fill fires after a pause — run it on Haiku for speed (it supports
      // Citations). "Ask" is user-initiated and rarer, so it can afford Opus.
      model: isAsk ? "claude-opus-4-8" : "claude-haiku-4-5",
      max_tokens: 320, // room for a real note-length completion (few sentences)
      messages: [{ role: "user", content }],
    });

    // Decision rule: a text block carrying a citation === grounded.
    let grounded = false;
    let completion = "";
    let source = "";
    const cited: string[] = []; // every distinct source the answer drew from
    for (const block of message.content) {
      if (block.type !== "text") continue;
      completion += block.text;
      if (block.citations && block.citations.length > 0) {
        grounded = true;
        for (const cit of block.citations) {
          const title = (cit as { document_title?: string }).document_title || "";
          if (title && !cited.includes(title)) cited.push(title);
        }
        if (!source) source = cited[0] || "";
      }
    }
    completion = completion.trim();

    if (grounded && completion) {
      return NextResponse.json({ grounded: true, text: completion, source, cited });
    }

    // ── Grounded-or-ghost: nothing was grounded, but "ask" stays citation-only
    //    (a Q&A answer must be trustworthy). For inline CONTINUE we fall back to
    //    a general-knowledge completion, returned as an UNGROUNDED ghost so the
    //    note-taker is never left with a dead end. ──
    if (isAsk) return NextResponse.json({ grounded: false });

    const fb = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 320,
      messages: [
        { role: "user", content: `${CONTINUE_FALLBACK}\n\n"""\n${query}\n"""` },
      ],
    });
    let fallback = "";
    for (const block of fb.content) {
      if (block.type === "text") fallback += block.text;
    }
    fallback = fallback.trim();
    if (!fallback) return NextResponse.json({ grounded: false });
    // grounded:false but text present → the client ghosts it (provisional grey).
    return NextResponse.json({ grounded: false, text: fallback });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request failed";
    return NextResponse.json({ grounded: false, error: msg }, { status: 200 });
  }
}
