import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

// v3.7 — key-point marking (domain-neutral). Given a chunk of the user's notes,
// return the few most important phrases worth HIGHLIGHTING, as exact verbatim
// substrings. The client applies a soft background highlight to each, so the eye
// lands on what matters. Not medical-specific; no classification.
const INSTRUCTION = `You highlight what matters in a student's notes. Identify the KEY phrases worth marking — the core takeaways the reader must catch.

Rules:
- Return ONLY the most important phrases (usually 1–4 across the whole text). Do NOT mark everything.
- Each "text" MUST be an exact, verbatim substring copied from the notes (match case and punctuation).
- Keep each phrase TIGHT — the meaningful words, never a whole sentence or paragraph.
- If nothing is important enough, return an empty list.`;

const SCHEMA = {
  type: "object" as const,
  properties: {
    spans: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          text: { type: "string" as const },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  required: ["spans"],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  // Per-IP rate limit (calm: empty span list).
  if (rateLimited(req, "mark")) return NextResponse.json({ spans: [] });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ spans: [] });
  }
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const notes = (text ?? "").trim();
  if (notes.length < 12) return NextResponse.json({ spans: [] });

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        { role: "user", content: `${INSTRUCTION}\n\nNotes:\n"""\n${notes}\n"""` },
      ],
    });
    let parsed: { spans?: { text: string }[] } = {};
    for (const block of message.content) {
      if (block.type === "text") {
        try {
          parsed = JSON.parse(block.text);
        } catch {
          /* ignore */
        }
      }
    }
    const spans = (parsed.spans ?? []).filter(
      (s) => s && typeof s.text === "string" && s.text.trim().length > 1
    );
    return NextResponse.json({ spans });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request failed";
    return NextResponse.json({ spans: [], error: msg });
  }
}
