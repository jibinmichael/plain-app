import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/ratelimit";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

/**
 * /api/research — web search WITH citations, server-side (keys never leave here).
 *
 * Given a concept/claim, the model runs Anthropic's web-search tool and answers
 * in a few factual sentences, each backed by a real, named, reputable source.
 * We parse the model's web citations into a numbered SOURCES list and embed
 * inline `[[cite:N:url]]` markers in the returned markdown, so the client can
 * render blue superscript markers on the cited claims and a tappable sources
 * list below.
 *
 * Grounded-or-ghost: if nothing reputable is found we return grounded:false with
 * no sources — the caller keeps its provisional ghost rather than fabricating a
 * citation. We NEVER attach a source that doesn't support the claim.
 *
 * Cost is bounded: results are cached per concept (in-memory) and the route is
 * rate-limited; web-search uses are capped per request.
 */

type WebSource = { n: number; name: string; domain: string; url: string };
type Research = { grounded: boolean; markdown: string; sources: WebSource[] };

// Per-concept cache (per server instance) so re-opening a note is free.
const cache = new Map<string, Research>();

const PROMPT = (concept: string) =>
  `Research the concept "${concept}" and write 2–4 sentences of accurate, factual note content explaining it and why it matters. ` +
  `Back the key factual claims with reputable, popular sources — prefer .gov / .org, major medical or academic sites, and established references. ` +
  `Cite as you write. Plain prose only: no headings, no lists, no preamble like "Here is".`;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  // Calm on limit (200) — caller just keeps its provisional content, no error.
  if (rateLimited(req, "research")) {
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });
  }

  const { concept } = (await req.json().catch(() => ({}))) as { concept?: string };
  const query = (concept ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });
  }

  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached) return NextResponse.json(cached);

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      tools: [
        // Anthropic's hosted web-search tool — runs the searches server-side and
        // returns the answer with real web citations attached to text spans.
        { type: "web_search_20250305", name: "web_search", max_uses: 4 },
      ],
      messages: [{ role: "user", content: PROMPT(query) }],
    });

    // Walk the answer: assemble prose, and after each cited span append a
    // numbered marker pointing at the real source URL. Sources dedupe by URL.
    const byUrl = new Map<string, number>();
    const sources: WebSource[] = [];
    let markdown = "";

    for (const block of message.content) {
      if (block.type !== "text") continue; // skip tool-use / search-result blocks
      markdown += block.text;
      const citations = (block as { citations?: unknown[] }).citations;
      if (!Array.isArray(citations)) continue;
      for (const raw of citations) {
        const cit = raw as { url?: string; title?: string };
        const url = cit.url;
        if (!url) continue;
        let n = byUrl.get(url);
        if (n == null) {
          n = sources.length + 1;
          byUrl.set(url, n);
          const domain = domainOf(url);
          sources.push({ n, url, domain, name: cit.title?.trim() || domain || "source" });
        }
        markdown += `[[cite:${n}:${url}]]`;
      }
    }

    markdown = markdown.trim();
    const result: Research = {
      grounded: sources.length > 0 && markdown.length > 0,
      markdown,
      sources,
    };
    if (result.grounded) cache.set(key, result);
    return NextResponse.json(result);
  } catch {
    // Any failure → no citation invented; caller keeps its provisional ghost.
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });
  }
}
