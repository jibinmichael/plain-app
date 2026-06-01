import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { rateLimited } from "@/lib/ratelimit";
import { sanitizeSpec } from "@/lib/flow";

export const runtime = "nodejs";

type Src = { title: string; markdown: string; tier?: string };

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

// v3.6 Part B — one domain-neutral binary, then act on it. This is NOT the old
// medical type schema: it's simply process-vs-explanation. A process becomes a
// flowchart spec; anything else falls back to the normal Part-A note.
const INSTRUCTION = `You decide ONE binary question about a concept, then act on it.

QUESTION: is this concept fundamentally a PROCESS / PROTOCOL / DECISION-PATHWAY — ordered steps and/or yes/no decisions (e.g. a clinical algorithm, an emergency protocol, a recipe, a setup or git workflow, a troubleshooting flow)? Or is it normal explanatory content (a definition, a disease, a drug, an idea to understand)?

Respond with ONLY a JSON object — no prose, no markdown code fences:
- If it is NOT a process: {"process": false}
- If it IS a process: {"process": true, "nodes": [{"id":"n1","label":"…","kind":"start|step|decision|end"}], "edges": [{"from":"n1","to":"n2","branch":"yes|no|<optional>"}]}

Rules for the spec:
- Exactly one "start" node and at least one "end". Use "decision" for branch points and put the branch label ("yes"/"no") on each of a decision's outgoing edges.
- Short labels (a few words). 4–12 nodes is ideal. ids are short unique strings.
- Ground it in the SOURCES where provided, otherwise use accurate general knowledge. It will be shown as PROVISIONAL and is fully editable — do NOT invent precise figures you are unsure of.`;

export async function POST(req: NextRequest) {
  // Calm on limit / no key: {process:false} → caller just makes a normal note.
  if (rateLimited(req, "flow")) return NextResponse.json({ process: false });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ process: false });

  const { concept, sources } = (await req.json().catch(() => ({}))) as {
    concept?: string;
    sources?: Src[];
  };
  if (!concept) return NextResponse.json({ process: false });

  const srcs = Array.isArray(sources) ? sources.slice(0, 6) : [];
  const client = new Anthropic();

  try {
    const content: Anthropic.ContentBlockParam[] = srcs.map((s, i) => ({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: clip(s.markdown, 4000) },
      title: s.title,
      citations: { enabled: true },
      ...(i === srcs.length - 1
        ? { cache_control: { type: "ephemeral" as const } }
        : {}),
    }));
    content.push({ type: "text", text: `${INSTRUCTION}\n\nCONCEPT: ${concept}` });

    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1200,
      messages: [{ role: "user", content }],
    });

    let txt = "";
    let grounded = false;
    for (const block of message.content) {
      if (block.type !== "text") continue;
      txt += block.text;
      if (block.citations && block.citations.length > 0) grounded = true;
    }

    // Be forgiving about formatting: strip fences, then grab the first {...}.
    txt = txt.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ process: false });

    const parsed = JSON.parse(m[0]) as { process?: boolean };
    if (parsed.process !== true) return NextResponse.json({ process: false });

    const spec = sanitizeSpec(parsed);
    if (!spec) return NextResponse.json({ process: false }); // malformed → normal note

    return NextResponse.json({ process: true, spec, grounded });
  } catch {
    // Any failure → not a process; the caller falls back to a normal note.
    return NextResponse.json({ process: false });
  }
}
