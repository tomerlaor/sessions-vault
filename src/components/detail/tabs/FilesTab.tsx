import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  listFiles,
  addFile,
  updateFile,
  removeFile,
  setFinal,
} from "../../../db/queries/project-files";
import {
  nextVersionLabel,
  inferExportType,
  formatAudioSummary,
  audioWarnings,
  formatMediaSummary,
} from "../../../lib/project-files";
import type {
  Project,
  ProjectFile,
  ProjectFileKind,
  ExportType,
} from "../../../types";

interface Props {
  project: Project;
}

interface AudioInfo {
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  durationSecs: number | null;
  peakDb: number | null;
  clipped: boolean;
  lossy: boolean;
}

interface MediaReport {
  total: number;
  missing: number;
  external: number;
}

interface FileStat {
  sizeBytes: number;
  modifiedAt: number;
}

const DAW_EXTENSIONS = [
  "als",
  "logicx",
  "flp",
  "ptx",
  "cpr",
  "rpp",
  "bwproject",
  "song",
];
const AUDIO_EXTENSIONS = ["wav", "aif", "aiff", "flac", "mp3", "m4a"];

const EXPORT_TYPES: { value: ExportType; label: string }[] = [
  { value: "mix", label: "Mix" },
  { value: "master", label: "Master" },
  { value: "stems", label: "Stems" },
  { value: "instrumental", label: "Instrumental" },
  { value: "alternate", label: "Alternate" },
];

const SECTIONS: { kind: ProjectFileKind; title: string; add: string }[] = [
  { kind: "mix_project", title: "Record / Mix", add: "Add mix project" },
  { kind: "master_project", title: "Mastering", add: "Add mastering project" },
  { kind: "export", title: "Exports", add: "Add export" },
];

function fmtSize(bytes: number) {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function fmtDate(secs: number) {
  return new Date(secs * 1000).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function baseName(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

const chipStyle = (color: string): React.CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 6px",
  borderRadius: 3,
  color,
  border: `1px solid ${color}`,
});

export default function FilesTab({ project: p }: Props) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const reload = useCallback(async () => {
    const rows = await listFiles(p.id);
    setFiles(rows);
    if (rows.length === 0) {
      setExists({});
      return;
    }
    try {
      const flags = await invoke<boolean[]>("file_exists_many", {
        paths: rows.map((f) => f.filePath),
      });
      setExists(Object.fromEntries(rows.map((f, i) => [f.id, flags[i]])));
    } catch {
      setExists({});
    }
  }, [p.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleAdd = useCallback(
    async (kind: ProjectFileKind) => {
      setError(null);
      const isExport = kind === "export";
      const sel = await open({
        multiple: false,
        title: isExport ? "Select an export" : "Select a DAW project",
        filters: [
          {
            name: isExport ? "Audio" : "DAW project",
            extensions: isExport ? AUDIO_EXTENSIONS : DAW_EXTENSIONS,
          },
        ],
      });
      if (!sel) return;
      const path =
        typeof sel === "string" ? sel : (sel as { path: string }).path;
      if (!path) return;

      try {
        const stat = await invoke<FileStat>("file_stat", { path });
        const name = baseName(path);
        const sameKind = files.filter((f) => f.kind === kind);

        let audio: AudioInfo | null = null;
        let media: MediaReport | null = null;
        if (isExport) {
          audio = await invoke<AudioInfo>("inspect_audio", { path }).catch(
            () => null,
          );
        } else if (path.toLowerCase().endsWith(".als")) {
          media = await invoke<MediaReport | null>("inspect_project_media", {
            path,
          }).catch(() => null);
        }

        await addFile({
          projectId: p.id,
          kind,
          exportType: isExport ? inferExportType(name) : null,
          filePath: path,
          fileName: name,
          sizeBytes: stat.sizeBytes,
          versionLabel: nextVersionLabel(sameKind.map((f) => f.versionLabel)),
          fileDate: stat.modifiedAt,
          isFinal: false,
          linkedProjectId: null,
          sampleRate: audio?.sampleRate ?? null,
          bitDepth: audio?.bitDepth ?? null,
          channels: audio?.channels ?? null,
          durationSecs: audio?.durationSecs ?? null,
          peakDb: audio?.peakDb ?? null,
          clipped: audio?.clipped ?? false,
          lossy: audio?.lossy ?? false,
          mediaMissingCount: media?.missing ?? null,
          mediaExternalCount: media?.external ?? null,
          note: null,
        });
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [files, p.id, reload],
  );

  const saveLabel = async (f: ProjectFile) => {
    const label = labelDraft.trim();
    setEditingId(null);
    if (!label || label === f.versionLabel) return;
    await updateFile(f.id, { versionLabel: label });
    await reload();
  };

  const finalFile = files.find((f) => f.isFinal);

  const renderRow = (f: ProjectFile) => {
    const missing = exists[f.id] === false;
    const warnings = audioWarnings(f);
    const summary =
      f.kind === "export"
        ? formatAudioSummary(f)
        : formatMediaSummary(f.mediaMissingCount, f.mediaExternalCount);
    const mediaWarn = f.kind !== "export" && (f.mediaMissingCount ?? 0) > 0;

    return (
      <div
        key={f.id}
        style={{
          background: "var(--bg-2)",
          border: `1px solid ${f.isFinal ? "#5cd18b" : "var(--line)"}`,
          borderRadius: 5,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {editingId === f.id ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => saveLabel(f)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveLabel(f);
                if (e.key === "Escape") setEditingId(null);
              }}
              style={{ width: 90, fontSize: 11 }}
            />
          ) : (
            <button
              title="Edit version label"
              onClick={() => {
                setEditingId(f.id);
                setLabelDraft(f.versionLabel);
              }}
              style={{
                background: "none",
                border: "1px solid var(--line)",
                borderRadius: 3,
                color: "var(--text-1)",
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 6px",
                cursor: "pointer",
              }}
            >
              {f.versionLabel}
            </button>
          )}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: missing ? "#ff5a5a" : "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={f.filePath}
          >
            {f.fileName}
          </div>
          {f.isFinal && <span style={chipStyle("#5cd18b")}>FINAL</span>}
          {missing && <span style={chipStyle("#ff5a5a")}>Missing</span>}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--text-3)",
          }}
        >
          {f.kind === "export" && (
            <select
              value={f.exportType ?? "mix"}
              onChange={async (e) => {
                await updateFile(f.id, {
                  exportType: e.target.value as ExportType,
                });
                await reload();
              }}
              style={{ fontSize: 11 }}
            >
              {EXPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          <span>{fmtDate(f.fileDate)}</span>
          <span>{fmtSize(f.sizeBytes)}</span>
          {summary && (
            <span style={{ color: mediaWarn ? "#ffcc66" : undefined }}>
              {summary}
            </span>
          )}
          {warnings.map((w) => (
            <span key={w} style={chipStyle("#ffcc66")}>
              {w}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <button
            className="tb-btn"
            onClick={() => invoke("reveal_in_finder", { path: f.filePath })}
          >
            Reveal
          </button>
          {f.kind !== "export" && !missing && (
            <button
              className="tb-btn"
              onClick={() => invoke("open_in_daw", { path: f.filePath })}
            >
              Open
            </button>
          )}
          {f.kind === "export" && !f.isFinal && (
            <button
              className="tb-btn"
              onClick={async () => {
                await setFinal(p.id, f.id);
                await reload();
              }}
            >
              Mark final
            </button>
          )}
          <button
            className="tb-btn"
            title="Removes it from this list only. The file on disk is untouched."
            onClick={async () => {
              await removeFile(f.id);
              await reload();
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {finalFile && (
        <div
          style={{
            border: "1px solid #5cd18b",
            borderRadius: 5,
            padding: "8px 10px",
            fontSize: 12,
          }}
        >
          <div className="field-label">Final version</div>
          <div style={{ color: "var(--text-1)" }}>
            {finalFile.versionLabel} · {finalFile.fileName}
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: "#ff5a5a" }}>{error}</div>}

      {SECTIONS.map(({ kind, title, add }) => {
        const rows = files
          .filter((f) => f.kind === kind)
          .sort((a, b) => b.fileDate - a.fileDate);
        return (
          <div
            key={kind}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div className="field-label">{title}</div>
            {kind === "mix_project" && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-3)",
                  padding: "0 2px",
                }}
                title={p.filePath}
              >
                This project: {baseName(p.filePath)}
              </div>
            )}
            {rows.map(renderRow)}
            {rows.length === 0 && kind !== "mix_project" && (
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                Nothing added yet.
              </div>
            )}
            <button
              className="tb-btn"
              style={{ justifyContent: "center", padding: "6px 12px" }}
              onClick={() => handleAdd(kind)}
            >
              + {add}
            </button>
          </div>
        );
      })}
    </div>
  );
}
