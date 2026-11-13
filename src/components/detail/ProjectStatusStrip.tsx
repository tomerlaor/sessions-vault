import { useEffect, useState, useCallback } from "react";
import {
  getBackups,
  getGDriveConfig,
  getGDriveFolderConfig,
} from "../../db/queries/backups";
import { listFiles } from "../../db/queries/project-files";
import { todoProgress, latestVersionLabel } from "../../lib/project-tabs";
import type { Project } from "../../types";

interface Props {
  project: Project;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  /** Bumped by the caller whenever backups/files might have changed. */
  refreshKey: number;
}

function fmtBackupTime(secs: number): string {
  const d = new Date(secs * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

export default function ProjectStatusStrip({
  project: p,
  onOpenSettings,
  onOpenHistory,
  refreshKey,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [localAt, setLocalAt] = useState<number | null>(null);
  const [driveReady, setDriveReady] = useState(false);
  const [driveAt, setDriveAt] = useState<number | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [backups, gdriveCfg, gdriveFolder, files] = await Promise.all([
      getBackups(p.id),
      getGDriveConfig(),
      getGDriveFolderConfig(),
      listFiles(p.id),
    ]);
    const lastOf = (provider: "local" | "gdrive") =>
      backups.find((b) => b.provider === provider && b.status !== "failed")
        ?.snapshotAt ?? null;
    setLocalAt(lastOf("local"));
    setDriveReady(!!gdriveCfg?.connected || !!gdriveFolder?.destination);
    setDriveAt(lastOf("gdrive"));
    setVersion(latestVersionLabel(files.map((f) => f.versionLabel)));
    setLoading(false);
  }, [p.id]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  const { done, total } = todoProgress(p.todos);

  if (loading) {
    return (
      <div className="pv-status" role="status">
        <span className="pv-status-skeleton" />
      </div>
    );
  }

  return (
    <div className="pv-status" role="status">
      <span>
        <span
          className="pv-status-dot"
          style={{ background: localAt ? "var(--green)" : "var(--text-3)" }}
        />
        {localAt ? (
          <>
            Local backup <b>{fmtBackupTime(localAt)}</b>
          </>
        ) : (
          "No local backup yet"
        )}
      </span>
      {driveReady ? (
        <span>
          <span
            className="pv-status-dot"
            style={{ background: "var(--green)" }}
          />
          {driveAt ? (
            <>
              Google Drive <b>{fmtBackupTime(driveAt)}</b>
            </>
          ) : (
            "Google Drive connected"
          )}
        </span>
      ) : (
        <span className="pv-status-warn">
          <span
            className="pv-status-dot"
            style={{ background: "var(--yellow)" }}
          />
          Google Drive not connected —{" "}
          <button onClick={onOpenSettings}>Connect in Settings</button>
        </span>
      )}
      {total > 0 && (
        <span>
          Todos{" "}
          <b>
            {done} / {total}
          </b>
        </span>
      )}
      <span className="pv-status-right">
        {version && (
          <>
            Version <b>{version}</b> ·{" "}
          </>
        )}
        <button onClick={onOpenHistory}>History</button>
      </span>
    </div>
  );
}
