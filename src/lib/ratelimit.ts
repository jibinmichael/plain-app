import type { NextRequest } from "next/server";

/**
 * Per-IP sliding-window rate limit for the AI routes. In-memory + best-effort:
 * it bounds cost on a shared link (10 testers) without any external store. On
 * serverless it's per-instance, so the real ceiling is roughly limit × instances
 * — fine as a cost backstop for a small test, not a security boundary. Swap for
 * a shared store (Upstash/Redis) before real scale.
 *
 * Default: 30 AI calls per IP per minute — generous for one person typing (ghost
 * fires on pauses, concepts debounced) but caps a runaway/abusive caller.
 */
const WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 30;
const hits = new Map<string, number[]>();

/** Best-effort caller identity behind a proxy (Vercel sets x-forwarded-for). */
export function callerKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

/**
 * Returns true if this caller is OVER the limit (should be rejected). Records
 * the hit when allowed. Keyed per route+IP so one busy route can't starve others.
 */
export function rateLimited(
  req: NextRequest,
  route: string,
  max: number = DEFAULT_MAX
): boolean {
  const key = `${route}:${callerKey(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
