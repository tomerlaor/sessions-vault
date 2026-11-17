import { useRef } from "react";
import { rovingTabTarget, type TabId } from "../../lib/project-tabs";

interface TabDef {
  id: TabId;
  label: string;
  kbd: string;
}

const TABS: TabDef[] = [
  { id: "project", label: "Project", kbd: "⌘1" },
  { id: "lyrics", label: "Lyrics", kbd: "⌘2" },
  { id: "tabs", label: "Tabs", kbd: "⌘3" },
];

interface Props {
  active: TabId;
  onSelect: (tab: TabId) => void;
  fileCount: number;
  lyricsUnsaved: boolean;
  partCount: number;
}

export default function ProjectTabs({
  active,
  onSelect,
  fileCount,
  lyricsUnsaved,
  partCount,
}: Props) {
  const btnRefs = useRef<Partial<Record<TabId, HTMLButtonElement>>>({});

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = rovingTabTarget(active, e.key);
    if (!target) return;
    e.preventDefault();
    onSelect(target);
    btnRefs.current[target]?.focus();
  };

  const badgeFor = (id: TabId) => {
    if (id === "project")
      return (
        <span className="pt-count" aria-label={`${fileCount} files`}>
          {fileCount}
        </span>
      );
    if (id === "lyrics")
      return lyricsUnsaved ? (
        <span
          className="pt-dot"
          title="Unsaved changes"
          aria-label="unsaved changes"
        />
      ) : null;
    return <span className="pt-count">{partCount}</span>;
  };

  return (
    <div className="pv-tabs" role="tablist" aria-label="Project sections">
      {TABS.map((t) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) btnRefs.current[t.id] = el;
            }}
            role="tab"
            id={`t-${t.id}`}
            aria-controls={`p-${t.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="pv-tab"
            onClick={() => onSelect(t.id)}
            onKeyDown={onKeyDown}
          >
            {t.label}
            {badgeFor(t.id)}
            <kbd>{t.kbd}</kbd>
          </button>
        );
      })}
      <span className="pv-tabs-hint">← → to switch · ⌘1–3</span>
    </div>
  );
}
