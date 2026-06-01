import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// The conversion service is a separate deployable unit. Its URL is server-side
// only (no NEXT_PUBLIC); the browser never talks to it directly.
const SERVICE_URL =
  process.env.CONVERSION_SERVICE_URL || "http://localhost:8000";

// ── Guardrails (needed before hosting) ────────────────────────────────────
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXT = new Set([
  // documents
  "pdf", "docx", "pptx", "xlsx", "doc", "ppt", "xls",
  // text/markup/data
  "txt", "md", "html", "htm", "csv", "json", "xml", "rtf", "epub",
  // images (OCR)
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff",
  // audio (transcription)
  "mp3", "wav", "m4a", "ogg", "flac",
]);

// Per-user conversion rate limit (best-effort, in-memory). Keeps paid OCR/LLM
// cost bounded per user; resets each window. Swap for a shared store at scale.
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

function ext(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

export async function POST(req: NextRequest) {
  // Identify the caller for rate limiting (best-effort, behind a proxy).
  const who =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (rateLimited(who)) {
    return NextResponse.json(
      { error: "too many uploads — try again later" },
      { status: 429 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
  }
  if (!ALLOWED_EXT.has(ext(file.name))) {
    return NextResponse.json(
      { error: `unsupported file type (.${ext(file.name)})` },
      { status: 415 }
    );
  }

  // Forward to the conversion service.
  try {
    const fwd = new FormData();
    fwd.append("file", file, file.name);
    const res = await fetch(`${SERVICE_URL}/convert`, { method: "POST", body: fwd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (body as { error?: string }).error || "conversion failed" },
        { status: 200 } // calm failure — the pill shows a retry, never a crash
      );
    }
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { error: "conversion service unavailable" },
      { status: 200 }
    );
  }
}
