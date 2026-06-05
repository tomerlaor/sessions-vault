import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { TabGrid } from "../../../types";
import TabGridEditor from "./TabGridEditor";
import AnnotationToolbar from "./AnnotationToolbar";

interface Props {
  grid: TabGrid;
  selectedCell: { stringIdx: number; colIdx: number } | null;
  activeAnnotation: string | null;
  onCellClick: (stringIdx: number, colIdx: number) => void;
  onPlaceValue: (stringIdx: number, colIdx: number, value: string) => void;
  onClearCell: (stringIdx: number, colIdx: number) => void;
  onExtend: () => void;
  onMoveSelection: (ds: number, dc: number) => void;
  onAnnotationChange: (value: string | null) => void;
  onClose: () => void;
}

export default function TabExpandedModal({
  grid,
  selectedCell,
  activeAnnotation,
  onCellClick,
  onPlaceValue,
  onClearCell,
  onExtend,
  onMoveSelection,
  onAnnotationChange,
  onClose,
}: Props) {
  // 64-col expanded grid (4 bars)
  const expandedGrid: TabGrid = { ...grid, colCount: Math.max(grid.colCount, 64) };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="tab-expanded-overlay" onClick={onClose}>
      <div
        className="tab-expanded-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tab-expanded-header">
          <span style={{ fontSize: 12, color: "var(--text-2)", fontFamily: "sans-serif" }}>
            Expanded View — 4 bars
          </span>
          <button
            style={{ fontSize: 12, color: "var(--text-3)" }}
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
        <AnnotationToolbar active={activeAnnotation} onChange={onAnnotationChange} />
        <TabGridEditor
          grid={expandedGrid}
          selectedCell={selectedCell}
          activeAnnotation={activeAnnotation}
          onCellClick={onCellClick}
          onPlaceValue={onPlaceValue}
          onClearCell={onClearCell}
          onExtend={onExtend}
          onMoveSelection={onMoveSelection}
        />
      </div>
    </div>,
    document.body,
  );
}
