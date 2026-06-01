import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Spawn-bar guards (Gap 2): reject phrases too generic/short/long to deserve
// their own note. Cheap deterministic floor on top of the model's judgement.
const GENERIC = new Set([
  "treatment", "patient", "patients", "symptoms", "symptom", "diagnosis",
  "management", "presentation", "investigation", "investigations", "disease",
  "condition", "therapy", "cause", "causes", "effect", "effects", "risk",
  "history", "examination", "test", "tests", "note", "notes", "drug", "drugs",
  // domain-neutral generics — plain is not medicine-only
  "process", "system", "method", "concept", "idea", "thing", "topic", "example",
  "type", "types", "form", "forms", "way", "ways", "part", "parts", "factor",
  "factors", "result", "results", "feature", "features", "use", "uses",
]);

function passesBar(phrase: string): boolean {
  const p = phrase.trim();
  if (p.length < 3) return false; // too short
  const words = p.split(/\s+/);
  if (words.length > 4) return false; // a clause, not a concept
  if (/^\d+$/.test(p)) return false; // a bare number
  if (GENERIC.has(p.toLowerCase())) return false; // too generic
  return true;
}

const INSTRUCTION = `You read a student's notes and identify the few genuinely significant concepts that each deserve their own standalone reference note (an atomic note). The domain may be anything — medicine, history, economics, etc.

Return concepts as short noun-phrases — a named thing, idea, mechanism, or entity. Examples: "troponin", "supply and demand", "the Treaty of Westphalia".

Rules — BE VERY STRICT (under-extract; flooding the tree is the failure to avoid):
- Return AT MOST 5, and usually 1–3. If you are unsure whether something is page-worthy, LEAVE IT OUT.
- A good concept is a SPECIFIC, NAMEABLE, SIGNIFICANT standalone idea a learner would want as its own note. It must be substantial enough to fill a small note on its own.
- REJECT: generic words ("treatment", "patient", "process", "system"), common verbs/adjectives, headings, dates, numbers, vague phrases, and anything that is basically a restatement of the note's own main topic (don't spawn a note that just duplicates the source note).
- REJECT anything that is really just a passing mention rather than a concept the note is genuinely ABOUT or that clearly stands alone.
- Each "phrase" MUST be an exact, verbatim substring copied from the text (match its casing).
- Each phrase should be 1–4 words; skip anything that's really a sentence.
- "summary" is a single concise line (≤ 120 chars) defining the concept.
- "points" is an array of 2–4 short ATOMIC facts about the concept (each ≤ 90 chars, one idea per line).`;

const SCHEMA = {
  type: "object" as const,
  properties: {
    concepts: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          phrase: { type: "string" as const },
          summary: { type: "string" as const },
          points: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        required: ["phrase", "summary", "points"],
        additionalProperties: false,
      },
    },
  },
  required: ["concepts"],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  // Per-IP rate limit (calm: empty concept list, no error surfaced to the user).
  if (rateLimited(req, "concepts")) return NextResponse.json({ concepts: [] });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ concepts: [] });

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const body = (text ?? "").trim();
  if (body.length < 12) return NextResponse.json({ concepts: [] });

  const client = new Anthropic();
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        { role: "user", content: `${INSTRUCTION}\n\nNotes:\n"""\n${body}\n"""` },
      ],
    });

    let parsed: {
      concepts?: {
        phrase: string;
        summary: string;
        points?: string[];
      }[];
    } = {};
    for (const block of message.content) {
      if (block.type === "text") {
        try {
          parsed = JSON.parse(block.text);
        } catch {
          /* ignore */
        }
      }
    }
    // Quality floor: tighten what the model returns so the tree stays clean.
    const concepts = (parsed.concepts ?? [])
      .filter((c) => c && typeof c.phrase === "string")
      .map((c) => ({
        phrase: c.phrase.trim(),
        summary: (c.summary || "").trim(),
        points: Array.isArray(c.points)
          ? c.points.map((p) => String(p).trim()).filter(Boolean).slice(0, 4)
          : [],
      }))
      .filter((c) => passesBar(c.phrase))
      .slice(0, 5); // under-spawn: the route returns at most 5 per pass
    return NextResponse.json({ concepts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request failed";
    return NextResponse.json({ concepts: [], error: msg });
  }
}
