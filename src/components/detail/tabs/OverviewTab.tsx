import TagInput from "../../shared/TagInput";
import type { Project } from "../../../types";
import type { Tag } from "../../../types";

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
