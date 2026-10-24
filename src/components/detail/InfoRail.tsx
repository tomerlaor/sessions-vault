import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import Icon from "../shared/Icon";
import OverviewTab from "./tabs/OverviewTab";
import FilesTab from "./tabs/FilesTab";
import TodoTab from "./tabs/TodoTab";
import HistoryTab from "./tabs/HistoryTab";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { Project, Tag } from "../../types";

interface Props {
  project: Project;
  allTags: Tag[];
  onUpdate: (field: string, value: unknown) => void;
  onTagChange: () => void;
}

type IconName = ComponentProps<typeof Icon>["name"];
type SectionId = "info" | "files" | "todo" | "sync";

const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: "info", label: "Info", icon: "music" },
  { id: "files", label: "Files", icon: "paperclip" },
  { id: "todo", label: "To-do", icon: "check" },
  { id: "sync", label: "Sync", icon: "history" },
];

function RailSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rail-section">
      <button
        type="button"
        className="rail-section-title"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={`rail-chevron ${open ? "open" : ""}`}>▸</span>
        {label}
      </button>
      {open && <div className="rail-section-body">{children}</div>}
    </section>
  );
}

export default function InfoRail({
  project,
  allTags,
  onUpdate,
  onTagChange,
}: Props) {
  const compact = useMediaQuery("(max-width: 1100px)");
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    info: true,
    files: true,
    todo: true,
    sync: true,
  });
  const [flyout, setFlyout] = useState<SectionId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact) setFlyout(null);
  }, [compact]);

  useEffect(() => {
    if (!flyout) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setFlyout(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setFlyout(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [flyout]);

  const renderBody = (id: SectionId) => {
    switch (id) {
      case "info":
        return (
          <OverviewTab
            project={project}
            allTags={allTags}
            onUpdate={onUpdate}
            onTagChange={onTagChange}
          />
        );
      case "files":
        return <FilesTab key={project.id} project={project} />;
      case "todo":
        return (
          <TodoTab key={project.id} project={project} onUpdate={onUpdate} />
        );
      case "sync":
        return <HistoryTab project={project} />;
    }
  };

  if (compact) {
    const active = SECTIONS.find((s) => s.id === flyout);
    return (
      <div ref={rootRef} className="info-rail rail-icons">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`rail-icon-btn ${flyout === s.id ? "active" : ""}`}
            title={s.label}
            aria-label={s.label}
            aria-expanded={flyout === s.id}
            onClick={() => setFlyout(flyout === s.id ? null : s.id)}
          >
            <Icon name={s.icon} size={14} />
          </button>
        ))}
        {active && (
          <div className="rail-flyout">
            <div className="rail-flyout-title">{active.label}</div>
            <div className="rail-section-body">{renderBody(active.id)}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="info-rail">
      {SECTIONS.map((s) => (
        <RailSection
          key={s.id}
          label={s.label}
          open={openSections[s.id]}
          onToggle={() =>
            setOpenSections((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
          }
        >
          {renderBody(s.id)}
        </RailSection>
      ))}
    </div>
  );
}
