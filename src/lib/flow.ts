import dagre from "dagre";

/**
 * v3.6 Part B — "form follows content" for PROCESSES. When a concept is a
 * process / protocol / decision-pathway (a clinical algorithm, a recipe, a git
 * workflow…), the auto-note becomes a FLOWCHART instead of prose. The AI returns
 * a structured spec (nodes + edges); we lay it out top-to-bottom with Dagre (no
 * hand-placement) and render it with React Flow. Grounded-or-ghost still holds:
 * built from the user's sources where possible, provisional otherwise, always
 * editable and never presented as an authoritative algorithm.
 */

export type FlowKind = "start" | "step" | "decision" | "end";

export type FlowNode = {
  id: string;
  label: string;
  kind: FlowKind;
  x?: number; // persisted layout position (after first layout / user drag)
  y?: number;
};

export type FlowEdge = {
  from: string;
  to: string;
  branch?: string; // e.g. "yes" / "no" on a decision's outgoing edges
};

export type FlowSpec = { nodes: FlowNode[]; edges: FlowEdge[] };

const KINDS: FlowKind[] = ["start", "step", "decision", "end"];

/**
 * Validate + sanitize a raw spec parsed from model JSON. Drops malformed nodes,
 * dedupes ids, and keeps only edges whose endpoints both exist — so a sloppy
 * model response can never crash the renderer. Returns null if nothing usable.
 */
export function sanitizeSpec(raw: unknown): FlowSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(r.nodes) || !Array.isArray(r.edges)) return null;

  const nodes: FlowNode[] = [];
  const seen = new Set<string>();
  for (const n of r.nodes) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!id || !label || seen.has(id)) continue;
    const kind = KINDS.includes(o.kind as FlowKind) ? (o.kind as FlowKind) : "step";
    const x = typeof o.x === "number" ? o.x : undefined;
    const y = typeof o.y === "number" ? o.y : undefined;
    nodes.push({ id, label, kind, x, y });
    seen.add(id);
  }
  if (nodes.length < 2) return null; // a flowchart needs at least a couple of steps

  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const e of r.edges) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const from = typeof o.from === "string" ? o.from.trim() : "";
    const to = typeof o.to === "string" ? o.to.trim() : "";
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const key = `${from}->${to}`;
    if (edgeSeen.has(key)) continue;
    const branch =
      typeof o.branch === "string" && o.branch.trim() ? o.branch.trim() : undefined;
    edges.push({ from, to, branch });
    edgeSeen.add(key);
  }
  if (!edges.length) return null;

  return { nodes, edges };
}

// Node box sizes fed to Dagre (decisions are squarer for the diamond shape).
const NODE_W = 168;
const NODE_H = 48;
const DECISION_W = 140;
const DECISION_H = 108; // square-ish so the rotated-diamond fits the box

export function nodeSize(kind: FlowKind): { width: number; height: number } {
  return kind === "decision"
    ? { width: DECISION_W, height: DECISION_H }
    : { width: NODE_W, height: NODE_H };
}

/**
 * Run Dagre to compute a clean top-to-bottom hierarchical layout (arrows flow
 * downward, minimal crossings) and return the spec with x/y on every node.
 * This is the mandatory auto-layout — never hand-place.
 */
export function layoutSpec(spec: FlowSpec): FlowSpec {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 44, ranksep: 56, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of spec.nodes) {
    const { width, height } = nodeSize(n.kind);
    g.setNode(n.id, { width, height });
  }
  for (const e of spec.edges) g.setEdge(e.from, e.to);

  dagre.layout(g);

  const nodes = spec.nodes.map((n) => {
    const p = g.node(n.id);
    // Dagre gives the node CENTRE; React Flow positions by top-left corner.
    const { width, height } = nodeSize(n.kind);
    return p
      ? { ...n, x: p.x - width / 2, y: p.y - height / 2 }
      : { ...n, x: n.x ?? 0, y: n.y ?? 0 };
  });
  return { nodes, edges: spec.edges };
}
