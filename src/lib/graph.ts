import type { NoteRecord } from "./store";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

/**
 * Graph data for the React Flow views. React Flow OWNS rendering + interaction;
 * d3-force is used here only as a pure x/y position calculator (it never draws).
 *
 *  - buildOrbit (in orbit.ts) feeds the MINI docked view (current note + 1 hop).
 *  - buildVaultGraph feeds the MAXIMIZED view (the whole vault as constellations):
 *    every note + concept is a node, every link an edge, clustered by the same
 *    shared-link heuristic the sidebar tree uses, laid out so clusters group.
 *
 * Pure + deterministic (seeded layout, no Math.random) — call from a memo keyed
 * on a links/kind signature so it builds once on open, never on a keystroke.
 */

export type VaultNode = {
  id: string;
  title: string;
  kind: "written" | "micro";
  degree: number; // total links (both directions) → node size
  cluster: number; // constellation grouping
  x: number;
  y: number;
};
export type VaultEdge = {
  id: string;
  source: string;
  target: string;
  strength: number; // 1 one-way, 2 mutual → edge thickness
};
export type VaultGraph = {
  nodes: VaultNode[];
  edges: VaultEdge[];
  clusterCount: number;
};

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Assign every note a cluster index. Written notes cluster by shared links (the
 * same neighbourhood logic as tree.ts); a micro-note inherits its parent's
 * cluster; orphans land in a trailing misc cluster. Returns {clusterOf, count}.
 */
function assignClusters(notes: NoteRecord[]): {
  clusterOf: Map<string, number>;
  count: number;
} {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const written = notes.filter((n) => (n.kind ?? "written") !== "micro");
  const clusters: string[][] = [];
  const clusterOf = new Map<string, number>();

  for (const w of written) {
    const linkSet = new Set(
      (w.links || []).filter((id) => byId.get(id)?.kind !== "micro")
    );
    let found = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (
        clusters[i].some(
          (id) => linkSet.has(id) || (byId.get(id)?.links || []).includes(w.id)
        )
      ) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      clusters.push([w.id]);
      clusterOf.set(w.id, clusters.length - 1);
    } else {
      clusters[found].push(w.id);
      clusterOf.set(w.id, found);
    }
  }

  // Micro-notes inherit the cluster of the first written note that links them.
  let misc = -1;
  for (const m of notes) {
    if (m.kind !== "micro") continue;
    let parentCluster = -1;
    for (const w of written) {
      if ((w.links || []).includes(m.id)) {
        parentCluster = clusterOf.get(w.id) ?? -1;
        break;
      }
    }
    if (parentCluster === -1) {
      if (misc === -1) misc = clusters.length === 0 ? 0 : clusters.length;
      parentCluster = misc;
    }
    clusterOf.set(m.id, parentCluster);
  }

  const count = Math.max(1, misc === -1 ? clusters.length : misc + 1);
  return { clusterOf, count };
}

const nodeRadius = (degree: number) => 3 + Math.min(6, degree * 0.6);

export function buildVaultGraph(
  notes: NoteRecord[],
  activeId: string | null
): VaultGraph {
  if (notes.length === 0) return { nodes: [], edges: [], clusterCount: 0 };

  const byId = new Map(notes.map((n) => [n.id, n]));

  // Undirected adjacency + per-pair strength.
  const adj = new Map<string, Set<string>>();
  const strength = new Map<string, number>();
  const ensure = (id: string) => {
    if (!adj.has(id)) adj.set(id, new Set());
    return adj.get(id)!;
  };
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const n of notes) {
    for (const t of n.links || []) {
      if (!byId.has(t) || t === n.id) continue; // drop dangling / self
      ensure(n.id).add(t);
      ensure(t).add(n.id);
      const k = pairKey(n.id, t);
      strength.set(k, (strength.get(k) ?? 0) + 1); // mutual → 2
    }
  }
  const degree = (id: string) => adj.get(id)?.size ?? 0;

  const { clusterOf, count } = assignClusters(notes);

  // Deterministic seed: cluster centroids on a ring, nodes seeded around theirs.
  // Wider ring → constellations sit clearly apart, not crowded into the middle.
  const ringR = count <= 1 ? 0 : 360 + count * 48;
  const centroid = (c: number): [number, number] =>
    count <= 1
      ? [0, 0]
      : [ringR * Math.cos((2 * Math.PI * c) / count), ringR * Math.sin((2 * Math.PI * c) / count)];

  type SN = SimulationNodeDatum & { id: string; cluster: number; deg: number };
  const perCluster = new Map<number, number>();
  const simNodes: SN[] = notes.map((n) => {
    const c = clusterOf.get(n.id) ?? 0;
    const idxInCluster = perCluster.get(c) ?? 0;
    perCluster.set(c, idxInCluster + 1);
    const [cxp, cyp] = centroid(c);
    const a = idxInCluster * 2.399963; // golden angle → even local spread
    const r = 20 + idxInCluster * 4;
    return {
      id: n.id,
      cluster: c,
      deg: degree(n.id),
      x: cxp + r * Math.cos(a),
      y: cyp + r * Math.sin(a),
    };
  });

  const seen = new Set<string>();
  const simLinks: (SimulationLinkDatum<SN> & { strength: number })[] = [];
  const edges: VaultEdge[] = [];
  for (const [id, set] of adj) {
    for (const t of set) {
      const k = pairKey(id, t);
      if (seen.has(k)) continue;
      seen.add(k);
      const s = strength.get(k) ?? 1;
      simLinks.push({ source: id, target: t, strength: s });
      edges.push({ id: `e-${k}`, source: id, target: t, strength: s });
    }
  }

  // Force as a pure solver: settle synchronously, keep clusters grouped while
  // giving every node clear, non-overlapping breathing room. Stronger repulsion
  // + longer links spread things out; collide enforces hard spacing (with room
  // for the label beneath each node) over a couple of iterations; looser X/Y so
  // grouping pulls clusters together without crushing nodes into each other.
  const sim = forceSimulation<SN>(simNodes)
    .force("charge", forceManyBody<SN>().strength(-340).distanceMax(1400))
    .force(
      "link",
      forceLink<SN, SimulationLinkDatum<SN> & { strength: number }>(simLinks)
        .id((d) => d.id)
        .distance(110)
        .strength(0.28)
    )
    .force(
      "collide",
      forceCollide<SN>((d) => nodeRadius(d.deg) + 34).iterations(2)
    )
    .force("x", forceX<SN>((d) => centroid(d.cluster)[0]).strength(0.08))
    .force("y", forceY<SN>((d) => centroid(d.cluster)[1]).strength(0.08))
    .stop();
  for (let i = 0; i < 440; i++) sim.tick();

  const posById = new Map(simNodes.map((s) => [s.id, s]));
  const nodes: VaultNode[] = notes.map((n) => {
    const s = posById.get(n.id)!;
    return {
      id: n.id,
      title: n.title || "Untitled",
      kind: n.kind === "micro" ? "micro" : "written",
      degree: degree(n.id),
      cluster: clusterOf.get(n.id) ?? 0,
      x: s.x ?? 0,
      y: s.y ?? 0,
    };
  });

  return { nodes, edges, clusterCount: count };
}

export { nodeRadius };

/** Changes only when notes / kinds / links change — not on caret moves. */
export function vaultSignature(notes: NoteRecord[]): string {
  return notes
    .map((n) => `${n.id}:${n.kind ?? "written"}:${(n.links || []).join(",")}`)
    .sort()
    .join(";");
}
