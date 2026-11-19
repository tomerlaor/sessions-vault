import { useCallback, useEffect, useRef } from "react";
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
  // Set by HistoryTab whenever its RestoreWizard is mounted — while that's
  // true, this drawer must not close out from under it (Escape, overlay
  // click, or the close button would otherwise tear down an in-flight
  // restore). RestoreWizard renders via a portal above this drawer, so the
  // only thing keeping it alive once mounted is this drawer staying open.
  const wizardOpenRef = useRef(false);

  const guardedClose = useCallback(() => {
    if (wizardOpenRef.current) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || wizardOpenRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="history-drawer-overlay" onMouseDown={guardedClose}>
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
            onClick={guardedClose}
          >
            ✕
          </button>
        </div>
        <div className="history-drawer-body">
          <HistoryTab
            project={project}
            onRestoreWizardOpenChange={(open) => {
              wizardOpenRef.current = open;
            }}
          />
        </div>
      </aside>
    </div>
  );
}
