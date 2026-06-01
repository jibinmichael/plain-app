import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

const VERBS = ["find", "do", "avoid", "because"] as const;

const INSTRUCTION = `You mark what matters in a single line of a medical student's notes. Identify the key spans and classify each into exactly one verb:
- "find" — a finding, sign, symptom, or diagnostic clue
- "do" — a treatment, action, or thing to perform
- "avoid" — a danger, contraindication, or thing to watch out for
- "because" — a mechanism, cause, or reason

Rules:
- Return ONLY the most important spans (usually 1–3). Do not mark everything.
- Each span's "text" MUST be an exact, verbatim substring copied from the line.
- Keep spans tight — the meaningful phrase, not the whole sentence.
- If nothing in the line is important enough, return an empty list.`;

const SCHEMA = {
  type: "object" as const,
  properties: {
    spans: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          text: { type: "string" as const },
          verb: { type: "string" as const, enum: [...VERBS] },
        },
        required: ["text", "verb"],
        additionalProperties: false,
      },
    },
  },
  required: ["spans"],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  // Per-IP rate limit (calm: empty span list). This route is dormant (verb tags
  // were removed in v3.0) but stays guarded as a live Anthropic endpoint.
  if (rateLimited(req, "mark")) return NextResponse.json({ spans: [] });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ spans: [] });
  }
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const line = (text ?? "").trim();
  if (line.length < 3) return NextResponse.json({ spans: [] });

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        { role: "user", content: `${INSTRUCTION}\n\nLine:\n"""\n${line}\n"""` },
      ],
    });
    let parsed: { spans?: { text: string; verb: string }[] } = {};
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
      (s) => s && typeof s.text === "string" && (VERBS as readonly string[]).includes(s.verb)
    );
    return NextResponse.json({ spans });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request failed";
    return NextResponse.json({ spans: [], error: msg });
  }
}
