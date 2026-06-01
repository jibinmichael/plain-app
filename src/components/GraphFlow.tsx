"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { IconFocusCentered } from "@tabler/icons-react";
import type { NoteRecord } from "@/lib/store";
import { buildOrbit, orbitSignature } from "@/lib/orbit";
import { buildVaultGraph, vaultSignature, nodeRadius } from "@/lib/graph";

type Mode = "mini" | "max";
type PlainNodeData = {
  label: string;
  kind: "written" | "micro";
  size: number; // diameter in px
  anchor: boolean;
  mode: Mode;
};

/** One custom node, styled white/ink — never React Flow's default chrome. The
 *  node box IS the dot (so handles centre cleanly); the label floats beneath. */
function PlainNode({ data }: NodeProps) {
  const nd = data as unknown as PlainNodeData;
  return (
    <div
      className={`rf-node ${nd.kind} ${nd.anchor ? "anchor" : ""} ${nd.mode}`}
      style={{ width: nd.size, height: nd.size }}
    >
      <Handle type="target" position={Position.Top} className="rf-handle" />
      <Handle type="source" position={Position.Bottom} className="rf-handle" />
      <span className="rf-label">{nd.label}</span>
    </div>
  );
}

const nodeTypes = { plain: PlainNode };

const edgeStyle = (strength: number, mode: Mode) => ({
  stroke: strength >= 2 ? "#cfcfcf" : "#e2e2e2",
  strokeWidth: mode === "mini" ? 1 : 0.8 + Math.min(2, strength * 0.8),
});

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Build React Flow nodes/edges for each mode (default Node type; the custom
//    component reads its typed data via cast — sidesteps generic friction) ────
function miniGraph(
  notes: NoteRecord[],
  activeId: string | null
): { nodes: Node[]; edges: Edge[] } {
  const data = buildOrbit(notes, activeId);
  if (!data.center) return { nodes: [], edges: [] };
  // A MINIMAP, not a graph: the current note (ink) + one block per connected
  // note (grey), laid out as a compact tidy grid. No edges/lines — the squares
  // alone show how many notes connect to where you are.
  const items = [
    { node: data.center, anchor: true },
    ...data.neighbors.slice(0, 35).map((n) => ({ node: n, anchor: false })),
  ];
  const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
  const GAP = 16; // tight, even spacing → reads as one block
  const nodes: Node[] = items.map((it, i) => ({
    id: it.node.id,
    type: "plain",
    position: { x: (i % cols) * GAP, y: Math.floor(i / cols) * GAP },
    data: {
      label: it.node.title, // hidden in mini; kept for the native title tooltip
      kind: it.node.kind,
      size: 6, // very small colored square
      anchor: it.anchor,
      mode: "mini",
    } satisfies PlainNodeData,
  }));
  return { nodes, edges: [] }; // minimap: squares only, no lines
}

function maxGraph(
  notes: NoteRecord[],
  activeId: string | null
): { nodes: Node[]; edges: Edge[] } {
  const g = buildVaultGraph(notes, activeId);
  const nodes: Node[] = g.nodes.map((n) => ({
    id: n.id,
    type: "plain",
    position: { x: n.x, y: n.y },
    data: {
      label: clip(n.title, 26),
      kind: n.kind,
      size: nodeRadius(n.degree) * 2,
      anchor: n.id === activeId,
      mode: "max",
    } satisfies PlainNodeData,
  }));
  const edges: Edge[] = g.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "straight",
    style: edgeStyle(e.strength, "max"),
  }));
  return { nodes, edges };
}

/** Re-frame the current note (the anchor) — the "you are here" control. */
function RecenterControl({ anchorId }: { anchorId: string | null }) {
  const rf = useReactFlow();
  if (!anchorId) return null;
  return (
    <Panel position="top-right">
      <button
        className="rf-recenter"
        onClick={() =>
          rf.fitView({ nodes: [{ id: anchorId }], duration: 400, maxZoom: 1.2, padding: 0.6 })
        }
        aria-label="Recenter on current note"
        title="Recenter on current note"
      >
        <IconFocusCentered aria-hidden="true" />
        <span>here</span>
      </button>
    </Panel>
  );
}

type Props = {
  notes: NoteRecord[];
  activeId: string | null;
  mode: Mode;
  onNavigate: (id: string) => void;
};

export default function GraphFlow({ notes, activeId, mode, onNavigate }: Props) {
  const isMini = mode === "mini";
  const sig = useMemo(
    () => (isMini ? orbitSignature(notes, activeId) : vaultSignature(notes)),
    [notes, activeId, isMini]
  );
  const built = useMemo(
    () => (isMini ? miniGraph(notes, activeId) : maxGraph(notes, activeId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, activeId, isMini]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);
  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  // Level-of-detail: when zoomed out, hide labels (CSS) except anchor + hover,
  // so a large vault stays legible. Flip a class only when crossing the line.
  const [lodFar, setLodFar] = useState(false);
  const lodRef = useRef(false);
  const onMove = useCallback((_: unknown, vp: Viewport) => {
    const far = vp.zoom < 0.55;
    if (far !== lodRef.current) {
      lodRef.current = far;
      setLodFar(far);
    }
  }, []);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.id !== activeId) onNavigate(node.id);
    },
    [activeId, onNavigate]
  );

  return (
    <div className={`rf-wrap ${mode} ${lodFar ? "lod-far" : ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodeOrigin={[0.5, 0.5]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onMove={isMini ? undefined : onMove}
        fitView
        fitViewOptions={{ padding: isMini ? 0.25 : 0.2 }}
        minZoom={isMini ? 0.2 : 0.15}
        maxZoom={isMini ? 1.5 : 2.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={!isMini}
        nodesConnectable={false}
        elementsSelectable={!isMini}
        zoomOnScroll={!isMini}
        zoomOnPinch={!isMini}
        zoomOnDoubleClick={!isMini}
        panOnDrag={!isMini}
        panOnScroll={false}
        preventScrolling={!isMini}
      >
        {!isMini && (
          <>
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#efefef" />
            <Controls showInteractive={false} />
            <RecenterControl anchorId={activeId} />
          </>
        )}
      </ReactFlow>
    </div>
  );
}
