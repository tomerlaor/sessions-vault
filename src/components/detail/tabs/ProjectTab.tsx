import { useEffect, useState, useCallback, type Ref } from "react";
import FilesTab from "./FilesTab";
import TodoTab, { type TodoTabHandle } from "./TodoTab";
import OverviewTab from "./OverviewTab";
import { getBackups } from "../../../db/queries/backups";
import { listFiles } from "../../../db/queries/project-files";
import { todoProgress } from "../../../lib/project-tabs";
import type { Project, ProjectFile, BackupRecord, Tag } from "../../../types";

interface Props {
  project: Project;
  allTags: Tag[];
  onUpdate: (field: string, value: unknown) => void;
  onTagChange: () => void;
  onFilesChange: (files: ProjectFile[]) => void;
  todoRef: Ref<TodoTabHandle>;
  /** Bumped by the caller whenever a backup finishes, to refresh activity. */
  refreshKey: number;
}

interface ActivityEntry {
  key: string;
  label: string;
  at: number;
}

function kindLabel(kind: ProjectFile["kind"]): string {
  if (kind === "export") return "Exported";
  if (kind === "master_project") return "Saved mastering project";
  return "Saved project";
}

function fmtWhen(secs: number): string {
  const d = new Date(secs * 1000);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  const days = Math.round((Date.now() - secs * 1000) / 86_400_000);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString();
}

function buildActivity(
  files: ProjectFile[],
  backups: BackupRecord[],
): ActivityEntry[] {
  const fromFiles: ActivityEntry[] = files.map((f) => ({
    key: `file:${f.id}`,
    label: `${f.versionLabel} · ${kindLabel(f.kind)} ${f.fileName}`,
    at: f.fileDate,
  }));
  const fromBackups: ActivityEntry[] = backups
    .filter((b) => b.status !== "failed")
    .map((b) => ({
      key: `backup:${b.id}`,
      label:
        b.provider === "gdrive"
          ? "Google Drive backup completed"
          : "Local backup completed",
      at: b.snapshotAt,
    }));
  return [...fromFiles, ...fromBackups].sort((a, b) => b.at - a.at).slice(0, 8);
}

export default function ProjectTab({
  project: p,
  allTags,
  onUpdate,
  onTagChange,
  onFilesChange,
  todoRef,
  refreshKey,
}: Props) {
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);

  const loadActivity = useCallback(async () => {
    const [files, backups] = await Promise.all([
      listFiles(p.id),
      getBackups(p.id),
    ]);
    setActivity(buildActivity(files, backups));
  }, [p.id]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity, refreshKey]);

  const { done, total } = todoProgress(p.todos);
  const [fileCount, setFileCount] = useState(0);
  const handleFilesChange = useCallback(
    (files: ProjectFile[]) => {
      setFileCount(files.length);
      onFilesChange(files);
    },
    [onFilesChange],
  );

  return (
    <div className="pt-overview">
      <div className="card pt-files-card">
        <h3 className="pt-card-title">
          Files by stage
          <span>{fileCount}</span>
        </h3>
        <FilesTab project={p} onFilesChange={handleFilesChange} />
      </div>

      <div className="pt-side">
        <div className="card">
          <h3 className="pt-card-title">
            To-do
            {total > 0 && (
              <span>
                {done}/{total}
              </span>
            )}
          </h3>
          <TodoTab ref={todoRef} project={p} onUpdate={onUpdate} />
        </div>
        <div className="card">
          <h3 className="pt-card-title">Notes</h3>
          <OverviewTab
            project={p}
            allTags={allTags}
            onUpdate={onUpdate}
            onTagChange={onTagChange}
          />
        </div>
      </div>

      <div className="card pt-activity-card">
        <h3 className="pt-card-title">Versions &amp; activity</h3>
        {activity === null ? (
          <div className="pv-status-skeleton" />
        ) : activity.length === 0 ? (
          <div className="pt-empty">No activity yet.</div>
        ) : (
          <div className="pt-activity-list">
            {activity.map((a) => (
              <div key={a.key} className="pt-activity-row">
                <span>{a.label}</span>
                <time>{fmtWhen(a.at)}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
