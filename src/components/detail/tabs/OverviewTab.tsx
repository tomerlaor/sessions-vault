import TagInput from "../../shared/TagInput";

function formatDuration(secs: number | null): string | null {
  if (secs == null) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
import type { Project } from "../../../types";
import type { Tag } from "../../../types";

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

interface Props {
  project: Project;
  allTags: Tag[];
  onUpdate: (field: string, value: unknown) => void;
  onTagChange: () => void;
}

export default function OverviewTab({
  project: p,
  allTags,
  onUpdate,
  onTagChange,
}: Props) {
  return (
    <>
      <div className="field-label">Description</div>
      <textarea
        className="description-input"
        rows={5}
        placeholder="What is this project about? Mood, references, what's unfinished…"
        value={p.notes ?? ""}
        onChange={(e) => onUpdate("notes", e.target.value)}
      />

      <div style={{ marginTop: 18 }} className="field-label">
        Details
      </div>
      <div className="meta-grid">
        {(
          [
            ["BPM", p.bpm],
            ["Time", p.timeSignature],
            ["Tracks", p.trackCount],
            ["Duration", formatDuration(p.durationSecs)],
          ] as const
        ).map(([l, v]) => (
          <div key={l}>
            <div className="lbl">{l}</div>
            <div className="val">{v ?? "—"}</div>
          </div>
        ))}
        <div>
          <div className="lbl">Key</div>
          <select
            className="val key-select"
            value={p.key ?? ""}
            onChange={(e) => onUpdate("key", e.target.value || null)}
          >
            <option value="">—</option>
            {KEY_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 18 }} className="field-label">
        Tags
      </div>
      <TagInput
        projectId={p.id}
        projectTags={p.tags ?? []}
        allTags={allTags}
        onChange={onTagChange}
      />
    </>
  );
}
