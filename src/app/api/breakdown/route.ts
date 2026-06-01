import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

type Src = { title: string; markdown: string; tier?: string };

const TIER_RANK: Record<string, number> = {
  peer: 0,
  lecture: 1,
  textbook: 2,
  guideline: 3,
};

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

// v3.4 Part 3 — auto-notes are SYNTHETIC, ATOMIC, well-structured notes (no rigid
// section schema). The model writes a real note about ONE concept, structured
// however the CONTENT calls for — prose, checklists, tables, lists. Atomic
// (Zettelkasten) principles: one idea, self-contained, clearly titled, concise.
// Output is MARKDOWN so the client renders live TipTap nodes (checkable boxes,
// editable tables). Grounded-or-ghost: prefer the user's sources; where a part
// isn't grounded, still write useful general-knowledge content (the client marks
// the whole note provisional when ungrounded) — never empty, never apologetic.

const STRUCTURE = `Write a single, well-structured ATOMIC note about the concept — like a great hand-made study note, NOT a filled-in form. Follow these principles:
- ONE idea only: cover just this concept, self-contained (understandable without the source note open). Be concise and complete, not sprawling.
- Structure by what the CONTENT needs, mixing freely:
  - prose paragraphs for explanation,
  - "- [ ] " checkbox lines for steps / criteria / checklists,
  - a markdown table for comparisons / values / classifications,
  - "- " bullet lists where a list fits,
- Do NOT start with the title (the app shows it). Do NOT use rigid fixed headings like "IN SIMPLE TERMS". You MAY use short "## " subheadings only if they genuinely help.
- Plain markdown only. No preamble like "Here is a note". Keep it tight — a handful of blocks.`;

function buildPrompt(grounded: boolean, sectionList: string): string {
  if (grounded) {
    return `You write a synthetic study note about ONE concept, grounded in the user's own SOURCES.

${STRUCTURE}

Grounding rule:
- Build the note from facts present in the SOURCES where possible.
- Where the sources don't cover a useful part, you MAY add accurate general-knowledge content to keep the note complete — but stay accurate and don't contradict the sources.
- End with a single "SOURCES:" line listing the source titles you actually drew from (comma-separated). If you drew from none, write "SOURCES:" with nothing after it.`;
  }
  return `You write a synthetic study note about ONE concept from your general knowledge (the user has no sources covering it yet).

${STRUCTURE}

- Be accurate and concrete; this is a provisional note the user will review and keep or edit.
- Do NOT include a SOURCES line.${sectionList ? "" : ""}`;
}

export async function POST(req: NextRequest) {
  // Per-IP rate limit (calm: grounded:false, empty markdown → page shows a note
  // can't be generated right now, never an error).
  if (rateLimited(req, "breakdown"))
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });
  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });

  const { concept, sources } = (await req.json().catch(() => ({}))) as {
    concept?: string;
    sources?: Src[];
  };
  if (!concept) {
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });
  }

  const srcs = Array.isArray(sources) ? sources : [];
  const hasSources = srcs.length > 0;

  const client = new Anthropic();
  try {
    let raw = "";
    let grounded = false;
    const cited: string[] = [];

    if (hasSources) {
      // ── Grounded attempt: send the user's sources as citeable documents. A
      //    text block carrying a citation === grounded. ──
      const ranked = [...srcs].sort(
        (a, b) =>
          (TIER_RANK[b.tier ?? "peer"] ?? 0) - (TIER_RANK[a.tier ?? "peer"] ?? 0)
      );
      const content: Anthropic.ContentBlockParam[] = ranked.map((s, i) => ({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: clip(s.markdown, 4000) },
        title: s.title,
        context: `authority tier: ${s.tier ?? "peer"}`,
        citations: { enabled: true },
        ...(i === ranked.length - 1
          ? { cache_control: { type: "ephemeral" as const } }
          : {}),
      }));
      content.push({
        type: "text",
        text: `${buildPrompt(true, "")}\n\nCONCEPT: ${concept}`,
      });

      const message = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 900,
        messages: [{ role: "user", content }],
      });
      for (const block of message.content) {
        if (block.type !== "text") continue;
        raw += block.text;
        if (block.citations && block.citations.length > 0) {
          grounded = true;
          for (const c of block.citations) {
            const t = (c as { document_title?: string }).document_title || "";
            if (t && !cited.includes(t)) cited.push(t);
          }
        }
      }
    }

    // Strip any trailing "SOURCES: ..." line (we surface citations separately).
    let markdown = raw.replace(/\n*SOURCES:[\s\S]*$/i, "").trim();

    // ── Grounded-or-ghost: if nothing came back grounded (or there were no
    //    sources at all), generate the note from general knowledge. It returns
    //    grounded:false → the client renders the whole note as a provisional
    //    ghost. Never empty, never "(not covered)". ──
    if (!grounded || !markdown) {
      const fb = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 900,
        messages: [
          { role: "user", content: `${buildPrompt(false, "")}\n\nCONCEPT: ${concept}` },
        ],
      });
      let fbRaw = "";
      for (const block of fb.content) {
        if (block.type === "text") fbRaw += block.text;
      }
      markdown = fbRaw.replace(/\n*SOURCES:[\s\S]*$/i, "").trim();
      grounded = false;
      cited.length = 0;
    }

    if (!markdown) {
      return NextResponse.json({ grounded: false, markdown: "", sources: [] });
    }
    return NextResponse.json({ grounded, markdown, sources: cited });
  } catch {
    return NextResponse.json({ grounded: false, markdown: "", sources: [] });
  }
}
