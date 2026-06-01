"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconPlus,
  IconChevronRight,
  IconChevronDown,
  IconArchive,
  IconTrash,
} from "@tabler/icons-react";
import type { NoteRecord } from "@/lib/store";
import {
  getClusterLabels,
  getTreeExpand,
  setClusterLabels,
  setTreeExpand,
} from "@/lib/store";
import { buildTree, treeSignature, type TreeCluster } from "@/lib/tree";
import Orbit from "./Orbit";

type Props = {
  notes: NoteRecord[];
  activeId: string | null;
  docked: boolean;
  open: boolean; // overlay visibility when not docked
  onOpen: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onDismissMicro: (id: string) => void;
};

export default function Sidebar({
  notes,
  activeId,
  docked,
  open,
  onOpen,
  onCreate,
  onClose,
  onDelete,
  onArchive,
  onDismissMicro,
}: Props) {
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    getTreeExpand().then(setExpand);
    getClusterLabels().then(setLabels);
  }, []);

  // Memoized: rebuild only when the graph signature or labels actually change —
  // never on caret moves or keystrokes (notes state updates only on autosave).
  const sig = useMemo(() => treeSignature(notes), [notes]);
  const tree = useMemo<TreeCluster[]>(
    () => buildTree(notes, labels),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, labels]
  );

  // Defaults: clusters open (show their notes), notes collapsed (hide micros).
  const isOpen = (id: string, dflt: boolean) => expand[id] ?? dflt;
  const toggle = (id: string, dflt: boolean) => {
    setExpand((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? dflt) };
      setTreeExpand(next);
      return next;
    });
  };

  const rename = (key: string, label: string) => {
    setLabels((prev) => {
      const next = { ...prev, [key]: label };
      setClusterLabels(next);
      return next;
    });
    setEditing(null);
  };

  if (!docked && !open) return null;

  return (
    <>
      {!docked && open && (
        <div className="scrim" onClick={onClose} aria-hidden="true" />
      )}
      <aside
        className={`sidebar${docked ? " docked" : " overlay"}`}
        aria-label="Notes"
      >
        <div className="side-head">
          <span className="side-mark">plain</span>
          <button
            className="cir accent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCreate}
            aria-label="New note"
            title="New note"
          >
            <IconPlus aria-hidden="true" />
          </button>
        </div>

        <div className="side-tree">
          {tree.map((cluster) => {
            const cOpen = isOpen(cluster.id, true);
            return (
              <div key={cluster.id} className="cluster">
                <div className="tree-row cluster-row" onClick={() => toggle(cluster.id, true)}>
                  <span className="twisty" aria-hidden="true">
                    {cOpen ? (
                      <IconChevronDown />
                    ) : (
                      <IconChevronRight />
                    )}
                  </span>
                  {editing === cluster.key ? (
                    <input
                      className="cluster-rename"
                      autoFocus
                      defaultValue={cluster.label}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => rename(cluster.key, e.target.value.trim() || cluster.label)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") rename(cluster.key, (e.target as HTMLInputElement).value.trim() || cluster.label);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span
                      className="cluster-label"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditing(cluster.key);
                      }}
                      title="Double-click to rename"
                    >
                      {cluster.label}
                    </span>
                  )}
                </div>

                {cOpen &&
                  cluster.notes.map((note) => {
                    const hasMicros = note.micros.length > 0;
                    const nOpen = isOpen(note.id, false);
                    return (
                      <div key={note.id} className="note-group">
                        <div
                          className={`tree-row note-row${
                            activeId === note.id ? " active" : ""
                          }`}
                          onClick={() => onOpen(note.id)}
                        >
                          <span
                            className="twisty"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (hasMicros) toggle(note.id, false);
                            }}
                            aria-hidden="true"
                          >
                            {hasMicros ? (
                              nOpen ? (
                                <IconChevronDown />
                              ) : (
                                <IconChevronRight />
                              )
                            ) : null}
                          </span>
                          <span className="note-title">
                            {note.title || "Untitled"}
                          </span>
                          <span className="row-actions">
                            <button
                              className="row-act"
                              aria-label="Archive note"
                              title="Archive"
                              onMouseDown={stop}
                              onClick={(e) => {
                                stop(e);
                                onArchive(note.id);
                              }}
                            >
                              <IconArchive aria-hidden="true" />
                            </button>
                            <button
                              className="row-act"
                              aria-label="Delete note"
                              title="Delete"
                              onMouseDown={stop}
                              onClick={(e) => {
                                stop(e);
                                onDelete(note.id);
                              }}
                            >
                              <IconTrash aria-hidden="true" />
                            </button>
                          </span>
                        </div>

                        {nOpen &&
                          note.micros.map((m) => (
                            <div
                              key={m.id}
                              className={`tree-row micro-row${
                                activeId === m.id ? " active" : ""
                              }`}
                              onClick={() => onOpen(m.id)}
                            >
                              <span className="twisty" aria-hidden="true" />
                              <span className="micro-title">{m.title}</span>
                              <span className="row-actions">
                                <button
                                  className="row-act"
                                  aria-label="Archive note"
                                  title="Archive"
                                  onMouseDown={stop}
                                  onClick={(e) => {
                                    stop(e);
                                    onArchive(m.id);
                                  }}
                                >
                                  <IconArchive aria-hidden="true" />
                                </button>
                                <button
                                  className="row-act"
                                  aria-label="Delete note"
                                  title="Delete"
                                  onMouseDown={stop}
                                  onClick={(e) => {
                                    stop(e);
                                    onDismissMicro(m.id);
                                  }}
                                >
                                  <IconTrash aria-hidden="true" />
                                </button>
                              </span>
                            </div>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>

        {/* Zone 3: the connected orbit — pinned, never scrolls, never overlapped
            by the tree (tree is the only overflow:auto child; this is flex-shrink:0). */}
        <Orbit notes={notes} activeId={activeId} onOpen={onOpen} />
      </aside>
    </>
  );
}
