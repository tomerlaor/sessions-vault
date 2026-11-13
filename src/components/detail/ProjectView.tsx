import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import Icon from "../shared/Icon";
import WaveArt, { deterministicWave } from "../shared/WaveArt";
import LyricsTab, { type LyricsTabHandle } from "./tabs/LyricsTab";
import TabTab from "./tabs/TabTab";
import ProjectTab from "./tabs/ProjectTab";
import { type TodoTabHandle } from "./tabs/TodoTab";
import ProjectStatusStrip from "./ProjectStatusStrip";
import ProjectTabs from "./ProjectTabs";
import HistoryDrawer from "./HistoryDrawer";
import { useProjectShortcuts } from "../../hooks/useProjectShortcuts";
import {
  updateProjectField,
  renameProject,
  updateProjectFilePath,
} from "../../db/queries/projects";
import {
  parseTabHash,
  tabHash,
  showUnsavedDot,
  type TabId,
  type SaveState,
  type ShortcutAction,
} from "../../lib/project-tabs";
import type { Project, Tag, ProjectFile } from "../../types";

const DAWS: Record<string, { name: string; color: string }> = {
  ableton: { name: "Ableton Live", color: "#ff7a45" },
  logic: { name: "Logic Pro", color: "#ffcc66" },
  fl: { name: "FL Studio", color: "#5cd18b" },
  bitwig: { name: "Bitwig", color: "#ff5a5a" },
  reaper: { name: "Reaper", color: "#a98bff" },
};

const STAGE_LABELS: Record<Project["status"], string> = {
  draft: "Draft",
  mixed: "Mixing",
  released: "Released",
  archived: "Archived",
};

const KEY_OPTIONS = [
  "C major",
  "C# major",
  "D major",
  "D# major",
  "E major",
  "F major",
  "F# major",
  "G major",
  "G# major",
  "A major",
  "A# major",
  "B major",
  "C minor",
  "C# minor",
  "D minor",
  "D# minor",
  "E minor",
  "F minor",
  "F# minor",
  "G minor",
  "G# minor",
  "A minor",
  "A# minor",
  "B minor",
];

const COLORS = [
  ["#6b21a8", "#ec4899"],
  ["#f59e0b", "#b45309"],
  ["#0ea5e9", "#1e3a8a"],
];
const artFor = (id: string) => {
  const i = id.charCodeAt(0) % COLORS.length;
  return `linear-gradient(135deg, ${COLORS[i][0]} 0%, ${COLORS[i][1]} 100%)`;
};

function relativeTime(secs: number): string {
  const diff = Date.now() / 1000 - secs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

interface Props {
  project: Project;
  allTags: Tag[];
  prevId: string | null;
  nextId: string | null;
  onNavigate: (id: string) => void;
  onBack: () => void;
  onOpen: (p: Project) => void;
  onReveal: (p: Project) => void;
  onProjectUpdated: () => void;
  onTagChange: () => void;
  onStar: (p: Project) => void;
  onOpenSettings: () => void;
}

export default function ProjectView({
  project: p,
  allTags,
  prevId,
  nextId,
  onNavigate,
  onBack,
  onOpen,
  onReveal,
  onProjectUpdated,
  onTagChange,
  onStar,
  onOpenSettings,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileMissing, setFileMissing] = useState<boolean | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [lyricsSaveState, setLyricsSaveState] = useState<SaveState>("clean");
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    parseTabHash(window.location.hash),
  );

  const titleInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lyricsRef = useRef<LyricsTabHandle>(null);
  const todoRef = useRef<TodoTabHandle>(null);
  const pendingEditLyrics = useRef(false);
  const pendingAddTodo = useRef(false);

  const daw = DAWS[p.daw] ?? { name: p.daw, color: "#888" };
  const partCount = useMemo(() => {
    try {
      return (JSON.parse(p.tabs ?? "[]") as unknown[]).length;
    } catch {
      return 0;
    }
  }, [p.tabs]);

  // Keep the hash and tab state in sync both ways, so the active tab
  // survives a reload and back/forward navigation.
  useEffect(() => {
    if (parseTabHash(window.location.hash) !== activeTab) {
      window.location.hash = tabHash(activeTab);
    }
  }, [activeTab]);
  useEffect(() => {
    const onHashChange = () => setActiveTab(parseTabHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (activeTab === "lyrics" && pendingEditLyrics.current) {
      pendingEditLyrics.current = false;
      lyricsRef.current?.focusEdit();
    }
    if (activeTab === "project" && pendingAddTodo.current) {
      pendingAddTodo.current = false;
      todoRef.current?.focusAdd();
    }
  }, [activeTab]);

  // Check whether the primary project file still exists on disk.
  useEffect(() => {
    let cancelled = false;
    setFileMissing(null);
    invoke<boolean[]>("file_exists_many", { paths: [p.filePath] })
      .then((flags) => {
        if (!cancelled) setFileMissing(flags[0] === false);
      })
      .catch(() => {
        if (!cancelled) setFileMissing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p.id, p.filePath]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const copyPath = useCallback(() => {
    navigator.clipboard.writeText(p.filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [p.filePath]);

  const startEdit = useCallback(() => {
    setTitleDraft(p.title);
    setRenameError(null);
    setEditingTitle(true);
    setMenuOpen(false);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [p.title]);

  const cancelEdit = useCallback(() => {
    setEditingTitle(false);
    setRenameError(null);
  }, []);

  const commitRename = useCallback(async () => {
    const newName = titleDraft.trim();
    if (!newName || newName === p.title) {
      cancelEdit();
      return;
    }
    setRenameError(null);
    try {
      const newPath = await invoke<string>("rename_project", {
        oldPath: p.filePath,
        newName,
      });
      await renameProject(p.id, newName, newPath);
      setEditingTitle(false);
      onProjectUpdated();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
    }
  }, [titleDraft, p.title, p.filePath, p.id, cancelEdit, onProjectUpdated]);

  const handleUpdate = useCallback(
    async (field: string, value: unknown) => {
      await updateProjectField(p.id, field, value);
      onProjectUpdated();
    },
    [p.id, onProjectUpdated],
  );

  const locateFile = useCallback(async () => {
    setLocateError(null);
    try {
      const sel = await open({ multiple: false, title: "Locate project file" });
      if (!sel) return;
      const path =
        typeof sel === "string" ? sel : (sel as { path: string }).path;
      if (!path) return;
      await updateProjectFilePath(p.id, path);
      onProjectUpdated();
    } catch (e) {
      setLocateError(e instanceof Error ? e.message : String(e));
    }
  }, [p.id, onProjectUpdated]);

  const dispatch = useCallback(
    (action: ShortcutAction) => {
      switch (action.type) {
        case "select-tab":
          setActiveTab(action.tab);
          break;
        case "open":
          onOpen(p);
          break;
        case "back":
          // The library view's own Escape handler owns navigating back.
          break;
        case "prev-project":
          if (prevId !== null) onNavigate(prevId);
          break;
        case "next-project":
          if (nextId !== null) onNavigate(nextId);
          break;
        case "copy-path":
          copyPath();
          break;
        case "edit-lyrics":
          if (activeTab === "lyrics") {
            lyricsRef.current?.focusEdit();
          } else {
            pendingEditLyrics.current = true;
            setActiveTab("lyrics");
          }
          break;
        case "add-todo":
          if (activeTab === "project") {
            todoRef.current?.focusAdd();
          } else {
            pendingAddTodo.current = true;
            setActiveTab("project");
          }
          break;
      }
    },
    [p, prevId, nextId, onNavigate, onOpen, copyPath, activeTab],
  );
  // Per-event editable-target guards (see resolveShortcut) already cover the
  // rename input; Escape and Cmd+O stay active there by design.
  useProjectShortcuts(dispatch);

  const onFilesChange = useCallback((files: ProjectFile[]) => {
    setFileCount(files.length);
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="project-view">
      <div className="pv-topbar">
        <div className="pv-crumb">
          <button
            className="tb-btn pv-icon-btn"
            onClick={onBack}
            title="Back to library (Esc)"
            aria-label="Back to library"
          >
            <Icon
              name="chevron"
              size={12}
              style={{ transform: "rotate(180deg)" }}
            />
          </button>
          <button
            className="tb-btn pv-icon-btn"
            title="Previous project (⌘[)"
            aria-label="Previous project"
            disabled={prevId === null}
            onClick={() => prevId !== null && onNavigate(prevId)}
          >
            ‹
          </button>
          <button
            className="tb-btn pv-icon-btn"
            title="Next project (⌘])"
            aria-label="Next project"
            disabled={nextId === null}
            onClick={() => nextId !== null && onNavigate(nextId)}
          >
            ›
          </button>
        </div>

        <WaveArt
          wave={deterministicWave(p.id.charCodeAt(0))}
          bg={artFor(p.id)}
          size={56}
        />

        <div className="pv-title-block">
          {editingTitle ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cancelEdit();
                  }
                }}
                onBlur={commitRename}
                autoFocus
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  background: "var(--bg-2)",
                  border: "1px solid var(--accent)",
                  borderRadius: 5,
                  padding: "3px 7px",
                  color: "var(--text-0)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
              {renameError && (
                <div style={{ fontSize: 11, color: "var(--red)" }}>
                  {renameError}
                </div>
              )}
            </div>
          ) : (
            <h1>
              {p.title}
              <span className="badge stage">● {STAGE_LABELS[p.status]}</span>
              <button
                className="pv-icon-btn"
                aria-label={p.rating ? "Unstar project" : "Star project"}
                title={p.rating ? "Unstar project" : "Star project"}
                onClick={() => onStar(p)}
                style={{ color: p.rating ? "var(--yellow)" : "var(--text-3)" }}
              >
                <Icon name="star" size={13} />
              </button>
            </h1>
          )}

          <div className="facts">
            {p.bpm != null && (
              <span className="chip">
                <small>BPM</small>
                {p.bpm}
              </span>
            )}
            <span className="chip">
              <small>Key</small>
              <select
                className="chip-select"
                aria-label="Key"
                value={p.key ?? ""}
                onChange={(e) => handleUpdate("key", e.target.value || null)}
              >
                <option value="">—</option>
                {KEY_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </span>
            {p.timeSignature && (
              <span className="chip">
                <small>Time</small>
                {p.timeSignature}
              </span>
            )}
            {p.trackCount != null && (
              <span className="chip">
                <small>Tracks</small>
                {p.trackCount}
              </span>
            )}
            <span className="badge">
              {daw.name}
              {p.dawVersion ? ` ${p.dawVersion}` : ""}
            </span>
          </div>

          <div className="path">
            <span title={p.filePath}>{p.filePath}</span>
            <button
              onClick={copyPath}
              title="Copy full path"
              aria-label="Copy full path"
            >
              {copied ? "✓ copied" : "Copy path"}
            </button>
            · edited {relativeTime(p.modifiedAt)}
          </div>
        </div>

        <div className="pv-acts" ref={menuRef}>
          <button
            className="tb-btn"
            onClick={() => onReveal(p)}
            title="Reveal in Finder"
            aria-label="Reveal in Finder"
          >
            <Icon name="folder" size={12} />
          </button>
          <div style={{ position: "relative" }}>
            <button
              className="tb-btn"
              onClick={() => setMenuOpen((v) => !v)}
              title="More actions"
              aria-label="More actions"
              aria-expanded={menuOpen}
            >
              <Icon name="dots" size={12} />
            </button>
            {menuOpen && (
              <div className="pv-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    handleUpdate(
                      "status",
                      p.status === "archived" ? "draft" : "archived",
                    );
                  }}
                >
                  <Icon name="archive" size={12} />
                  {p.status === "archived" ? "Unarchive" : "Archive"}
                </button>
                <button role="menuitem" onClick={startEdit}>
                  <Icon name="doc" size={12} />
                  Rename
                </button>
              </div>
            )}
          </div>
          <button className="tb-btn primary" onClick={() => onOpen(p)}>
            <Icon name="open" size={12} /> Open in {daw.name}
            <kbd>⌘O</kbd>
          </button>
        </div>
      </div>

      {fileMissing ? (
        <div className="pv-missing">
          <Icon name="folder" size={32} style={{ color: "var(--text-3)" }} />
          <div className="pv-missing-title">Project file not found</div>
          <div className="pv-missing-sub">
            {p.filePath} no longer exists at that location.
          </div>
          {locateError && (
            <div style={{ fontSize: 11, color: "var(--red)" }}>
              {locateError}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="tb-btn primary" onClick={locateFile}>
              Locate…
            </button>
            <button className="tb-btn" onClick={onBack}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <>
          <ProjectStatusStrip
            project={p}
            onOpenSettings={onOpenSettings}
            onOpenHistory={() => setHistoryOpen(true)}
            refreshKey={refreshKey}
          />

          <ProjectTabs
            active={activeTab}
            onSelect={setActiveTab}
            fileCount={fileCount}
            lyricsUnsaved={showUnsavedDot(lyricsSaveState)}
            partCount={partCount}
          />

          <div className="pv-panels">
            <section
              role="tabpanel"
              id="p-project"
              aria-labelledby="t-project"
              tabIndex={0}
              hidden={activeTab !== "project"}
              className="pv-panel"
            >
              {activeTab === "project" && (
                <ProjectTab
                  project={p}
                  allTags={allTags}
                  onUpdate={handleUpdate}
                  onTagChange={onTagChange}
                  onFilesChange={onFilesChange}
                  todoRef={todoRef}
                  refreshKey={refreshKey}
                />
              )}
            </section>
            <section
              role="tabpanel"
              id="p-lyrics"
              aria-labelledby="t-lyrics"
              tabIndex={0}
              hidden={activeTab !== "lyrics"}
              className="pv-panel"
            >
              {activeTab === "lyrics" && (
                <LyricsTab
                  ref={lyricsRef}
                  project={p}
                  onUpdate={handleUpdate}
                  onSaveStateChange={setLyricsSaveState}
                />
              )}
            </section>
            <section
              role="tabpanel"
              id="p-tabs"
              aria-labelledby="t-tabs"
              tabIndex={0}
              hidden={activeTab !== "tabs"}
              className="pv-panel"
            >
              {activeTab === "tabs" && (
                <TabTab project={p} onUpdate={handleUpdate} />
              )}
            </section>
          </div>
        </>
      )}

      {historyOpen && <HistoryDrawer project={p} onClose={closeHistory} />}
    </div>
  );
}
