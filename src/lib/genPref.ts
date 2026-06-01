/**
 * v3.6 Part A — "form follows content": every auto-note adapts its FORM to two
 * dimensions the student controls:
 *   - level: how deep   (simple = ELI5 · student = working depth · exam = dense)
 *   - style: how shaped (prose paragraphs · tight bullet lists)
 *
 * There's a GLOBAL default (set once, persisted in localStorage — a final-year
 * sets Exam + Bullets and forgets about it) and a PER-NOTE override (a quiet
 * control on a note bumps just that note). Override beats global. Each (level,
 * style) combo is generated + cached independently so switching is instant.
 *
 * Types live here (not store.ts) so the API route can import them type-only
 * without pulling in client storage. All localStorage access is guarded so this
 * module is safe to import on the server (the route only uses the types).
 */

export type Level = "simple" | "student" | "exam";
export type Style = "prose" | "bullets";
export type GenPref = { level: Level; style: Style };

export const DEFAULT_GEN: GenPref = { level: "student", style: "prose" };

export const LEVELS: { key: Level; label: string }[] = [
  { key: "simple", label: "Simple" },
  { key: "student", label: "Student" },
  { key: "exam", label: "Exam" },
];
export const STYLES: { key: Style; label: string }[] = [
  { key: "prose", label: "Prose" },
  { key: "bullets", label: "Bullets" },
];

// Colour-code each template option so the differences read at a glance
// (iA-Writer-style syntax palette). Used in both the per-note menu and the
// global popover, and on the dropdown trigger.
// Muted, harmonious palette — refined for Apercu (a clean sans): the same hues
// at lower saturation/medium tone so the coloured labels read as calm accents,
// not strong/heavy text.
export const OPTION_COLOR: Record<Level | Style, string> = {
  simple: "#4f9d6b", // muted green
  student: "#4a72cf", // muted blue
  exam: "#c25f57", // muted terracotta
  prose: "#8067c4", // dusty violet
  bullets: "#b08130", // ochre
};

/** Cache key for one (level, style) breakdown of a note. */
export function comboKey(level: Level, style: Style): string {
  return `${level}:${style}`;
}

const STORE_KEY = "plain-gen-pref";
/** Fired on <window> when the global default changes, so open notes can react. */
export const GEN_PREF_EVENT = "plain:gen-pref";

function isLevel(v: unknown): v is Level {
  return LEVELS.some((l) => l.key === v);
}
function isStyle(v: unknown): v is Style {
  return STYLES.some((s) => s.key === v);
}

/** The student's global default (or DEFAULT_GEN). Safe on the server. */
export function getGlobalGen(): GenPref {
  if (typeof window === "undefined") return DEFAULT_GEN;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_GEN;
    const p = JSON.parse(raw) as Partial<GenPref>;
    return {
      level: isLevel(p.level) ? p.level : DEFAULT_GEN.level,
      style: isStyle(p.style) ? p.style : DEFAULT_GEN.style,
    };
  } catch {
    return DEFAULT_GEN;
  }
}

export function setGlobalGen(pref: GenPref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(pref));
    window.dispatchEvent(new CustomEvent(GEN_PREF_EVENT, { detail: pref }));
  } catch {
    /* storage unavailable → fall back to default each load */
  }
}
