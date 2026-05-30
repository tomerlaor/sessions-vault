import { useState, useRef, useEffect } from "react";
import type { TabGrid } from "../../../types";
import { COL_WIDTH, STRING_HEIGHT, COLS_PER_BAR, COLS_PER_BEAT } from "../../../lib/tab-grid";

interface Props {
  grid: TabGrid;
  selectedCell: { stringIdx: number; colIdx: number } | null;
  activeAnnotation: string | null;
  onCellClick: (stringIdx: number, colIdx: number) => void;
  onPlaceValue: (stringIdx: number, colIdx: number, value: string) => void;
  onClearCell: (stringIdx: number, colIdx: number) => void;
  onExtend: () => void;
  onMoveSelection: (ds: number, dc: number) => void;
}

export default function TabGridEditor({
  grid,
  selectedCell,
  activeAnnotation,
  onCellClick,
  onPlaceValue,
  onClearCell,
  onExtend,
  onMoveSelection,
}: Props) {
  const [editingCell, setEditingCell] = useState<{ stringIdx: number; colIdx: number } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell) inputRef.current?.focus();
  }, [editingCell]);

  const totalWidth = grid.colCount * COL_WIDTH;

  function handleLineClick(e: React.MouseEvent<HTMLDivElement>, stringIdx: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const colIdx = Math.min(Math.floor(x / COL_WIDTH), grid.colCount - 1);
    const key = `${stringIdx}:${colIdx}`;

    if (activeAnnotation) {
      onPlaceValue(stringIdx, colIdx, activeAnnotation);
      return;
    }

    const existing = grid.cells[key];
    if (existing) {
      setInputValue(existing.value);
    } else {
      setInputValue("");
    }
    onCellClick(stringIdx, colIdx);
    setEditingCell({ stringIdx, colIdx });
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!editingCell) return;
    if (e.key === "Enter") {
      commitInput();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    } else if (e.key === "Backspace" && inputValue === "") {
      onClearCell(editingCell.stringIdx, editingCell.colIdx);
      setEditingCell(null);
    } else if (e.key === "ArrowLeft") {
      commitInput();
      onMoveSelection(0, -1);
    } else if (e.key === "ArrowRight") {
      commitInput();
      onMoveSelection(0, 1);
    } else if (e.key === "ArrowUp") {
      commitInput();
      onMoveSelection(-1, 0);
    } else if (e.key === "ArrowDown") {
      commitInput();
      onMoveSelection(1, 0);
    }
  }

  function commitInput() {
    if (!editingCell) return;
    const v = inputValue.trim();
    if (v) onPlaceValue(editingCell.stringIdx, editingCell.colIdx, v);
    setEditingCell(null);
  }

  function handleContextMenu(e: React.MouseEvent, stringIdx: number, colIdx: number) {
    e.preventDefault();
    onClearCell(stringIdx, colIdx);
  }

  // Collect all occupied columns for chord highlight
  const occupiedCols = new Set(
    Object.keys(grid.cells).map((k) => parseInt(k.split(":")[1], 10)),
  );
  const highlightCol =
    selectedCell?.colIdx !== undefined && occupiedCols.has(selectedCell.colIdx)
      ? selectedCell.colIdx
      : null;

  return (
    <div className="tab-grid-wrap">
      {/* Scrollable area */}
      <div className="tab-grid-scroll">
        <div style={{ display: "inline-block", position: "relative" }}>
          {/* Chord column highlight overlay */}
          {highlightCol !== null && (
            <div
              className="tab-grid-col-highlight"
              style={{
                left: 44 + highlightCol * COL_WIDTH, // 24px label + 2px bar + 18px padding
                width: COL_WIDTH,
                top: 0,
                height: grid.strings.length * STRING_HEIGHT,
              }}
            />
          )}

          {grid.strings.map((label, si) => {
            return (
              <div key={label} className="tab-grid-row" style={{ height: STRING_HEIGHT }}>
                {/* String label */}
                <span className="tab-grid-label">{label}</span>
                {/* Opening bar */}
                <span className="tab-grid-bar">|</span>
                {/* Line container */}
                <div
                  className="tab-grid-line"
                  style={{ width: totalWidth }}
                  onClick={(e) => handleLineClick(e, si)}
                >
                  {/* Background line */}
                  <div className="tab-grid-bg-line" />

                  {/* Beat ticks */}
                  {Array.from({ length: Math.floor(grid.colCount / COLS_PER_BEAT) }).map((_, i) => (
                    <div
                      key={i}
                      className={`tab-grid-tick${i % (COLS_PER_BAR / COLS_PER_BEAT) === 0 ? " bar" : ""}`}
                      style={{ left: i * COLS_PER_BEAT * COL_WIDTH }}
                    />
                  ))}

                  {/* Placed values for this string */}
                  {Object.entries(grid.cells)
                    .filter(([k]) => parseInt(k.split(":")[0], 10) === si)
                    .map(([k, cell]) => {
                      const colIdx = parseInt(k.split(":")[1], 10);
                      const isEditing =
                        editingCell?.stringIdx === si && editingCell?.colIdx === colIdx;
                      if (isEditing) return null;
                      return (
                        <div
                          key={k}
                          className={`tab-grid-token ${cell.kind}`}
                          style={{ left: colIdx * COL_WIDTH }}
                          onContextMenu={(e) => handleContextMenu(e, si, colIdx)}
                        >
                          {cell.value}
                        </div>
                      );
                    })}

                  {/* Inline input for selected cell */}
                  {editingCell?.stringIdx === si && (
                    <div
                      className="tab-grid-input-wrap"
                      style={{ left: editingCell.colIdx * COL_WIDTH }}
                    >
                      <input
                        ref={inputRef}
                        className="tab-grid-input"
                        value={inputValue}
                        maxLength={2}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        onBlur={commitInput}
                      />
                    </div>
                  )}
                </div>
                {/* Closing bar */}
                <span className="tab-grid-bar">|</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Extend button */}
      <div className="tab-grid-footer">
        <button className="tb-btn" onClick={onExtend} style={{ fontSize: 11 }}>
          + Extend
        </button>
      </div>
    </div>
  );
}
