"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Controls,
  Panel,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { IconHierarchy3, IconPlus } from "@tabler/icons-react";
import { type FlowSpec, type FlowKind, layoutSpec } from "@/lib/flow";

/**
 * v3.6 Part B — a process/protocol rendered as a clean, editable flowchart.
 * Dagre computes a top-to-bottom hierarchical layout (no hand-placement); React
 * Flow renders custom white/ink nodes (start/end ink-filled, step hairline,
 * decision diamond) with arrowheaded edges and yes/no branch labels. The student
 * can edit labels, drag, connect, delete, and re-layout; changes persist via
 * onChange. Provisional + editable — never an authoritative-looking algorithm.
 */

type FlowNodeData = {
  label: string;
  kind: FlowKind;
  onLabel: (id: string, label: string) => void;
};

function FlowNodeView({ id, data }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.label);
  useEffect(() => setText(d.label), [d.label]);

  const commit = () => {
    setEditing(false);
    const t = text.trim();
    if (t && t !== d.label) d.onLabel(id, t);
    else setText(d.label);
  };

  return (
    <div className={`flow-node flow-${d.kind}`}>
      <Handle type="target" position={Position.Top} className="flow-handle" />
      {d.kind === "decision" && <span className="flow-diamond" aria-hidden="true" />}
      {editing ? (
        <input
          className="flow-edit"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setText(d.label);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="flow-label"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to edit"
        >
          {d.label}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="flow-handle" />
    </div>
  );
}

const nodeTypes = { flow: FlowNodeView };

const EDGE_COLOR = "#6f6f6f"; // --secondary
const defaultEdgeOptions = {
  type: "smoothstep" as const,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR },
  style: { stroke: EDGE_COLOR, strokeWidth: 1 },
  labelStyle: { fill: "#bcbcbc", fontSize: 12, fontFamily: "var(--font-mono)" },
  labelBgStyle: { fill: "#ffffff" },
  labelBgPadding: [4, 2] as [number, number],
};

function specToFlow(
  spec: FlowSpec,
  onLabel: (id: string, label: string) => void
): { nodes: Node[]; edges: Edge[] } {
  // Layout if positions are missing (fresh spec); else honour stored x/y.
  const laid = spec.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number")
    ? spec
    : layoutSpec(spec);
  const nodes: Node[] = laid.nodes.map((n) => ({
    id: n.id,
    type: "flow",
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    data: { label: n.label, kind: n.kind, onLabel } satisfies FlowNodeData,
  }));
  const edges: Edge[] = spec.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    label: e.branch,
  }));
  return { nodes, edges };
}

type Props = { spec: FlowSpec; onChange: (spec: FlowSpec) => void };

export default function FlowChart({ spec, onChange }: Props) {
  // onLabel is referenced by node data; keep it stable via a ref so building
  // nodes once is enough and editing always hits the latest handler.
  const labelRef = useRef<(id: string, label: string) => void>(() => {});
  const onLabel = useCallback((id: string, label: string) => labelRef.current(id, label), []);

  const initial = useRef(specToFlow(spec, onLabel));
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.current.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.current.edges);

  // Current nodes/edges → FlowSpec, persisted on every meaningful change.
  const persist = useCallback(
    (ns: Node[], es: Edge[]) => {
      onChange({
        nodes: ns.map((n) => {
          const d = n.data as unknown as FlowNodeData;
          return { id: n.id, label: d.label, kind: d.kind, x: n.position.x, y: n.position.y };
        }),
        edges: es.map((e) => ({
          from: e.source,
          to: e.target,
          branch: typeof e.label === "string" ? e.label : undefined,
        })),
      });
    },
    [onChange]
  );

  labelRef.current = (id: string, label: string) => {
    setNodes((cur) => {
      const next = cur.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label } } : n
      );
      persist(next, edges);
      return next;
    });
  };

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      setEdges((cur) => {
        const next = addEdge({ ...c, id: `${c.source}->${c.target}` }, cur);
        persist(nodes, next);
        return next;
      });
    },
    [setEdges, persist, nodes]
  );

  const onNodesDelete = useCallback(() => {
    // RF has already applied the removal to state by the time we persist below.
    setTimeout(() => persist(nodesRef.current, edgesRef.current), 0);
  }, [persist]);

  // Refs mirror the latest state for the deferred persist after deletes/drags.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const addStep = useCallback(() => {
    const id = `n${Date.now().toString(36)}`;
    const center = nodes[0]?.position ?? { x: 0, y: 0 };
    setNodes((cur) => {
      const next = [
        ...cur,
        {
          id,
          type: "flow",
          position: { x: center.x, y: center.y + 120 },
          data: { label: "new step", kind: "step" as FlowKind, onLabel },
        },
      ];
      persist(next, edges);
      return next;
    });
  }, [nodes, edges, setNodes, onLabel, persist]);

  const relayout = useCallback(() => {
    const laid = layoutSpec({
      nodes: nodesRef.current.map((n) => {
        const d = n.data as unknown as FlowNodeData;
        return { id: n.id, label: d.label, kind: d.kind };
      }),
      edges: edgesRef.current.map((e) => ({
        from: e.source,
        to: e.target,
        branch: typeof e.label === "string" ? e.label : undefined,
      })),
    });
    setNodes((cur) =>
      cur.map((n) => {
        const p = laid.nodes.find((m) => m.id === n.id);
        return p ? { ...n, position: { x: p.x ?? 0, y: p.y ?? 0 } } : n;
      })
    );
    persist(
      nodesRef.current.map((n) => {
        const p = laid.nodes.find((m) => m.id === n.id);
        return p ? { ...n, position: { x: p.x ?? 0, y: p.y ?? 0 } } : n;
      }),
      edgesRef.current
    );
  }, [setNodes, persist]);

  return (
    <div className="flow-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={() => setTimeout(() => persist(nodesRef.current, edgesRef.current), 0)}
        onNodeDragStop={() => persist(nodesRef.current, edgesRef.current)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        elementsSelectable
        zoomOnPinch
        panOnDrag
        panOnScroll={false}
      >
        <Controls showInteractive={false} />
        <Panel position="top-right" className="flow-tools">
          <button className="flow-tool" onClick={addStep} title="Add step" aria-label="Add step">
            <IconPlus aria-hidden="true" />
          </button>
          <button
            className="flow-tool"
            onClick={relayout}
            title="Tidy layout"
            aria-label="Tidy layout"
          >
            <IconHierarchy3 aria-hidden="true" />
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
