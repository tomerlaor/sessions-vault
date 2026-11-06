import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getGDriveConfig,
  insertBackupRestore,
} from "../../../db/queries/backups";
import {
  defaultRestoreTarget,
  groupRestoreFilesByStatus,
  isLocalDestination,
  summarizeRestore,
  summarizeVerify,
} from "../../../lib/restore";
import type {
  BackupRecord,
  Project,
  RestoreOutcome,
  VerifyReport,
} from "../../../types";

interface Props {
  project: Project;
  backup: BackupRecord;
  onClose: () => void;
}

type Step =
  | "review"
  | "verifying"
  | "verified"
  | "target"
  | "confirm"
  | "restoring"
  | "result";

interface Progress {
  done: number;
  total: number;
  file: string;
}

function fmtSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

const STATUS_LABEL: Record<string, string> = {
  ok: "Restored ok",
  mismatch: "Hash mismatch",
  conflict: "Already existed (not overwritten)",
  rejected: "Rejected (unsafe entry)",
  missing_in_archive: "Missing from archive",
  error: "Error",
};

async function resolveZipPath(backup: BackupRecord): Promise<string> {
  if (backup.provider === "local" || isLocalDestination(backup.destination)) {
    return backup.destination;
  }
  const apiCfg = await getGDriveConfig();
  if (!apiCfg?.connected || !apiCfg.clientId) {
    throw new Error("Google Drive not connected — open Settings to reconnect.");
  }
  // Rust holds and refreshes the OAuth tokens; the webview only passes clientId.
  return await invoke<string>("gdrive_download_backup", {
    fileId: backup.destination,
    clientId: apiCfg.clientId,
  });
}

export default function RestoreWizard({ project, backup, onClose }: Props) {
  const [step, setStep] = useState<Step>("review");
  const [zipPath, setZipPath] = useState<string | null>(null);
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null);
  const [targetDir, setTargetDir] = useState(() =>
    defaultRestoreTarget(
      project.filePath,
      project.title,
      Math.floor(Date.now() / 1000),
    ),
  );
  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = useCallback(async () => {
    setError(null);
    setStep("verifying");
    try {
      const path = zipPath ?? (await resolveZipPath(backup));
      setZipPath(path);
      const report = await invoke<VerifyReport>("verify_backup", {
        zipPath: path,
      });
      setVerifyReport(report);
      setStep("verified");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("review");
    }
  }, [zipPath, backup]);

  const handlePickTarget = useCallback(async () => {
    const sel = await open({
      directory: true,
      multiple: false,
      title: "Choose restore folder",
    });
    if (!sel) return;
    const path = typeof sel === "string" ? sel : (sel as { path: string }).path;
    if (path) setTargetDir(path);
  }, []);

  const handleRestore = useCallback(async () => {
    setError(null);
    setStep("restoring");
    setProgress(null);

    let path = zipPath;
    try {
      if (!path) {
        path = await resolveZipPath(backup);
        setZipPath(path);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("confirm");
      return;
    }

    const unlisten = await listen<Progress>("restore:progress", (e) =>
      setProgress(e.payload),
    );
    try {
      const result = await invoke<RestoreOutcome>("restore_backup", {
        zipPath: path,
        destDir: targetDir,
      });
      setOutcome(result);
      await insertBackupRestore({
        backupId: backup.id,
        restoredTo: result.restoredTo,
        restoredAt: Math.floor(Date.now() / 1000),
        okCount: result.okCount,
        mismatchCount:
          result.mismatchCount + result.conflictCount + result.rejectedCount,
        errorMsg: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      await insertBackupRestore({
        backupId: backup.id,
        restoredTo: targetDir,
        restoredAt: Math.floor(Date.now() / 1000),
        okCount: 0,
        mismatchCount: 0,
        errorMsg: msg,
      });
    } finally {
      unlisten();
      setStep("result");
    }
  }, [zipPath, targetDir, backup]);

  const nonOkVerifyFiles =
    verifyReport?.files.filter((f) => f.status !== "ok") ?? [];
  const restoreGroups = outcome ? groupRestoreFilesByStatus(outcome.files) : {};

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== "restoring") onClose();
      }}
    >
      <div
        style={{
          width: 480,
          maxHeight: "82vh",
          overflowY: "auto",
          background: "var(--bg-1)",
          border: "1px solid var(--line-2)",
          borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          padding: 16,
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-0)",
          }}
        >
          Restore backup
        </div>

        {error && <div style={{ fontSize: 11, color: "#ff5a5a" }}>{error}</div>}

        {(step === "review" || step === "verifying") && (
          <>
            <div className="field-label">Backup</div>
            <div style={{ fontSize: 12, color: "var(--text-1)" }}>
              {backup.provider === "gdrive" ? "Google Drive" : "Local"} ·{" "}
              {fmtSize(backup.sizeBytes)}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="tb-btn primary"
                disabled={step === "verifying"}
                onClick={handleVerify}
              >
                {step === "verifying" ? "Verifying…" : "Verify"}
              </button>
              <button
                className="tb-btn"
                disabled={step === "verifying"}
                onClick={() => setStep("target")}
              >
                Skip verification
              </button>
              <button className="tb-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "verified" && verifyReport && (
          <>
            <div className="field-label">Verify result</div>
            <div style={{ fontSize: 12, color: "var(--text-1)" }}>
              {summarizeVerify(verifyReport)}
            </div>
            {nonOkVerifyFiles.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {nonOkVerifyFiles.map((f) => (
                  <div
                    key={f.archivePath}
                    style={{ fontSize: 10, color: "var(--text-3)" }}
                    title={f.originalPath}
                  >
                    {f.archivePath} — {f.status}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="tb-btn primary"
                onClick={() => setStep("target")}
              >
                Continue
              </button>
              <button className="tb-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "target" && (
          <>
            <div className="field-label">Restore to</div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-1)",
                fontFamily: "var(--font-mono)",
                wordBreak: "break-all",
                background: "var(--bg-2)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                padding: "6px 8px",
              }}
            >
              {targetDir}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-3)" }}>
              A new folder — nothing in it will be overwritten.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="tb-btn" onClick={handlePickTarget}>
                Choose folder…
              </button>
              <button
                className="tb-btn primary"
                onClick={() => setStep("confirm")}
              >
                Next
              </button>
              <button className="tb-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="field-label">Confirm restore</div>
            <div style={{ fontSize: 12, color: "var(--text-1)" }}>
              {verifyReport
                ? `${verifyReport.okCount + verifyReport.missingCount + verifyReport.corruptCount} files`
                : "File count unknown — verification was skipped"}{" "}
              will be extracted to:
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-1)",
                fontFamily: "var(--font-mono)",
                wordBreak: "break-all",
              }}
            >
              {targetDir}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="tb-btn primary" onClick={handleRestore}>
                Restore
              </button>
              <button className="tb-btn" onClick={() => setStep("target")}>
                Back
              </button>
              <button className="tb-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "restoring" && (
          <>
            <div className="field-label">Restoring…</div>
            {progress ? (
              <>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "var(--bg-2)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                  {progress.done} / {progress.total} — {progress.file}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                Starting…
              </div>
            )}
          </>
        )}

        {step === "result" && (
          <>
            <div className="field-label">Result</div>
            {outcome ? (
              <>
                <div style={{ fontSize: 12, color: "var(--text-1)" }}>
                  {summarizeRestore(outcome)}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                  Restored to: {outcome.restoredTo}
                </div>
                {Object.entries(restoreGroups)
                  .filter(([status]) => status !== "ok")
                  .map(([status, group]) => (
                    <div key={status}>
                      <div style={{ fontSize: 10, color: "var(--text-2)" }}>
                        {STATUS_LABEL[status] ?? status} ({group.length})
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                          maxHeight: 100,
                          overflowY: "auto",
                        }}
                      >
                        {group.map((f) => (
                          <div
                            key={f.archivePath}
                            style={{ fontSize: 10, color: "var(--text-3)" }}
                            title={f.detail ?? ""}
                          >
                            {f.archivePath}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#ff5a5a" }}>
                Restore failed{error ? `: ${error}` : ""}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="tb-btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
