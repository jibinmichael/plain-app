import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * v3.4 Part 4 — fetch an image URL and return it as a downscaled, size-capped
 * base64 data URL so a generated note can embed it INLINE and have it persist
 * locally (IndexedDB), surviving refresh — consistent with v0.9 image handling.
 *
 * "Downscale" here is a hard SIZE cap, not pixel resampling (no native image
 * libs server-side): we reject anything over the cap so the stored note stays
 * small. The seam for real file storage / true resampling is left for later.
 */
const MAX_BYTES = 350 * 1024; // ~350KB cap on the embedded image
const OK_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(req: NextRequest) {
  if (rateLimited(req, "image-embed", 30)) {
    return NextResponse.json({ dataUrl: null });
  }
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url || !/^https:\/\//.test(url)) {
    return NextResponse.json({ dataUrl: null });
  }
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return NextResponse.json({ dataUrl: null });
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!OK_TYPES.has(type)) return NextResponse.json({ dataUrl: null });

    const buf = Buffer.from(await res.arrayBuffer());
    // Hard cap: skip silently if too big (no broken/placeholder image).
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ dataUrl: null, reason: "too-large" });
    }
    const dataUrl = `data:${type};base64,${buf.toString("base64")}`;
    return NextResponse.json({ dataUrl });
  } catch {
    return NextResponse.json({ dataUrl: null });
  }
}
