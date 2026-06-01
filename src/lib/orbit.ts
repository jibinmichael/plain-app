import type { NoteRecord } from "./store";

/**
 * The local orbit of one note: the open note at the centre + its DIRECT
 * neighbours only (one hop). Pure + cheap — derived from the persisted graph,
 * never the whole vault. Memoize on [activeId, links-signature].
 *
 * A neighbour is any note connected by a graph edge in either direction:
 *  - outgoing: ids in the active note's `links` (reference marks + concept
 *    edges / extraLinks from v0.5 + v1.3)
 *  - incoming: other notes whose `links` include the active note
 */

export type OrbitNode = { id: string; title: string; kind: "written" | "micro" };
export type Orbit = { center: OrbitNode | null; neighbors: OrbitNode[] };

function toNode(n: NoteRecord): OrbitNode {
  return { id: n.id, title: n.title || "Untitled", kind: n.kind === "micro" ? "micro" : "written" };
}

export function buildOrbit(notes: NoteRecord[], activeId: string | null): Orbit {
  if (!activeId) return { center: null, neighbors: [] };
  const byId = new Map(notes.map((n) => [n.id, n]));
  const active = byId.get(activeId);
  if (!active) return { center: null, neighbors: [] };

  const ids = new Set<string>();
  for (const id of active.links || []) if (id !== activeId) ids.add(id); // outgoing
  for (const n of notes) {
    if (n.id === activeId) continue;
    if ((n.links || []).includes(activeId)) ids.add(n.id); // incoming
  }

  const neighbors: OrbitNode[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (n) neighbors.push(toNode(n)); // skip stale/dangling edges
  }
  // Written notes first, then concepts; stable alphabetical within each.
  neighbors.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "written" ? -1 : 1) ||
      a.title.localeCompare(b.title)
  );

  return { center: toNode(active), neighbors };
}

/** Changes only when the active note or any note's links change. */
export function orbitSignature(notes: NoteRecord[], activeId: string | null): string {
  return (
    (activeId ?? "∅") +
    "|" +
    notes
      .map((n) => `${n.id}:${(n.links || []).join(",")}`)
      .sort()
      .join(";")
  );
}
