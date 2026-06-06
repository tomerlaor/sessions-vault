import { useState, useCallback } from "react";
import TabAgentModal from "../TabAgentModal";
import TabGridEditor from "./TabGridEditor";
import AnnotationToolbar from "./AnnotationToolbar";
import TabExpandedModal from "./TabExpandedModal";
import { useTabGrid } from "../../../hooks/useTabGrid";
import type { Project, TabPart, Instrument, TabGrid } from "../../../types";
import { defaultGrid } from "../../../lib/tab-grid";

function parseParts(raw: string | null): TabPart[] {
  try {
    return JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
}

function makeNew(instrument: Instrument, existing: TabPart[]): TabPart {
  const count = existing.filter((p) => p.instrument === instrument).length;
  const base = { guitar: "Guitar", bass: "Bass", drums: "Drums" }[instrument];
  return {
    id: crypto.randomUUID(),
    name: count > 0 ? `${base} ${count + 1}` : base,
    instrument,
    content: "",
    grid: defaultGrid(instrument),
  };
}

interface Props {
  project: Project;
  onUpdate: (field: string, value: unknown) => void;
}

// Inner component so key={active.id} remounts useTabGrid on part switch
function ActivePartEditor({
  part,
  onPartUpdate,
  expanded,
  onExpand,
  onCollapse,
}: {
  part: TabPart;
  onPartUpdate: (changes: Partial<TabPart>) => void;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const handleGridUpdate = useCallback(
    (grid: TabGrid, text: string) => onPartUpdate({ grid, content: text }),
    [onPartUpdate],
  );

  const {
    grid,
    selectedCell,
    activeAnnotation,
    selectCell,
    placeValue,
    clearCell,
    setActiveAnnotation,
    extend,
    addString,
    moveSelection,
  } = useTabGrid(part.instrument, part.content, part.grid, handleGridUpdate);

  const handleExtend = useCallback(() => {
    extend();
    onExpand();
  }, [extend, onExpand]);

  return (
    <>
      <AnnotationToolbar active={activeAnnotation} onChange={setActiveAnnotation} />
      <TabGridEditor
        grid={grid}
        selectedCell={selectedCell}
        activeAnnotation={activeAnnotation}
        onCellClick={selectCell}
        onPlaceValue={placeValue}
        onClearCell={clearCell}
        onExtend={handleExtend}
        onAddString={addString}
        onMoveSelection={moveSelection}
      />
      {expanded && (
        <TabExpandedModal
          grid={grid}
          selectedCell={selectedCell}
          activeAnnotation={activeAnnotation}
          onCellClick={selectCell}
          onPlaceValue={placeValue}
          onClearCell={clearCell}
          onExtend={extend}
          onAddString={addString}
          onMoveSelection={moveSelection}
          onAnnotationChange={setActiveAnnotation}
          onClose={onCollapse}
        />
      )}
    </>
  );
}

export default function TabTab({ project: p, onUpdate }: Props) {
  const initialParts = parseParts(p.tabs);
  const [parts, setParts] = useState<TabPart[]>(initialParts);
  const [activeId, setActiveId] = useState<string | null>(initialParts[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const active = parts.find((pt) => pt.id === activeId) ?? null;

  const persist = useCallback(
    (updated: TabPart[]) => onUpdate("tabs", JSON.stringify(updated)),
    [onUpdate],
  );

  const updateActive = useCallback(
    (changes: Partial<TabPart>) => {
      if (!active) return;
      const updated = parts.map((pt) =>
        pt.id === active.id ? { ...pt, ...changes } : pt,
      );
      setParts(updated);
      persist(updated);
    },
    [active, parts, persist],
  );

  const handleInsertGenerated = useCallback(
    (generated: TabPart[]) => {
      const updated = [...parts, ...generated];
      setParts(updated);
      setActiveId(generated[0]?.id ?? activeId);
      persist(updated);
    },
    [parts, activeId, persist],
  );

  const addPart = (instrument: Instrument) => {
    const part = makeNew(instrument, parts);
    const updated = [...parts, part];
    setParts(updated);
    setActiveId(part.id);
    setAdding(false);
    persist(updated);
  };

  const deletePart = (id: string) => {
    const updated = parts.filter((pt) => pt.id !== id);
    setParts(updated);
    setActiveId(updated[0]?.id ?? null);
    setEditingName(false);
    persist(updated);
  };

  const handleCollapse = useCallback(() => setExpanded(false), []);

  if (parts.length === 0) {
    return (
      <>
        <div className="tab-editor">
          <div
            style={{
              color: "var(--text-3)",
              textAlign: "center",
              padding: "28px 16px 12px",
              fontSize: 12,
            }}
          >
            No tablature yet — add a part manually or let the AI generate a structure.
          </div>
          <div className="tab-add-row">
            <button className="tb-btn primary" onClick={() => setAgentOpen(true)}>
              ✦ Generate with AI
            </button>
          </div>
          <div className="tab-add-row" style={{ paddingTop: 0 }}>
            {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
              <button key={inst} className="tb-btn" onClick={() => addPart(inst)}>
                + {inst.charAt(0).toUpperCase() + inst.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {agentOpen && (
          <TabAgentModal
            project={p}
            onInsert={handleInsertGenerated}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="tab-editor">
        {/* Parts bar */}
        <div className="tab-parts-bar">
          {parts.map((pt) => (
            <button
              key={pt.id}
              className={`tab-part-btn ${pt.id === activeId ? "active" : ""}`}
              onClick={() => {
                setActiveId(pt.id);
                setEditingName(false);
                setAdding(false);
                setExpanded(false);
              }}
            >
              {pt.name}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {adding ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
                <button
                  key={inst}
                  className="tb-btn"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => addPart(inst)}
                >
                  {inst.charAt(0).toUpperCase() + inst.slice(1)}
                </button>
              ))}
              <button
                style={{ fontSize: 11, color: "var(--text-3)", padding: "2px 6px" }}
                onClick={() => setAdding(false)}
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <button className="tab-part-btn" onClick={() => setAdding(true)}>+ Part</button>
              <button
                className="tab-part-btn"
                style={{ color: "var(--accent)" }}
                onClick={() => setAgentOpen(true)}
              >
                ✦ AI
              </button>
            </>
          )}
        </div>

        {active && (
          <>
            {/* Part header */}
            <div className="tab-part-header">
              {editingName ? (
                <>
                  {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
                    <button
                      key={inst}
                      className={`tb-btn ${active.instrument === inst ? "active-inst" : ""}`}
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => updateActive({ instrument: inst, grid: defaultGrid(inst) })}
                    >
                      {inst.charAt(0).toUpperCase() + inst.slice(1)}
                    </button>
                  ))}
                  <input
                    className="tab-name-input"
                    value={active.name}
                    onChange={(e) => updateActive({ name: e.target.value })}
                    placeholder="Part name"
                  />
                  <button
                    style={{ fontSize: 11, color: "var(--red)" }}
                    onClick={() => deletePart(active.id)}
                  >
                    Delete
                  </button>
                  <button
                    style={{ fontSize: 11, color: "var(--accent)" }}
                    onClick={() => setEditingName(false)}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {active.instrument}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-0)" }}>{active.name}</span>
                  <div style={{ flex: 1 }} />
                  <button
                    style={{ fontSize: 11, color: "var(--text-3)" }}
                    title="Expand to 4 bars"
                    onClick={() => setExpanded(true)}
                  >
                    ⤢
                  </button>
                  <button
                    style={{ fontSize: 11, color: "var(--accent)" }}
                    onClick={() => setEditingName(true)}
                  >
                    ✎ Edit
                  </button>
                </>
              )}
            </div>

            {/* key includes instrument so editor remounts when instrument changes */}
            <ActivePartEditor
              key={`${active.id}-${active.instrument}`}
              part={active}
              onPartUpdate={updateActive}
              expanded={expanded}
              onExpand={() => setExpanded(true)}
              onCollapse={handleCollapse}
            />
          </>
        )}
      </div>

      {agentOpen && (
        <TabAgentModal
          project={p}
          onInsert={handleInsertGenerated}
          onClose={() => setAgentOpen(false)}
        />
      )}
    </>
  );
}
