import { useEffect, useRef } from "react";
import HistoryTab from "./tabs/HistoryTab";
import type { Project } from "../../types";

interface Props {
  project: Project;
  onClose: () => void;
}

/** A drawer shell around the unmodified HistoryTab, opened from the status
 * strip's "History" link now that backups no longer have their own tab. */
export default function HistoryDrawer({ project, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="history-drawer-overlay" onMouseDown={onClose}>
      <aside
        className="history-drawer"
        aria-label="Version history and backups"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="history-drawer-header">
          <span className="field-label" style={{ margin: 0 }}>
            History &amp; backups
          </span>
          <button
            ref={closeRef}
            className="tb-btn"
            aria-label="Close history"
            title="Close history"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="history-drawer-body">
          <HistoryTab project={project} />
        </div>
      </aside>
    </div>
  );
}
