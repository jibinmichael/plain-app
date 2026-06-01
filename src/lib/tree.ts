import type { NoteRecord } from "./store";

/**
 * Derives the sidebar tree from the persisted graph — never authored.
 *
 * - Written notes are clustered by shared concepts (shared links to the same
 *   micro-notes): a cheap union-find over the concept edges. Each cluster gets
 *   an inferred label (the dominant shared concept), overridable + persisted.
 * - Each micro-note nests under ONE primary parent: the written note that most
 *   references it. The graph keeps the rest of the truth (peek + meaning search).
 *
 * Pure + cheap: call it from a memo keyed on the note signature, not per key.
 */

export type TreeMicro = { id: string; title: string };
export type TreeNote = { id: string; title: string; micros: TreeMicro[] };
export type TreeCluster = {
  id: string; // stable-ish: "c:" + sorted member ids
  key: string; // same as id sans prefix — the label-store key
  label: string;
  notes: TreeNote[];
};

const isMicro = (n: NoteRecord) => n.kind === "micro";

class UF {
  parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    while (this.parent.get(x) !== r) {
      const nxt = this.parent.get(x)!;
      this.parent.set(x, r);
      x = nxt;
    }
    return r;
  }
  union(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

export function buildTree(
  notes: NoteRecord[],
  labels: Record<string, string>
): TreeCluster[] {
  const written = notes.filter((n) => !isMicro(n));
  const micros = notes.filter(isMicro);
  const microIds = new Set(micros.map((m) => m.id));
  const titleById = new Map(notes.map((n) => [n.id, n.title]));

  // A written note's concepts = its links that point at micro-notes.
  const conceptsOf = (n: NoteRecord) =>
    (n.links || []).filter((id) => microIds.has(id));

  // Primary parent of each micro = the written note (most links) referencing it.
  const parentOf = new Map<string, string>();
  for (const m of micros) {
    let best: NoteRecord | null = null;
    for (const w of written) {
      if (!conceptsOf(w).includes(m.id)) continue;
      if (!best || (w.links?.length ?? 0) > (best.links?.length ?? 0)) best = w;
    }
    if (best) parentOf.set(m.id, best.id);
  }
  const microsByParent = new Map<string, TreeMicro[]>();
  for (const m of micros) {
    const p = parentOf.get(m.id);
    if (!p) continue; // orphan micro stays in the graph, not the tree
    const arr = microsByParent.get(p) ?? [];
    arr.push({ id: m.id, title: m.title });
    microsByParent.set(p, arr);
  }

  // Cluster written notes that share any concept.
  const uf = new UF();
  written.forEach((w) => uf.find(w.id));
  const byConcept = new Map<string, string[]>();
  for (const w of written) {
    for (const c of conceptsOf(w)) {
      const arr = byConcept.get(c) ?? [];
      arr.push(w.id);
      byConcept.set(c, arr);
    }
  }
  for (const ids of byConcept.values()) {
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  // Gather components.
  const comps = new Map<string, NoteRecord[]>();
  for (const w of written) {
    const root = uf.find(w.id);
    const arr = comps.get(root) ?? [];
    arr.push(w);
    comps.set(root, arr);
  }

  const clusters: TreeCluster[] = [];
  for (const members of comps.values()) {
    members.sort((a, b) => b.updatedAt - a.updatedAt);
    const key = members
      .map((m) => m.id)
      .sort()
      .join("|");

    // Inferred label = the most-referenced shared concept across members;
    // fall back to the dominant note title. (Seam: swap for a model call.)
    const freq = new Map<string, number>();
    for (const w of members) {
      for (const c of conceptsOf(w)) freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    let topConcept = "";
    let topN = 0;
    for (const [c, n] of freq) {
      if (n > topN) {
        topN = n;
        topConcept = c;
      }
    }
    const derived =
      (topConcept && titleById.get(topConcept)) || members[0]?.title || "notes";
    const label = labels[key] ?? derived;

    clusters.push({
      id: `c:${key}`,
      key,
      label,
      notes: members.map((w) => ({
        id: w.id,
        title: w.title,
        micros: (microsByParent.get(w.id) ?? []).sort((a, b) =>
          a.title.localeCompare(b.title)
        ),
      })),
    });
  }

  clusters.sort((a, b) => b.notes.length - a.notes.length);
  return clusters;
}

/** A cheap signature: changes only when notes/titles/links/kinds change. */
export function treeSignature(notes: NoteRecord[]): string {
  return notes
    .map((n) => `${n.id}:${n.kind ?? "w"}:${n.title}:${(n.links || []).join(",")}`)
    .sort()
    .join(";");
}
