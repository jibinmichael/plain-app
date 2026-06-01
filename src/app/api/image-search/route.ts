import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * v3.4 Part 4 — image search for auto-notes (Bing / Azure Image Search).
 *
 * Given a concept, returns the best candidate image(s) + source/attribution so a
 * generated note can embed ONE relevant image inline. The provider key is
 * server-side only (AZURE_IMAGE_KEY) — if it's unset the route SKIPS cleanly
 * (200 + empty list), so the app ships safely with images "off" until you add a
 * key. Citation-or-silence spirit: only return real results, never fabricate.
 *
 * Env:
 *   AZURE_IMAGE_KEY       — Bing/Azure Image Search subscription key (required)
 *   AZURE_IMAGE_ENDPOINT  — optional override of the search endpoint
 */
const ENDPOINT =
  process.env.AZURE_IMAGE_ENDPOINT ||
  "https://api.bing.microsoft.com/v7.0/images/search";

export type ImageHit = {
  url: string; // direct image URL
  thumbnail: string; // smaller URL (used for the downscaled embed)
  width: number;
  height: number;
  sourceName: string; // host / publisher
  sourcePage: string; // page the image lives on (attribution link)
};

export async function POST(req: NextRequest) {
  if (rateLimited(req, "image-search", 20)) {
    return NextResponse.json({ images: [] });
  }
  // No key → skip cleanly. Images are an optional enhancement, never an error.
  const key = process.env.AZURE_IMAGE_KEY;
  if (!key) return NextResponse.json({ images: [], skipped: "no-key" });

  const { concept } = (await req.json().catch(() => ({}))) as { concept?: string };
  const q = (concept ?? "").trim();
  if (q.length < 2) return NextResponse.json({ images: [] });

  try {
    const params = new URLSearchParams({
      q,
      count: "8",
      safeSearch: "Strict",
      imageType: "Photo",
    });
    const res = await fetch(`${ENDPOINT}?${params}`, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    if (!res.ok) return NextResponse.json({ images: [] });
    const data = (await res.json()) as {
      value?: {
        contentUrl?: string;
        thumbnailUrl?: string;
        width?: number;
        height?: number;
        hostPageDisplayUrl?: string;
        hostPageUrl?: string;
      }[];
    };

    const images: ImageHit[] = (data.value ?? [])
      .filter((v) => v.contentUrl && /^https:\/\//.test(v.contentUrl))
      .map((v) => ({
        url: v.contentUrl!,
        thumbnail: v.thumbnailUrl || v.contentUrl!,
        width: v.width ?? 0,
        height: v.height ?? 0,
        sourceName: v.hostPageDisplayUrl || "",
        sourcePage: v.hostPageUrl || "",
      }))
      .slice(0, 8);

    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ images: [] });
  }
}
