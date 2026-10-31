import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getBackups,
  insertBackup,
  getLocalConfig,
  setLocalConfig,
  getGDriveConfig,
  setGDriveConfig,
  getGDriveFolderConfig,
  getStageSelection,
  setStageSelection,
} from "../../../db/queries/backups";
import { listFiles } from "../../../db/queries/project-files";
import {
  stageKey,
  groupFilesByStage,
  resolveStageSelection,
  parseMissing,
  toStageFileInput,
  type StageFileInput,
} from "../../../lib/backup-stages";
import type {
  Project,
  ProjectFile,
  BackupRecord,
  GDriveConfig,
  StageGroup,
} from "../../../types";

interface Props {
  project: Project;
}

interface BackupResult {
  provider: string;
  destination: string;
  sizeBytes: number;
  checksum: string;
  status: "ok" | "partial";
  missingCount: number;
  manifestJson: string;
}

interface GDriveTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// What to run once the stage picker (if shown) is confirmed.
type PendingBackup =
  | { kind: "local"; destinationDir: string }
  | { kind: "gdrive-folder"; destinationDir: string }
  | { kind: "gdrive-api"; accessToken: string };

function fmt(secs: number) {
  return new Date(secs * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function fileName(destination: string) {
  if (!destination) return null;
  // Last path component works for both local paths and GDrive file IDs
  const part = destination.split(/[/\\]/).pop() ?? destination;
  return part;
}

function destinationLabel(b: BackupRecord) {
  if (!b.destination) return null;
  // GDrive API returns a file ID (no slashes) — not a useful display path
  if (
    b.provider === "gdrive" &&
    !b.destination.includes("/") &&
    !b.destination.includes("\\")
  ) {
    return `Drive file ID: ${b.destination}`;
  }
  return b.destination;
}

const STATUS_COLOR: Record<BackupRecord["status"], string> = {
  ok: "#5cd18b",
  partial: "#e8b339",
  failed: "#ff5a5a",
};

export default function HistoryTab({ project: p }: Props) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [rememberedStages, setRememberedStages] = useState<string[] | null>(
    null,
  );
  const [localBusy, setLocalBusy] = useState(false);
  const [gdriveBusy, setGdriveBusy] = useState(false);
  const [gdriveReady, setGdriveReady] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [gdriveErr, setGdriveErr] = useState<string | null>(null);
  const [expandedMissing, setExpandedMissing] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set());

  const stageGroups = groupFilesByStage(files);

  const reload = useCallback(async () => {
    const [bs, gc, gf, fs, remembered] = await Promise.all([
      getBackups(p.id),
      getGDriveConfig(),
      getGDriveFolderConfig(),
      listFiles(p.id),
      getStageSelection(),
    ]);
    setBackups(bs);
    setGdriveReady(!!gc?.refreshToken || !!gf?.destination);
    setFiles(fs);
    setRememberedStages(remembered);
  }, [p.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Shared backup execution ──────────────────────────────────────────────

  const runBackup = useCallback(
    async (target: PendingBackup, stageFiles: StageFileInput[]) => {
      const busySetter = target.kind === "local" ? setLocalBusy : setGdriveBusy;
      const errSetter = target.kind === "local" ? setLocalErr : setGdriveErr;
      const provider = target.kind === "local" ? "local" : "gdrive";
      const stageKeys = [...selectedStages];

      errSetter(null);
      busySetter(true);
      try {
        let result: BackupResult;
        if (target.kind === "gdrive-api") {
          result = await invoke<BackupResult>("backup_gdrive", {
            filePath: p.filePath,
            title: p.title,
            projectId: p.id,
            accessToken: target.accessToken,
            lyrics: p.lyrics || null,
            tabs: p.tabs || null,
            todos: p.todos || null,
            files: stageFiles,
          });
        } else {
          result = await invoke<BackupResult>("backup_local", {
            filePath: p.filePath,
            title: p.title,
            projectId: p.id,
            destinationDir: target.destinationDir,
            lyrics: p.lyrics || null,
            tabs: p.tabs || null,
            todos: p.todos || null,
            files: stageFiles,
          });
        }
        await insertBackup({
          projectId: p.id,
          provider,
          destination: result.destination,
          snapshotAt: Math.floor(Date.now() / 1000),
          status: result.status,
          sizeBytes: result.sizeBytes,
          checksum: result.checksum,
          errorMsg: null,
          manifestJson: result.manifestJson,
          stages: JSON.stringify(stageKeys),
          missingCount: result.missingCount,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errSetter(msg);
        await insertBackup({
          projectId: p.id,
          provider,
          destination:
            target.kind === "gdrive-api" ? "" : target.destinationDir,
          snapshotAt: Math.floor(Date.now() / 1000),
          status: "failed",
          sizeBytes: null,
          checksum: null,
          errorMsg: msg,
          manifestJson: null,
          stages: JSON.stringify(stageKeys),
          missingCount: null,
        });
      } finally {
        busySetter(false);
        await reload();
      }
    },
    [p, reload, selectedStages],
  );

  const startBackup = useCallback(
    async (target: PendingBackup) => {
      if (stageGroups.length === 0) {
        await runBackup(target, []);
        return;
      }
      setSelectedStages(
        new Set(resolveStageSelection(stageGroups, rememberedStages)),
      );
      setPending(target);
    },
    [stageGroups, rememberedStages, runBackup],
  );

  const confirmStagePicker = useCallback(async () => {
    if (!pending) return;
    const target = pending;
    setPending(null);
    await setStageSelection([...selectedStages]);
    const stageFiles = files
      .filter((f) => selectedStages.has(stageKey(f)))
      .map(toStageFileInput);
    await runBackup(target, stageFiles);
  }, [pending, selectedStages, files, runBackup]);

  const toggleStage = (key: string) => {
    setSelectedStages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Local ────────────────────────────────────────────────────────────────

  const handleLocalBackup = useCallback(async () => {
    setLocalErr(null);
    let cfg = await getLocalConfig();
    if (!cfg?.destination) {
      const sel = await open({
        directory: true,
        multiple: false,
        title: "Select backup folder",
      });
      if (!sel) return;
      const path =
        typeof sel === "string" ? sel : (sel as { path: string }).path;
      if (!path) return;
      cfg = { destination: path };
      await setLocalConfig(cfg);
    }
    await startBackup({ kind: "local", destinationDir: cfg.destination });
  }, [startBackup]);

  // ── Google Drive ─────────────────────────────────────────────────────────

  const ensureFreshToken = useCallback(
    async (cfg: GDriveConfig): Promise<string> => {
      const now = Math.floor(Date.now() / 1000);
      if (cfg.accessToken && cfg.tokenExpiry && cfg.tokenExpiry - now > 60) {
        return cfg.accessToken;
      }
      if (!cfg.refreshToken) throw new Error("Not connected to Google Drive");
      const tokens = await invoke<GDriveTokens>("gdrive_refresh", {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        refreshToken: cfg.refreshToken,
      });
      const updated: GDriveConfig = {
        ...cfg,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiry: Math.floor(Date.now() / 1000) + tokens.expiresIn,
      };
      await setGDriveConfig(updated);
      return tokens.accessToken;
    },
    [],
  );

  const handleGDriveBackup = useCallback(async () => {
    setGdriveErr(null);
    const [folderCfg, apiCfg] = await Promise.all([
      getGDriveFolderConfig(),
      getGDriveConfig(),
    ]);

    if (!folderCfg?.destination && !apiCfg?.refreshToken) {
      setGdriveErr("Google Drive not configured — open Settings to set it up.");
      return;
    }

    try {
      if (folderCfg?.destination) {
        await startBackup({
          kind: "gdrive-folder",
          destinationDir: folderCfg.destination,
        });
      } else {
        const accessToken = await ensureFreshToken(apiCfg!);
        await startBackup({ kind: "gdrive-api", accessToken });
      }
    } catch (e) {
      setGdriveErr(e instanceof Error ? e.message : String(e));
    }
  }, [ensureFreshToken, startBackup]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {pending && (
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--line)",
            borderRadius: 5,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div className="field-label">Choose what to back up</div>
          {stageGroups.map((g: StageGroup) => (
            <label
              key={g.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--text-1)",
              }}
            >
              <input
                type="checkbox"
                checked={selectedStages.has(g.key)}
                onChange={() => toggleStage(g.key)}
              />
              <span style={{ flex: 1 }}>{g.label}</span>
              <span style={{ color: "var(--text-3)", fontSize: 11 }}>
                {g.count} file{g.count === 1 ? "" : "s"} ·{" "}
                {fmtSize(g.totalBytes)}
              </span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button className="tb-btn primary" onClick={confirmStagePicker}>
              Back up now
            </button>
            <button className="tb-btn" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Local */}
        <button
          className="tb-btn"
          style={{ justifyContent: "center", padding: "7px 12px" }}
          disabled={localBusy || !!pending}
          onClick={handleLocalBackup}
        >
          {localBusy ? "Backing up…" : "Back Up Locally"}
        </button>
        {localErr && (
          <div style={{ fontSize: 11, color: "#ff5a5a" }}>{localErr}</div>
        )}

        {/* GDrive */}
        {gdriveReady ? (
          <>
            <button
              className="tb-btn primary"
              style={{ justifyContent: "center", padding: "7px 12px" }}
              disabled={gdriveBusy || !!pending}
              onClick={handleGDriveBackup}
            >
              {gdriveBusy ? "Uploading…" : "Back Up to Google Drive"}
            </button>
            {gdriveErr && (
              <div style={{ fontSize: 11, color: "#ff5a5a" }}>{gdriveErr}</div>
            )}
          </>
        ) : (
          <div
            style={{ fontSize: 11, color: "var(--text-3)", padding: "4px 2px" }}
          >
            Google Drive not connected — configure in{" "}
            <b style={{ color: "var(--text-2)" }}>Settings</b>.
          </div>
        )}
      </div>

      {backups.length > 0 && (
        <>
          <div className="field-label">Backup history</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {backups.map((b) => {
              const missing = parseMissing(b.manifestJson);
              return (
                <div
                  key={b.id}
                  style={{
                    background: "var(--bg-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 5,
                    padding: "8px 10px",
                  }}
                >
                  {/* Top row: status + provider + timestamp + size */}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: STATUS_COLOR[b.status],
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        flexShrink: 0,
                        width: 42,
                        textTransform: "uppercase",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {b.provider === "gdrive" ? "Drive" : "Local"}
                    </div>
                    <div
                      style={{ flex: 1, fontSize: 11, color: "var(--text-2)" }}
                    >
                      {b.errorMsg ? (
                        <span style={{ color: "#ff5a5a" }}>{b.errorMsg}</span>
                      ) : (
                        fmt(b.snapshotAt)
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        flexShrink: 0,
                      }}
                    >
                      {fmtSize(b.sizeBytes)}
                    </div>
                  </div>

                  {/* Bottom row: zip filename + full path */}
                  {b.status !== "failed" && b.destination && (
                    <div
                      style={{
                        marginTop: 5,
                        paddingLeft: 15,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-1)",
                          fontFamily: "var(--font-mono)",
                          fontWeight: 500,
                        }}
                      >
                        {fileName(b.destination)}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-3)",
                          fontFamily: "var(--font-mono)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={destinationLabel(b) ?? ""}
                      >
                        {destinationLabel(b)}
                      </div>
                    </div>
                  )}

                  {/* Missing files, for partial backups */}
                  {b.status === "partial" && !!b.missingCount && (
                    <div style={{ marginTop: 5, paddingLeft: 15 }}>
                      <button
                        className="tb-btn"
                        style={{ fontSize: 10, padding: "2px 6px" }}
                        onClick={() =>
                          setExpandedMissing(
                            expandedMissing === b.id ? null : b.id,
                          )
                        }
                      >
                        {b.missingCount} file
                        {b.missingCount === 1 ? "" : "s"} missing
                      </button>
                      {expandedMissing === b.id && (
                        <div
                          style={{
                            marginTop: 4,
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          {missing.map((m, i) => (
                            <div
                              key={i}
                              style={{ fontSize: 10, color: "var(--text-3)" }}
                              title={m.originalPath}
                            >
                              {fileName(m.originalPath)} — {m.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
